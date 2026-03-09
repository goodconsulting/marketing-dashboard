/**
 * Meta / Facebook campaign CSV parser.
 *
 * Expected headers (from Meta Ads Manager export):
 * - "Campaign name", "Reporting starts", "Amount spent (USD)"
 * - "Impressions", "Reach", "Link clicks", "Results"
 * - "Cost per results", "Result indicator"
 *
 * Prefers "Link clicks" over "Results" for the clicks field
 * since link clicks are more accurate for traffic campaigns.
 */

import Papa from 'papaparse';
import type { MetaCampaign } from '../types.ts';
import { parseMonth, parseNum, parseInt_ } from './utils.ts';

export function parseMetaCampaigns(csvContent: string): MetaCampaign[] {
  const result = Papa.parse(csvContent, { header: true, skipEmptyLines: true });

  if (result.errors.length > 0) {
    console.warn(`[Meta Parser] ${result.errors.length} row-level warnings`);
  }

  const campaigns: MetaCampaign[] = [];

  for (const row of result.data as Record<string, string>[]) {
    const start = row['Reporting starts'] || '';
    const name = row['Campaign name'] || '';
    const spend = parseNum(row['Amount spent (USD)']);
    const impressions = parseInt_(row['Impressions']);
    const reach = parseInt_(row['Reach']);
    const resultsVal = parseInt_(row['Results']);
    const cpr = parseNum(row['Cost per results']);
    // Link clicks is more accurate than Results for traffic campaigns
    const linkClicks = parseInt_(row['Link clicks']);

    if (!name || (spend === 0 && impressions === 0)) continue;

    campaigns.push({
      month: parseMonth(start),
      campaignName: name,
      impressions,
      reach,
      clicks: linkClicks || resultsVal, // prefer link clicks
      spend,
      results: resultsVal,
      resultType: row['Result indicator'] || '',
      costPerResult: cpr,
    });
  }

  return campaigns;
}
