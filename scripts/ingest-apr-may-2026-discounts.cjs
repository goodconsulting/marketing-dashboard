/**
 * Ingest April + May 2026 Discount Summary (Toast) →  fact_discount_summary.
 *
 * Source: data/discount-summary/discount_summary_april_may_2026.xlsx
 *   Sheets named "April" / "May" (no year) → mapped to 2026-04 / 2026-05.
 *
 * Mirrors scripts/load-discounts.cjs categorization. The trailing "Total"
 * row in each sheet is skipped (it is a summary, not a discount). The
 * 'marketing' / 'new_customer' categories are what tie discounts back to
 * marketing activity for ROI analysis.
 *
 * Idempotent: INSERT OR REPLACE on (period, discount_name).
 * Usage: node scripts/ingest-apr-may-2026-discounts.cjs
 */
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');

const FILE = path.join(__dirname, '..', 'data', 'discount-summary', 'discount_summary_april_may_2026.xlsx');
const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const SHEET_PERIOD = { April: '2026-04', May: '2026-05' };

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

const wb = XLSX.readFile(FILE);
const db = new Database(DB_PATH);
const stmt = db.prepare(`
  INSERT OR REPLACE INTO fact_discount_summary
  (period, period_type, discount_name, discount_category, usage_count, discount_amount, profitability, pct_of_total_sales)
  VALUES (?, 'month', ?, ?, ?, ?, ?, ?)
`);

const summary = {};
db.transaction(() => {
  for (const sheetName of wb.SheetNames) {
    const period = SHEET_PERIOD[sheetName.trim()];
    if (!period) { console.log(`  Skipping sheet "${sheetName}"`); continue; }

    const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
    let headerIdx = 0;
    for (let i = 0; i < Math.min(raw.length, 5); i++) {
      if (String((raw[i] || [])[0] || '').trim() === 'Discount Name') { headerIdx = i; break; }
    }
    const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', range: headerIdx });
    // Normalize header keys — this workbook has " Profitability" with a leading space.
    const rows = rawRows.map(r => {
      const o = {};
      for (const k in r) o[k.trim()] = r[k];
      return o;
    });

    let count = 0, skippedTotal = 0;
    for (const row of rows) {
      const name = String(row['Discount Name'] || '').trim();
      if (!name) continue;
      if (name.toLowerCase() === 'total') { skippedTotal++; continue; }  // summary row, not a discount

      let pct = num(row['Percent of Total Sales']);
      if (pct > 0 && pct <= 1) pct = pct * 100;  // fractional → percent

      stmt.run(
        period, name, categorizeDiscount(name),
        Math.round(num(row['Count'])),
        Math.round(num(row['Discount Amount']) * 100) / 100,
        Math.round(num(row['Profitability']) * 100) / 100,
        Math.round(pct * 10000) / 10000,
      );
      count++;
    }
    summary[`${sheetName} (${period})`] = { count, skippedTotal };
  }
})();

console.log('Discount ingest complete:');
for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v.count} discounts (skipped ${v.skippedTotal} Total row)`);

// ── Verify: per period + marketing-tied categories (ROI relevant) ──
console.log('\nAll discount periods now:');
console.table(db.prepare('SELECT period, COUNT(*) n, ROUND(SUM(discount_amount),2) discount_$ FROM fact_discount_summary GROUP BY period ORDER BY period').all());
console.log('April + May by category:');
console.table(db.prepare(`
  SELECT period, discount_category, COUNT(*) n, ROUND(SUM(discount_amount),2) discount_$
  FROM fact_discount_summary WHERE period IN ('2026-04','2026-05')
  GROUP BY period, discount_category ORDER BY period, discount_$ DESC
`).all());
db.close();
