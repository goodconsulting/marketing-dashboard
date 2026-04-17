/**
 * OneLink QR tracking CSV parser.
 *
 * Each CSV file corresponds to a single tracking code (QR code).
 * The tracking code and campaign source are derived from the filename.
 *
 * CSV headers: YYYYMMDD (UTC), Total, iPhone, iPad, Android, Huawei, Other
 * Date format: 20250714 → 2025-07-14
 * Huawei + Other are combined into a single "other" field.
 * Rows with Total = 0 are skipped.
 */

import Papa from 'papaparse';
import type { OneLinkDaily } from '../types.ts';
import { parseInt_ } from './utils.ts';

/**
 * Extract tracking code and campaign metadata from a OneLink filename.
 *
 * Filename patterns:
 *   onelinkto_{trackingCode}_directmailer1_cedarrapids_stats_...
 *   onelinkto_{trackingCode}_stats_ValPak_waukee_device_...
 *   onelinkto_{trackingCode}_stats_Valpak_Coralville_device_...
 *   onelinkto_{trackingCode}_ValPak_CR_stats_device_...
 *   onelinkto_{trackingCode}_stats_device_..._METAADS.csv
 *   onelinkto_{trackingCode}_AppDownload_stats_device_...
 *   onelinkto_{trackingCode}_ORIGINAL_stats_device_...
 */
function extractMetadata(filename: string): { trackingCode: string; campaignSource: string; campaignLabel: string } {
  const parts = filename.split('_');
  const trackingCode = parts[1] || 'unknown';
  const lower = filename.toLowerCase();

  if (lower.includes('valpak')) {
    // Extract location from filename segments
    const location = extractValpakLocation(filename);
    return { trackingCode, campaignSource: 'valpak', campaignLabel: `ValPak - ${location}` };
  }

  if (lower.includes('directmailer')) {
    const location = extractDirectMailLocation(filename);
    return { trackingCode, campaignSource: 'direct_mail', campaignLabel: `Direct Mailer 1 - ${location}` };
  }

  if (lower.includes('metaads')) {
    return { trackingCode, campaignSource: 'meta_ads', campaignLabel: 'Meta Ads - App Download' };
  }

  if (lower.includes('appdownload')) {
    return { trackingCode, campaignSource: 'app_download', campaignLabel: 'App Download' };
  }

  if (lower.includes('original')) {
    return { trackingCode, campaignSource: 'original', campaignLabel: 'Original QR' };
  }

  return { trackingCode, campaignSource: 'other', campaignLabel: 'Other' };
}

/** Extract location name from ValPak filenames. */
function extractValpakLocation(filename: string): string {
  const parts = filename.split('_');
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].toLowerCase() === 'valpak' && parts[i + 1]) {
      // Next segment is the location (e.g., "waukee", "Coralville", "CR")
      const loc = parts[i + 1];
      if (loc.toLowerCase() === 'cr') return 'Cedar Rapids';
      // Capitalize first letter
      return loc.charAt(0).toUpperCase() + loc.slice(1);
    }
  }
  return 'Unknown';
}

/** Extract location name from direct mail filenames. */
function extractDirectMailLocation(filename: string): string {
  const parts = filename.split('_');
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].toLowerCase().includes('directmailer') && parts[i + 1]) {
      const loc = parts[i + 1];
      // "cedarrapids" → "Cedar Rapids"
      if (loc.toLowerCase() === 'cedarrapids') return 'Cedar Rapids';
      return loc.charAt(0).toUpperCase() + loc.slice(1);
    }
  }
  return 'Unknown';
}

/**
 * Convert YYYYMMDD date string to YYYY-MM-DD.
 */
function formatDate(yyyymmdd: string): string {
  const cleaned = yyyymmdd.trim();
  if (cleaned.length < 8) return cleaned;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
}

/**
 * Parse a OneLink QR tracking CSV file.
 */
export function parseOneLinkDaily(csvContent: string, filename: string): OneLinkDaily[] {
  const { trackingCode, campaignSource, campaignLabel } = extractMetadata(filename);

  const result = Papa.parse(csvContent, { header: true, skipEmptyLines: true });

  if (result.errors.length > 0) {
    console.warn(`[OneLink Parser] ${result.errors.length} row-level warnings`);
  }

  const records: OneLinkDaily[] = [];

  for (const row of result.data as Record<string, string>[]) {
    const dateRaw = row['YYYYMMDD (UTC)'] || '';
    const total = parseInt_(row['Total']);

    // Skip rows with zero total
    if (total === 0) continue;

    const date = formatDate(dateRaw);
    const month = date.substring(0, 7);
    const huawei = parseInt_(row['Huawei']);
    const otherVal = parseInt_(row['Other']);

    records.push({
      date,
      month,
      trackingCode,
      campaignSource,
      campaignLabel,
      total,
      iphone: parseInt_(row['iPhone']),
      ipad: parseInt_(row['iPad']),
      android: parseInt_(row['Android']),
      other: huawei + otherVal,
    });
  }

  return records;
}
