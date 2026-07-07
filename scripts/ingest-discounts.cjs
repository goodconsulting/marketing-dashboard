/**
 * Ingest monthly Toast Discount Summary → fact_discount_summary.
 *
 * Usage: node scripts/ingest-discounts.cjs <file.xlsx> <YYYY-MM> [--sheet <name>] [--dry-run]
 *   e.g. node scripts/ingest-discounts.cjs data/discount-summary/discount_summary_june_2026.xlsx 2026-06
 *
 * Generalized from ingest-apr-may-2026-discounts.cjs (Apr/May 2026).
 * Sheet resolution: --sheet wins; otherwise tries the month name ("June",
 * "June 2026"); otherwise a single-sheet workbook uses that sheet.
 *
 * Known format quirks (learned Apr 2026):
 *   - Header keys can have stray whitespace (" Profitability") → keys trimmed.
 *   - Trailing "Total" row is a summary, not a discount → skipped.
 *   - Percent of Total Sales may be fractional (0.0132) → normalized to percent.
 *
 * The 'marketing' / 'new_customer' categories tie discounts to marketing ROI.
 *
 * Idempotent: INSERT OR REPLACE on (period, discount_name).
 */
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const { randomBytes } = require('crypto');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const sheetFlag = argv.indexOf('--sheet');
const SHEET_ARG = sheetFlag >= 0 ? argv[sheetFlag + 1] : null;
const args = argv.filter((a, i) => a !== '--dry-run' && (sheetFlag < 0 || (i !== sheetFlag && i !== sheetFlag + 1)));
const [FILE_ARG, MONTH] = args;
if (!FILE_ARG || !MONTH || !/^\d{4}-\d{2}$/.test(MONTH)) {
  console.error('Usage: node scripts/ingest-discounts.cjs <file.xlsx> <YYYY-MM> [--sheet <name>] [--dry-run]');
  process.exit(2);
}
const FILE = path.resolve(FILE_ARG);
const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const SOURCE = path.basename(FILE);

// Mirror of load-discounts.cjs categorizeDiscount()
function categorizeDiscount(name) {
  const lower = name.toLowerCase();
  if (/sign\s*up|signup|referr?al|1st\s*time|first\s*time/.test(lower)) return 'new_customer';
  if (/points|birthday|combo|breakfast\s*deal|lunch|bowl|smoothie/.test(lower)) return 'loyalty';
  if (/momo/.test(lower)) return 'software_vendor';
  if (/bogo/.test(lower)) return 'print';
  if (/employee|comp|open\s*\$|open\s*%|manage|manager/.test(lower)) return 'operations';
  if (/in-kind|marketing/.test(lower)) return 'marketing';
  return 'other';
}

const num = (v) => (typeof v === 'number' ? v : parseFloat(String(v || '0').replace(/[$,%]/g, '')) || 0);

// ── Resolve sheet ──
const wb = XLSX.readFile(FILE);
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = MONTH_NAMES[parseInt(MONTH.slice(5), 10) - 1];
const year = MONTH.slice(0, 4);

let sheetName = null;
if (SHEET_ARG) {
  sheetName = wb.SheetNames.find((s) => s.trim().toLowerCase() === SHEET_ARG.trim().toLowerCase());
  if (!sheetName) { console.error(`✗ Sheet "${SHEET_ARG}" not found. Sheets: ${wb.SheetNames.join(', ')}`); process.exit(1); }
} else {
  const candidates = [monthName, `${monthName} ${year}`, `${monthName.slice(0, 3)}`, MONTH];
  for (const c of candidates) {
    sheetName = wb.SheetNames.find((s) => s.trim().toLowerCase() === c.toLowerCase());
    if (sheetName) break;
  }
  if (!sheetName && wb.SheetNames.length === 1) sheetName = wb.SheetNames[0];
  if (!sheetName) {
    console.error(`✗ Could not resolve a sheet for ${MONTH} (${monthName}). Sheets: ${wb.SheetNames.join(', ')}`);
    console.error('  Pass one explicitly: --sheet <name>');
    process.exit(1);
  }
}
console.log(`Using sheet "${sheetName}" → period ${MONTH}`);

// ── Parse ──
const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
let headerIdx = 0;
for (let i = 0; i < Math.min(raw.length, 5); i++) {
  if (String((raw[i] || [])[0] || '').trim() === 'Discount Name') { headerIdx = i; break; }
}
const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', range: headerIdx });
// Trim header keys — workbooks have had " Profitability" with a leading space.
const rows = rawRows.map((r) => {
  const o = {};
  for (const k in r) o[k.trim()] = r[k];
  return o;
});

const records = [];
let skippedTotal = 0;
for (const row of rows) {
  const name = String(row['Discount Name'] || '').trim();
  if (!name) continue;
  if (name.toLowerCase() === 'total') { skippedTotal++; continue; }

  let pct = num(row['Percent of Total Sales']);
  if (pct > 0 && pct <= 1) pct = pct * 100;

  records.push({
    period: MONTH,
    discount_name: name,
    discount_category: categorizeDiscount(name),
    usage_count: Math.round(num(row['Count'])),
    discount_amount: Math.round(num(row['Discount Amount']) * 100) / 100,
    profitability: Math.round(num(row['Profitability']) * 100) / 100,
    pct_of_total_sales: Math.round(pct * 10000) / 10000,
  });
}

const totalAmt = records.reduce((a, r) => a + r.discount_amount, 0);
const profitZero = records.filter((r) => r.profitability === 0).length;
console.log(`Parsed ${records.length} discounts (skipped ${skippedTotal} Total row), $${totalAmt.toFixed(2)} discount total`);
if (records.length && profitZero === records.length) {
  console.log('⚠️  ALL profitability values are 0 — header may have changed again. Check the workbook.');
}
console.table(records.map(({ discount_name, discount_category, usage_count, discount_amount, profitability }) =>
  ({ discount_name, discount_category, usage_count, discount_amount, profitability })));

if (records.length === 0) {
  console.error('✗ Parsed 0 discounts — wrong sheet or format. Nothing written.');
  process.exit(1);
}
if (DRY_RUN) {
  console.log('\n[dry-run] No database writes performed.');
  process.exit(0);
}

// ── Insert ──
const db = new Database(DB_PATH);
const stmt = db.prepare(`
  INSERT OR REPLACE INTO fact_discount_summary
  (period, period_type, discount_name, discount_category, usage_count, discount_amount, profitability, pct_of_total_sales)
  VALUES (?, 'month', ?, ?, ?, ?, ?, ?)
`);
db.transaction(() => {
  db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)').run(MONTH);
  for (const r of records) {
    stmt.run(r.period, r.discount_name, r.discount_category, r.usage_count, r.discount_amount, r.profitability, r.pct_of_total_sales);
  }
})();

try {
  db.prepare(`
    INSERT INTO upload_log (id, filename, source_type, record_count, month_covered, status, dedup_summary, confirmed_at)
    VALUES (?, ?, 'discount_summary', ?, ?, 'success', ?, datetime('now'))
  `).run(randomBytes(8).toString('hex'), SOURCE, records.length, MONTH, JSON.stringify({ discounts: records.length, skippedTotal }));
} catch (e) {
  console.warn('upload_log insert skipped:', e.message);
}

// ── Verify against DB ──
console.table(db.prepare(`
  SELECT discount_category, COUNT(*) n, ROUND(SUM(discount_amount),2) amount, ROUND(SUM(profitability),2) profitability
  FROM fact_discount_summary WHERE period=? GROUP BY discount_category ORDER BY amount DESC
`).all(MONTH));
db.close();
