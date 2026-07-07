/**
 * One-off ingest: April 2026 marketing expenses from data/apr_2026_expenses.xlsx
 *
 * Usage: node scripts/ingest-apr-2026-expenses.cjs
 *
 * Source: QuickBooks "Transaction Report" (Advertising & marketing, April 2026).
 * Mirrors server/parsers/expenses.ts (parseExpensesXLSX) + server/parsers/categorize.ts
 * (kept in sync as of April 2026 — re-port if those files change).
 *
 * XLSX column layout (header:1, column indices):
 *   [1]=Transaction date  [2]=Transaction type  [3]=Num
 *   [4]=Name (vendor)     [5]=Description        [8]=Amount
 *
 * Two precedent-based refinements beyond the bare parser:
 *   1. Vendor falls back to the transaction TYPE (col 2) and description falls
 *      back to the Num/memo (col 3) when the Name/Description cells are blank.
 *      This cleanly fixes the one blank-vendor row — the "$500 / AT APR26 DD MKTG"
 *      DoorDash marketing journal entry — so it categorizes as paid_media, matching
 *      how Dec 2025 → Mar 2026 stored their DD/UE "gross up" accruals.
 *   2. Non-positive rows (amount <= 0) are excluded, same as the live parser.
 *      April has one: a -$5,000 Hero Labs "Receivable" deposit miscoded to the
 *      A&M register. It is money IN, not ad spend, so it is not stored. (This is
 *      why dashboard gross spend $27,786.78 != the QB report's net $22,786.78.)
 */
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const { randomBytes } = require('crypto');

const XLSX_PATH = path.join(__dirname, '..', 'data', 'apr_2026_expenses.xlsx');
const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const SOURCE = 'apr_2026_expenses.xlsx';

// ── Mirror of server/parsers/categorize.ts ──
const VENDOR_CATEGORIES = {
  'gsuite': 'software_fees', 'workspace': 'software_fees',
  'google': 'paid_media', 'facebook': 'paid_media', 'facebk': 'paid_media',
  'meta': 'paid_media', 'yelp': 'paid_media', 'indeed': 'paid_media',
  'uber eats': 'paid_media', 'ue mktg': 'paid_media', 'ue marketing': 'paid_media',
  'dd mktg': 'paid_media', 'sinclair': 'paid_media',
  'allegra': 'direct_mail_print', 'vistaprint': 'direct_mail_print',
  'gotprint': 'direct_mail_print', 'usps': 'direct_mail_print',
  'vpc direct': 'direct_mail_print', 'uline': 'direct_mail_print',
  'copyworks': 'direct_mail_print',
  'lamar': 'ooh', 'billboard': 'ooh', 'valpak': 'ooh',
  'incentivio': 'software_fees', 'momos': 'software_fees', 'canva': 'software_fees',
  'highlevel': 'software_fees', 'high level': 'software_fees', 'godaddy': 'software_fees',
  'webflow': 'software_fees', 'bright local': 'software_fees', 'brightlocal': 'software_fees',
  'claude.ai': 'software_fees', 'claude ai': 'software_fees', 'giftameal': 'software_fees',
  'hoskins': 'labor', 'hopkins': 'labor', 'alexis': 'labor', 'tyce': 'labor',
  'hello digital': 'labor',
  'metro alliance': 'sponsorship', 'economic alliance': 'sponsorship',
  'cedar rapids metro': 'sponsorship', 'west des moines': 'sponsorship',
  'newbo': 'sponsorship', 'urbandale chamber': 'sponsorship',
  'waukee area chamber': 'sponsorship',
  'big green': 'sponsorship', 'umbrella media': 'sponsorship',
  'downtown events': 'sponsorship',
  'careismatic': 'sponsorship', 'legitscript': 'sponsorship',
  'sponsorship': 'sponsorship',
  'dd marketing': 'paid_media', 'doordash': 'paid_media',
};

function categorize(vendor, description) {
  const s = `${vendor} ${description}`.toLowerCase();
  for (const [k, c] of Object.entries(VENDOR_CATEGORIES)) {
    if (s.includes(k.toLowerCase())) return c;
  }
  if (s.includes('ads') || s.includes('campaign')) return 'paid_media';
  if (s.includes('print') || s.includes('mail') || s.includes('flyer')) return 'direct_mail_print';
  if (s.includes('sign') || s.includes('outdoor') || s.includes('bulletin')) return 'ooh';
  return 'other';
}

function parseMonth(dateStr) {
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}`;
  throw new Error(`Unparseable date: ${dateStr}`);
}

// ── Parse the XLSX (mirror of parseExpensesXLSX) ──
const wb = XLSX.readFile(XLSX_PATH);
const ws = wb.Sheets[wb.SheetNames[0]];
const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

const rows = [];
const excluded = [];
for (const r of raw) {
  if (!Array.isArray(r)) continue;
  const dateVal = r[1];
  const amount = r[8];

  // Skip headers / section rows / totals (no date), and non-numeric amounts.
  if (!dateVal || typeof amount !== 'number') continue;

  // Resolve date (strings come straight through; serials via SSF as a safety net).
  let dateStr = '';
  if (typeof dateVal === 'string') dateStr = dateVal;
  else if (typeof dateVal === 'number') {
    const d = XLSX.SSF.parse_date_code(dateVal);
    dateStr = `${String(d.m).padStart(2, '0')}/${String(d.d).padStart(2, '0')}/${d.y}`;
  }
  if (!dateStr || !dateStr.match(/\d/)) continue;

  // Exclude non-positive amounts (deposits/credits) — track them for the report.
  if (amount <= 0) {
    excluded.push({ date: dateStr, vendor: String(r[4] || r[2] || ''), desc: String(r[5] || r[3] || ''), amount });
    continue;
  }

  // Vendor / description with precedent-based fallbacks (type, then Num/memo).
  const vendor = String(r[4] || r[2] || '').trim();
  const desc = String(r[5] || r[3] || '').trim();

  rows.push({
    id: randomBytes(8).toString('hex'),
    date: dateStr,
    month: parseMonth(dateStr),
    vendor,
    description: desc,
    amount,
    category: categorize(vendor, desc),
    source: SOURCE,
  });
}

const total = rows.reduce((a, r) => a + r.amount, 0);
console.log(`Parsed ${rows.length} expense rows, total $${total.toFixed(2)}`);
if (excluded.length) {
  console.log(`\nExcluded ${excluded.length} non-positive row(s) (not ad spend):`);
  console.table(excluded);
}

// ── Insert ──
const db = new Database(DB_PATH);
const stmt = db.prepare(`
  INSERT OR IGNORE INTO fact_expense (id, date, month, vendor, description, amount, category, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');

let inserted = 0, skipped = 0;
const tx = db.transaction(() => {
  for (const r of rows) {
    dimStmt.run(r.month);
    const res = stmt.run(r.id, r.date, r.month, r.vendor, r.description, r.amount, r.category, r.source);
    if (res.changes > 0) inserted++; else skipped++;
  }
});
tx();
console.log(`\nInserted: ${inserted}, Skipped (already present / dedup): ${skipped}`);

// ── Log to upload_log (mirrors the confirm step) ──
try {
  db.prepare(`
    INSERT INTO upload_log (id, filename, source_type, record_count, month_covered, status, dedup_summary, confirmed_at)
    VALUES (?, ?, 'expenses', ?, '2026-04', 'success', ?, datetime('now'))
  `).run(
    randomBytes(8).toString('hex'),
    SOURCE,
    inserted,
    JSON.stringify({ parsed: rows.length, inserted, skipped, excludedNonPositive: excluded.length }),
  );
} catch (e) {
  console.warn('upload_log insert skipped:', e.message);
}

// ── Verify ──
const byCat = db.prepare(`
  SELECT category, COUNT(*) AS n, ROUND(SUM(amount), 2) AS total
  FROM fact_expense WHERE month='2026-04' GROUP BY category ORDER BY total DESC
`).all();
console.log('\nApril 2026 by category:');
console.table(byCat);

const totalRow = db.prepare(
  `SELECT COUNT(*) AS n, ROUND(SUM(amount),2) AS total FROM fact_expense WHERE month='2026-04'`
).get();
console.log(`April 2026 stored total: $${totalRow.total} across ${totalRow.n} rows`);
console.log(`(QuickBooks report net total: $22,786.78 — difference is the -$5,000 Hero Labs deposit, excluded as non-spend.)`);

db.close();
