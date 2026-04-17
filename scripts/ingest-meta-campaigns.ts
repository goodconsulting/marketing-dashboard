/**
 * Bulk ingestion script for Meta campaign CSVs.
 *
 * Usage: npx tsx scripts/ingest-meta-campaigns.ts
 *
 * Reads all CSV files from data/meta-campaigns/, parses them using
 * the Meta campaign parser, and inserts into SQLite.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseMetaCampaigns } from '../server/parsers/meta.ts';
import { insertMetaCampaigns, initializeDatabase } from '../server/db/queries.ts';

const DATA_DIR = join(import.meta.dirname || __dirname, '..', 'data', 'meta-campaigns');

// Initialize DB (creates tables if needed, runs migrations)
initializeDatabase();

const files = readdirSync(DATA_DIR).filter(f => f.endsWith('.csv'));

let totalInserted = 0;

for (const file of files.sort()) {
  const filePath = join(DATA_DIR, file);
  const content = readFileSync(filePath, 'utf-8');

  const campaigns = parseMetaCampaigns(content);

  if (campaigns.length === 0) {
    console.log(`⚠️  ${file}: No campaigns parsed`);
    continue;
  }

  const month = campaigns[0].month;
  const inserted = insertMetaCampaigns(campaigns);

  console.log(`✅ ${file}: ${campaigns.length} campaigns for ${month} → ${inserted} inserted`);

  // Show per-campaign detail
  for (const c of campaigns) {
    console.log(`     ${c.campaignName}: $${c.spend.toFixed(2)} spend, ${c.impressions} impr, ${c.clicks} clicks, ${c.results} results`);
  }

  totalInserted += inserted;
}

console.log(`\n📊 Total: ${files.length} files, ${totalInserted} records inserted`);
