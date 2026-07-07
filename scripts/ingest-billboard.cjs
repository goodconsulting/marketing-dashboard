/**
 * Ingest monthly Lamar billboard proof-of-play figures → fact_billboard_monthly.
 *
 * The proof-of-play arrives as a PDF; figures are read from its "Report
 * Summary" section and passed as flags (there is no machine-readable export).
 *
 * Usage:
 *   node scripts/ingest-billboard.cjs <YYYY-MM> \
 *     --plays-guaranteed 38688 --plays-delivered 44922 \
 *     --impressions-guaranteed 1312663.67 --impressions-delivered 1524180.04 \
 *     --creatives 5 --days 31 \
 *     [--location "Cedar Rapids"] [--panel 232-070050] [--dry-run]
 *
 * Defaults: location "Cedar Rapids", panel 232-070050 (1201 Blairs Ferry Rd NE
 * — the only contracted panel as of mid-2026). variance_pct is computed.
 *
 * Idempotent: INSERT OR REPLACE on (month, location).
 */
const path = require('path');
const Database = require('better-sqlite3');
const { randomBytes } = require('crypto');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const MONTH = argv[0];
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};

if (!MONTH || !/^\d{4}-\d{2}$/.test(MONTH)) {
  console.error('Usage: node scripts/ingest-billboard.cjs <YYYY-MM> --plays-guaranteed N --plays-delivered N --impressions-guaranteed N --impressions-delivered N --creatives N --days N [--location L] [--panel P] [--dry-run]');
  process.exit(2);
}

const row = {
  month: MONTH,
  location: flag('location', 'Cedar Rapids'),
  panel_id: flag('panel', '232-070050'),
  plays_guaranteed: parseFloat(flag('plays-guaranteed')),
  plays_delivered: parseFloat(flag('plays-delivered')),
  impressions_guaranteed: parseFloat(flag('impressions-guaranteed')),
  impressions_delivered: parseFloat(flag('impressions-delivered')),
  num_creatives: parseInt(flag('creatives'), 10),
  contracted_days: parseInt(flag('days'), 10),
};

const missing = Object.entries(row).filter(([, v]) => v == null || Number.isNaN(v)).map(([k]) => k);
if (missing.length) {
  console.error(`✗ Missing/invalid: ${missing.join(', ')}`);
  process.exit(2);
}
row.variance_pct = Math.round(((row.plays_delivered - row.plays_guaranteed) / row.plays_guaranteed) * 100);

console.table([row]);
console.log(`Delivery vs guarantee: ${row.variance_pct >= 0 ? '+' : ''}${row.variance_pct}%`);
if (row.variance_pct < 0) console.log('⚠️  UNDER-delivery — flag with Lamar rep for make-good.');

if (DRY_RUN) {
  console.log('\n[dry-run] No database writes performed.');
  process.exit(0);
}

const db = new Database(path.join(__dirname, '..', 'data', 'stack.db'));
db.transaction(() => {
  db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)').run(MONTH);
  db.prepare(`
    INSERT OR REPLACE INTO fact_billboard_monthly
    (month, location, panel_id, plays_guaranteed, plays_delivered,
     impressions_guaranteed, impressions_delivered, variance_pct, num_creatives, contracted_days)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.month, row.location, row.panel_id, row.plays_guaranteed, row.plays_delivered,
    row.impressions_guaranteed, row.impressions_delivered, row.variance_pct, row.num_creatives, row.contracted_days,
  );
})();

try {
  db.prepare(`
    INSERT INTO upload_log (id, filename, source_type, record_count, month_covered, status, dedup_summary, confirmed_at)
    VALUES (?, ?, 'billboard', 1, ?, 'success', ?, datetime('now'))
  `).run(randomBytes(8).toString('hex'), `lamar-proof-of-play-${MONTH}`, MONTH, JSON.stringify(row));
} catch (e) {
  console.warn('upload_log insert skipped:', e.message);
}

console.log('Billboard trend:');
console.table(db.prepare(`
  SELECT month, plays_guaranteed, plays_delivered, variance_pct, num_creatives
  FROM fact_billboard_monthly ORDER BY month
`).all());
db.close();
