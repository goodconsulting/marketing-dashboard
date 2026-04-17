/**
 * One-off ingest: March 2026 expenses from data/mar_2026_expenses.csv
 *
 * Usage: node scripts/ingest-mar-2026-expenses.cjs
 *
 * Mirrors server/parsers/expenses.ts + server/parsers/categorize.ts
 * (kept in sync as of April 2026 — re-port if those files change)
 */
const path = require('path');
const fs = require('fs');
const Papa = require('papaparse');
const Database = require('better-sqlite3');
const { randomBytes } = require('crypto');

const CSV_PATH = path.join(__dirname, '..', 'data', 'mar_2026_expenses.csv');
const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');

// Mirror of server/parsers/categorize.ts (post-March-2026 patch)
const VENDOR_CATEGORIES = {
  'gsuite': 'software_fees', 'workspace': 'software_fees',
  'google': 'paid_media', 'facebook': 'paid_media', 'facebk': 'paid_media',
  'meta': 'paid_media', 'yelp': 'paid_media', 'indeed': 'paid_media',
  'uber eats': 'paid_media', 'ue mktg': 'paid_media', 'ue marketing': 'paid_media',
  'dd mktg': 'paid_media', 'sinclair': 'paid_media',
  'allegra': 'direct_mail_print', 'vistaprint': 'direct_mail_print',
  'gotprint': 'direct_mail_print', 'usps': 'direct_mail_print',
  'vpc direct': 'direct_mail_print', 'uline': 'direct_mail_print',
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

function parseNum(v) {
  if (!v) return 0;
  return parseFloat(String(v).replace(/[$,]/g, '').trim()) || 0;
}

const csv = fs.readFileSync(CSV_PATH, 'utf8');
const result = Papa.parse(csv, { header: true, skipEmptyLines: true });
if (result.errors.length) console.warn(`${result.errors.length} CSV warnings`);

const rows = [];
for (const r of result.data) {
  const date = r['Transaction date'];
  const vendor = r['Name'] || '';
  const desc = r['Memo/Description'] || '';
  const amount = Math.abs(parseNum(r['Amount']));
  if (!date || amount === 0) continue;
  rows.push({
    id: randomBytes(8).toString('hex'),
    date,
    month: parseMonth(date),
    vendor,
    description: desc,
    amount,
    category: categorize(vendor, desc),
    source: 'mar_2026_expenses.csv',
  });
}

console.log(`Parsed ${rows.length} rows, total $${rows.reduce((a, r) => a + r.amount, 0).toFixed(2)}`);

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

console.log(`Inserted: ${inserted}, Skipped (dedup): ${skipped}`);

const verify = db.prepare(`
  SELECT category, COUNT(*) AS n, ROUND(SUM(amount), 2) AS total
  FROM fact_expense WHERE month='2026-03' GROUP BY category ORDER BY total DESC
`).all();
console.log('\nMarch 2026 by category:');
console.table(verify);

const totalRow = db.prepare(
  `SELECT COUNT(*) AS n, ROUND(SUM(amount),2) AS total FROM fact_expense WHERE month='2026-03'`
).get();
console.log(`\nMarch 2026 total: $${totalRow.total} across ${totalRow.n} rows (target $33,103.30)`);

db.close();
