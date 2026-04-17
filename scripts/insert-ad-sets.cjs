const fs = require('fs');
const Papa = require('papaparse');
const Database = require('better-sqlite3');
const db = new Database('data/stack.db');

db.exec(`
CREATE TABLE IF NOT EXISTS fact_meta_ad_set (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  month             TEXT NOT NULL,
  campaign_name     TEXT NOT NULL,
  ad_set_name       TEXT NOT NULL,
  delivery          TEXT,
  impressions       INTEGER DEFAULT 0,
  reach             INTEGER DEFAULT 0,
  clicks            INTEGER DEFAULT 0,
  spend             REAL DEFAULT 0,
  results           INTEGER DEFAULT 0,
  result_type       TEXT,
  cost_per_result   REAL DEFAULT 0,
  landing_page_views INTEGER DEFAULT 0,
  cpm               REAL DEFAULT 0,
  cpc               REAL DEFAULT 0,
  ctr               REAL DEFAULT 0,
  UNIQUE(month, ad_set_name)
)`);

const stmt = db.prepare(`INSERT OR IGNORE INTO fact_meta_ad_set
  (month, campaign_name, ad_set_name, delivery, impressions, reach, clicks,
   spend, results, result_type, cost_per_result, landing_page_views, cpm, cpc, ctr)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

function pn(v) { return parseFloat(v) || 0; }
function pi(v) { return parseInt(v) || 0; }

function insertFile(filepath, campaignName) {
  const csv = fs.readFileSync(filepath, 'utf8');
  const result = Papa.parse(csv, { header: true, skipEmptyLines: true });
  let count = 0;
  for (const r of result.data) {
    const start = r['Reporting starts'] || '';
    const month = start.slice(0, 7);
    const name = r['Ad set name'] || '';
    if (!name) continue;
    const res = stmt.run(
      month, campaignName, name,
      r['Ad set delivery'] || '',
      pi(r['Impressions']), pi(r['Reach']),
      pi(r['Link clicks']) || pi(r['Results']),
      pn(r['Amount spent (USD)']),
      pi(r['Results']),
      r['Result indicator'] || '',
      pn(r['Cost per results']),
      pi(r['Landing page views']),
      pn(r['CPM (cost per 1,000 impressions) (USD)']),
      pn(r['CPC (cost per link click) (USD)']),
      pn(r['CTR (link click-through rate)'])
    );
    if (res.changes > 0) count++;
  }
  return count;
}

db.transaction(() => {
  const c1 = insertFile(
    '/Users/carsongoodale/Desktop/Stack-Wellness-Ad-sets-Fe-1-2026-Fe-28-2026 (1).csv',
    'Onelink Clicks'
  );
  const c2 = insertFile(
    '/Users/carsongoodale/Desktop/Stack-Wellness-Ad-sets-Fe-1-2026-Fe-28-2026.csv',
    'Link Clicks | 1/30'
  );
  console.log('Inserted:', c1, '+', c2, '=', c1 + c2, 'ad sets');
})();

console.log('Verify:');
const rows = db.prepare('SELECT campaign_name, ad_set_name, spend FROM fact_meta_ad_set ORDER BY campaign_name, ad_set_name').all();
rows.forEach(r => console.log(`  ${r.campaign_name} -> ${r.ad_set_name}: $${r.spend.toFixed(2)}`));
db.close();
