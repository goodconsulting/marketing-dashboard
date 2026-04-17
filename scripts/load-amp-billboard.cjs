/**
 * Load AMP (email + streaming) and Lamar Billboard data into the database.
 *
 * Usage: node scripts/load-amp-billboard.cjs
 */

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const db = new Database(DB_PATH);

// ── Ensure tables exist ──────────────────────────────────────────────

db.exec(`
CREATE TABLE IF NOT EXISTS fact_amp_campaign (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,
  campaign_type TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  location TEXT,
  impressions INTEGER DEFAULT 0,
  reach INTEGER DEFAULT 0,
  frequency REAL DEFAULT 0,
  sent INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  view_rate REAL DEFAULT 0,
  click_rate REAL DEFAULT 0,
  vcr REAL DEFAULT 0,
  viewing_hours REAL DEFAULT 0,
  UNIQUE(month, campaign_type, campaign_name)
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS fact_billboard_monthly (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,
  location TEXT NOT NULL,
  panel_id TEXT,
  plays_guaranteed INTEGER DEFAULT 0,
  plays_delivered INTEGER DEFAULT 0,
  impressions_guaranteed REAL DEFAULT 0,
  impressions_delivered REAL DEFAULT 0,
  variance_pct REAL DEFAULT 0,
  num_creatives INTEGER DEFAULT 0,
  contracted_days INTEGER DEFAULT 0,
  UNIQUE(month, location)
);
`);

// ── AMP Data ─────────────────────────────────────────────────────────

const ampData = [
  // Dec 2025 emails (from Sinclair tracking PDFs)
  { month: '2025-12', campaignType: 'email', campaignName: 'Holiday Free Smoothie', location: 'Cedar Rapids',
    impressions: 0, reach: 0, frequency: 0, sent: 35125, views: 5982, clicks: 771,
    viewRate: 17.03, clickRate: 2.20, vcr: 0, viewingHours: 0 },
  { month: '2025-12', campaignType: 'email', campaignName: 'Grand Opening Waukee', location: 'Waukee',
    impressions: 0, reach: 0, frequency: 0, sent: 25192, views: 4417, clicks: 537,
    viewRate: 17.53, clickRate: 2.13, vcr: 0, viewingHours: 0 },
  // Jan 2026 CTV streaming (from XLSX)
  { month: '2026-01', campaignType: 'streaming', campaignName: 'CTV Campaign', location: 'Cedar Rapids / Waukee',
    impressions: 49810, reach: 11272, frequency: 4.42, sent: 0, views: 49028, clicks: 0,
    viewRate: 0, clickRate: 0, vcr: 98.41, viewingHours: 408.57 },
];

// ── Billboard Data ───────────────────────────────────────────────────

const billboardData = [
  { month: '2025-12', location: 'Cedar Rapids', panelId: '232-070050',
    playsGuaranteed: 38688, playsDelivered: 67672,
    impressionsGuaranteed: 1312664, impressionsDelivered: 2296076,
    variancePct: 75, numCreatives: 5, contractedDays: 31 },
  { month: '2026-01', location: 'Cedar Rapids', panelId: '232-070050',
    playsGuaranteed: 38688, playsDelivered: 59485,
    impressionsGuaranteed: 1312664, impressionsDelivered: 2018295,
    variancePct: 54, numCreatives: 8, contractedDays: 31 },
  { month: '2026-02', location: 'Cedar Rapids', panelId: '232-070050',
    playsGuaranteed: 34944, playsDelivered: 41949,
    impressionsGuaranteed: 1185632, impressionsDelivered: 1423308,
    variancePct: 20, numCreatives: 4, contractedDays: 28 },
];

// ── Insert AMP ───────────────────────────────────────────────────────

const ampStmt = db.prepare(`
  INSERT OR REPLACE INTO fact_amp_campaign
  (month, campaign_type, campaign_name, location, impressions, reach, frequency,
   sent, views, clicks, view_rate, click_rate, vcr, viewing_hours)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');

let ampCount = 0;
db.transaction(function() {
  for (const r of ampData) {
    dimStmt.run(r.month);
    ampStmt.run(
      r.month, r.campaignType, r.campaignName, r.location,
      r.impressions, r.reach, r.frequency, r.sent, r.views, r.clicks,
      r.viewRate, r.clickRate, r.vcr, r.viewingHours
    );
    ampCount++;
  }
})();

console.log('AMP Campaigns: inserted ' + ampCount + ' records');

// ── Insert Billboard ─────────────────────────────────────────────────

const bbStmt = db.prepare(`
  INSERT OR REPLACE INTO fact_billboard_monthly
  (month, location, panel_id, plays_guaranteed, plays_delivered,
   impressions_guaranteed, impressions_delivered, variance_pct,
   num_creatives, contracted_days)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let bbCount = 0;
db.transaction(function() {
  for (const r of billboardData) {
    dimStmt.run(r.month);
    bbStmt.run(
      r.month, r.location, r.panelId, r.playsGuaranteed, r.playsDelivered,
      r.impressionsGuaranteed, r.impressionsDelivered, r.variancePct,
      r.numCreatives, r.contractedDays
    );
    bbCount++;
  }
})();

console.log('Billboard Monthly: inserted ' + bbCount + ' records');

// ── Verify ───────────────────────────────────────────────────────────

const ampVerify = db.prepare('SELECT COUNT(*) as count FROM fact_amp_campaign').get();
console.log('\nfact_amp_campaign now has ' + ampVerify.count + ' rows');

const ampByType = db.prepare(
  'SELECT campaign_type, COUNT(*) as cnt FROM fact_amp_campaign GROUP BY campaign_type'
).all();
for (const r of ampByType) {
  console.log('  ' + r.campaign_type + ': ' + r.cnt + ' campaigns');
}

const bbVerify = db.prepare('SELECT COUNT(*) as count FROM fact_billboard_monthly').get();
console.log('\nfact_billboard_monthly now has ' + bbVerify.count + ' rows');

const bbByMonth = db.prepare(
  'SELECT month, location, plays_delivered, impressions_delivered FROM fact_billboard_monthly ORDER BY month'
).all();
for (const r of bbByMonth) {
  console.log('  ' + r.month + ' | ' + r.location + ' | plays=' + r.plays_delivered + ' | impressions=' + r.impressions_delivered);
}

db.close();
console.log('\nDone!');
