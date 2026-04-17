/**
 * Barrel export for all server-side parsers.
 */

export { detectSourceType, detectSourceFromFilename, detectSourceFromHeaders } from './detect.ts';
export { categorizeExpense } from './categorize.ts';
export { parseCRM } from './crm.ts';
export { parseMenuIntelligence } from './menuIntelligence.ts';
export { parseExpensesCSV, parseExpensesXLSX } from './expenses.ts';
export { parseMetaCampaigns } from './meta.ts';
export { parseGoogleCampaigns, parseGoogleDaily, isGoogleCampaignReport } from './google.ts';
export { parseToastCSV } from './toast.ts';
export { parseBudgetXLSX } from './budget.ts';
export { parseOneLinkDaily } from './onelink.ts';
export { parseDiscountSummary } from './discountSummary.ts';
