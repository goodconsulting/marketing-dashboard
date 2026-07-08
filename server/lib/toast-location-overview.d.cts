/**
 * Type declarations for toast-location-overview.cjs.
 */

export interface LocationOverviewRecord {
  month: string;
  location: string;
  grossSales: number;
  netSales: number;
  orders: number;
  discountTotal: number;
  guests: number;
  refunds: number;
  source: string;
}

export declare const LOCATION_MAP: Record<string, string>;

export declare function parseLocationOverviewCsv(
  text: string,
  month: string,
  PapaLib: unknown,
): LocationOverviewRecord[];
