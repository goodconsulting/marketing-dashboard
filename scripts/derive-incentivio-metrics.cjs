/**
 * Derive fact_incentivio_metrics rows from existing CRM customer snapshots.
 *
 * Mirrors server/parsers/crm.ts aggregation logic but pulls from the DB
 * instead of re-parsing the source CSV.
 *
 * Usage: node scripts/derive-incentivio-metrics.cjs [snapshot_month]
 *   If snapshot_month omitted, processes all months not already in metrics.
 */
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const targetMonth = process.argv[2] || null;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const allMonths = db.prepare(
  'SELECT DISTINCT snapshot_month FROM fact_crm_customer_snapshot ORDER BY snapshot_month'
).all().map(r => r.snapshot_month);

const existingMetrics = new Set(
  db.prepare('SELECT month FROM fact_incentivio_metrics').all().map(r => r.month)
);

const months = targetMonth ? [targetMonth] : allMonths;

const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO fact_incentivio_metrics
  (month, total_loyalty_accounts, new_accounts, avg_order_value, lifetime_visits, last_90_days_spend, ltv)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

console.log('Processing months:', months.join(', '));
console.log('Already in metrics:', [...existingMetrics].sort().join(', ') || '(none)');
console.log('');

db.transaction(() => {
  for (const month of months) {
    const [y, m] = month.split('-');
    const monthStart = `${y}-${m}-01`;
    const monthEnd = `${y}-${m}-31`;

    const agg = db.prepare(`
      SELECT
        COUNT(*) AS total_accounts,
        SUM(CASE WHEN account_created_date >= ? AND account_created_date <= ? THEN 1 ELSE 0 END) AS new_accounts,
        AVG(NULLIF(avg_basket_value, 0)) AS avg_order_value,
        AVG(NULLIF(lifetime_visits, 0)) AS lifetime_visits,
        AVG(NULLIF(last_90_days_spend, 0)) AS last_90_days_spend,
        AVG(NULLIF(lifetime_spend, 0)) AS ltv
      FROM fact_crm_customer_snapshot
      WHERE snapshot_month = ?
    `).get(monthStart, monthEnd, month);

    if (!agg || agg.total_accounts === 0) {
      console.log(`  ${month}: no CRM rows, skipping`);
      continue;
    }

    const round = (n, p = 2) => n == null ? 0 : Math.round(n * Math.pow(10, p)) / Math.pow(10, p);
    const aov = round(agg.avg_order_value);
    const ltv = round(agg.ltv || aov * 2.5);

    insertStmt.run(
      month,
      agg.total_accounts,
      agg.new_accounts || 0,
      aov,
      round(agg.lifetime_visits, 1),
      round(agg.last_90_days_spend),
      ltv,
    );

    console.log(`  ${month}: accounts=${agg.total_accounts} new=${agg.new_accounts || 0} aov=$${aov} ltv=$${ltv}`);
  }
})();

console.log('\nFinal fact_incentivio_metrics:');
const final = db.prepare(
  'SELECT month, total_loyalty_accounts, new_accounts, avg_order_value, ltv FROM fact_incentivio_metrics ORDER BY month'
).all();
console.table(final);

db.close();
