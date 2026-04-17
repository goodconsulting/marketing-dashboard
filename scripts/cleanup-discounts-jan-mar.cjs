/**
 * Cleanup fact_discount_summary for Jan + March 2026.
 *
 * Two bugs being fixed:
 *   1. "Total" summary rows were being ingested as data rows, inflating
 *      totals (usage_count and discount_amount) by ~2x when the UI sums
 *      all rows for the period.
 *   2. Discount categorization drifted between ingest passes — many
 *      discount names have conflicting categories across rows (e.g.
 *      "1000 Points = Free Smoothie" appears as both 'loyalty' and
 *      'loyalty_redemption'). This script applies the canonical mapping
 *      confirmed with the user on 2026-04-17.
 *
 * Idempotent. Re-running replaces March with the canonical snapshot and
 * keeps Jan line items (minus the Total + em-dash duplicates) with
 * refreshed categorization.
 */
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const db = new Database(DB_PATH);

// ── Canonical category mapping (March 46 line items + any Jan extras) ─────
// Keyed by exact discount_name string. If a name isn't in this map, the
// existing category is left alone (logged as "uncategorized — review").
const CANONICAL = {
  // loyalty_redemption (earned rewards burned)
  '1000 Points = Free Smoothie':                                'loyalty_redemption',
  'APP - 1000 Points - Free Smoothie':                          'loyalty_redemption',
  'APP - Birthday Offer - Free Smoothie':                       'loyalty_redemption',
  'Birthday Offer - Free Smoothie':                             'loyalty_redemption',
  'App - Free Delivery ($3.99)':                                'loyalty_redemption',

  // acquisition (new customer / referral)
  'APP - Sign up offer Free Smoothie (8.99)':                   'acquisition',
  'APP - Sign up offer Free Smoothie (7.25 )':                  'acquisition',
  'Sign Up Offer - Free Smoothie':                              'acquisition',
  'APP - Referal Offer - Free Smoothie (8.99) Existing Customer':'acquisition',
  'APP - Referal Offer - Free Smoothie (8.99) New customer':    'acquisition',
  'Referral Offer - Free Smoothie ($8.99 Value)':               'acquisition',
  'Referral Offer - New sign up ($8.99 Value)':                 'acquisition',

  // meal_deal
  'APP - Breakfast Deal':                                       'meal_deal',
  'APP - Meal Deal':                                            'meal_deal',
  'Breakfast Deal':                                             'meal_deal',
  'Breakfast Deal (Kiosk)':                                     'meal_deal',
  'Breakfast Deal - $1.25 off':                                 'meal_deal',
  'Breakfast Deal - $10.99':                                    'meal_deal',
  'Meal Deal':                                                  'meal_deal',
  'Meal Deal – Save $3.99':                                     'meal_deal',
  'Meal Deal – Save $4.99':                                     'meal_deal',
  'Meal Deal – Save $2.99':                                     'meal_deal',
  'Meal Deal - Save $3.99':                                     'meal_deal',
  'Meal Deal - Save $4.99':                                     'meal_deal',
  'Meal Deal - Save $2.99':                                     'meal_deal',
  'Meal Deal (Kiosk)':                                          'meal_deal',
  'Meal Deal - Eastern Iowa':                                   'meal_deal',
  'Meal Deal - Central Iowa':                                   'meal_deal',
  'Web/app - meal deal Eastern iowa':                           'meal_deal',
  'Web/app - meal deal central iowa':                           'meal_deal',

  // operations (internal comp, staff, waste)
  'Employee Discount - Item':                                   'operations',
  'Employee Discount - Check':                                  'operations',
  'Employee Meal 100%':                                         'operations',
  'Manager Comp - Item':                                        'operations',
  'Manager Comp - Check':                                       'operations',
  'Spillage/Food Quality - Item':                               'operations',
  'Open % Item':                                                'operations',
  'Open % Check':                                               'operations',
  'Open $ Check':                                               'operations',
  'Case Discount (20%)':                                        'operations',

  // print (print-attributable codes)
  'VAL20':                                                      'print',
  'VALBOGO':                                                    'print',
  'BOGO Card':                                                  'print',
  'CHCK 20':                                                    'print',

  // partner_marketing (3rd-party platforms + influencer + VIP)
  "Momo's 20% off":                                             'partner_marketing',
  'Stack Influencer Program':                                   'partner_marketing',
  'Stack Influencer Program.':                                  'partner_marketing',
  '100% OFF IN-KIND MARKETING':                                 'partner_marketing',
  'UberEats PERCENT':                                           'partner_marketing',
  'UberEats PERCENTOFF':                                        'partner_marketing',
  'VIP Discount - 20% Off':                                     'partner_marketing',
  'VIP Discount - 20% OFF':                                     'partner_marketing',

  // community_service
  'Service 20% - Heroes':                                       'community_service',
  'Friends & Family Discount - 20% OFF':                        'community_service',

  // seasonal_lto
  '10% off all in-store products':                              'seasonal_lto',
  'DISC RETAIL 20%':                                            'seasonal_lto',

  // loyalty (one-off communication makegood)
  'Please Disregard Today\u2019s Birthday Smoothie Email':      'loyalty',
};

// ── March 2026 canonical line items (from user on 2026-04-17) ─────────────
// Each row: [discount_name, usage_count, discount_amount, profitability, pct_of_total_sales]
const MARCH_2026 = [
  ['1000 Points = Free Smoothie',                                   277,  2320.25,  2768.09, 0.90],
  ['10% off all in-store products',                                   7,     6.29,    78.50, 0.00],
  ['APP - 1000 Points - Free Smoothie',                             204,  1706.02,  1631.66, 0.70],
  ['APP - Birthday Offer - Free Smoothie',                          139,  1164.17,   502.36, 0.50],
  ['APP - Breakfast Deal',                                            7,     8.75,    73.43, 0.00],
  ['APP - Referal Offer - Free Smoothie (8.99) Existing Customer',   19,   158.82,    68.68, 0.10],
  ['APP - Referal Offer - Free Smoothie (8.99) New customer',        28,   236.49,    60.45, 0.10],
  ['APP - Sign up offer Free Smoothie (8.99)',                      421,  3594.04,  2348.61, 1.40],
  ['Birthday Offer - Free Smoothie',                                115,   973.12,   801.31, 0.40],
  ['BOGO Card',                                                      52,   445.49,   708.83, 0.20],
  ['Breakfast Deal - $1.25 off',                                     19,    23.75,   255.39, 0.00],
  ['Case Discount (20%)',                                             8,    71.03,   649.02, 0.00],
  ['DISC RETAIL 20%',                                                 2,    11.20,    64.11, 0.00],
  ['Employee Discount - Item',                                      100,   221.12,   746.98, 0.10],
  ['Employee Meal 100%',                                            108,  1092.80,    17.22, 0.40],
  ['Manager Comp - Item',                                            25,   280.51,   207.74, 0.10],
  ['Meal Deal \u2013 Save $3.99',                                     8,    31.92,   144.85, 0.00],
  ['Meal Deal \u2013 Save $4.99',                                     4,    19.96,    80.69, 0.00],
  ["Momo's 20% off",                                                 26,    68.18,   365.04, 0.00],
  ['Open % Item',                                                    53,   785.22,  2485.87, 0.30],
  ['Referral Offer - Free Smoothie ($8.99 Value)',                   11,    90.89,   115.57, 0.00],
  ['Referral Offer - New sign up ($8.99 Value)',                     11,    91.89,    85.16, 0.00],
  ['Service 20% - Heroes',                                           65,   157.80,   817.06, 0.10],
  ['Sign Up Offer - Free Smoothie',                                 305,  2615.70,  2201.77, 1.00],
  ['Spillage/Food Quality - Item',                                   18,   311.05,     0.00, 0.10],
  ['VAL20',                                                          29,   121.31,   516.36, 0.00],
  ['VALBOGO',                                                         6,    65.94,    96.52, 0.00],
  ['VIP Discount - 20% Off',                                          4,     7.00,    38.95, 0.00],
  ['Web/app - meal deal central iowa',                               56,   279.44,  1144.19, 0.10],
  ['Web/app - meal deal Eastern iowa',                              278,  1109.22,  5342.19, 0.40],
  ['CHCK 20',                                                        62,   234.06,   947.41, 0.10],
  ['Stack Influencer Program',                                       13,   161.60,     0.00, 0.10],
  ['100% OFF IN-KIND MARKETING',                                     42,   702.06,     3.11, 0.30],
  ['App - Free Delivery ($3.99)',                                     6,    23.94,   279.97, 0.00],
  ['Employee Discount - Check',                                     113,   358.17,   836.99, 0.10],
  ['VIP Discount - 20% OFF',                                         13,    72.09,   272.67, 0.00],
  ['Meal Deal - Eastern Iowa',                                     1584,  6439.16, 38724.52, 2.50],
  ['Manager Comp - Check',                                           30,   656.51,     0.00, 0.30],
  ['Meal Deal - Central Iowa',                                      364,  1832.36,  9816.90, 0.70],
  ['UberEats PERCENT',                                               11,    73.01,   218.96, 0.00],
  ['Open $ Check',                                                    9,   212.24,    56.47, 0.10],
  ['Please Disregard Today\u2019s Birthday Smoothie Email',           6,     0.80,    73.38, 0.00],
  ['UberEats PERCENTOFF',                                             4,    25.30,    75.85, 0.00],
  ['Meal Deal (Kiosk)',                                              17,    69.83,   362.99, 0.00],
  ['Breakfast Deal',                                                 63,    78.75,  1413.15, 0.00],
  ['Open % Check',                                                   59,   279.17,   598.57, 0.10],
];

// ── Step 1: Delete all "Total" summary rows across all periods ────────────
const delTotals = db.prepare(`DELETE FROM fact_discount_summary WHERE discount_name = 'Total'`).run();
console.log(`Deleted ${delTotals.changes} "Total" summary rows across all periods`);

// ── Step 2: Replace March 2026 with canonical data ────────────────────────
const delMar = db.prepare(`DELETE FROM fact_discount_summary WHERE period = '2026-03' AND period_type = 'month'`).run();
console.log(`Deleted ${delMar.changes} stale March rows`);

const insMar = db.prepare(`
  INSERT INTO fact_discount_summary
  (period, period_type, discount_name, discount_category, usage_count, discount_amount, profitability, pct_of_total_sales)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
let marInserted = 0, marUncategorized = 0;
db.transaction(() => {
  for (const [name, count, amount, profit, pct] of MARCH_2026) {
    const category = CANONICAL[name];
    if (!category) {
      console.warn(`  UNCATEGORIZED (review): "${name}"`);
      marUncategorized++;
    }
    insMar.run('2026-03', 'month', name, category || 'other', count, amount, profit, pct);
    marInserted++;
  }
})();
console.log(`Inserted ${marInserted} March 2026 rows (${marUncategorized} uncategorized → fell back to 'other')`);

// ── Step 3: Re-apply canonical categories to remaining Jan rows ───────────
// For Jan, we don't have a fresh CSV — so keep the existing counts/amounts
// but overwrite discount_category with the canonical value. Also dedupe the
// em-dash vs hyphen Meal Deal variants (Jan had both forms for the same
// items with identical counts/amounts).
const janRows = db.prepare(`SELECT id, discount_name FROM fact_discount_summary WHERE period = '2026-01' AND period_type = 'month'`).all();
let janRecategorized = 0, janUncategorized = 0;
const updateCat = db.prepare(`UPDATE fact_discount_summary SET discount_category = ? WHERE id = ?`);
db.transaction(() => {
  for (const r of janRows) {
    const category = CANONICAL[r.discount_name];
    if (category) {
      updateCat.run(category, r.id);
      janRecategorized++;
    } else {
      console.warn(`  JAN UNCATEGORIZED (review): "${r.discount_name}"`);
      janUncategorized++;
    }
  }
})();
console.log(`Jan: recategorized ${janRecategorized} rows (${janUncategorized} left uncategorized)`);

// ── Step 4: Dedupe Jan's em-dash / hyphen Meal Deal duplicates ────────────
// In Jan, "Meal Deal - Save $4.99" (hyphen, meal_deal) and "Meal Deal – Save
// $4.99" (em-dash, other originally) both exist with identical counts and
// amounts. Same for "$2.99". Keep the em-dash variant (matches March CSV
// format), delete the hyphen one.
const delHyphenDupes = db.prepare(`
  DELETE FROM fact_discount_summary
  WHERE period = '2026-01' AND period_type = 'month'
    AND discount_name IN ('Meal Deal - Save $4.99', 'Meal Deal - Save $2.99', 'Meal Deal - Save $3.99')
`).run();
console.log(`Deleted ${delHyphenDupes.changes} Jan hyphen-variant Meal Deal duplicates`);

// ── Verify ────────────────────────────────────────────────────────────────
console.log('\n=== Post-cleanup verification ===');
for (const p of ['2026-01', '2026-02', '2026-03']) {
  const agg = db.prepare(`
    SELECT COUNT(*) AS lines, SUM(usage_count) AS uses,
           ROUND(SUM(discount_amount),2) AS amount,
           ROUND(SUM(profitability),2) AS profit
    FROM fact_discount_summary WHERE period = ? AND period_type = 'month'
  `).get(p);
  const sales = db.prepare(`
    SELECT ROUND(SUM(gross_sales),2) AS gross, ROUND(SUM(discount_total),2) AS disc_from_toast
    FROM fact_store_sales WHERE month = ?
  `).get(p);
  const pct = agg.amount && sales.gross ? ((agg.amount / sales.gross) * 100).toFixed(2) : 'n/a';
  console.log(`${p}: ${agg.lines} lines / ${agg.uses} uses / $${agg.amount} disc / $${agg.profit} profit | Toast gross $${sales.gross} | Disc/Gross = ${pct}%`);
}

db.close();
console.log('\nDone.');
