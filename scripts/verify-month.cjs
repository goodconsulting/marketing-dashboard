/**
 * Verify a month's data completeness in stack.db — the single source of truth
 * for "is this month's close done?".
 *
 * Usage: node scripts/verify-month.cjs [YYYY-MM]
 *   (defaults to the previous calendar month)
 *
 * Prints a source-by-source checklist with row counts and dollar totals,
 * then the derived ROI inputs. Exit code 0 = all REQUIRED sources present,
 * 1 = gaps. Use the exit code as a /goal stop condition or in the monthly
 * close routine.
 *
 * The checklist itself lives in server/lib/month-checks.cjs — shared with the
 * dashboard's month-status API so CLI and scorecard can never disagree.
 * Edit `required` flags there as contracts change.
 */
const path = require('path');
const Database = require('better-sqlite3');
const { runMonthChecks } = require('../server/lib/month-checks.cjs');

let MONTH = process.argv[2];
if (!MONTH) {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  MONTH = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}
if (!/^\d{4}-\d{2}$/.test(MONTH)) {
  console.error('Usage: node scripts/verify-month.cjs [YYYY-MM]');
  process.exit(2);
}

const db = new Database(path.join(__dirname, '..', 'data', 'stack.db'), { readonly: true });

console.log(`\n═══ Month close status: ${MONTH} ═══\n`);
const { checks, gaps } = runMonthChecks(db, MONTH);
console.table(checks.map((c) => ({
  source: c.label,
  status: c.present ? '✅' : c.required ? '❌ MISSING' : '— (optional)',
  rows: c.rows,
  total: c.total != null ? `$${c.total}` : '',
})));

// ── Derived ROI inputs ──
const spend = db.prepare('SELECT ROUND(SUM(amount),2) t FROM fact_expense WHERE month=?').get(MONTH).t || 0;
const revenue = db.prepare('SELECT ROUND(SUM(gross_sales),2) t FROM fact_store_sales WHERE month=?').get(MONTH).t || 0;
const coop = db.prepare('SELECT ROUND(SUM(amount),2) t FROM fact_marketing_funding WHERE month=?').get(MONTH).t || 0;
console.log('ROI inputs:');
console.log(`  Gross marketing spend: $${spend}${coop ? `  (co-op $${coop} → net $${(spend - coop).toFixed(2)})` : ''}`);
console.log(`  Store revenue (gross): $${revenue}`);
if (spend > 0 && revenue > 0) {
  console.log(`  → CAC / ROI computable for ${MONTH}.`);
} else {
  console.log(`  → ⚠️  CAC / ROI NOT computable: missing ${spend === 0 ? 'marketing spend' : ''}${spend === 0 && revenue === 0 ? ' and ' : ''}${revenue === 0 ? 'store revenue' : ''}.`);
}

// ── Cross-check: sales export discount count vs discount summary ──
const salesDisc = db.prepare('SELECT ROUND(SUM(discount_total),2) t FROM fact_store_sales WHERE month=?').get(MONTH).t;
const summDisc = db.prepare('SELECT ROUND(SUM(discount_amount),2) t FROM fact_discount_summary WHERE period=?').get(MONTH).t;
if (salesDisc && summDisc) {
  const delta = Math.abs(salesDisc - summDisc);
  const pct = (delta / summDisc) * 100;
  console.log(`\nDiscount cross-check: sales export $${salesDisc} vs discount summary $${summDisc} (Δ ${pct.toFixed(1)}%)${pct > 5 ? ' ⚠️  >5% — check for wrong-month file' : ' ✓'}`);
}

db.close();

if (gaps > 0) {
  console.log(`\n❌ ${MONTH} close INCOMPLETE — ${gaps} required source(s) missing.`);
  process.exit(1);
}
console.log(`\n✅ ${MONTH} close complete — all required sources loaded.`);
