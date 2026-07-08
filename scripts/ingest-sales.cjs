/**
 * Ingest monthly Toast "Location overview" sales export → fact_store_sales.
 *
 * Usage: node scripts/ingest-sales.cjs <file.csv> <YYYY-MM> [--dry-run]
 *   e.g. node scripts/ingest-sales.cjs data/store-data/jun_2026_location_overview.csv 2026-06
 *
 * Parsing core: server/lib/toast-location-overview.cjs (shared with the
 * dashboard upload pipeline). The export has NO date column — the month is
 * the argument. Blank location = the export's Total row (skipped);
 * "CR Downtown" → "Downtown Cedar Rapids".
 *
 * Sanity check: if the export's discount total wildly mismatches the loaded
 * fact_discount_summary for the month, you may have the wrong month's file.
 * verify-month.cjs cross-checks this; the upload pipeline warns pre-confirm.
 *
 * Idempotent: INSERT OR REPLACE on (month, location).
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { randomBytes } = require('crypto');
const { parseLocationOverviewCsv } = require('../server/lib/toast-location-overview.cjs');

const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const DRY_RUN = process.argv.includes('--dry-run');
const [FILE_ARG, MONTH] = args;
if (!FILE_ARG || !MONTH || !/^\d{4}-\d{2}$/.test(MONTH)) {
  console.error('Usage: node scripts/ingest-sales.cjs <file.csv> <YYYY-MM> [--dry-run]');
  process.exit(2);
}
const FILE = path.resolve(FILE_ARG);
const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const SOURCE = path.basename(FILE);

const records = parseLocationOverviewCsv(fs.readFileSync(FILE, 'utf8'), MONTH, require('papaparse'));

console.log(`Parsed ${records.length} locations for ${MONTH}:`);
console.table(records.map(({ month, location, grossSales, netSales, orders, discountTotal, guests, refunds }) =>
  ({ month, location, grossSales, netSales, orders, discountTotal, guests, refunds })));
const gross = records.reduce((a, r) => a + r.grossSales, 0);
console.log(`Total gross: $${gross.toFixed(2)}`);

if (records.length === 0) {
  console.error('✗ Parsed 0 locations — wrong file or unrecognized format. Nothing written.');
  process.exit(1);
}
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
  VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, 0, 0, 0, 0, 'toast_location_overview', datetime('now'))
`);
const dimMonth = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');
const dimLoc = db.prepare('INSERT OR IGNORE INTO dim_location (name) VALUES (?)');

db.transaction(() => {
  dimMonth.run(MONTH);
  for (const r of records) {
    dimLoc.run(r.location);
    stmt.run(r.month, r.location, r.grossSales, r.netSales, r.orders, r.discountTotal, r.guests, r.refunds);
  }
})();

try {
  db.prepare(`
    INSERT INTO upload_log (id, filename, source_type, record_count, month_covered, status, dedup_summary, confirmed_at)
    VALUES (?, ?, 'store_sales', ?, ?, 'success', ?, datetime('now'))
  `).run(randomBytes(8).toString('hex'), SOURCE, records.length, MONTH, JSON.stringify({ locations: records.length }));
} catch (e) {
  console.warn('upload_log insert skipped:', e.message);
}

// ── Verify against DB ──
console.table(db.prepare(`
  SELECT month, COUNT(*) locations, ROUND(SUM(gross_sales),2) gross, ROUND(SUM(net_sales),2) net, SUM(orders) orders
  FROM fact_store_sales WHERE month=? GROUP BY month
`).all(MONTH));
db.close();
