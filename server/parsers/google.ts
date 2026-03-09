/**
 * Google Ads parsers — campaign-level + daily time series.
 *
 * Campaign-level (overview_cards):
 *   Headers: "Campaign Name" | "Campaign", "Clicks", "Impressions", "CTR", "Cost"
 *   Note: month is NOT in the CSV — must be supplied externally.
 *
 * Daily time series (time_series):
 *   Headers: "Date", "Clicks", "Impressions", "Avg. CPC", "Cost"
 *   Date format: "Sun, Feb 1, 2026" (parseMonth handles this).
 */

import Papa from 'papaparse';
import type { GoogleCampaign, GoogleDaily } from '../types.ts';
import { parseNum, parseInt_, parsePct } from './utils.ts';

/**
 * Parse Google Ads campaign-level CSV.
 *
 * Campaign CSVs don't contain dates — the `month` field is left empty.
 * The upload pipeline will assign the month from the upload context
 * (filename date hint or user-selected month).
 */
export function parseGoogleCampaigns(csvContent: string): GoogleCampaign[] {
  const result = Papa.parse(csvContent, { header: true, skipEmptyLines: true });

  if (result.errors.length > 0) {
    console.warn(`[Google Campaign Parser] ${result.errors.length} row-level warnings`);
  }

  const campaigns: GoogleCampaign[] = [];

  for (const row of result.data as Record<string, string>[]) {
    const name = row['Campaign Name'] || row['Campaign'] || '';
    const cost = parseNum(row['Cost']);
    const clicks = parseInt_(row['Clicks']);
    const impressions = parseInt_(row['Impressions']);
    const ctr = parsePct(row['CTR']);

    if (!name) continue;

    campaigns.push({
      month: '', // assigned during upload pipeline
      campaignName: name,
      clicks,
      impressions: impressions || (ctr > 0 ? Math.round(clicks / (ctr / 100)) : 0),
      ctr,
      avgCpc: clicks > 0 ? cost / clicks : 0,
      cost,
    });
  }

  return campaigns;
}

/**
 * Parse Google Ads daily time series CSV.
 *
 * Each row has a date like "Sun, Feb 1, 2026" and daily metrics.
 * These are stored as-is — the date acts as the PK in fact_google_daily.
 */
export function parseGoogleDaily(csvContent: string): GoogleDaily[] {
  const result = Papa.parse(csvContent, { header: true, skipEmptyLines: true });

  if (result.errors.length > 0) {
    console.warn(`[Google Daily Parser] ${result.errors.length} row-level warnings`);
  }

  const daily: GoogleDaily[] = [];

  for (const row of result.data as Record<string, string>[]) {
    const date = row['Date'] || '';
    const clicks = parseInt_(row['Clicks']);
    const impressions = parseInt_(row['Impressions']);
    const cpc = parseNum(row['Avg. CPC']);
    const cost = parseNum(row['Cost']);

    if (!date) continue;

    daily.push({ date, clicks, impressions, avgCpc: cpc, cost });
  }

  return daily;
}
