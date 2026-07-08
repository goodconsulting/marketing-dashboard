/**
 * Month-close source checklist — SINGLE SOURCE OF TRUTH for "what counts as
 * a complete month" in stack.db.
 *
 * Consumed by BOTH:
 *   - scripts/verify-month.cjs        (CLI month-close check)
 *   - server (GET /api/data/month-status → landing-page scorecard)
 *
 * Each check: { key, label, required, sql, since? } where sql takes one
 * ?-param (the month, 'YYYY-MM') and returns { n, total }. Edit `required`
 * flags as contracts change (e.g. billboard optional while the Lamar contract
 * lapses). `since` (YYYY-MM) marks when a source began existing — months
 * before it are not required (e.g. Hello Digital social started 2026-04).
 */

const CHECKS = [
  { key: 'expenses', label: 'Marketing expenses (QuickBooks)', required: true,
    sql: "SELECT COUNT(*) n, ROUND(SUM(amount),2) total FROM fact_expense WHERE month=?" },
  { key: 'google', label: 'Google Ads campaigns', required: true,
    sql: "SELECT COUNT(*) n, ROUND(SUM(cost),2) total FROM fact_google_campaign WHERE month=?" },
  { key: 'meta', label: 'Meta Ads campaigns', required: true,
    sql: "SELECT COUNT(*) n, ROUND(SUM(spend),2) total FROM fact_meta_campaign WHERE month=?" },
  { key: 'sales', label: 'Toast store sales', required: true,
    sql: "SELECT COUNT(*) n, ROUND(SUM(gross_sales),2) total FROM fact_store_sales WHERE month=?" },
  { key: 'discounts', label: 'Toast discount summary', required: true,
    sql: "SELECT COUNT(*) n, ROUND(SUM(discount_amount),2) total FROM fact_discount_summary WHERE period=?" },
  { key: 'crm', label: 'Incentivio CRM snapshot', required: true,
    sql: "SELECT COUNT(*) n, NULL total FROM fact_crm_customer_snapshot WHERE snapshot_month=?" },
  { key: 'incentivio', label: 'Incentivio derived metrics', required: true,
    sql: "SELECT COUNT(*) n, NULL total FROM fact_incentivio_metrics WHERE month=?" },
  { key: 'social_facebook', label: 'Social — Facebook (Hello Digital)', required: true, since: '2026-04',
    sql: "SELECT COUNT(*) n, NULL total FROM fact_social_monthly WHERE month=? AND platform='facebook'" },
  { key: 'social_instagram', label: 'Social — Instagram (Hello Digital)', required: true, since: '2026-04',
    sql: "SELECT COUNT(*) n, NULL total FROM fact_social_monthly WHERE month=? AND platform='instagram'" },
  { key: 'billboard', label: 'Lamar billboard proof-of-play', required: false,
    sql: "SELECT COUNT(*) n, ROUND(SUM(plays_delivered),0) total FROM fact_billboard_monthly WHERE month=?" },
  { key: 'coop', label: 'Co-op / in-kind funding', required: false,
    sql: "SELECT COUNT(*) n, ROUND(SUM(amount),2) total FROM fact_marketing_funding WHERE month=?" },
];

/**
 * Run all checks for a month against an open better-sqlite3 connection.
 * Returns { month, checks: [{key,label,required,rows,total,present}], gaps }.
 * Tables that don't exist yet (fresh DB) count as absent, not as errors.
 */
function runMonthChecks(db, month) {
  const results = [];
  let gaps = 0;
  for (const c of CHECKS) {
    let n = 0, total = null;
    try {
      const r = db.prepare(c.sql).get(month);
      n = r.n; total = r.total;
    } catch (e) {
      if (!/no such table/.test(e.message)) throw e;
    }
    const present = n > 0;
    // A source isn't required before it existed (`since`).
    const required = c.required && (!c.since || month >= c.since);
    if (!present && required) gaps++;
    results.push({ key: c.key, label: c.label, required, rows: n, total, present });
  }
  return { month, checks: results, gaps };
}

module.exports = { CHECKS, runMonthChecks };
