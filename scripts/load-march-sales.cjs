/**
 * Load March 2026 SalesSummary zips → fact_store_sales.
 *
 * Each SalesSummary zip contains ~17 monthly rollup CSVs:
 *   - Net sales summary.csv  → Gross sales, Sales discounts, Net sales
 *   - Revenue summary.csv    → Tax amount, Tips
 *   - Service mode summary.csv → Total orders, Total guests (Total row)
 *   - Dining options summary.csv → DoorDash / Uber Eats breakdown
 *   - Sales category summary.csv → Food / Smoothies / Retail / etc
 *
 * Usage: node scripts/load-march-sales.cjs
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const Papa = require('papaparse');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const STORE_DATA_DIR = path.join(__dirname, '..', 'data', 'store-data');
const MONTH = '2026-03';

const LOCATIONS = [
  { dir: 'Coralville', name: 'Coralville', zip: 'SalesSummary_2026-03-01_2026-03-31.zip' },
  { dir: 'Downtown ', name: 'Downtown Cedar Rapids', zip: 'SalesSummary_2026-03-01_2026-03-31 (1).zip' },
  { dir: 'Edgewood ', name: 'Edgewood', zip: 'SalesSummary_2026-03-01_2026-03-31.zip' },
  { dir: 'Fountains', name: 'Fountains', zip: 'SalesSummary_2026-03-01_2026-03-31 (1).zip' },
  { dir: 'Waukee', name: 'Waukee', zip: 'SalesSummary_2026-03-01_2026-03-31.zip' },
];

// ─── Category mapping (per user decision) ────────────────────────
// Food + Drinks + Catering → food_sales (kept separate from smoothie/retail)
// Smoothies → smoothie_sales
// Retail + Supplements → retail_sales
// Skip: Custom Amount Refunds, Non-Grat Svc Charges, No Sales Category Assigned
function mapSalesCategory(name) {
  const lower = String(name || '').toLowerCase().trim();
  if (!lower || lower === 'total') return null;
  if (lower.includes('refund')) return null;
  if (lower.includes('svc charge') || lower.includes('service charge')) return null;
  if (lower.includes('no sales category')) return null;

  if (lower.startsWith('smoothie')) return 'smoothie';
  if (lower.startsWith('retail') || lower.startsWith('supplement')) return 'retail';
  if (lower.startsWith('food') || lower.startsWith('drink') || lower.startsWith('catering')) return 'food';
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────
function parseCSV(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  return Papa.parse(content, { header: true, skipEmptyLines: true }).data;
}

function toNum(v) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = parseFloat(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function extractZip(zipPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-'));
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', tmpDir]);
  return tmpDir;
}

function parseLocation(zipPath, locationName) {
  const tmp = extractZip(zipPath);
  try {
    // Net sales summary: Gross sales, Sales discounts, Sales refunds, Net sales
    const netRows = parseCSV(path.join(tmp, 'Net sales summary.csv'));
    const nsRow = netRows[0] || {};
    const grossSales = toNum(nsRow['Gross sales']);
    const netSales = toNum(nsRow['Net sales']);
    const discountTotal = Math.abs(toNum(nsRow['Sales discounts']));
    const refunds = toNum(nsRow['Sales refunds']);

    // Revenue summary: Tax amount, Tips
    const revRows = parseCSV(path.join(tmp, 'Revenue summary.csv'));
    const revRow = revRows[0] || {};
    const taxAmount = toNum(revRow['Tax amount']);
    const tips = toNum(revRow['Tips']);

    // Service mode summary: pick Total row
    const svcRows = parseCSV(path.join(tmp, 'Service mode summary.csv'));
    const svcTotal = svcRows.find(r => String(r['Service mode']).trim() === 'Total') || svcRows[svcRows.length - 1] || {};
    const orders = parseInt(String(svcTotal['Total orders'] || '0').replace(/,/g, ''), 10) || 0;
    const guests = parseInt(String(svcTotal['Total guests'] || '0').replace(/,/g, ''), 10) || 0;

    // Dining options: sum DoorDash*, Uber Eats* rows (gross sales)
    const dineRows = parseCSV(path.join(tmp, 'Dining options summary.csv'));
    let doordashSales = 0;
    let uberEatsSales = 0;
    for (const r of dineRows) {
      const opt = String(r['Dining option'] || '').toLowerCase();
      if (opt === 'total') continue;
      const gross = toNum(r['Gross sales']);
      if (opt.startsWith('doordash')) doordashSales += gross;
      else if (opt.startsWith('uber eats')) uberEatsSales += gross;
    }

    // Sales category: apply user's mapping (use Net sales per category)
    const catRows = parseCSV(path.join(tmp, 'Sales category summary.csv'));
    let foodSales = 0, smoothieSales = 0, retailSales = 0;
    for (const r of catRows) {
      const bucket = mapSalesCategory(r['Sales category']);
      if (!bucket) continue;
      const ns = toNum(r['Net sales']);
      if (bucket === 'food') foodSales += ns;
      else if (bucket === 'smoothie') smoothieSales += ns;
      else if (bucket === 'retail') retailSales += ns;
    }

    return {
      month: MONTH,
      location: locationName,
      grossSales: round2(grossSales),
      netSales: round2(netSales),
      orders,
      discountTotal: round2(discountTotal),
      guests,
      tips: round2(tips),
      taxAmount: round2(taxAmount),
      refunds: round2(refunds),
      doordashSales: round2(doordashSales),
      uberEatsSales: round2(uberEatsSales),
      foodSales: round2(foodSales),
      smoothieSales: round2(smoothieSales),
      retailSales: round2(retailSales),
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function round2(n) { return Math.round(n * 100) / 100; }

// ─── Main ────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const stmt = db.prepare(`
  INSERT OR REPLACE INTO fact_store_sales
  (month, location, gross_sales, net_sales, orders, discount_total,
   guests, tips, tax_amount, refunds,
   doordash_sales, uber_eats_sales, food_sales, smoothie_sales, retail_sales,
   source, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'toast', datetime('now'))
`);
const dimMonth = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');
const dimLoc = db.prepare('INSERT OR IGNORE INTO dim_location (name) VALUES (?)');

const results = [];
db.transaction(() => {
  dimMonth.run(MONTH);
  for (const loc of LOCATIONS) {
    const zipPath = path.join(STORE_DATA_DIR, loc.dir, loc.zip);
    if (!fs.existsSync(zipPath)) {
      console.error(`  ✗ ${loc.name}: zip not found at ${zipPath}`);
      continue;
    }
    const s = parseLocation(zipPath, loc.name);
    dimLoc.run(s.location);
    stmt.run(
      s.month, s.location, s.grossSales, s.netSales, s.orders, s.discountTotal,
      s.guests, s.tips, s.taxAmount, s.refunds,
      s.doordashSales, s.uberEatsSales, s.foodSales, s.smoothieSales, s.retailSales
    );
    results.push(s);
  }
})();

console.log('\nMarch 2026 Store Sales Load');
console.log('='.repeat(70));
console.log(
  ['Location', 'Gross', 'Net', 'Orders', 'Discounts', 'Food', 'Smoothie', 'Retail']
    .map(h => h.padEnd(12)).join('')
);
for (const r of results) {
  console.log(
    [r.location, r.grossSales, r.netSales, r.orders, r.discountTotal, r.foodSales, r.smoothieSales, r.retailSales]
      .map(v => String(v).padEnd(12)).join('')
  );
}

const totalGross = results.reduce((s, r) => s + r.grossSales, 0);
const totalNet = results.reduce((s, r) => s + r.netSales, 0);
const totalOrders = results.reduce((s, r) => s + r.orders, 0);
console.log('-'.repeat(70));
console.log(`TOTAL  gross=$${round2(totalGross).toLocaleString()}  net=$${round2(totalNet).toLocaleString()}  orders=${totalOrders.toLocaleString()}`);

db.close();
