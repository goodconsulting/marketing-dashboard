/**
 * Load OneLink QR tracking CSVs into the database.
 *
 * Usage: node scripts/load-onelink.cjs
 *
 * Reads all 7 CSV files from data/onelink/, parses each with
 * tracking code + campaign source derived from filename, and
 * inserts into fact_onelink_daily.
 */

const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const DATA_DIR = path.join(__dirname, '..', 'data', 'onelink');

const db = new Database(DB_PATH);

// Ensure table exists
db.exec(`
CREATE TABLE IF NOT EXISTS fact_onelink_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  month TEXT NOT NULL,
  tracking_code TEXT NOT NULL,
  campaign_source TEXT NOT NULL,
  campaign_label TEXT NOT NULL,
  total INTEGER DEFAULT 0,
  iphone INTEGER DEFAULT 0,
  ipad INTEGER DEFAULT 0,
  android INTEGER DEFAULT 0,
  other INTEGER DEFAULT 0,
  UNIQUE(date, tracking_code)
);
`);

const stmt = db.prepare(`
  INSERT OR REPLACE INTO fact_onelink_daily
  (date, month, tracking_code, campaign_source, campaign_label, total, iphone, ipad, android, other)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');

function pi(v) { return parseInt(v, 10) || 0; }

/**
 * Derive campaign metadata from filename.
 */
function extractMetadata(filename) {
  const parts = filename.split('_');
  const trackingCode = parts[1] || 'unknown';
  const lower = filename.toLowerCase();

  if (lower.includes('valpak')) {
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].toLowerCase() === 'valpak' && parts[i + 1]) {
        const loc = parts[i + 1];
        let location;
        if (loc.toLowerCase() === 'cr') location = 'Cedar Rapids';
        else location = loc.charAt(0).toUpperCase() + loc.slice(1);
        return { trackingCode, source: 'valpak', label: 'ValPak - ' + location };
      }
    }
    return { trackingCode, source: 'valpak', label: 'ValPak' };
  }

  if (lower.includes('directmailer')) {
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].toLowerCase().includes('directmailer') && parts[i + 1]) {
        const loc = parts[i + 1];
        let location;
        if (loc.toLowerCase() === 'cedarrapids') location = 'Cedar Rapids';
        else location = loc.charAt(0).toUpperCase() + loc.slice(1);
        return { trackingCode, source: 'direct_mail', label: 'Direct Mailer 1 - ' + location };
      }
    }
    return { trackingCode, source: 'direct_mail', label: 'Direct Mailer 1' };
  }

  if (lower.includes('metaads')) {
    return { trackingCode, source: 'meta_ads', label: 'Meta Ads - App Download' };
  }

  if (lower.includes('appdownload')) {
    return { trackingCode, source: 'app_download', label: 'App Download' };
  }

  if (lower.includes('original')) {
    return { trackingCode, source: 'original', label: 'Original QR' };
  }

  return { trackingCode, source: 'other', label: 'Other' };
}

/**
 * Convert YYYYMMDD to YYYY-MM-DD.
 */
function formatDate(yyyymmdd) {
  const s = yyyymmdd.trim();
  if (s.length < 8) return s;
  return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
}

function loadFile(filepath) {
  const filename = path.basename(filepath);
  const meta = extractMetadata(filename);
  const csv = fs.readFileSync(filepath, 'utf8');
  const result = Papa.parse(csv, { header: true, skipEmptyLines: true });

  let count = 0;
  for (const row of result.data) {
    const dateRaw = row['YYYYMMDD (UTC)'] || '';
    const total = pi(row['Total']);
    if (total === 0) continue;

    const date = formatDate(dateRaw);
    const month = date.substring(0, 7);
    const huawei = pi(row['Huawei']);
    const otherVal = pi(row['Other']);

    dimStmt.run(month);
    stmt.run(
      date, month, meta.trackingCode, meta.source, meta.label,
      total, pi(row['iPhone']), pi(row['iPad']), pi(row['Android']),
      huawei + otherVal
    );
    count++;
  }

  return { filename, trackingCode: meta.trackingCode, source: meta.source, label: meta.label, count };
}

// ── Main ────────────────────────────────────────────────────────────

const files = fs.readdirSync(DATA_DIR).filter(function(f) { return f.endsWith('.csv'); }).sort();

if (files.length === 0) {
  console.log('No CSV files found in', DATA_DIR);
  process.exit(1);
}

console.log('Loading ' + files.length + ' OneLink CSV files from ' + DATA_DIR + '\n');

let totalRecords = 0;

db.transaction(function() {
  for (const file of files) {
    const filepath = path.join(DATA_DIR, file);
    const result = loadFile(filepath);
    console.log('  ' + result.filename);
    console.log('    tracking_code=' + result.trackingCode + '  source=' + result.source + '  label="' + result.label + '"  records=' + result.count);
    totalRecords += result.count;
  }
})();

console.log('\nDone! Inserted ' + totalRecords + ' total records into fact_onelink_daily.');

// Verify
const verify = db.prepare('SELECT COUNT(*) as count FROM fact_onelink_daily').get();
console.log('Table now has ' + verify.count + ' rows.');

const byCampaign = db.prepare(
  'SELECT campaign_source, campaign_label, COUNT(*) as cnt, SUM(total) as total_scans FROM fact_onelink_daily GROUP BY campaign_source, campaign_label ORDER BY total_scans DESC'
).all();
console.log('\nBy campaign:');
for (const r of byCampaign) {
  console.log('  ' + r.campaign_label + ' (' + r.campaign_source + '): ' + r.cnt + ' days, ' + r.total_scans + ' scans');
}

db.close();
