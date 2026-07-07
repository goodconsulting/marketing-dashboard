/**
 * Ingest April + May 2026 Lamar billboard proof-of-play → fact_billboard_monthly.
 *
 * Source PDFs (Cedar Rapids panel 232-070050, 1201 Blairs Ferry Rd NE):
 *   data/lamar-billboard/Proof of Play - Stack Wellness - 04-2026.pdf
 *   data/lamar-billboard/Proof of Play - Stack Wellness - 05-2026.pdf
 * Figures hand-keyed from each "Report Summary" (consistent with the
 * Dec 2025–Mar 2026 rows loaded via load-amp-billboard.cjs).
 *
 * Note (May): the panel delivered the full month (31 days); the 4 menu-item
 * creatives ran 5/1–5/4 and a "$50 OFF Catering" creative ran 5/4–5/31, so
 * num_creatives = 5.
 *
 * Idempotent: INSERT OR REPLACE on (month, location).
 * Usage: node scripts/ingest-apr-may-2026-billboard.cjs
 */
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');

const rows = [
  {
    month: '2026-04', location: 'Cedar Rapids', panel_id: '232-070050',
    plays_guaranteed: 37440, plays_delivered: 41723,
    impressions_guaranteed: 1270319.68, impressions_delivered: 1415639.64,
    num_creatives: 4, contracted_days: 30,
  },
  {
    month: '2026-05', location: 'Cedar Rapids', panel_id: '232-070050',
    plays_guaranteed: 38688, plays_delivered: 44922,
    impressions_guaranteed: 1312663.67, impressions_delivered: 1524180.04,
    num_creatives: 5, contracted_days: 31,
  },
];

const db = new Database(DB_PATH);
const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');
const stmt = db.prepare(`
  INSERT OR REPLACE INTO fact_billboard_monthly
  (month, location, panel_id, plays_guaranteed, plays_delivered,
   impressions_guaranteed, impressions_delivered, variance_pct, num_creatives, contracted_days)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  for (const r of rows) {
    dimStmt.run(r.month);
    const variancePct = Math.round(((r.plays_delivered - r.plays_guaranteed) / r.plays_guaranteed) * 100);
    stmt.run(
      r.month, r.location, r.panel_id, r.plays_guaranteed, r.plays_delivered,
      r.impressions_guaranteed, r.impressions_delivered, variancePct, r.num_creatives, r.contracted_days,
    );
  }
})();

console.log('Billboard monthly (all rows):');
console.table(db.prepare(`
  SELECT month, location, plays_guaranteed, plays_delivered, impressions_delivered, variance_pct, num_creatives, contracted_days
  FROM fact_billboard_monthly ORDER BY month
`).all());
db.close();
