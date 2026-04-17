const Database = require('better-sqlite3');
const db = new Database('data/stack.db');

/**
 * Stack Wellness 7-Category Discount Classification
 *
 * 1. loyalty_redemption  — Points, birthday, earned rewards
 * 2. acquisition         — Sign-up, referral offers
 * 3. meal_deal           — Meal deals, breakfast deals, bundles
 * 4. seasonal_lto        — BOGO, seasonal promos, LTOs
 * 5. community_service   — Military, heroes, case discount, VIP
 * 6. operations          — Employee, manager comp, spillage, open discounts
 * 7. partner_marketing   — Momo's, in-kind marketing, influencer
 */
function categorize(name) {
  const l = name.toLowerCase();

  // Cat 2: Acquisition & Referral — sign up, referral
  if (l.includes('sign up') || l.includes('signup') || l.includes('sign-up')) return 'acquisition';
  if (l.includes('referal') || l.includes('referral') || l.includes('refferal')) return 'acquisition';

  // Cat 1: Loyalty Redemptions — points, birthday
  if (l.includes('points') || l.includes('1000 points')) return 'loyalty_redemption';
  if (l.includes('birthday')) return 'loyalty_redemption';
  if (l.includes('free delivery')) return 'loyalty_redemption';

  // Cat 3: Meal Deals & Bundles
  if (l.includes('meal deal')) return 'meal_deal';
  if (l.includes('breakfast deal')) return 'meal_deal';
  if (l.includes('app - meal')) return 'meal_deal';
  if (l.includes('app - breakfast')) return 'meal_deal';
  if (l.includes('web/app - meal')) return 'meal_deal';
  if (l.includes('kiosk')) return 'meal_deal';
  if (l.includes('meal deal -') || l.includes('meal deal –')) return 'meal_deal';

  // Cat 4: Seasonal & LTO
  if (l.includes('bogo')) return 'seasonal_lto';
  if (l.includes('val20')) return 'seasonal_lto';
  if (l.includes('vip discount')) return 'seasonal_lto';
  if (l.includes('10% off')) return 'seasonal_lto';
  if (l.includes('free egg bite') || l.includes('egg bite')) return 'seasonal_lto';
  if (l.includes('free stackwich') || l.includes('stackwich')) return 'seasonal_lto';
  if (l.includes('chck 20')) return 'seasonal_lto';
  if (l.includes('friends & family')) return 'seasonal_lto';
  if (l.includes('ubereats')) return 'seasonal_lto';

  // Cat 5: Community & Service
  if (l.includes('military') || l.includes('first responder')) return 'community_service';
  if (l.includes('service 20%') || l.includes('heroes')) return 'community_service';
  if (l.includes('case discount')) return 'community_service';

  // Cat 6: Internal & Operational
  if (l.includes('employee')) return 'operations';
  if (l.includes('manager comp')) return 'operations';
  if (l.includes('open $') || l.includes('open %')) return 'operations';
  if (l.includes('spillage') || l.includes('food quality')) return 'operations';
  if (l.includes('employee meal')) return 'operations';

  // Cat 7: Partner & In-Kind Marketing
  if (l.includes('momo')) return 'partner_marketing';
  if (l.includes('in-kind') || l.includes('in kind')) return 'partner_marketing';
  if (l.includes('influencer')) return 'partner_marketing';

  return 'other';
}

// Re-categorize all existing records
const rows = db.prepare('SELECT id, discount_name FROM fact_discount_summary').all();
const updateStmt = db.prepare('UPDATE fact_discount_summary SET discount_category = ? WHERE id = ?');

const counts = {};
db.transaction(() => {
  for (const row of rows) {
    const cat = categorize(row.discount_name);
    updateStmt.run(cat, row.id);
    counts[cat] = (counts[cat] || 0) + 1;
  }
})();

console.log('Re-categorized', rows.length, 'discount records:');
Object.entries(counts).sort(([,a],[,b]) => b - a).forEach(([cat, cnt]) => {
  console.log(`  ${cat}: ${cnt} records`);
});

// Verify by period
const summary = db.prepare(`
  SELECT period, discount_category, COUNT(*) as cnt, ROUND(SUM(discount_amount), 2) as total
  FROM fact_discount_summary
  WHERE period = '2026-02'
  GROUP BY discount_category
  ORDER BY total DESC
`).all();
console.log('\nFeb 2026 by category:');
summary.forEach(r => console.log(`  ${r.discount_category}: ${r.cnt} items, $${r.total}`));

db.close();
