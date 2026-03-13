/**
 * Google Ads parsers — campaign report + daily time series.
 *
 * Campaign Report format (from Google Ads UI export):
 *   Row 1: "Campaign report"
 *   Row 2: Date range like "October 1, 2025 - October 31, 2025"
 *   Row 3: CSV headers
 *   Data rows: One per (conversion action × campaign), metrics at row level are 0
 *              except Conversions which has per-conversion-action values.
 *   Summary rows: "Total: Account", "Total: Search", "Total: Performance Max", etc.
 *
 *   Strategy: Sum conversions per campaign, then distribute campaign-type-level
 *   cost/clicks/impressions proportionally based on each campaign's conversion share.
 *
 * Daily time series (time_series):
 *   Headers: "Date", "Clicks", "Impressions", "Avg. CPC", "Cost"
 *   Date format: "Sun, Feb 1, 2026" (parseMonth handles this).
 */

import Papa from 'papaparse';
import type { GoogleCampaign, GoogleDaily } from '../types.ts';
import { parseNum, parseInt_, parsePct } from './utils.ts';

/** Known campaign type identifiers in "Total: {type}" summary rows. */
const CAMPAIGN_TYPES = new Set(['Search', 'Performance Max', 'Smart']);

interface CampaignTypeTotal {
  clicks: number;
  impressions: number;
  cost: number;
  conversions: number;
  ctr: number;
  avgCpc: number;
}

/**
 * Parse a Google Ads campaign report CSV.
 *
 * These have metadata rows before the headers — we strip those first,
 * extract the month from the date range, then parse the tabular data.
 */
export function parseGoogleCampaigns(csvContent: string): GoogleCampaign[] {
  const lines = csvContent.split('\n');

  // ── Extract month from date range (row 2) ────────────────────────
  // Format: "October 1, 2025 - October 31, 2025"
  const month = extractMonthFromDateRange(lines[1] || '');
  if (!month) {
    console.warn('[Google Campaign Parser] Could not extract month from date range');
    return [];
  }

  // ── Strip metadata rows (title + date range) and parse as CSV ────
  const csvWithoutMeta = lines.slice(2).join('\n');
  const result = Papa.parse(csvWithoutMeta, { header: true, skipEmptyLines: true });

  if (result.errors.length > 0) {
    console.warn(`[Google Campaign Parser] ${result.errors.length} row-level warnings`);
  }

  const rows = result.data as Record<string, string>[];

  // ── Pass 1: Collect per-campaign conversions + campaign type ──────
  // Map of campaignName → { conversions, campaignType }
  const campaignMap = new Map<string, { conversions: number; campaignType: string }>();

  // Map of campaignType → aggregated totals from "Total: {type}" rows
  const typeTotals = new Map<string, CampaignTypeTotal>();

  for (const row of rows) {
    const campaignStatus = (row['Campaign status'] || '').trim();
    const campaign = (row['Campaign'] || '').trim();
    const conversions = parseNum(row['Conversions']);

    // Skip "Total:" summary rows for campaign data, but capture type totals
    if (campaignStatus.startsWith('Total:')) {
      const totalLabel = campaignStatus.replace('Total:', '').trim();

      // Capture per-type totals (e.g., "Total: Search", "Total: Performance Max")
      if (CAMPAIGN_TYPES.has(totalLabel) && !campaign) {
        // These are the aggregate "Total: {type}" rows that have real metrics
        const clicks = parseInt_(row['Clicks']);
        const impr = parseInt_(row['Impr.'] || row['Impressions']);
        const cost = parseNum(row['Cost']);
        const ctr = parsePct(row['Interaction rate'] || row['Conv. rate']);
        const avgCpc = parseNum(row['Avg. CPC']);
        const conv = parseNum(row['Conversions']);

        // Only use the row that has actual metrics (clicks > 0 or cost > 0)
        if (clicks > 0 || cost > 0) {
          typeTotals.set(totalLabel, {
            clicks, impressions: impr, cost, conversions: conv, ctr, avgCpc,
          });
        }
      }
      continue;
    }

    // Skip rows with no campaign name or -- placeholder campaigns
    if (!campaign || campaign === '--') continue;

    // Accumulate conversions per campaign
    const existing = campaignMap.get(campaign);
    const campaignType = (row['Campaign type'] || '').trim();
    if (existing) {
      existing.conversions += conversions;
      // Keep the first non-empty campaign type found
      if (!existing.campaignType && campaignType) {
        existing.campaignType = campaignType;
      }
    } else {
      campaignMap.set(campaign, { conversions, campaignType });
    }
  }

  // ── Pass 2: Group campaigns by type and distribute metrics ───────
  // Group campaigns by their campaign type
  const campaignsByType = new Map<string, Array<{ name: string; conversions: number }>>();
  for (const [name, info] of campaignMap) {
    const type = info.campaignType || 'Unknown';
    if (!campaignsByType.has(type)) campaignsByType.set(type, []);
    campaignsByType.get(type)!.push({ name, conversions: info.conversions });
  }

  const campaigns: GoogleCampaign[] = [];

  for (const [type, typeCampaigns] of campaignsByType) {
    const totals = typeTotals.get(type);

    // Total conversions for this type (from individual campaign sums)
    const totalTypeConversions = typeCampaigns.reduce((s, c) => s + c.conversions, 0);

    for (const camp of typeCampaigns) {
      // Proportional share based on conversions
      const share = totalTypeConversions > 0 ? camp.conversions / totalTypeConversions : 1 / typeCampaigns.length;

      if (totals) {
        // Distribute the type-level totals proportionally
        const clicks = Math.round(totals.clicks * share);
        const impressions = Math.round(totals.impressions * share);
        const cost = Math.round(totals.cost * share * 100) / 100;

        campaigns.push({
          month,
          campaignName: camp.name,
          clicks,
          impressions,
          ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
          avgCpc: clicks > 0 ? cost / clicks : 0,
          cost,
          conversions: Math.round(camp.conversions * 100) / 100,
        });
      } else {
        // No type-level totals found — just store conversions with zero metrics
        campaigns.push({
          month,
          campaignName: camp.name,
          clicks: 0,
          impressions: 0,
          ctr: 0,
          avgCpc: 0,
          cost: 0,
          conversions: Math.round(camp.conversions * 100) / 100,
        });
      }
    }
  }

  return campaigns;
}

/**
 * Extract YYYY-MM from a date range string like:
 *   "October 1, 2025 - October 31, 2025"
 *   "February 13, 2025 - February 28, 2025"
 *   "May 1, 2025 - May 31, 2025"
 */
function extractMonthFromDateRange(line: string): string | null {
  const cleaned = line.replace(/"/g, '').trim();

  const months: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
  };

  // Match "Month DD, YYYY" at the start of the range
  const match = cleaned.match(/^(\w+)\s+\d+,?\s+(\d{4})/);
  if (match) {
    const m = months[match[1].toLowerCase()];
    if (m) return `${match[2]}-${m}`;
  }

  return null;
}

/**
 * Detect if a CSV string is a Google Ads Campaign Report.
 * Checks if the first line is "Campaign report".
 */
export function isGoogleCampaignReport(csvContent: string): boolean {
  const firstLine = csvContent.split('\n')[0]?.trim();
  return firstLine === 'Campaign report';
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
