/**
 * Toast "Location overview" CSV parser core.
 *
 * Shared between scripts/ingest-sales.cjs (CLI) and
 * server/parsers/toastLocationOverview.ts (upload pipeline).
 *
 * This coarse export carries gross/net/orders/discounts/guests/refunds only
 * and — critically — NO date column: the month must be supplied by the
 * caller. The blank-location row is the export's Total row and is skipped.
 * Location names are canonicalized to match existing fact_store_sales rows.
 *
 * The papaparse lib is passed in by the caller (no top-level require of
 * node_modules — Vite's bundled dev server can't resolve dynamic CJS
 * requires, which silently breaks server restarts).
 */

// Export location names → canonical fact_store_sales names
const LOCATION_MAP = { 'CR Downtown': 'Downtown Cedar Rapids' };
const canon = (name) => LOCATION_MAP[name.trim()] || name.trim();

const toNum = (v) => {
  if (v === '' || v == null) return 0;
  const n = parseFloat(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {string} text  CSV text of the export
 * @param {string} month 'YYYY-MM' the export covers (not present in the file)
 * @param {object} PapaLib the papaparse module
 * @returns records in the camelCase StoreSales shape used by insertStoreSales
 */
function parseLocationOverviewCsv(text, month, PapaLib) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) {
    throw new Error('Toast location-overview exports carry no dates — a month (YYYY-MM) is required');
  }
  const rows = PapaLib.parse(text, { header: true, skipEmptyLines: true }).data;
  const records = [];
  for (const r of rows) {
    const rawName = String(r['Location name'] || '').trim();
    if (!rawName) continue; // Total row
    records.push({
      month,
      location: canon(rawName),
      grossSales: round2(toNum(r['Gross sales'])),
      netSales: round2(toNum(r['Net sales'])),
      orders: Math.round(toNum(r['Order count'])),
      discountTotal: round2(toNum(r['Discount amount'])),
      guests: Math.round(toNum(r['Guest count'])),
      refunds: round2(toNum(r['Refund amount'])),
      source: 'toast_location_overview',
    });
  }
  return records;
}

module.exports = { parseLocationOverviewCsv, LOCATION_MAP };
