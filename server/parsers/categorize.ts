/**
 * Expense auto-categorization by vendor/description keywords.
 * Server-side copy of src/utils/categorize.ts.
 */

import type { SpendCategory } from '../types.ts';

const VENDOR_CATEGORIES: Record<string, SpendCategory> = {
  // Paid Media
  'google': 'paid_media',
  'facebook': 'paid_media',
  'facebk': 'paid_media',
  'meta': 'paid_media',
  'yelp': 'paid_media',
  'indeed': 'paid_media',

  // Direct Mail & Print
  'allegra': 'direct_mail_print',
  'vistaprint': 'direct_mail_print',
  'gotprint': 'direct_mail_print',
  'usps': 'direct_mail_print',

  // Out-of-Home
  'lamar': 'ooh',
  'billboard': 'ooh',
  'valpak': 'ooh',

  // Software Fees
  'incentivio': 'software_fees',
  'momos': 'software_fees',
  'canva': 'software_fees',
  'highlevel': 'software_fees',
  'high level': 'software_fees',
  'godaddy': 'software_fees',
  'workspace': 'software_fees',
  'bright local': 'software_fees',
  'brightlocal': 'software_fees',

  // Labor
  'hoskins': 'labor',
  'alexis': 'labor',
  'tyce': 'labor',
};

export function categorizeExpense(vendor: string, description: string): SpendCategory {
  const searchText = `${vendor} ${description}`.toLowerCase();

  for (const [keyword, category] of Object.entries(VENDOR_CATEGORIES)) {
    if (searchText.includes(keyword.toLowerCase())) {
      return category;
    }
  }

  // Fallback heuristics
  if (searchText.includes('ads') || searchText.includes('campaign')) return 'paid_media';
  if (searchText.includes('print') || searchText.includes('mail') || searchText.includes('flyer')) return 'direct_mail_print';
  if (searchText.includes('sign') || searchText.includes('outdoor') || searchText.includes('bulletin')) return 'ooh';

  return 'other';
}
