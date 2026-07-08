/**
 * Ingest monthly Toast Discount Summary → fact_discount_summary.
 *
 * Usage: node scripts/ingest-discounts.cjs <file.xlsx> <YYYY-MM> [--dry-run]
 *   e.g. node scripts/ingest-discounts.cjs data/discount-summary/discount_summary_june_2026.xlsx 2026-06
 *
 * Parsing core: server/lib/discount-summary.cjs (shared with the dashboard
 * upload pipeline). Handles bare month-name sheets ("June" — year taken from
 * the YYYY-MM argument), trimmed header keys (the " Profitability" bug), the
 * trailing "Total" row, and fractional percent normalization.
 *
 * This script stores ONLY the sheet matching the requested month; other
 * period sheets in the workbook are listed (upload the workbook via the
 * dashboard to store all periods at once).
 *
 * Idempotent: INSERT OR REPLACE on (period, discount_name).
 */
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const { randomBytes } = require('crypto');
const { parseDiscountWorkbook } = require('../server/lib/discount-summary.cjs');

const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const DRY_RUN = process.argv.includes('--dry-run');
const [FILE_ARG, MONTH] = args;
if (!FILE_ARG || !MONTH || !/^\d{4}-\d{2}$/.test(MONTH)) {
  console.error('Usage: node scripts/ingest-discounts.cjs <file.xlsx> <YYYY-MM> [--dry-run]');
  process.exit(2);
}
const FILE = path.resolve(FILE_ARG);
const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const SOURCE = path.basename(FILE);

const wb = XLSX.readFile(FILE);
const { periods, skippedSheets } = parseDiscountWorkbook(wb, XLSX, MONTH.slice(0, 4));

const target = periods.find((p) => p.period === MONTH);
if (!target) {
  console.error(`✗ No sheet resolved to ${MONTH}. Periods found: ${periods.map((p) => p.period).join(', ') || 'none'}`);
  if (skippedSheets.length) console.error(`  Unrecognized sheets: ${skippedSheets.join(', ')}`);
  process.exit(1);
}
const otherPeriods = periods.filter((p) => p.period !== MONTH).map((p) => p.period);
if (otherPeriods.length) {
  console.log(`Note: workbook also contains ${otherPeriods.join(', ')} — not stored by this run.`);
}

const records = target.records;
const totalAmt = records.reduce((a, r) => a + r.discountAmount, 0);
const profitZero = records.filter((r) => r.profitability === 0).length;
console.log(`Parsed ${records.length} discounts for ${MONTH}, $${totalAmt.toFixed(2)} discount total`);
if (records.length && profitZero === records.length) {
  console.log('⚠️  ALL profitability values are 0 — header may have changed again. Check the workbook.');
}
console.table(records.map(({ discountName, discountCategory, usageCount, discountAmount, profitability }) =>
  ({ discountName, discountCategory, usageCount, discountAmount, profitability })));

if (DRY_RUN) {
  console.log('\n[dry-run] No database writes performed.');
  process.exit(0);
}

// ── Insert ──
const db = new Database(DB_PATH);
const stmt = db.prepare(`
  INSERT OR REPLACE INTO fact_discount_summary
  (period, period_type, discount_name, discount_category, usage_count, discount_amount, profitability, pct_of_total_sales)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
db.transaction(() => {
  db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)').run(MONTH);
  for (const r of records) {
    stmt.run(r.period, r.periodType, r.discountName, r.discountCategory,
      r.usageCount, r.discountAmount, r.profitability, r.pctOfTotalSales);
  }
})();

try {
  db.prepare(`
    INSERT INTO upload_log (id, filename, source_type, record_count, month_covered, status, dedup_summary, confirmed_at)
    VALUES (?, ?, 'discount_summary', ?, ?, 'success', ?, datetime('now'))
  `).run(randomBytes(8).toString('hex'), SOURCE, records.length, MONTH,
    JSON.stringify({ discounts: records.length, otherPeriodsInWorkbook: otherPeriods }));
} catch (e) {
  console.warn('upload_log insert skipped:', e.message);
}

// ── Verify against DB ──
console.table(db.prepare(`
  SELECT discount_category, COUNT(*) n, ROUND(SUM(discount_amount),2) amount, ROUND(SUM(profitability),2) profitability
  FROM fact_discount_summary WHERE period=? GROUP BY discount_category ORDER BY amount DESC
`).all(MONTH));
db.close();
