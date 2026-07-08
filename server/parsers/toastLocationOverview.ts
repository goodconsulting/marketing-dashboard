/**
 * Toast "Location overview" export parser (upload-pipeline wrapper).
 *
 * The parsing core lives in server/lib/toast-location-overview.cjs, shared
 * with scripts/ingest-sales.cjs. This export carries NO date column — the
 * month must come from the upload form's month hint.
 */
import Papa from 'papaparse';
import { parseLocationOverviewCsv } from '../lib/toast-location-overview.cjs';
import type { StoreSales } from '../types.ts';

export function parseToastLocationOverview(content: string, month: string): StoreSales[] {
  return parseLocationOverviewCsv(content, month, Papa) as StoreSales[];
}
