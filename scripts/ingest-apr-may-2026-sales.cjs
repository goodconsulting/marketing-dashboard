/**
 * Ingest April + May 2026 Toast location-overview sales → fact_store_sales.
 *
 * Source (Toast "Location overview" export, one file per month):
 *   data/store-data/apr_2026_location_overview.csv  (April — 5,185 discounts, 5 locations)
 *   data/store-data/may_2026_location_overview.csv  (May   — 5,128 discounts, 6 locations incl. Food Truck)
 * Month↔file determined by matching # Discounts to the loaded discount summaries.
 *
 * This coarser export carries gross/net/orders/discounts/guests/refunds (no
 * food/smoothie/retail or DoorDash/UberEats split — those default to 0).
 * Location name "CR Downtown" is mapped to "Downtown Cedar Rapids" to match
 * the existing fact_store_sales naming.
 *
 * Idempotent: INSERT OR REPLACE on (month, location).
 * Usage: node scripts/ingest-apr-may-2026-sales.cjs
 */
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const FILES = [
  { month: '2026-04', file: 'apr_2026_location_overview.csv' },
  { month: '2026-05', file: 'may_2026_location_overview.csv' },
];

// Map export location names → canonical fact_store_sales names
const LOCATION_MAP = { 'CR Downtown': 'Downtown Cedar Rapids' };
const canon = (name) => LOCATION_MAP[name.trim()] || name.trim();

const toNum = (v) => {
  if (v === '' || v == null) return 0;
  const n = parseFloat(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;

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

const results = [];
db.transaction(() => {
  for (const { month, file } of FILES) {
    dimMonth.run(month);
    const rows = Papa.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'store-data', file), 'utf8'),
      { header: true, skipEmptyLines: true }).data;
    for (const r of rows) {
      const rawName = String(r['Location name'] || '').trim();
      if (!rawName) continue;  // skip the total row (blank location)
      const location = canon(rawName);
      dimLoc.run(location);
      const rec = {
        month, location,
        gross: round2(toNum(r['Gross sales'])),
        net: round2(toNum(r['Net sales'])),
        orders: Math.round(toNum(r['Order count'])),
        discounts: round2(toNum(r['Discount amount'])),
        guests: Math.round(toNum(r['Guest count'])),
        refunds: round2(toNum(r['Refund amount'])),
      };
      stmt.run(rec.month, rec.location, rec.gross, rec.net, rec.orders, rec.discounts, rec.guests, rec.refunds);
      results.push(rec);
    }
  }
})();

// ── Verify ──
console.log('Loaded fact_store_sales rows (April + May):');
console.table(results);
console.table(db.prepare(`
  SELECT month, COUNT(*) locations, ROUND(SUM(gross_sales),2) gross, ROUND(SUM(net_sales),2) net, SUM(orders) orders
  FROM fact_store_sales WHERE month IN ('2026-04','2026-05') GROUP BY month
`).all());
console.log('Full store-sales trend:');
console.table(db.prepare('SELECT month, COUNT(*) n, ROUND(SUM(gross_sales),2) gross FROM fact_store_sales GROUP BY month ORDER BY month').all());
db.close();
