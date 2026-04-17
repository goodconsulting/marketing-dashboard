/**
 * Ingest March 2026 Paid Media (Meta + Google) from
 * Stack_Paid_Media_Consolidated_Mar2026.xlsx
 *
 * Yelp is intentionally NOT ingested as a campaign row — Yelp lives only
 * as an expense row ($403.20, already in fact_expense). The paid-media
 * tables are scoped to channels with per-campaign metrics.
 *
 * Reads sheets:
 *   - "Meta Detail"   → fact_meta_campaign  (one row per campaign)
 *   - "Google Detail" → fact_google_campaign (one row per campaign)
 *
 * Source XLSX is hand-aggregated; values are pre-formatted strings
 * ("$1,376.88", "215,194", "1.53%") so we strip $/,/% before insert.
 *
 * Idempotent: INSERT OR REPLACE on (month, campaign_name).
 */
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');

const XLSX_PATH = '/Users/carsongoodale/Downloads/Stack_Paid_Media_Consolidated_Mar2026.xlsx';
const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const MONTH = '2026-03';

const wb = XLSX.read(require('fs').readFileSync(XLSX_PATH));

// ── Helpers ──────────────────────────────────────────────────────
const num = (v) => {
  if (v === '' || v == null) return 0;
  const n = parseFloat(String(v).replace(/[$,%\s]/g, ''));
  return isNaN(n) ? 0 : n;
};
const int = (v) => Math.round(num(v));

// ── Meta ─────────────────────────────────────────────────────────
const metaRows = XLSX.utils.sheet_to_json(wb.Sheets['Meta Detail'], { header: 1, raw: false, defval: '' });
// Header is row index 2 ("Campaign name", "Campaign delivery", ...). Data rows 3..n-1, last row is TOTAL.
const metaCampaigns = [];
for (let i = 3; i < metaRows.length; i++) {
  const r = metaRows[i];
  if (!r[0] || r[0] === 'TOTAL') continue;
  metaCampaigns.push({
    campaign_name: r[0],
    delivery: r[1],          // active / inactive
    spend: num(r[2]),
    impressions: int(r[3]),
    link_clicks: int(r[4]),
    clicks_all: int(r[5]),
    ctr: num(r[6]),
    cpc: num(r[7]),
    results: int(r[8]),
    landing_page_views: int(r[9]),
    reach: int(r[10]),
  });
}

// ── Google ───────────────────────────────────────────────────────
const googleRows = XLSX.utils.sheet_to_json(wb.Sheets['Google Detail'], { header: 1, raw: false, defval: '' });
const googleCampaigns = [];
for (let i = 3; i < googleRows.length; i++) {
  const r = googleRows[i];
  if (!r[0] || r[0] === 'TOTAL') continue;
  googleCampaigns.push({
    campaign_name: r[0],
    state: r[1],
    type: r[2],
    cost: num(r[3]),
    impressions: int(r[4]),
    clicks: int(r[5]),
    ctr: num(r[6]),
    avg_cpc: num(r[7]),
    conversions: num(r[8]),
    cost_per_conv: num(r[9]),
  });
}

console.log(`Parsed ${metaCampaigns.length} Meta + ${googleCampaigns.length} Google campaigns`);
console.log('Meta total spend:', metaCampaigns.reduce((a, c) => a + c.spend, 0).toFixed(2), '(target $4,029.62)');
console.log('Google total cost:', googleCampaigns.reduce((a, c) => a + c.cost, 0).toFixed(2), '(target $1,216.51)');

// ── DB inserts ───────────────────────────────────────────────────
const db = new Database(DB_PATH);
const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');

const metaStmt = db.prepare(`
  INSERT OR REPLACE INTO fact_meta_campaign
  (month, campaign_name, impressions, reach, clicks, spend, results, result_type, cost_per_result)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const googleStmt = db.prepare(`
  INSERT OR REPLACE INTO fact_google_campaign
  (month, campaign_name, clicks, impressions, ctr, avg_cpc, cost, conversions)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

let metaInserted = 0, googleInserted = 0;
db.transaction(() => {
  dimStmt.run(MONTH);
  for (const c of metaCampaigns) {
    metaStmt.run(
      MONTH, c.campaign_name, c.impressions, c.reach, c.link_clicks,
      c.spend, c.results,
      'mixed (LPV+RSVP per source notes)',
      c.results > 0 ? c.spend / c.results : 0
    );
    metaInserted++;
  }
  for (const c of googleCampaigns) {
    googleStmt.run(
      MONTH, c.campaign_name, c.clicks, c.impressions, c.ctr,
      c.avg_cpc, c.cost, c.conversions
    );
    googleInserted++;
  }
})();

console.log(`Inserted: ${metaInserted} Meta, ${googleInserted} Google`);

// ── Verify ───────────────────────────────────────────────────────
const metaCheck = db.prepare(
  `SELECT campaign_name, spend, impressions, clicks, results FROM fact_meta_campaign WHERE month=? ORDER BY spend DESC`
).all(MONTH);
console.log('\n--- fact_meta_campaign (March) ---');
console.table(metaCheck);

const googleCheck = db.prepare(
  `SELECT campaign_name, cost, impressions, clicks, conversions FROM fact_google_campaign WHERE month=? ORDER BY cost DESC`
).all(MONTH);
console.log('\n--- fact_google_campaign (March) ---');
console.table(googleCheck);

const metaTotal = db.prepare(`SELECT ROUND(SUM(spend),2) AS total FROM fact_meta_campaign WHERE month=?`).get(MONTH).total;
const googleTotal = db.prepare(`SELECT ROUND(SUM(cost),2) AS total FROM fact_google_campaign WHERE month=?`).get(MONTH).total;
console.log(`\nMarch totals in DB: Meta $${metaTotal} (target $4,029.62) | Google $${googleTotal} (target $1,216.51)`);

db.close();
