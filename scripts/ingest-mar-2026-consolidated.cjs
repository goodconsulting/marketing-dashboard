/**
 * Ingest the March 2026 consolidated paid-media JSON into SQLite.
 *
 * Reads: data/mar_2026_paid_media_consolidated.json
 *
 * Writes to three tables:
 *   fact_other_campaign    — Yelp Downtown row (new)
 *   fact_amp_campaign      — March AMP CTV row (extends existing)
 *   fact_billboard_monthly — March Lamar row (extends existing)
 *
 * Lamar March spend is linked to the $1,000 expense row (Lamar Companies,
 * Digital Bulletins, 03/04/2026) which is already in fact_expense — we do
 * NOT duplicate it. AMP CTV spend is NULL pending the AMP invoice.
 *
 * Idempotent: all inserts are INSERT OR REPLACE on their respective
 * unique keys.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const JSON_PATH = path.join(__dirname, '..', 'data', 'mar_2026_paid_media_consolidated.json');
const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');

const payload = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
const MONTH = payload.period; // '2026-03'

const db = new Database(DB_PATH);

// Ensure schema is up to date (create fact_other_campaign if not yet present).
db.prepare(`
  CREATE TABLE IF NOT EXISTS fact_other_campaign (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    month         TEXT NOT NULL,
    source        TEXT NOT NULL,
    campaign_name TEXT NOT NULL,
    spend         REAL DEFAULT 0,
    impressions   INTEGER DEFAULT 0,
    clicks        INTEGER DEFAULT 0,
    conversions   REAL DEFAULT 0,
    ctr           REAL DEFAULT 0,
    cpc           REAL DEFAULT 0,
    cost_per_conv REAL DEFAULT 0,
    window_start  TEXT,
    window_end    TEXT,
    extra         TEXT,
    UNIQUE(month, source, campaign_name)
  )
`).run();

const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');

// ── 1. Yelp → fact_other_campaign ────────────────────────────────
const y = payload.detail.yelp_ads;
const yelpExtra = {
  reporting_window: y.reporting_window,
  reporting_window_mismatch: y.reporting_window_mismatch,
  impressions_total: y.impressions_total,
  page_visits_total: y.page_visits_total,
  ads_share_of_impressions: y.ads_share_of_impressions,
  ads_share_of_page_visits: y.ads_share_of_page_visits,
  ads_share_of_leads: y.ads_share_of_leads,
  context_12mo: y.context_12mo,
  scope: y.scope,
};

db.prepare(`
  INSERT OR REPLACE INTO fact_other_campaign
  (month, source, campaign_name, spend, impressions, clicks, conversions,
   ctr, cpc, cost_per_conv, window_start, window_end, extra)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  MONTH, 'yelp', 'Downtown',
  y.spend, y.impressions_ads, y.page_visits_ads, y.leads_ads,
  y.ctr, y.cost_per_page_visit, y.cost_per_lead,
  y.window_start, y.window_end,
  JSON.stringify(yelpExtra),
);
dimStmt.run(MONTH);
console.log(`Yelp → fact_other_campaign: spend=$${y.spend}, impressions=${y.impressions_ads}, leads=${y.leads_ads}`);

// ── 2. AMP CTV → fact_amp_campaign ───────────────────────────────
const amp = payload.detail.amp_ctv;
db.prepare(`
  INSERT OR REPLACE INTO fact_amp_campaign
  (month, campaign_type, campaign_name, location, impressions, reach, frequency,
   sent, views, clicks, view_rate, click_rate, vcr, viewing_hours)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  MONTH, 'streaming', 'AMP CTV — Des Moines Metro',
  amp.location,
  amp.impressions_delivered, amp.reach, amp.frequency,
  0, amp.completed_views, 0,
  0, 0,
  amp.vcr * 100,  // schema stores VCR as percentage (matches Feb row at 98.07)
  amp.viewing_hours,
);
console.log(`AMP CTV → fact_amp_campaign: impressions=${amp.impressions_delivered}, VCR=${(amp.vcr*100).toFixed(2)}%, viewing_hours=${amp.viewing_hours}`);

// ── 3. Lamar → fact_billboard_monthly ────────────────────────────
const l = payload.detail.lamar_ooh;
db.prepare(`
  INSERT OR REPLACE INTO fact_billboard_monthly
  (month, location, panel_id, plays_guaranteed, plays_delivered,
   impressions_guaranteed, impressions_delivered, variance_pct,
   num_creatives, contracted_days)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  MONTH, 'Cedar Rapids', l.panel_id,
  l.plays_guaranteed, l.plays_delivered,
  l.impressions_guaranteed, l.impressions_delivered,
  Math.round((l.delivery_rate - 1) * 100),  // 12 (= 112.4% delivery)
  l.creatives.length, l.contracted_days,
);
console.log(`Lamar → fact_billboard_monthly: plays ${l.plays_delivered}/${l.plays_guaranteed}, impressions ${l.impressions_delivered.toLocaleString()}`);

// ── Verify ───────────────────────────────────────────────────────
console.log('\n--- Post-insert verification ---');
console.log('fact_other_campaign (Yelp March):');
console.table(db.prepare(`
  SELECT source, campaign_name, spend, impressions, clicks, conversions, window_start, window_end
  FROM fact_other_campaign WHERE month=?
`).all(MONTH));

console.log('fact_amp_campaign (all months, most recent first):');
console.table(db.prepare(`
  SELECT month, campaign_type, campaign_name, impressions, reach, vcr, viewing_hours
  FROM fact_amp_campaign ORDER BY month DESC LIMIT 5
`).all());

console.log('fact_billboard_monthly (all months):');
console.table(db.prepare(`
  SELECT month, location, plays_guaranteed, plays_delivered,
         impressions_guaranteed, impressions_delivered, variance_pct, num_creatives
  FROM fact_billboard_monthly ORDER BY month DESC
`).all());

// Consolidated channel summary for March
console.log('\n--- Channel Summary for March 2026 (matches JSON channel_summary) ---');
const meta = db.prepare(`SELECT ROUND(SUM(spend),2) AS spend, SUM(impressions) AS imp, SUM(clicks) AS clicks, SUM(results) AS conv FROM fact_meta_campaign WHERE month=?`).get(MONTH);
const google = db.prepare(`SELECT ROUND(SUM(cost),2) AS spend, SUM(impressions) AS imp, SUM(clicks) AS clicks, ROUND(SUM(conversions),2) AS conv FROM fact_google_campaign WHERE month=?`).get(MONTH);
const yelp = db.prepare(`SELECT ROUND(SUM(spend),2) AS spend, SUM(impressions) AS imp, SUM(clicks) AS clicks, SUM(conversions) AS conv FROM fact_other_campaign WHERE month=? AND source='yelp'`).get(MONTH);
const lamar = db.prepare(`SELECT SUM(impressions_delivered) AS imp FROM fact_billboard_monthly WHERE month=?`).get(MONTH);
const ampRow = db.prepare(`SELECT SUM(impressions) AS imp FROM fact_amp_campaign WHERE month=? AND campaign_type='streaming'`).get(MONTH);
console.table([
  { channel: 'Meta Ads',   spend: `$${meta.spend}`,   impressions: meta.imp,   clicks: meta.clicks, conversions: meta.conv },
  { channel: 'Google Ads', spend: `$${google.spend}`, impressions: google.imp, clicks: google.clicks, conversions: google.conv },
  { channel: 'Yelp Ads',   spend: `$${yelp.spend}`,   impressions: yelp.imp,   clicks: yelp.clicks, conversions: yelp.conv },
  { channel: 'Lamar OOH',  spend: '(linked to expense: $1,000)', impressions: lamar.imp, clicks: null, conversions: null },
  { channel: 'AMP CTV',    spend: '(pending invoice)', impressions: ampRow.imp, clicks: null, conversions: null },
]);

db.close();
console.log('\nDone.');
