/**
 * Ingest monthly Toast "Location overview" sales export → fact_store_sales.
 *
 * Usage: node scripts/ingest-sales.cjs <file.csv> <YYYY-MM> [--dry-run]
 *   e.g. node scripts/ingest-sales.cjs data/store-data/jun_2026_location_overview.csv 2026-06
 *
 * Generalized from ingest-apr-may-2026-sales.cjs (Apr/May 2026). This coarse
 * export carries gross/net/orders/discounts/guests/refunds only (no channel
 * or category split — those columns default to 0). Blank location = the
 * export's Total row and is skipped. Location names are canonicalized
 * (e.g. "CR Downtown" → "Downtown Cedar Rapids") to match existing rows.
 *
 * Sanity check: if the export's # Discounts wildly mismatches the loaded
 * fact_discount_summary for the month, you may have the wrong month's file
 * (this is how Apr/May files were disambiguated). verify-month.cjs reports both.
 *
 * Idempotent: INSERT OR REPLACE on (month, location).
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const Database = require('better-sqlite3');
const { randomBytes } = require('crypto');

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

// Map export location names → canonical fact_store_sales names
const LOCATION_MAP = { 'CR Downtown': 'Downtown Cedar Rapids' };
const canon = (name) => LOCATION_MAP[name.trim()] || name.trim();

const toNum = (v) => {
  if (v === '' || v == null) return 0;
  const n = parseFloat(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;

const rows = Papa.parse(fs.readFileSync(FILE, 'utf8'), { header: true, skipEmptyLines: true }).data;
const records = [];
for (const r of rows) {
  const rawName = String(r['Location name'] || '').trim();
  if (!rawName) continue; // Total row
  records.push({
    month: MONTH,
    location: canon(rawName),
    gross: round2(toNum(r['Gross sales'])),
    net: round2(toNum(r['Net sales'])),
    orders: Math.round(toNum(r['Order count'])),
    discounts: round2(toNum(r['Discount amount'])),
    guests: Math.round(toNum(r['Guest count'])),
    refunds: round2(toNum(r['Refund amount'])),
  });
}

console.log(`Parsed ${records.length} locations for ${MONTH}:`);
console.table(records);
const gross = records.reduce((a, r) => a + r.gross, 0);
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
    stmt.run(r.month, r.location, r.gross, r.net, r.orders, r.discounts, r.guests, r.refunds);
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
