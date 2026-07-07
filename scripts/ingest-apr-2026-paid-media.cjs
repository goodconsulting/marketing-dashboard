/**
 * Ingest April 2026 Paid Media:
 *   - data/google-campaigns/apr_2026_google_ads.csv  → fact_google_campaign
 *   - data/meta-campaigns/apr_2026_meta_report.csv   → fact_meta_campaign
 *
 * Google: "Campaign performance" export — one row per campaign with direct
 *   metrics (NOT the "Campaign report" format the app parser expects, which
 *   distributes from Total: rows). So we read rows directly. Zero-activity
 *   paused campaigns are skipped.
 *
 * Meta: AD-LEVEL export (one row per ad). fact_meta_campaign is keyed
 *   (month, campaign_name), so we AGGREGATE ads → campaign first (sum spend,
 *   impressions, link clicks, results, reach). result_type = the campaign's
 *   first non-empty result type. reach is summed across ad sets (upper-bound
 *   approximation — Meta gives no campaign-level dedup reach in this export).
 *
 * Idempotent: INSERT OR REPLACE on (month, campaign_name).
 * Usage: node scripts/ingest-apr-2026-paid-media.cjs
 */
const path = require('path');
const fs = require('fs');
const Papa = require('papaparse');
const Database = require('better-sqlite3');

const MONTH = '2026-04';
const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const GOOGLE_CSV = path.join(__dirname, '..', 'data', 'google-campaigns', 'apr_2026_google_ads.csv');
const META_CSV = path.join(__dirname, '..', 'data', 'meta-campaigns', 'apr_2026_meta_report.csv');

const num = (v) => {
  if (v === '' || v == null) return 0;
  const n = parseFloat(String(v).replace(/[$,%\s]/g, ''));
  return isNaN(n) ? 0 : n;
};
const int = (v) => Math.round(num(v));

// ── Google: direct campaign rows ─────────────────────────────────
const gLines = fs.readFileSync(GOOGLE_CSV, 'utf8').split('\n');
// lines[0]="Campaign performance", lines[1]=date range, lines[2]=headers
const gParsed = Papa.parse(gLines.slice(2).join('\n'), { header: true, skipEmptyLines: true });
const googleCampaigns = [];
for (const r of gParsed.data) {
  const name = (r['Campaign'] || '').trim();
  if (!name || name.startsWith('Total')) continue;
  const clicks = int(r['Clicks']);
  const impressions = int(r['Impr.'] || r['Impressions']);
  const cost = num(r['Cost']);
  // Skip zero-activity (paused, never spent) campaigns
  if (clicks === 0 && impressions === 0 && cost === 0) continue;
  googleCampaigns.push({
    campaign_name: name,
    clicks,
    impressions,
    ctr: num(r['CTR']),
    avg_cpc: num(r['Avg. CPC']),
    cost,
    conversions: num(r['Conversions']),
  });
}

// ── Meta: aggregate ad rows → campaign ───────────────────────────
const mParsed = Papa.parse(fs.readFileSync(META_CSV, 'utf8'), { header: true, skipEmptyLines: true });
const metaMap = new Map();
for (const r of mParsed.data) {
  const name = (r['Campaign name'] || '').trim();
  if (!name) continue;
  const spend = num(r['Amount spent (USD)']);
  const impressions = int(r['Impressions']);
  if (spend === 0 && impressions === 0) continue;
  let c = metaMap.get(name);
  if (!c) {
    c = { campaign_name: name, spend: 0, impressions: 0, reach: 0, clicks: 0, results: 0, result_type: '', purchases: 0, conversion_value: 0 };
    metaMap.set(name, c);
  }
  c.spend += spend;
  c.impressions += impressions;
  c.reach += int(r['Reach']);
  c.clicks += int(r['Link clicks']);
  c.results += int(r['Results']);
  c.purchases += int(r['Purchases']);
  c.conversion_value += num(r['Purchases conversion value']);
  if (!c.result_type && (r['Result type'] || '').trim()) c.result_type = r['Result type'].trim();
}
const metaCampaigns = [...metaMap.values()].map((c) => ({
  ...c,
  spend: Math.round(c.spend * 100) / 100,
  conversion_value: Math.round(c.conversion_value * 100) / 100,
  cost_per_result: c.results > 0 ? Math.round((c.spend / c.results) * 100) / 100 : 0,
}));

const gTotal = googleCampaigns.reduce((a, c) => a + c.cost, 0);
const mTotal = metaCampaigns.reduce((a, c) => a + c.spend, 0);
console.log(`Google: ${googleCampaigns.length} campaigns, $${gTotal.toFixed(2)} cost`);
console.log(`Meta:   ${metaCampaigns.length} campaigns (from ${mParsed.data.length} ad rows), $${mTotal.toFixed(2)} spend`);

// ── Insert ───────────────────────────────────────────────────────
const db = new Database(DB_PATH);
// Ensure Meta ROAS columns exist (mirrors the app migration in queries.ts)
const metaCols = db.pragma('table_info(fact_meta_campaign)');
if (!metaCols.some((c) => c.name === 'purchases')) db.prepare('ALTER TABLE fact_meta_campaign ADD COLUMN purchases INTEGER DEFAULT 0').run();
if (!metaCols.some((c) => c.name === 'conversion_value')) db.prepare('ALTER TABLE fact_meta_campaign ADD COLUMN conversion_value REAL DEFAULT 0').run();

const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');
const gStmt = db.prepare(`
  INSERT OR REPLACE INTO fact_google_campaign
  (month, campaign_name, clicks, impressions, ctr, avg_cpc, cost, conversions)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const mStmt = db.prepare(`
  INSERT OR REPLACE INTO fact_meta_campaign
  (month, campaign_name, impressions, reach, clicks, spend, results, result_type, cost_per_result, purchases, conversion_value)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  dimStmt.run(MONTH);
  for (const c of googleCampaigns) {
    gStmt.run(MONTH, c.campaign_name, c.clicks, c.impressions, c.ctr, c.avg_cpc, c.cost, c.conversions);
  }
  for (const c of metaCampaigns) {
    mStmt.run(MONTH, c.campaign_name, c.impressions, c.reach, c.clicks, c.spend, c.results, c.result_type, c.cost_per_result, c.purchases, c.conversion_value);
  }
})();

// ── Verify ───────────────────────────────────────────────────────
console.log('\n--- fact_google_campaign (April) ---');
console.table(db.prepare('SELECT campaign_name, cost, clicks, impressions, conversions FROM fact_google_campaign WHERE month=? ORDER BY cost DESC').all(MONTH));
console.log('--- fact_meta_campaign (April) ---');
console.table(db.prepare(`
  SELECT campaign_name, spend, purchases, conversion_value,
         ROUND(CASE WHEN spend>0 THEN conversion_value/spend ELSE 0 END, 2) AS roas, result_type
  FROM fact_meta_campaign WHERE month=? ORDER BY spend DESC
`).all(MONTH));
const g = db.prepare('SELECT ROUND(SUM(cost),2) t FROM fact_google_campaign WHERE month=?').get(MONTH).t;
const m = db.prepare('SELECT ROUND(SUM(spend),2) t FROM fact_meta_campaign WHERE month=?').get(MONTH).t;
console.log(`April totals — Google $${g} | Meta $${m} | Combined paid platforms $${(g + m).toFixed(2)}`);
db.close();
