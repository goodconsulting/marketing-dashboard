/**
 * Source type detection — filename-first, then header-based fallback.
 *
 * Server-side port of the detection logic from src/utils/parsers.ts.
 * Uses CSV string instead of File object for header detection.
 */

import Papa from 'papaparse';
import type { DataSourceType } from '../types.ts';

/**
 * Detect source type from filename patterns.
 * Returns the source type or null if filename is inconclusive.
 */
export function detectSourceFromFilename(filename: string): DataSourceType | null {
  const lower = filename.toLowerCase();

  // Meta / Facebook campaigns
  if (lower.includes('campaign') && (
    lower.includes('meta') || lower.includes('facebook') ||
    lower.includes('wellness-campaigns') || lower.includes('brightn')
  )) return 'meta';

  // Google Ads
  if (lower.includes('overview_cards') || lower.includes('time_series') || lower.includes('search_keywords')) return 'google';
  if (lower.includes('google') && !lower.includes('analytics')) return 'google';

  // Toast POS
  if (lower.includes('toast') || lower.includes('productmix')) return 'toast';

  // Incentivio CRM customer export
  if (lower.includes('customer_export') || lower.includes('incentivio') ||
      lower.includes('loyalty') || lower.includes('giftpool') ||
      lower.includes('kpi')) return 'incentivio_crm';

  // Menu intelligence (also from Incentivio)
  if (lower.includes('menu_intelligence') || lower.includes('menuintelligence')) return 'incentivio_menu';

  // Organic social
  if (lower.includes('onelink') || lower.includes('organic') || lower.includes('review_analytics')) return 'organic';

  // 3rd party delivery
  if (lower.includes('uber') || lower.includes('doordash') || lower.includes('grubhub')) return '3po';

  // Budget
  if (lower.includes('budget') || lower.includes('operating budget')) return 'budget';

  // QuickBooks / general expenses
  if (lower.includes('expense') || (lower.includes('marketing') && lower.includes('exp'))) return 'expenses';
  if (lower.includes('quickbooks')) return 'expenses';

  return null;
}

/**
 * Detect source type by inspecting CSV headers.
 * Called when filename detection returns null.
 */
export function detectSourceFromHeaders(csvContent: string): DataSourceType {
  const result = Papa.parse(csvContent, { header: true, preview: 1 });
  const headers = result.meta.fields || [];
  const headerSet = new Set(headers.map(h => h.toLowerCase()));

  // Incentivio customer export: "Customer ID" + "Lifetime Visits"
  if (headerSet.has('customer id') && headerSet.has('lifetime visits')) {
    return 'incentivio_crm';
  }

  // Incentivio menu intelligence: "Item Name" + "Item Score"
  if (headerSet.has('item name') && headerSet.has('item score')) {
    return 'incentivio_menu';
  }

  // Meta Ads: "Campaign name" + "Amount spent (USD)"
  if (headerSet.has('campaign name') && (headerSet.has('amount spent (usd)') || headerSet.has('impressions'))) {
    return 'meta';
  }

  // Google Ads daily: "Date" + "Clicks" + "Avg. CPC"
  if (headerSet.has('date') && headerSet.has('clicks') && headerSet.has('avg. cpc')) {
    return 'google';
  }

  // Google Ads campaigns: "Campaign Name" + "Cost"
  if (headerSet.has('campaign name') && headerSet.has('cost')) {
    return 'google';
  }

  // QuickBooks / Expenses: "Transaction date" + "Amount" or "Date" + "Merchant" + "Amount"
  if ((headerSet.has('transaction date') || headerSet.has('date')) && headerSet.has('amount') &&
      (headerSet.has('name') || headerSet.has('vendor') || headerSet.has('merchant'))) {
    return 'expenses';
  }

  return 'expenses'; // final fallback
}

/**
 * Combined detection: try filename first, then headers.
 */
export function detectSourceType(filename: string, csvContent?: string): DataSourceType {
  const fromFilename = detectSourceFromFilename(filename);
  if (fromFilename) return fromFilename;

  if (csvContent) return detectSourceFromHeaders(csvContent);

  // Can't detect without content — default to expenses
  return 'expenses';
}
