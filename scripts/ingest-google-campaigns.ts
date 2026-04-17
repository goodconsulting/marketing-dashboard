/**
 * Bulk ingestion script for Google Ads campaign report CSVs.
 *
 * Usage: npx tsx scripts/ingest-google-campaigns.ts
 *
 * Reads all CSV files from data/google-campaigns/, parses them using
 * the campaign report parser, and inserts into SQLite.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseGoogleCampaigns } from '../server/parsers/google.ts';
import { insertGoogleCampaigns, initializeDatabase } from '../server/db/queries.ts';

const DATA_DIR = join(import.meta.dirname || __dirname, '..', 'data', 'google-campaigns');

// Initialize DB (creates tables if needed, runs migrations)
initializeDatabase();

const files = readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'));

let totalInserted = 0;

for (const file of files.sort()) {
  const filePath = join(DATA_DIR, file);
  const content = readFileSync(filePath, 'utf-8');

  const campaigns = parseGoogleCampaigns(content);

  if (campaigns.length === 0) {
    console.log(`⚠️  ${file}: No campaigns parsed`);
    continue;
  }

  const month = campaigns[0].month;
  const inserted = insertGoogleCampaigns(campaigns);

  console.log(`✅ ${file}: ${campaigns.length} campaigns for ${month} → ${inserted} inserted`);

  // Show per-campaign detail
  for (const c of campaigns) {
    console.log(`     ${c.campaignName}: $${c.cost.toFixed(2)} cost, ${c.clicks} clicks, ${c.impressions} impr, ${c.conversions} conv`);
  }

  totalInserted += inserted;
}

console.log(`\n📊 Total: ${files.length} files, ${totalInserted} records inserted`);
