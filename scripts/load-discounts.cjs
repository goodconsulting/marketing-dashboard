/**
 * Load Discount Summary data from XLSX into SQLite.
 *
 * Usage: node scripts/load-discounts.cjs
 *
 * Reads data/discount-summary/Discount Summary.xlsx, parses all sheets,
 * categorizes each discount, and inserts into fact_discount_summary.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const FILE_PATH = path.join(__dirname, '..', 'data', 'discount-summary', 'Discount Summary.xlsx');

if (!fs.existsSync(FILE_PATH)) {
  console.error('File not found:', FILE_PATH);
  process.exit(1);
}

// ─── Period Parsing ──────────────────────────────────────────────

const MONTH_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  january: '01', february: '02', march: '03', april: '04', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

function parseSheetPeriod(sheetName) {
  const trimmed = sheetName.trim();

  // Quarter: "Q2 2025" -> 2025-Q2
  const qMatch = trimmed.match(/^Q(\d)\s+(\d{4})$/i);
  if (qMatch) {
    return { period: `${qMatch[2]}-Q${qMatch[1]}`, periodType: 'quarter' };
  }

  // Month: "Jan 2026" or "March 2026" -> 2026-01 / 2026-03
  const mMatch = trimmed.match(/^(\w+)\s+(\d{4})$/i);
  if (mMatch) {
    const monthNum = MONTH_MAP[mMatch[1].toLowerCase()];
    if (monthNum) {
      return { period: `${mMatch[2]}-${monthNum}`, periodType: 'month' };
    }
  }

  return null;
}

// ─── Category Classification ─────────────────────────────────────

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

// ─── Main ────────────────────────────────────────────────────────

const db = new Database(DB_PATH);

// Ensure table exists
db.pragma('journal_mode = WAL');
db.prepare(`
CREATE TABLE IF NOT EXISTS fact_discount_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL,
  period_type TEXT NOT NULL,
  discount_name TEXT NOT NULL,
  discount_category TEXT NOT NULL,
  usage_count INTEGER DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  profitability REAL DEFAULT 0,
  pct_of_total_sales REAL DEFAULT 0,
  UNIQUE(period, discount_name)
)
`).run();

const stmt = db.prepare(`
  INSERT OR REPLACE INTO fact_discount_summary
  (period, period_type, discount_name, discount_category, usage_count, discount_amount, profitability, pct_of_total_sales)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const buffer = fs.readFileSync(FILE_PATH);
const wb = XLSX.read(buffer, { type: 'buffer' });

const summary = {};
let totalInserted = 0;

db.transaction(() => {
  for (const sheetName of wb.SheetNames) {
    const periodInfo = parseSheetPeriod(sheetName);
    if (!periodInfo) {
      console.log(`  Skipping sheet "${sheetName}" (could not parse period)`);
      continue;
    }

    const ws = wb.Sheets[sheetName];

    // Some sheets have a title row ("Discount Summary") before the actual headers.
    // Detect header row by scanning raw rows for "Discount Name" in first cell.
    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
      const firstCell = String((rawRows[i] || [])[0] || '').trim();
      if (firstCell === 'Discount Name') {
        headerRowIdx = i;
        break;
      }
    }

    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', range: headerRowIdx });

    let count = 0;
    for (const row of rows) {
      const discountName = String(row['Discount Name'] || '').trim();
      if (!discountName) continue;

      const usageCount = typeof row['Count'] === 'number'
        ? row['Count']
        : parseInt(String(row['Count'] || '0').replace(/,/g, ''), 10) || 0;

      const discountAmount = typeof row['Discount Amount'] === 'number'
        ? row['Discount Amount']
        : parseFloat(String(row['Discount Amount'] || '0').replace(/[$,]/g, '')) || 0;

      const profitability = typeof row['Profitability'] === 'number'
        ? row['Profitability']
        : parseFloat(String(row['Profitability'] || '0').replace(/[$,]/g, '')) || 0;

      const pctRaw = row['Percent of Total Sales'];
      let pctOfTotalSales = 0;
      if (typeof pctRaw === 'number') {
        pctOfTotalSales = pctRaw > 1 ? pctRaw : pctRaw * 100;
      } else {
        pctOfTotalSales = parseFloat(String(pctRaw || '0').replace(/%/g, '')) || 0;
      }

      const category = categorizeDiscount(discountName);

      stmt.run(
        periodInfo.period, periodInfo.periodType, discountName, category,
        usageCount, Math.round(discountAmount * 100) / 100,
        Math.round(profitability * 100) / 100,
        Math.round(pctOfTotalSales * 10000) / 10000,
      );
      count++;
    }

    summary[`${sheetName} (${periodInfo.period})`] = count;
    totalInserted += count;
  }
})();

console.log('\nDiscount Summary Load Complete');
console.log('='.repeat(40));
for (const [period, count] of Object.entries(summary)) {
  console.log(`  ${period}: ${count} records`);
}
console.log(`  TOTAL: ${totalInserted} records`);

// Verify
const verify = db.prepare('SELECT period, COUNT(*) as cnt FROM fact_discount_summary GROUP BY period ORDER BY period').all();
console.log('\nVerification (rows per period):');
for (const row of verify) {
  console.log(`  ${row.period}: ${row.cnt}`);
}

db.close();
