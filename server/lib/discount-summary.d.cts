/**
 * Type declarations for discount-summary.cjs.
 */

export interface DiscountRecord {
  period: string;
  periodType: string;
  discountName: string;
  discountCategory: string;
  usageCount: number;
  discountAmount: number;
  profitability: number;
  pctOfTotalSales: number;
}

export interface DiscountWorkbookResult {
  periods: Array<{ period: string; periodType: string; records: DiscountRecord[] }>;
  skippedSheets: string[];
}

export declare function categorizeDiscount(name: string): string;

export declare function parseSheetPeriod(
  sheetName: string,
  yearHint?: string,
): { period: string; periodType: string } | null;

export declare function parseDiscountWorkbook(
  wb: unknown,
  XLSXlib: unknown,
  yearHint?: string,
): DiscountWorkbookResult;
