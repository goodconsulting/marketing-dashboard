/**
 * Shared parser utilities — date parsing, number coercion, ID generation.
 */

import { randomBytes } from 'crypto';

/** Generate a random ID for records that need one. */
export function generateId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Parse a date string into YYYY-MM month format.
 * Handles ISO dates, US dates (MM/DD/YYYY), and long-form dates.
 */
export function parseMonth(dateStr: string): string {
  const cleaned = dateStr.replace(/"/g, '').trim();

  // YYYY-MM-DD (most common ISO format)
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;

  // MM/DD/YYYY
  const slashMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) return `${slashMatch[3]}-${slashMatch[1].padStart(2, '0')}`;

  // "Mon, Dec 1, 2025" or "Dec 1, 2025" style
  const months: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  };

  const longMatch = cleaned.match(/(\w{3})\w*[,\s]+(\d+),?\s+(\d{4})/);
  if (longMatch) {
    const m = months[longMatch[1]];
    if (m) return `${longMatch[3]}-${m}`;
  }

  // "Sun, Feb 1, 2026" — Google Ads daily format
  const dayMonMatch = cleaned.match(/\w+,\s*(\w{3})\s+(\d+),?\s+(\d{4})/);
  if (dayMonMatch) {
    const m = months[dayMonMatch[1]];
    if (m) return `${dayMonMatch[3]}-${m}`;
  }

  return cleaned.substring(0, 7);
}

/** Parse a currency/number string into a float. Strips $, commas. */
export function parseNum(value: string | undefined, fallback = 0): number {
  if (!value) return fallback;
  const cleaned = value.replace(/[$,]/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? fallback : n;
}

/** Parse an integer string. Strips commas. */
export function parseInt_(value: string | undefined, fallback = 0): number {
  if (!value) return fallback;
  const cleaned = value.replace(/,/g, '').trim();
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? fallback : n;
}

/** Parse a percentage string. Strips %. */
export function parsePct(value: string | undefined, fallback = 0): number {
  if (!value) return fallback;
  const cleaned = value.replace(/%/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? fallback : n;
}

/** Check if a string looks like a truthy boolean. */
export function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  const lower = value.toLowerCase().trim();
  return lower === 'true' || lower === 'yes' || lower === '1';
}
