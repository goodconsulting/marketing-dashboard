/**
 * Compare per-location Toast SalesSummary workbooks against existing
 * fact_store_sales rows WITHOUT writing anything. Reports per-location
 * deltas on gross/net/orders so a historical backfill/restatement can be
 * judged for accuracy first.
 *
 * Usage: node scripts/compare-sales-summary.cjs <store-data-root> <YYYY-MM> [more months...]
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const { parseSalesSummaryWorkbook } = require('../server/lib/sales-summary-xlsx.cjs');

const [ROOT_ARG, ...MONTHS] = process.argv.slice(2);
if (!ROOT_ARG || MONTHS.length === 0) {
  console.error('Usage: node scripts/compare-sales-summary.cjs <store-data-root> <YYYY-MM> [more months...]');
  process.exit(2);
}
const ROOT = path.resolve(ROOT_ARG);
const db = new Database(path.join(__dirname, '..', 'data', 'stack.db'), { readonly: true });
const FOLDER_MAP = { 'Downtown': 'Downtown Cedar Rapids' };
const d2 = (n) => Math.round(n * 100) / 100;

for (const month of MONTHS) {
  const rows = [];
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const location = FOLDER_MAP[entry.name.trim()] || entry.name.trim();
    const files = fs.readdirSync(path.join(ROOT, entry.name))
      .filter((f) => f.startsWith(`SalesSummary_${month}-01_`) && f.endsWith('.xlsx') && !f.startsWith('~$'))
      .map((f) => path.join(ROOT, entry.name, f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (!files.length) continue;
    let parsed;
    try {
      parsed = parseSalesSummaryWorkbook(XLSX.readFile(files[0]), month, location, XLSX);
    } catch (e) {
      rows.push({ location, status: `PARSE FAIL: ${e.message.slice(0, 60)}` });
      continue;
    }
    const dbRow = db.prepare(
      'SELECT gross_sales, net_sales, orders, source FROM fact_store_sales WHERE month = ? AND location = ?'
    ).get(month, location);
    if (!dbRow) {
      rows.push({ location, status: 'NOT IN DB', fileGross: parsed.grossSales, fileOrders: parsed.orders });
      continue;
    }
    const dGross = d2(parsed.grossSales - dbRow.gross_sales);
    const dNet = d2(parsed.netSales - dbRow.net_sales);
    const dOrders = parsed.orders - dbRow.orders;
    rows.push({
      location,
      status: dGross === 0 && dNet === 0 && dOrders === 0 ? 'EXACT' : 'DIFFERS',
      dbSource: dbRow.source,
      fileGross: parsed.grossSales, dbGross: dbRow.gross_sales, dGross,
      fileNet: parsed.netSales, dbNet: dbRow.net_sales, dNet,
      fileOrders: parsed.orders, dbOrders: dbRow.orders, dOrders,
    });
  }
  const inDb = db.prepare('SELECT location FROM fact_store_sales WHERE month = ?').all(month)
    .map((r) => r.location).filter((l) => !rows.some((x) => x.location === l));
  console.log(`\n═══ ${month} ═══`);
  console.table(rows);
  if (inDb.length) console.log(`In DB but no file: ${inDb.join(', ')}`);
}
db.close();
