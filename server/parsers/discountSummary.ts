/**
 * Discount Summary XLSX parser (upload-pipeline wrapper).
 *
 * The parsing core lives in server/lib/discount-summary.cjs, shared with
 * scripts/ingest-discounts.cjs — including the CANONICAL discount categorizer
 * (new_customer / loyalty / software_vendor / print / operations / marketing /
 * other), the scheme every stored fact_discount_summary row uses. A previous
 * version of this file carried a divergent 7-category taxonomy that was never
 * wired into the pipeline; it was removed to prevent split categorization.
 *
 * Sheets named with a bare month ("April") carry no year — pass yearHint.
 */
import * as XLSX from 'xlsx';
import { parseDiscountWorkbook } from '../lib/discount-summary.cjs';
import type { DiscountWorkbookResult } from '../lib/discount-summary.cjs';

export function parseDiscountSummary(buffer: Buffer, yearHint?: string): DiscountWorkbookResult {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return parseDiscountWorkbook(wb, XLSX, yearHint);
}
