/**
 * Ingest OneLink daily clicks from
 * Stack_OneLink_Consolidated_Mar-Apr2026.xlsx (Raw by Source sheet).
 *
 * Reporting window: 3/1/2026 – 4/16/2026.
 *
 * Source-name ↔ tracking-code mapping (confirmed w/ user):
 *   Core            → umr42z (Original QR)          — keep existing label
 *   Website         → uegjxm (rename: App Download → Website)
 *   DirectMailer    → ahbay7 (Direct Mailer 1 - Cedar Rapids)
 *   Val Coralville  → rau9v3 (ValPak - Coralville)
 *   Val Waukee      → g6vqad (ValPak - Waukee)
 *
 * "Meta Ads OneLink" is intentionally NOT in this XLSX (the source doc's
 * Summary sheet explicitly notes it must be added from Meta Ads Manager).
 * Existing stackdownload rows are left untouched.
 *
 * Also retroactively relabels existing uegjxm rows from "App Download"
 * to "Website" for dashboard consistency.
 *
 * Uses INSERT OR REPLACE on (date, tracking_code), so re-running is safe.
 */
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');

const XLSX_PATH = '/Users/carsongoodale/Downloads/Stack_OneLink_Consolidated_Mar-Apr2026.xlsx';
const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');

const SOURCES = [
  { xlsxName: 'Core',           col: 1,  tracking: 'umr42z', source: 'original',    label: 'Original QR' },
  { xlsxName: 'Website',        col: 7,  tracking: 'uegjxm', source: 'website',     label: 'Website' },
  { xlsxName: 'DirectMailer',   col: 13, tracking: 'ahbay7', source: 'direct_mail', label: 'Direct Mailer 1 - Cedar Rapids' },
  { xlsxName: 'Val Coralville', col: 19, tracking: 'rau9v3', source: 'valpak',      label: 'ValPak - Coralville' },
  { xlsxName: 'Val Waukee',     col: 25, tracking: 'g6vqad', source: 'valpak',      label: 'ValPak - Waukee' },
];
// Column layout in "Raw by Source": each source occupies 6 cols: Total, iPhone, iPad, Android, Huawei, Other.

const wb = XLSX.read(fs.readFileSync(XLSX_PATH));
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Raw by Source'], { header: 1, raw: false, defval: '' });

// Rows: [0]=title, [1]=blank, [2]=source group header, [3]=sub-header, [4..n-1]=data, [last]=TOTAL
const pi = (v) => { const n = parseInt(String(v).replace(/,/g, ''), 10); return isNaN(n) ? 0 : n; };

// Convert MM/DD/YYYY → YYYY-MM-DD
function toIso(mdy) {
  const m = String(mdy).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

const db = new Database(DB_PATH);
const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');
const upsertStmt = db.prepare(`
  INSERT OR REPLACE INTO fact_onelink_daily
  (date, month, tracking_code, campaign_source, campaign_label, total, iphone, ipad, android, other)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// ── Pre-check: snapshot state before changes ─────────────────────
const before = db.prepare(`
  SELECT tracking_code, campaign_label, COUNT(*) AS days, SUM(total) AS scans
  FROM fact_onelink_daily WHERE tracking_code IN ('umr42z','uegjxm','ahbay7','rau9v3','g6vqad')
  GROUP BY tracking_code ORDER BY tracking_code
`).all();
console.log('--- Before ---');
console.table(before);

// ── 1. Retroactive relabel of uegjxm ─────────────────────────────
const relabelStmt = db.prepare(`
  UPDATE fact_onelink_daily SET campaign_source='website', campaign_label='Website'
  WHERE tracking_code='uegjxm'
`);
const relabelResult = relabelStmt.run();
console.log(`Relabeled ${relabelResult.changes} uegjxm rows → source='website', label='Website'`);

// ── 2. Ingest daily data from XLSX ───────────────────────────────
let totalInserted = 0;
db.transaction(() => {
  // data rows are 4..rows.length-2 (last is TOTAL)
  for (let i = 4; i < rows.length - 1; i++) {
    const r = rows[i];
    const dateStr = r[0];
    if (!dateStr || String(dateStr).toUpperCase() === 'TOTAL') continue;
    const iso = toIso(dateStr);
    if (!iso) continue;
    const month = iso.slice(0, 7);
    dimStmt.run(month);

    for (const s of SOURCES) {
      const total = pi(r[s.col]);
      const iphone = pi(r[s.col + 1]);
      const ipad = pi(r[s.col + 2]);
      const android = pi(r[s.col + 3]);
      const huawei = pi(r[s.col + 4]);
      const other = pi(r[s.col + 5]);

      // Skip day-source combos with zero activity (same behavior as load-onelink.cjs)
      if (total === 0) continue;

      upsertStmt.run(
        iso, month, s.tracking, s.source, s.label,
        total, iphone, ipad, android, huawei + other
      );
      totalInserted++;
    }
  }
})();

console.log(`Upserted ${totalInserted} daily rows across 5 sources`);

// ── 3. Verify ────────────────────────────────────────────────────
const after = db.prepare(`
  SELECT tracking_code, campaign_source, campaign_label,
         MIN(date) AS first_dt, MAX(date) AS last_dt,
         COUNT(*) AS days, SUM(total) AS scans
  FROM fact_onelink_daily
  WHERE tracking_code IN ('umr42z','uegjxm','ahbay7','rau9v3','g6vqad')
  GROUP BY tracking_code ORDER BY scans DESC
`).all();
console.log('\n--- After (lifetime) ---');
console.table(after);

const windowView = db.prepare(`
  SELECT campaign_label, SUM(total) AS scans, COUNT(*) AS days
  FROM fact_onelink_daily
  WHERE date BETWEEN '2026-03-01' AND '2026-04-16'
    AND tracking_code IN ('umr42z','uegjxm','ahbay7','rau9v3','g6vqad')
  GROUP BY campaign_label ORDER BY scans DESC
`).all();
console.log('\n--- Mar 1 – Apr 16 window (tracked channels) ---');
console.table(windowView);

const totalInWindow = windowView.reduce((a, r) => a + r.scans, 0);
console.log(`\nTotal in window: ${totalInWindow} (XLSX Summary target: 6259)`);
db.close();
