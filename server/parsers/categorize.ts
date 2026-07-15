/**
 * Expense auto-categorization by vendor/description keywords.
 * Server-side copy of src/utils/categorize.ts.
 */

import type { SpendCategory } from '../types.ts';

const VENDOR_CATEGORIES: Record<string, SpendCategory> = {
  // ── Specific overrides (must come BEFORE generic matches) ──
  // "gsuite" and "workspace" must match before "google" to avoid
  // mis-categorizing Google Workspace as Google Ads
  // "canvas on demand" must match before "canva" (in-store signage, not software)
  'canvas on demand': 'other',
  'gsuite': 'software_fees',
  'workspace': 'software_fees',

  // Paid Media
  'google': 'paid_media',
  'facebook': 'paid_media',
  'facebk': 'paid_media',
  'meta': 'paid_media',
  'yelp': 'paid_media',
  'indeed': 'paid_media',
  'uber eats': 'paid_media',
  'ue mktg': 'paid_media',
  'ue marketing': 'paid_media',
  'dd mktg': 'paid_media',
  'linkedin': 'paid_media',
  'sinclair': 'paid_media',

  // Direct Mail & Print
  // Allegra = uniforms & in-store signage; GotPrint = F&B labels (CIO, Jul 2026)
  'allegra': 'other',
  'vistaprint': 'direct_mail_print',
  'gotprint': 'other',
  'usps': 'direct_mail_print',
  'vpc direct': 'direct_mail_print',
  'uline': 'direct_mail_print',
  'copyworks': 'direct_mail_print',

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
  'webflow': 'software_fees',
  'bright local': 'software_fees',
  'brightlocal': 'software_fees',
  'claude.ai': 'software_fees',
  'claude ai': 'software_fees',
  'giftameal': 'software_fees',

  // Labor
  'hoskins': 'labor',
  'hopkins': 'labor',
  'alexis': 'labor',
  'tyce': 'labor',
  'clay b': 'labor',
  'dev base': 'labor',

  // Organic Marketing (consulting/content, not paid ads — added Jul 2026 per CIO)
  'hello digital': 'organic_marketing',
  'goodale consult': 'organic_marketing',

  // Sponsorships
  'metro alliance': 'sponsorship',
  'economic alliance': 'sponsorship',
  'cedar rapids metro': 'sponsorship',
  'west des moines': 'sponsorship',
  'newbo': 'sponsorship',
  'urbandale chamber': 'sponsorship',
  'waukee area chamber': 'sponsorship',
  'careismatic': 'sponsorship',
  'legitscript': 'sponsorship',
  'sponsorship': 'sponsorship',
  // Local media & event partners (added Apr 2026 per CIO)
  'big green': 'sponsorship',
  'umbrella media': 'sponsorship',
  'downtown events': 'sponsorship',
  'ragbrai': 'sponsorship',
  'dyersville': 'sponsorship',
  'marshalltown': 'sponsorship',
  'bliss balloon': 'sponsorship',
  'nhl operating': 'sponsorship',
  'nhrloperati': 'sponsorship',

  // DoorDash paid media (DD Marketing = DoorDash ads)
  'dd marketing': 'paid_media',
  'doordash': 'paid_media',
};

export function categorizeExpense(vendor: string, description: string): SpendCategory {
  const searchText = `${vendor} ${description}`.toLowerCase();

  // Vendor name outranks memo text: a "Workspace" charge must not become
  // paid_media because its memo reads "GOOGLE *WORKSPACE".
  for (const text of [vendor.toLowerCase(), searchText]) {
    for (const [keyword, category] of Object.entries(VENDOR_CATEGORIES)) {
      if (text.includes(keyword.toLowerCase())) {
        return category;
      }
    }
  }

  // Fallback heuristics ("mail" is word-bounded so "email" doesn't match)
  if (searchText.includes('ads') || searchText.includes('campaign')) return 'paid_media';
  if (searchText.includes('print') || /\bmail\b/.test(searchText) || searchText.includes('flyer')) return 'direct_mail_print';
  if (/\bsign/.test(searchText) || searchText.includes('outdoor') || searchText.includes('bulletin')) return 'ooh';

  return 'other';
}
