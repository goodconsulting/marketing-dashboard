/**
 * Ingest monthly paid media exports → fact_google_campaign / fact_meta_campaign.
 *
 * Usage:
 *   node scripts/ingest-paid-media.cjs google <file.csv> <YYYY-MM> [--dry-run]
 *   node scripts/ingest-paid-media.cjs meta   <file.csv> <YYYY-MM> [--dry-run]
 *
 * Generalized from ingest-apr-2026-paid-media.cjs (Apr 2026).
 *
 * Google: "Campaign performance" export — a couple of preamble lines
 *   (title + date range) before the header row. Header line auto-detected.
 *   One row per campaign, direct metrics. Zero-activity campaigns skipped.
 *
 * Meta: AD-LEVEL export (one row per ad). fact_meta_campaign is keyed
 *   (month, campaign_name) so ads are AGGREGATED to campaign: sum spend,
 *   impressions, link clicks, results, purchases, conversion value; reach is
 *   summed (upper bound — Meta gives no deduped campaign reach here).
 *   Purchases + conversion value power the Meta ROAS KPI card.
 *
 * Idempotent: INSERT OR REPLACE on (month, campaign_name).
 */
const path = require('path');
const fs = require('fs');
const Papa = require('papaparse');
const Database = require('better-sqlite3');
const { randomBytes } = require('crypto');

const args = process.argv.slice(2).filter((a) => a !== '--dry-run');
const DRY_RUN = process.argv.includes('--dry-run');
const [PLATFORM, FILE_ARG, MONTH] = args;
if (!['google', 'meta'].includes(PLATFORM || '') || !FILE_ARG || !MONTH || !/^\d{4}-\d{2}$/.test(MONTH)) {
  console.error('Usage: node scripts/ingest-paid-media.cjs <google|meta> <file.csv> <YYYY-MM> [--dry-run]');
  process.exit(2);
}
const FILE = path.resolve(FILE_ARG);
const DB_PATH = path.join(__dirname, '..', 'data', 'stack.db');
const SOURCE = path.basename(FILE);

const num = (v) => {
  if (v === '' || v == null) return 0;
  const n = parseFloat(String(v).replace(/[$,%\s]/g, ''));
  return isNaN(n) ? 0 : n;
};
const int = (v) => Math.round(num(v));
const round2 = (n) => Math.round(n * 100) / 100;

const text = fs.readFileSync(FILE, 'utf8');
let campaigns = [];

if (PLATFORM === 'google') {
  // Auto-detect the header line (exports have "Campaign performance" + date
  // range preamble lines; a raw export may start with the header directly).
  const lines = text.split('\n');
  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    if (/(^|,)"?Campaign"?(,|$)/.test(lines[i]) && /Clicks/i.test(lines[i])) { headerIdx = i; break; }
  }
  const parsed = Papa.parse(lines.slice(headerIdx).join('\n'), { header: true, skipEmptyLines: true });
  for (const r of parsed.data) {
    const name = (r['Campaign'] || r['Campaign Name'] || '').trim();
    if (!name || name.startsWith('Total')) continue;
    const clicks = int(r['Clicks']);
    const impressions = int(r['Impr.'] || r['Impressions']);
    const cost = num(r['Cost']);
    if (clicks === 0 && impressions === 0 && cost === 0) continue; // paused, never spent
    campaigns.push({
      campaign_name: name, clicks, impressions,
      ctr: num(r['CTR']), avg_cpc: num(r['Avg. CPC']), cost,
      conversions: num(r['Conversions']),
    });
  }
  console.log(`Google: ${campaigns.length} campaigns, $${campaigns.reduce((a, c) => a + c.cost, 0).toFixed(2)} cost`);
} else {
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  const map = new Map();
  for (const r of parsed.data) {
    const name = (r['Campaign name'] || '').trim();
    if (!name) continue;
    const spend = num(r['Amount spent (USD)']);
    const impressions = int(r['Impressions']);
    if (spend === 0 && impressions === 0) continue;
    let c = map.get(name);
    if (!c) {
      c = { campaign_name: name, spend: 0, impressions: 0, reach: 0, clicks: 0, results: 0, result_type: '', purchases: 0, conversion_value: 0 };
      map.set(name, c);
    }
    c.spend += spend;
    c.impressions += impressions;
    c.reach += int(r['Reach']);
    c.clicks += int(r['Link clicks']);
    c.results += int(r['Results']);
    c.purchases += int(r['Purchases']);
    // Ad-level exports carry an absolute "Purchases conversion value";
    // campaign-level exports only carry Purchase ROAS as a ratio — derive
    // the absolute value as spend x ROAS so the Meta ROAS card still works.
    const rawConvValue = num(r['Purchases conversion value']);
    c.conversion_value += rawConvValue > 0 ? rawConvValue : spend * num(r['Purchase ROAS (return on ad spend)']);
    if (!c.result_type && (r['Result type'] || '').trim()) c.result_type = r['Result type'].trim();
  }
  campaigns = [...map.values()].map((c) => ({
    ...c,
    spend: round2(c.spend),
    conversion_value: round2(c.conversion_value),
    cost_per_result: c.results > 0 ? round2(c.spend / c.results) : 0,
  }));
  console.log(`Meta: ${campaigns.length} campaigns (from ${parsed.data.length} ad rows), $${campaigns.reduce((a, c) => a + c.spend, 0).toFixed(2)} spend`);
}

console.table(campaigns);
if (campaigns.length === 0) {
  console.error('✗ Parsed 0 campaigns — wrong file or unrecognized export format. Nothing written.');
  process.exit(1);
}
if (DRY_RUN) {
  console.log('\n[dry-run] No database writes performed.');
  process.exit(0);
}

// ── Insert ──
const db = new Database(DB_PATH);
const dimStmt = db.prepare('INSERT OR IGNORE INTO dim_month (month) VALUES (?)');

db.transaction(() => {
  dimStmt.run(MONTH);
  if (PLATFORM === 'google') {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO fact_google_campaign
      (month, campaign_name, clicks, impressions, ctr, avg_cpc, cost, conversions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of campaigns) stmt.run(MONTH, c.campaign_name, c.clicks, c.impressions, c.ctr, c.avg_cpc, c.cost, c.conversions);
  } else {
    // Ensure Meta ROAS columns exist (mirrors the app migration in queries.ts)
    const cols = db.pragma('table_info(fact_meta_campaign)');
    if (!cols.some((c) => c.name === 'purchases')) db.prepare('ALTER TABLE fact_meta_campaign ADD COLUMN purchases INTEGER DEFAULT 0').run();
    if (!cols.some((c) => c.name === 'conversion_value')) db.prepare('ALTER TABLE fact_meta_campaign ADD COLUMN conversion_value REAL DEFAULT 0').run();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO fact_meta_campaign
      (month, campaign_name, impressions, reach, clicks, spend, results, result_type, cost_per_result, purchases, conversion_value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const c of campaigns) stmt.run(MONTH, c.campaign_name, c.impressions, c.reach, c.clicks, c.spend, c.results, c.result_type, c.cost_per_result, c.purchases, c.conversion_value);
  }
})();

try {
  db.prepare(`
    INSERT INTO upload_log (id, filename, source_type, record_count, month_covered, status, dedup_summary, confirmed_at)
    VALUES (?, ?, ?, ?, ?, 'success', ?, datetime('now'))
  `).run(
    randomBytes(8).toString('hex'), SOURCE, PLATFORM === 'google' ? 'google_campaigns' : 'meta_campaigns',
    campaigns.length, MONTH, JSON.stringify({ campaigns: campaigns.length }),
  );
} catch (e) {
  console.warn('upload_log insert skipped:', e.message);
}

// ── Verify against DB ──
if (PLATFORM === 'google') {
  const t = db.prepare('SELECT COUNT(*) n, ROUND(SUM(cost),2) total FROM fact_google_campaign WHERE month=?').get(MONTH);
  console.log(`\n${MONTH} fact_google_campaign: ${t.n} campaigns, $${t.total}`);
} else {
  const t = db.prepare('SELECT COUNT(*) n, ROUND(SUM(spend),2) total, ROUND(SUM(conversion_value),2) conv_value FROM fact_meta_campaign WHERE month=?').get(MONTH);
  const roas = t.total > 0 ? (t.conv_value / t.total).toFixed(2) : 'n/a';
  console.log(`\n${MONTH} fact_meta_campaign: ${t.n} campaigns, $${t.total} spend, ROAS ${roas}x`);
}
db.close();
