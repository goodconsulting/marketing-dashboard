/**
 * Ingest a Hello Digital Marketing monthly social PDF → fact_social_monthly.
 *
 * Usage: node scripts/ingest-social.cjs <report.pdf> <YYYY> [--dry-run]
 *   e.g. node scripts/ingest-social.cjs "data/social/jun_2026_facebook.pdf" 2026
 *
 * The PDF is a Jan–Dec year grid with NO year printed on it — the year is a
 * required argument. Every month present in the grid is (re)stored: the vendor
 * restates prior months (April 2026 was revised −65% in the May report), so
 * the LATEST report per platform is authoritative. Ingesting an old report
 * after a newer one would roll back restatements — always ingest newest last.
 *
 * Idempotent: INSERT OR REPLACE on (month, platform).
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { randomBytes } = require('crypto');
const { PDFParse } = require('pdf-parse');
const { parseSocialReportText } = require('../server/lib/social-pdf.cjs');

const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const DRY_RUN = process.argv.includes('--dry-run');
const [FILE_ARG, YEAR] = args;
if (!FILE_ARG || !YEAR || !/^\d{4}$/.test(YEAR)) {
  console.error('Usage: node scripts/ingest-social.cjs <report.pdf> <YYYY> [--dry-run]');
  process.exit(2);
}
const FILE = path.resolve(FILE_ARG);
const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const SOURCE = path.basename(FILE);

(async () => {
  const parser = new PDFParse({ data: fs.readFileSync(FILE) });
  const { text } = await parser.getText();
  const { platform, records } = parseSocialReportText(text, YEAR);

  console.log(`Platform: ${platform} — ${records.length} reported month(s):`);
  console.table(records);

  if (DRY_RUN) {
    console.log('\n[dry-run] No database writes performed.');
    return;
  }

  const db = new Database(DB_PATH);
  // CLI-side migration so the script works before the app has booted the new schema.
  db.prepare(`CREATE TABLE IF NOT EXISTS fact_social_monthly (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL, platform TEXT NOT NULL,
    followers INTEGER DEFAULT 0, engagement INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0, reach INTEGER DEFAULT 0,
    profile_visits INTEGER DEFAULT 0, website_clicks INTEGER DEFAULT 0,
    source TEXT, synced_at TEXT,
    UNIQUE(month, platform)
  )`).run();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO fact_social_monthly
    (month, platform, followers, engagement, impressions, reach, profile_visits, website_clicks, source, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');

  db.transaction(() => {
    for (const r of records) {
      dimStmt.run(r.month);
      stmt.run(r.month, r.platform, r.followers, r.engagement, r.impressions,
        r.reach, r.profile_visits, r.website_clicks, SOURCE);
    }
  })();

  try {
    db.prepare(`
      INSERT INTO upload_log (id, filename, source_type, record_count, month_covered, status, dedup_summary, confirmed_at)
      VALUES (?, ?, 'social_pdf', ?, ?, 'success', ?, datetime('now'))
    `).run(
      randomBytes(8).toString('hex'), SOURCE, records.length,
      records[records.length - 1].month,
      JSON.stringify({ platform, months: records.map((r) => r.month) }),
    );
  } catch (e) {
    console.warn('upload_log insert skipped:', e.message);
  }

  console.log(`\nStored ${records.length} month(s) for ${platform}. All social rows:`);
  console.table(db.prepare(
    'SELECT month, platform, followers, engagement, impressions, reach, profile_visits, website_clicks FROM fact_social_monthly ORDER BY month, platform'
  ).all());
  db.close();
})().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
