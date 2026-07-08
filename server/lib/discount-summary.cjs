/**
 * Toast Discount Summary XLSX parser core.
 *
 * Shared between scripts/ingest-discounts.cjs (CLI) and
 * server/parsers/discountSummary.ts (upload pipeline).
 *
 * Format facts (learned Dec 2025 – Apr 2026):
 *   - Sheets are periods. Names seen: "April", "May" (bare month, NO year —
 *     needs a year hint), "Jan 2026", "Q2 2025".
 *   - Header keys can carry stray whitespace (" Profitability") → trimmed.
 *   - Trailing "Total" row is a summary, not a discount → skipped.
 *   - "Percent of Total Sales" may be fractional (0.0132) → normalized to %.
 *
 * Categorizer is THE canonical discount scheme — the same buckets every
 * stored fact_discount_summary row uses (new_customer / loyalty /
 * software_vendor / print / operations / marketing / other). The
 * 'marketing' + 'new_customer' buckets tie discounts to marketing ROI.
 * Do not swap in a different taxonomy without migrating existing rows.
 */

const MONTH_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function categorizeDiscount(name) {
  const lower = name.toLowerCase();
  if (/sign\s*up|signup|referr?al|1st\s*time|first\s*time/.test(lower)) return 'new_customer';
  if (/points|birthday|combo|breakfast\s*deal|lunch|bowl|smoothie/.test(lower)) return 'loyalty';
  if (/momo/.test(lower)) return 'software_vendor';
  if (/bogo/.test(lower)) return 'print';
  if (/employee|comp|open\s*\$|open\s*%|manage|manager/.test(lower)) return 'operations';
  if (/in-kind|marketing/.test(lower)) return 'marketing';
  return 'other';
}

/**
 * Resolve a sheet name to a period.
 *  "Q2 2025"        → { period: '2025-Q2',  periodType: 'quarter' }
 *  "Jan 2026"       → { period: '2026-01', periodType: 'month' }
 *  "April" / "Apr"  → { period: `${yearHint}-04`, periodType: 'month' } (needs yearHint)
 */
function parseSheetPeriod(sheetName, yearHint) {
  const trimmed = sheetName.trim();

  const qMatch = trimmed.match(/^Q(\d)\s+(\d{4})$/i);
  if (qMatch) return { period: `${qMatch[2]}-Q${qMatch[1]}`, periodType: 'quarter' };

  const mYear = trimmed.match(/^(\w{3,9})[\s_-]+(\d{4})$/);
  if (mYear) {
    const mon = MONTH_MAP[mYear[1].substring(0, 3).toLowerCase()];
    if (mon) return { period: `${mYear[2]}-${mon}`, periodType: 'month' };
  }

  const bare = MONTH_MAP[trimmed.substring(0, 3).toLowerCase()];
  if (bare && /^[A-Za-z]+$/.test(trimmed)) {
    if (!yearHint) return null; // bare month name but no year to anchor it
    return { period: `${yearHint}-${bare}`, periodType: 'month' };
  }

  return null;
}

const num = (v) => (typeof v === 'number' ? v : parseFloat(String(v || '0').replace(/[$,%]/g, '')) || 0);

/**
 * Parse every period-named sheet of a discount workbook.
 *
 * @param {object} wb        SheetJS workbook (XLSX.read / XLSX.readFile result)
 * @param {object} XLSXlib   the xlsx module (passed in so core stays require-order agnostic)
 * @param {string} [yearHint] 'YYYY' used to anchor bare month-name sheets
 * @returns {{ periods: Array<{period, periodType, records}>, skippedSheets: string[] }}
 *   records use the camelCase DiscountSummary shape (insertDiscountSummary-ready).
 */
function parseDiscountWorkbook(wb, XLSXlib, yearHint) {
  const periods = [];
  const skippedSheets = [];

  for (const sheetName of wb.SheetNames) {
    const info = parseSheetPeriod(sheetName, yearHint);
    if (!info) { skippedSheets.push(sheetName); continue; }

    const ws = wb.Sheets[sheetName];
    const raw = XLSXlib.utils.sheet_to_json(ws, { header: 1 });
    let headerIdx = 0;
    for (let i = 0; i < Math.min(raw.length, 5); i++) {
      if (String((raw[i] || [])[0] || '').trim() === 'Discount Name') { headerIdx = i; break; }
    }
    const rawRows = XLSXlib.utils.sheet_to_json(ws, { defval: '', range: headerIdx });

    const records = [];
    for (const rawRow of rawRows) {
      // Trim header keys — workbooks have had " Profitability" with a leading space.
      const row = {};
      for (const k in rawRow) row[k.trim()] = rawRow[k];

      const name = String(row['Discount Name'] || '').trim();
      if (!name) continue;
      if (name.toLowerCase() === 'total') continue; // summary row, not a discount

      let pct = num(row['Percent of Total Sales']);
      if (pct > 0 && pct <= 1) pct = pct * 100; // fractional → percent

      records.push({
        period: info.period,
        periodType: info.periodType,
        discountName: name,
        discountCategory: categorizeDiscount(name),
        usageCount: Math.round(num(row['Count'])),
        discountAmount: Math.round(num(row['Discount Amount']) * 100) / 100,
        profitability: Math.round(num(row['Profitability']) * 100) / 100,
        pctOfTotalSales: Math.round(pct * 10000) / 10000,
      });
    }
    if (records.length > 0) periods.push({ period: info.period, periodType: info.periodType, records });
  }

  return { periods, skippedSheets };
}

module.exports = { parseDiscountWorkbook, parseSheetPeriod, categorizeDiscount };
