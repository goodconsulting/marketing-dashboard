/**
 * Ingest April 2026 CRM export into fact_crm_customer_snapshot AND
 * derive new transitions for the prev-snapshot → 2026-04 pair.
 *
 * Usage: node scripts/ingest-april-2026-crm.cjs
 */
const path = require('path');
const fs = require('fs');
const Papa = require('papaparse');
const Database = require('better-sqlite3');
const {
  deriveStageTransitions,
  computeDaysInStage,
} = require('../server/lib/stage-transitions.cjs');

const CSV_PATH = '/Users/carsongoodale/Desktop/Stack/Customer_Data/stackwellnesscafe_Customer_Export_2026_04_17_UTC_03_42_05_4ba9c50f-ac40-43e6-9521-8eb4ef7263ca_.csv';
const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const SNAPSHOT_MONTH = '2026-04';

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

// Transform to snapshot schema
const snapshotRows = parsed.data.map(r => ({
  customer_id: r['Customer ID'],
  snapshot_month: SNAPSHOT_MONTH,
  first_name: r['First Name'] || '',
  last_name: r['Last Name'] || '',
  email: r['Email Address'] || '',
  journey_stage: (r['Guest Journey Stage'] && r['Guest Journey Stage'] !== '-') ? r['Guest Journey Stage'] : 'UNKNOWN',
  attrition_risk: r['Attrition Risk'] || 'unknown',
  reach_location: r['Reach Location'] || '',
  lifetime_spend: toNum(r['Lifetime Spend']),
  lifetime_visits: toNum(r['Lifetime Visits']),
  avg_basket_value: toNum(r['Average Basket Value']),
  last_90_days_spend: toNum(r['Last 90 day Spend']),
  last_90_days_orders: toNum(r['Last 90 day Orders']),
  last_year_spend: toNum(r['Last year Spend']),
  last_year_orders: toNum(r['Last year Orders']),
  current_loyalty_balance: toNum(r['Current Loyalty Balance']),
  account_created_date: r['Account Created Date'] || '',
  last_visit_date: r['Last Purchase Date'] || '',
  days_since_signup: toNum(r['Days since Signup']),
  days_since_last_visit: toNum(r['Days Since Last Purchase']),
  user_affiliation: r['User Affiliation'] || '',
  signup_source: r['Signup Source'] || '',
})).filter(r => r.customer_id);

console.log(`Transformed ${snapshotRows.length} valid customer rows`);

const db = new Database(DB_PATH);

// Idempotent snapshot upsert: DELETE month, then INSERT
db.prepare('DELETE FROM fact_crm_customer_snapshot WHERE snapshot_month = ?').run(SNAPSHOT_MONTH);

const insertSnap = db.prepare(`
  INSERT INTO fact_crm_customer_snapshot
  (customer_id, snapshot_month, first_name, last_name, email, journey_stage, attrition_risk,
   reach_location, lifetime_spend, lifetime_visits, avg_basket_value, last_90_days_spend,
   last_90_days_orders, last_year_spend, last_year_orders, current_loyalty_balance,
   account_created_date, last_visit_date, days_since_signup, days_since_last_visit,
   user_affiliation, signup_source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  for (const r of snapshotRows) {
    insertSnap.run(
      r.customer_id, r.snapshot_month, r.first_name, r.last_name, r.email,
      r.journey_stage, r.attrition_risk, r.reach_location,
      r.lifetime_spend, r.lifetime_visits, r.avg_basket_value,
      r.last_90_days_spend, r.last_90_days_orders,
      r.last_year_spend, r.last_year_orders,
      r.current_loyalty_balance,
      r.account_created_date, r.last_visit_date,
      r.days_since_signup, r.days_since_last_visit,
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
