/**
 * Ingest an Incentivio Customer Export CSV into fact_crm_customer_snapshot
 * for a specific snapshot_month, then derive transitions for the
 * prev-snapshot → this-snapshot pair.
 *
 * Usage:
 *   node scripts/ingest-april-2026-crm.cjs [csvPath] [snapshotMonth]
 *
 * Defaults (no args): the original April 2026 export ingested as 2026-04.
 *
 * Both args are optional — if omitted, falls back to the April defaults
 * (preserves the original one-shot behavior).
 */
const path = require('path');
const fs = require('fs');
const Papa = require('papaparse');
const Database = require('better-sqlite3');
const {
  deriveStageTransitions,
  computeDaysInStage,
} = require('../server/lib/stage-transitions.cjs');

const DEFAULT_CSV = '/Users/carsongoodale/Desktop/Stack/Customer_Data/stackwellnesscafe_Customer_Export_2026_04_17_UTC_03_42_05_4ba9c50f-ac40-43e6-9521-8eb4ef7263ca_.csv';
const CSV_PATH = process.argv[2] || DEFAULT_CSV;
const SNAPSHOT_MONTH = process.argv[3] || '2026-04';
const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
console.log(`CSV:      ${CSV_PATH}`);
console.log(`Snapshot: ${SNAPSHOT_MONTH}`);

// Parse CSV
const csv = fs.readFileSync(CSV_PATH, 'utf8');
const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
console.log(`Parsed ${parsed.data.length} CSV rows`);
if (parsed.errors.length > 0) {
  console.warn(`  ${parsed.errors.length} parse warnings (continuing)`);
}

function toNum(v) {
  if (v === undefined || v === null || v === '' || v === '-') return 0;
  const n = parseFloat(String(v).replace(/[$,]/g, ''));
  return isNaN(n) ? 0 : n;
}

// Transform to snapshot schema. Field coverage mirrors server/parsers/crm.ts
// (the normal CRM parser) so the April snapshot has the same columns populated
// as prior months — critical for LTV calc which needs purchases_per_month +
// avg_basket_value together. Earlier rev of this script omitted many fields
// and caused projected LTV = 0 (ROI flipped negative) in the dashboard.
const boolTxt = (v) => (v === 'TRUE' || v === 'true' || v === '1' || v === 'YES' || v === 'Yes') ? 1 : 0;
const strOrEmpty = (v) => (v && v !== '-') ? String(v) : '';

// Normalize Incentivio's attrition_risk labels to the canonical low/medium/high
// taxonomy used elsewhere in the app. Mirrors server/parsers/crm.ts.
// Incentivio's export values: CHURNED | SLIDER | NO_RISK | '-' (blank).
function normalizeAttritionRisk(raw) {
  const v = (raw || '').toUpperCase().trim();
  if (v === 'CHURNED') return 'high';
  if (v === 'SLIDER') return 'medium';
  if (v === 'NO_RISK') return 'low';
  return 'unknown';
}
const snapshotRows = parsed.data.map(r => ({
  customer_id: r['Customer ID'],
  snapshot_month: SNAPSHOT_MONTH,
  first_name: strOrEmpty(r['First Name']),
  last_name: strOrEmpty(r['Last Name']),
  email: strOrEmpty(r['Email Address']),
  phone: strOrEmpty(r['Phone']),
  journey_stage: (r['Guest Journey Stage'] && r['Guest Journey Stage'] !== '-') ? r['Guest Journey Stage'] : 'UNKNOWN',
  attrition_risk: normalizeAttritionRisk(r['Attrition Risk']),
  reach_location: strOrEmpty(r['Reach Location']),
  // Core spend/frequency
  lifetime_spend: toNum(r['Lifetime Spend']),
  lifetime_visits: toNum(r['Lifetime Visits']),
  avg_basket_value: toNum(r['Average Basket Value']),
  avg_basket_value_per_month: toNum(r['Average Basket Value Per Month']),
  purchases_per_month: toNum(r['Purchases per Month']),
  avg_purchases_per_week: toNum(r['Average Purchases Per Week']),
  // Last 90 day window
  last_90_days_spend: toNum(r['Last 90 day Spend']),
  last_90_days_orders: toNum(r['Last 90 day Orders']),
  last_90_day_monthly_spend: toNum(r['Last 90 day monthly Spend']),
  last_90_day_avg_weekly_spend: toNum(r['Last 90 day average weekly Spend']),
  // Year window
  last_year_spend: toNum(r['Last year Spend']),
  last_year_orders: toNum(r['Last year Orders']),
  // Percentiles
  days_since_last_visit_pct: toNum(r['Days Since Last Purchase Percentile']),
  lifetime_aov_percentile: toNum(r['Lifetime Average Order Value Percentile']),
  purchases_per_month_pct: toNum(r['Purchases per Month Percentile']),
  // Referrals
  lifetime_referrals: toNum(r['Lifetime Referrals']),
  referrals_who_ordered: toNum(r['No of Referrals who Ordered']),
  orders_from_referrals: toNum(r['No of Orders from Referrals']),
  total_spend_from_referrals: toNum(r['Total Spend from Referrals']),
  unique_referral_code: strOrEmpty(r['Unique Referral Code']),
  // Engagement flags
  sms_order_notification_opt: boolTxt(r['SMS Order Notification Opt in']),
  valid_email: boolTxt(r['Valid Email?']),
  email_opt_in: boolTxt(r['Email Opt In']),
  sms_opt_in: boolTxt(r['SMS Marketing Opt in']),
  // Demographics
  date_of_birth: strOrEmpty(r['Date of Birth']),
  age: toNum(r['AGE']),
  gender: strOrEmpty(r['GENDER']),
  // Loyalty + weekly spend
  current_loyalty_balance: toNum(r['Current Loyalty Balance']),
  avg_weekly_spend: toNum(r['AVERAGE_WEEKLY_SPEND']),
  // Dates
  account_created_date: strOrEmpty(r['Account Created Date']),
  last_visit_date: strOrEmpty(r['Last Purchase Date']),
  days_since_signup: toNum(r['Days since Signup']),
  days_since_last_visit: toNum(r['Days Since Last Purchase']),
  user_affiliation: strOrEmpty(r['User Affiliation']),
  signup_source: strOrEmpty(r['Signup Source']),
})).filter(r => r.customer_id);

console.log(`Transformed ${snapshotRows.length} valid customer rows`);

const db = new Database(DB_PATH);

// Idempotent snapshot upsert: DELETE month, then INSERT
db.prepare('DELETE FROM fact_crm_customer_snapshot WHERE snapshot_month = ?').run(SNAPSHOT_MONTH);

const insertSnap = db.prepare(`
  INSERT INTO fact_crm_customer_snapshot
  (customer_id, snapshot_month, first_name, last_name, email, phone, journey_stage, attrition_risk,
   reach_location, lifetime_spend, lifetime_visits, avg_basket_value,
   avg_basket_value_per_month, purchases_per_month, avg_purchases_per_week,
   last_90_days_spend, last_90_days_orders, last_90_day_monthly_spend, last_90_day_avg_weekly_spend,
   last_year_spend, last_year_orders,
   days_since_last_visit_pct, lifetime_aov_percentile, purchases_per_month_pct,
   lifetime_referrals, referrals_who_ordered, orders_from_referrals, total_spend_from_referrals,
   unique_referral_code,
   sms_order_notification_opt, valid_email, email_opt_in, sms_opt_in,
   date_of_birth, age, gender,
   current_loyalty_balance, avg_weekly_spend,
   account_created_date, last_visit_date, days_since_signup, days_since_last_visit,
   user_affiliation, signup_source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  for (const r of snapshotRows) {
    insertSnap.run(
      r.customer_id, r.snapshot_month, r.first_name, r.last_name, r.email, r.phone,
      r.journey_stage, r.attrition_risk, r.reach_location,
      r.lifetime_spend, r.lifetime_visits, r.avg_basket_value,
      r.avg_basket_value_per_month, r.purchases_per_month, r.avg_purchases_per_week,
      r.last_90_days_spend, r.last_90_days_orders, r.last_90_day_monthly_spend, r.last_90_day_avg_weekly_spend,
      r.last_year_spend, r.last_year_orders,
      r.days_since_last_visit_pct, r.lifetime_aov_percentile, r.purchases_per_month_pct,
      r.lifetime_referrals, r.referrals_who_ordered, r.orders_from_referrals, r.total_spend_from_referrals,
      r.unique_referral_code,
      r.sms_order_notification_opt, r.valid_email, r.email_opt_in, r.sms_opt_in,
      r.date_of_birth, r.age, r.gender,
      r.current_loyalty_balance, r.avg_weekly_spend,
      r.account_created_date, r.last_visit_date, r.days_since_signup, r.days_since_last_visit,
      r.user_affiliation, r.signup_source,
    );
  }
})();

console.log(`Inserted ${snapshotRows.length} rows into fact_crm_customer_snapshot`);

// Derive new transitions for (prev, April) pair
const prevMonth = db.prepare(`
  SELECT MAX(snapshot_month) AS m FROM fact_crm_customer_snapshot
  WHERE snapshot_month < ? AND snapshot_month != '2025-08'
`).get(SNAPSHOT_MONTH).m;
console.log(`Previous snapshot: ${prevMonth}`);

const prevRows = db.prepare(`
  SELECT customer_id, journey_stage, lifetime_spend, lifetime_visits, account_created_date
  FROM fact_crm_customer_snapshot WHERE snapshot_month = ?
`).all(prevMonth);

// Idempotent transition refresh
const beforeCount = db.prepare('SELECT COUNT(*) AS n FROM fact_stage_transition WHERE to_snapshot = ?').get(SNAPSHOT_MONTH).n;
db.prepare('DELETE FROM fact_stage_transition WHERE to_snapshot = ?').run(SNAPSHOT_MONTH);

const newTransitions = deriveStageTransitions(prevRows, snapshotRows, prevMonth, SNAPSHOT_MONTH);
console.log(`Derived ${newTransitions.length} new transitions for ${prevMonth} → ${SNAPSHOT_MONTH}`);

// Re-chain days_in_from_stage for all transitions (since new April rows need to feed into existing chains)
const allTransitions = db.prepare(`
  SELECT customer_id, from_stage, to_stage, direction, from_snapshot, to_snapshot,
         days_in_from_stage, spend_in_from_stage, visits_in_from_stage,
         from_lifetime_spend, to_lifetime_spend, from_lifetime_visits, to_lifetime_visits,
         estimated_transition_date
  FROM fact_stage_transition ORDER BY customer_id, to_snapshot
`).all().concat(newTransitions);

const acctCreated = new Map();
for (const r of db.prepare('SELECT customer_id, MIN(account_created_date) AS d FROM fact_crm_customer_snapshot WHERE account_created_date NOT IN (\'\', \'-\') GROUP BY customer_id').all()) {
  acctCreated.set(r.customer_id, r.d);
}
computeDaysInStage(allTransitions, acctCreated);

// Insert only the new transitions (existing ones are untouched except for days_in_from_stage chain recomputation)
const insertTrans = db.prepare(`
  INSERT INTO fact_stage_transition
  (customer_id, from_stage, to_stage, direction, from_snapshot, to_snapshot,
   days_in_from_stage, spend_in_from_stage, visits_in_from_stage,
   from_lifetime_spend, to_lifetime_spend, from_lifetime_visits, to_lifetime_visits,
   estimated_transition_date)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  for (const t of newTransitions) {
    insertTrans.run(
      t.customer_id, t.from_stage, t.to_stage, t.direction,
      t.from_snapshot, t.to_snapshot,
      t.days_in_from_stage, t.spend_in_from_stage, t.visits_in_from_stage,
      t.from_lifetime_spend, t.to_lifetime_spend,
      t.from_lifetime_visits, t.to_lifetime_visits,
      t.estimated_transition_date,
    );
  }
})();

const afterCount = db.prepare('SELECT COUNT(*) AS n FROM fact_stage_transition WHERE to_snapshot = ?').get(SNAPSHOT_MONTH).n;
console.log(`\nTransitions to ${SNAPSHOT_MONTH}: before=${beforeCount}, after=${afterCount}, delta=${afterCount - beforeCount}`);

// Verification summary
const stageSummary = db.prepare(`
  SELECT journey_stage, COUNT(*) AS n FROM fact_crm_customer_snapshot
  WHERE snapshot_month = ? GROUP BY journey_stage ORDER BY n DESC
`).all(SNAPSHOT_MONTH);
console.log(`\nApril stage distribution:`);
console.table(stageSummary);

db.close();
console.log('\nDone.');
