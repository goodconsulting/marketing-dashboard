import type { SpendCategory } from '../types';

// Auto-categorize expenses by vendor name
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

  // OOH (also)
  'valpak': 'ooh',
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

export const CATEGORY_LABELS: Record<SpendCategory, string> = {
  paid_media: 'Paid Media',
  direct_mail_print: 'Direct Mail & Print',
  ooh: 'Out-of-Home (OOH)',
  software_fees: 'Software Fees',
  labor: 'Marketing Labor',
  other: 'Other',
};

export const CATEGORY_COLORS: Record<SpendCategory, string> = {
  paid_media: '#3b82f6',
  direct_mail_print: '#f59e0b',
  ooh: '#8b5cf6',
  software_fees: '#06b6d4',
  labor: '#10b981',
  other: '#6b7280',
};
