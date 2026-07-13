/**
 * Toast "Sales Summary" per-location XLSX parser core.
 *
 * ToastWeb → Sales → Sales summary → Excel export. One workbook per
 * location per month, ~22 tabs. We read three:
 *   - "Net sales summary":     Gross sales / Sales discounts / Sales refunds / Net sales
 *   - "Service mode summary":  Total row → Total guests / Total orders
 *   - "Revenue summary":       Tips / Tax amount
 *
 * All values are located by HEADER NAME, never column index — Toast layouts
 * shift between exports (see the QuickBooks Balance-column incident).
 * Discounts/refunds are signed negative in the export; stored absolute to
 * match the location-overview convention in fact_store_sales.
 *
 * The xlsx lib is passed in by the caller (no top-level require of
 * node_modules — Vite's bundled dev server can't resolve dynamic CJS
 * requires, which silently breaks server restarts).
 */

const round2 = (n) => Math.round(n * 100) / 100;
const toNum = (v) => {
  if (v === '' || v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Read a tab whose row 0 is headers; return row `idx` as {header: value}. */
function sheetRowByHeader(wb, tabName, XLSXLib, idx = 1) {
  const sheet = wb.Sheets[tabName];
  if (!sheet) throw new Error(`missing tab "${tabName}"`);
  const rows = XLSXLib.utils.sheet_to_json(sheet, { header: 1 });
  const headers = rows[0] || [];
  const row = rows[idx] || [];
  const out = {};
  headers.forEach((h, i) => { if (h != null && h !== '') out[String(h).trim()] = row[i]; });
  return out;
}

/** Find the "Total" row in a tab keyed by its first column. */
function sheetTotalRowByHeader(wb, tabName, XLSXLib) {
  const sheet = wb.Sheets[tabName];
  if (!sheet) throw new Error(`missing tab "${tabName}"`);
  const rows = XLSXLib.utils.sheet_to_json(sheet, { header: 1 });
  const headers = rows[0] || [];
  const totalRow = rows.find((r, i) => i > 0 && String(r?.[0]).trim() === 'Total');
  if (!totalRow) throw new Error(`no Total row in "${tabName}"`);
  const out = {};
  headers.forEach((h, i) => { if (h != null && h !== '') out[String(h).trim()] = totalRow[i]; });
  return out;
}

/**
 * @param {object} wb        XLSX workbook (already read by the caller)
 * @param {string} month     'YYYY-MM' the export covers
 * @param {string} location  canonical fact_store_sales location name
 * @param {object} XLSXLib   the xlsx module
 * @returns one record in the camelCase StoreSales shape
 */
function parseSalesSummaryWorkbook(wb, month, location, XLSXLib) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new Error('month must be YYYY-MM');

  const net = sheetRowByHeader(wb, 'Net sales summary', XLSXLib);
  const grossSales = toNum(net['Gross sales']);
  const rawDiscounts = toNum(net['Sales discounts']);
  const rawRefunds = toNum(net['Sales refunds']);
  const netSales = toNum(net['Net sales']);

  // Identity check: net = gross + discounts + refunds (both signed negative).
  const expectedNet = round2(grossSales + rawDiscounts + rawRefunds);
  if (Math.abs(expectedNet - netSales) > 0.02) {
    throw new Error(`${location}: net sales identity fails (gross ${grossSales} + disc ${rawDiscounts} + ref ${rawRefunds} = ${expectedNet}, file says ${netSales})`);
  }

  const svc = sheetTotalRowByHeader(wb, 'Service mode summary', XLSXLib);
  const rev = sheetRowByHeader(wb, 'Revenue summary', XLSXLib);

  return {
    month,
    location,
    grossSales: round2(grossSales),
    netSales: round2(netSales),
    orders: Math.round(toNum(svc['Total orders'])),
    discountTotal: round2(Math.abs(rawDiscounts)),
    guests: Math.round(toNum(svc['Total guests'])),
    tips: round2(toNum(rev['Tips'])),
    taxAmount: round2(toNum(rev['Tax amount'])),
    refunds: round2(Math.abs(rawRefunds)),
    source: 'toast_sales_summary',
  };
}

module.exports = { parseSalesSummaryWorkbook };
