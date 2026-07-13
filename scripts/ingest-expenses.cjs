/**
 * Ingest monthly marketing expenses (QuickBooks export) → fact_expense.
 *
 * Usage: node scripts/ingest-expenses.cjs <file.xlsx|csv> <YYYY-MM> [--dry-run]
 *   e.g. node scripts/ingest-expenses.cjs data/may_2026_expenses.xlsx 2026-05
 *
 * Generalized from ingest-apr-2026-expenses.cjs (Apr 2026). Handles both
 * QB "Transaction Report" layouts: header-row based (columns found by name)
 * and the headerless fixed-index layout ([1]=date [2]=type [3]=Num [4]=Name
 * [5]=Description [8]=Amount).
 *
 * Precedent-based rules (established Dec 2025 – Apr 2026):
 *   1. Vendor falls back to transaction TYPE, description to Num/memo, when
 *      blank (fixes DD/UE "gross up" journal entries → paid_media).
 *   2. Non-positive rows (amount <= 0) are EXCLUDED — deposits/credits are
 *      money in, not ad spend (e.g. Apr 2026 -$5,000 Hero Labs receivable).
 *      Dashboard stores GROSS spend; co-op funding goes to fact_marketing_funding.
 *   3. Rows outside the target month are excluded and reported loudly.
 *
 * Categorizer mirrors server/parsers/categorize.ts — run
 * `node scripts/check-categorizer-sync.cjs` to verify it hasn't drifted.
 *
 * Idempotent: INSERT OR IGNORE on (date, vendor, amount).
 */
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const { randomBytes } = require('crypto');

const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const DRY_RUN = process.argv.includes('--dry-run');
const [FILE_ARG, MONTH] = args;
if (!FILE_ARG || !MONTH || !/^\d{4}-\d{2}$/.test(MONTH)) {
  console.error('Usage: node scripts/ingest-expenses.cjs <file.xlsx|csv> <YYYY-MM> [--dry-run]');
  process.exit(2);
}
const FILE = path.resolve(FILE_ARG);
const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const SOURCE = path.basename(FILE);

// ── Mirror of server/parsers/categorize.ts (checked by check-categorizer-sync.cjs) ──
const VENDOR_CATEGORIES = {
  'canvas on demand': 'other',
  'gsuite': 'software_fees', 'workspace': 'software_fees',
  'google': 'paid_media', 'facebook': 'paid_media', 'facebk': 'paid_media',
  'meta': 'paid_media', 'yelp': 'paid_media', 'indeed': 'paid_media',
  'uber eats': 'paid_media', 'ue mktg': 'paid_media', 'ue marketing': 'paid_media',
  'dd mktg': 'paid_media', 'sinclair': 'paid_media', 'linkedin': 'paid_media',
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
  'clay b': 'labor', 'dev base': 'labor',
  'hello digital': 'organic_marketing', 'goodale consult': 'organic_marketing',
  'metro alliance': 'sponsorship', 'economic alliance': 'sponsorship',
  'cedar rapids metro': 'sponsorship', 'west des moines': 'sponsorship',
  'newbo': 'sponsorship', 'urbandale chamber': 'sponsorship',
  'waukee area chamber': 'sponsorship',
  'careismatic': 'sponsorship', 'legitscript': 'sponsorship',
  'sponsorship': 'sponsorship',
  'big green': 'sponsorship', 'umbrella media': 'sponsorship',
  'downtown events': 'sponsorship',
  'ragbrai': 'sponsorship', 'dyersville': 'sponsorship', 'marshalltown': 'sponsorship',
  'bliss balloon': 'sponsorship', 'nhl operating': 'sponsorship', 'nhrloperati': 'sponsorship',
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
  const iso = dateStr.match(/^(\d{4})-(\d{2})-\d{2}/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  return null;
}

function cellDateString(v) {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return '';
    return `${String(d.m).padStart(2, '0')}/${String(d.d).padStart(2, '0')}/${d.y}`;
  }
  return '';
}

// ── Parse ──
const wb = XLSX.readFile(FILE);
const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

// Column resolution: look for a header row naming the columns; otherwise use
// the QB Transaction Report fixed indices from the Apr 2026 layout.
let COLS = { date: 1, type: 2, num: 3, vendor: 4, desc: 5, amount: 8 };
let headerRowIdx = -1;
for (let i = 0; i < Math.min(raw.length, 10); i++) {
  const cells = (raw[i] || []).map((c) => String(c || '').toLowerCase().trim());
  const dateIdx = cells.findIndex((c) => c === 'date' || c === 'transaction date');
  const amtIdx = cells.findIndex((c) => c === 'amount');
  if (dateIdx >= 0 && amtIdx >= 0) {
    headerRowIdx = i;
    const find = (...names) => cells.findIndex((c) => names.includes(c));
    COLS = {
      date: dateIdx,
      type: find('transaction type', 'type'),
      num: find('num', 'no.', 'ref no.'),
      vendor: find('name', 'vendor'),
      desc: find('memo/description', 'description', 'memo'),
      amount: amtIdx,
    };
    break;
  }
}
console.log(headerRowIdx >= 0
  ? `Header row found at row ${headerRowIdx + 1}; columns resolved by name.`
  : 'No header row detected; using QB Transaction Report fixed column indices.');

const rows = [];
const excludedNonPositive = [];
const excludedWrongMonth = [];
for (let i = 0; i < raw.length; i++) {
  if (i === headerRowIdx) continue;
  const r = raw[i];
  if (!Array.isArray(r)) continue;
  const amount = r[COLS.amount];
  const dateStr = cellDateString(r[COLS.date]);
  if (!dateStr || !dateStr.match(/\d/) || typeof amount !== 'number') continue;

  const month = parseMonth(dateStr);
  if (!month) continue;

  // `||` not `??` — blank cells are empty strings, and the type/Num fallback
  // is what routes journal entries like "AT APR26 DD MKTG" to paid_media.
  const vendor = String(r[COLS.vendor] || r[COLS.type] || '').trim();
  const desc = String(r[COLS.desc] || r[COLS.num] || '').trim();

  if (amount <= 0) {
    excludedNonPositive.push({ date: dateStr, vendor, desc, amount });
    continue;
  }
  if (month !== MONTH) {
    excludedWrongMonth.push({ date: dateStr, vendor, desc, amount, month });
    continue;
  }

  rows.push({
    id: randomBytes(8).toString('hex'),
    date: dateStr, month, vendor, description: desc, amount,
    category: categorize(vendor, desc),
    source: SOURCE,
  });
}

const total = rows.reduce((a, r) => a + r.amount, 0);
console.log(`\nParsed ${rows.length} expense rows for ${MONTH}, gross total $${total.toFixed(2)}`);

const byCat = {};
for (const r of rows) byCat[r.category] = (byCat[r.category] || 0) + r.amount;
console.table(Object.entries(byCat).sort((a, b) => b[1] - a[1])
  .map(([category, amt]) => ({ category, total: Math.round(amt * 100) / 100 })));

if (excludedNonPositive.length) {
  console.log(`Excluded ${excludedNonPositive.length} non-positive row(s) (deposits/credits, not spend):`);
  console.table(excludedNonPositive);
}
if (excludedWrongMonth.length) {
  console.log(`⚠️  Excluded ${excludedWrongMonth.length} row(s) OUTSIDE ${MONTH} — review these:`);
  console.table(excludedWrongMonth);
}
const otherRows = rows.filter((r) => r.category === 'other');
if (otherRows.length) {
  console.log(`⚠️  ${otherRows.length} row(s) categorized 'other' — check if a keyword should be added to categorize.ts:`);
  console.table(otherRows.map(({ date, vendor, description, amount }) => ({ date, vendor, description, amount })));
}

if (DRY_RUN) {
  console.log('\n[dry-run] No database writes performed.');
  process.exit(0);
}

// ── Insert ──
const db = new Database(DB_PATH);
const stmt = db.prepare(`
  INSERT OR IGNORE INTO fact_expense (id, date, month, vendor, description, amount, category, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');

let inserted = 0, skipped = 0;
db.transaction(() => {
  dimStmt.run(MONTH);
  for (const r of rows) {
    const res = stmt.run(r.id, r.date, r.month, r.vendor, r.description, r.amount, r.category, r.source);
    if (res.changes > 0) inserted++; else skipped++;
  }
})();
console.log(`\nInserted: ${inserted}, Skipped (dedup): ${skipped}`);

try {
  db.prepare(`
    INSERT INTO upload_log (id, filename, source_type, record_count, month_covered, status, dedup_summary, confirmed_at)
    VALUES (?, ?, 'expenses', ?, ?, 'success', ?, datetime('now'))
  `).run(
    randomBytes(8).toString('hex'), SOURCE, inserted, MONTH,
    JSON.stringify({ parsed: rows.length, inserted, skipped, excludedNonPositive: excludedNonPositive.length, excludedWrongMonth: excludedWrongMonth.length }),
  );
} catch (e) {
  console.warn('upload_log insert skipped:', e.message);
}

// ── Verify against DB ──
const totalRow = db.prepare(
  'SELECT COUNT(*) AS n, ROUND(SUM(amount),2) AS total FROM fact_expense WHERE month=?'
).get(MONTH);
console.log(`${MONTH} stored total: $${totalRow.total} across ${totalRow.n} rows`);
db.close();
