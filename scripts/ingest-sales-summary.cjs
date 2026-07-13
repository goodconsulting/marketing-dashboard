/**
 * Ingest per-location Toast "Sales Summary" XLSX exports → fact_store_sales.
 *
 * Usage: node scripts/ingest-sales-summary.cjs <store-data-root> <YYYY-MM> [--dry-run]
 *   e.g. node scripts/ingest-sales-summary.cjs data/store-data 2026-06
 *
 * Expects <store-data-root>/<Location>/SalesSummary_<YYYY-MM>-01_*.xlsx —
 * one workbook per location (ToastWeb → Sales → Sales summary → Excel).
 * Folder names map to canonical fact_store_sales locations below; a folder
 * with no matching file for the month is reported, not fatal (e.g. Food
 * Truck idle months). Duplicate downloads ("(1)" copies) resolve to the
 * most recently modified file. Excel lock files (~$...) are ignored.
 *
 * Parsing core: server/lib/sales-summary-xlsx.cjs (header-name based).
 * Unlike the coarse location-overview export this also carries tips and
 * tax_amount, which are stored.
 *
 * Idempotent: INSERT OR REPLACE on (month, location).
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const { randomBytes } = require('crypto');
const { parseSalesSummaryWorkbook } = require('../server/lib/sales-summary-xlsx.cjs');

const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const DRY_RUN = process.argv.includes('--dry-run');
const [ROOT_ARG, MONTH] = args;
if (!ROOT_ARG || !MONTH || !/^\d{4}-\d{2}$/.test(MONTH)) {
  console.error('Usage: node scripts/ingest-sales-summary.cjs <store-data-root> <YYYY-MM> [--dry-run]');
  process.exit(2);
}
const ROOT = path.resolve(ROOT_ARG);
const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');

// Folder name (trimmed) → canonical fact_store_sales location name
const FOLDER_MAP = { 'Downtown': 'Downtown Cedar Rapids' };

const records = [];
const missing = [];
for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const folder = path.join(ROOT, entry.name);
  const location = FOLDER_MAP[entry.name.trim()] || entry.name.trim();

  const candidates = fs.readdirSync(folder)
    .filter((f) => f.startsWith(`SalesSummary_${MONTH}-01_`) && f.endsWith('.xlsx') && !f.startsWith('~$'))
    .map((f) => path.join(folder, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (candidates.length === 0) { missing.push(location); continue; }
  if (candidates.length > 1) {
    console.log(`  ${location}: ${candidates.length} copies for ${MONTH}, using newest: ${path.basename(candidates[0])}`);
  }
  const wb = XLSX.readFile(candidates[0]);
  records.push({ ...parseSalesSummaryWorkbook(wb, MONTH, location, XLSX), file: path.basename(candidates[0]) });
}

if (records.length === 0) {
  console.error(`✗ No SalesSummary_${MONTH}-01_*.xlsx found under ${ROOT} — nothing written.`);
  process.exit(1);
}

records.sort((a, b) => b.grossSales - a.grossSales);
console.log(`\nParsed ${records.length} locations for ${MONTH}:`);
console.table(records.map(({ month, file, ...r }) => r));
const gross = records.reduce((a, r) => a + r.grossSales, 0);
const orders = records.reduce((a, r) => a + r.orders, 0);
console.log(`Total gross: $${gross.toFixed(2)} across ${orders} orders`);
if (missing.length) console.log(`No ${MONTH} file for: ${missing.join(', ')}`);

if (DRY_RUN) {
  console.log('\n[dry-run] No database writes performed.');
  process.exit(0);
}

// ── Insert ──
const db = new Database(DB_PATH);
const stmt = db.prepare(`
  INSERT OR REPLACE INTO fact_store_sales
  (month, location, gross_sales, net_sales, orders, discount_total,
   guests, tips, tax_amount, refunds,
   doordash_sales, uber_eats_sales, food_sales, smoothie_sales, retail_sales,
   source, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 'toast_sales_summary', datetime('now'))
`);
const dimMonth = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');
const dimLoc = db.prepare('INSERT OR IGNORE INTO dim_location (name) VALUES (?)');

db.transaction(() => {
  dimMonth.run(MONTH);
  for (const r of records) {
    dimLoc.run(r.location);
    stmt.run(r.month, r.location, r.grossSales, r.netSales, r.orders, r.discountTotal,
      r.guests, r.tips, r.taxAmount, r.refunds);
  }
})();

try {
  db.prepare(`
    INSERT INTO upload_log (id, filename, source_type, record_count, month_covered, status, dedup_summary, confirmed_at)
    VALUES (?, ?, 'store_sales', ?, ?, 'success', ?, datetime('now'))
  `).run(randomBytes(8).toString('hex'), `SalesSummary per-location (${records.length} files)`, records.length, MONTH,
    JSON.stringify({ locations: records.map((r) => r.location) }));
} catch (e) {
  console.warn('upload_log insert skipped:', e.message);
}

const check = db.prepare('SELECT COUNT(*) n, SUM(gross_sales) g FROM fact_store_sales WHERE month = ?').get(MONTH);
console.log(`\n${MONTH} fact_store_sales: ${check.n} locations, $${check.g.toFixed(2)} gross`);
db.close();
