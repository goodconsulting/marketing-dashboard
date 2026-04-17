/**
 * Discount Summary XLSX parser — reads multi-sheet discount workbook.
 *
 * Layout: Each sheet represents a period (quarter or month).
 * Sheet names like "Q2 2025" → period=2025-Q2, periodType=quarter
 * Sheet names like "Jan 2026" → period=2026-01, periodType=month
 *
 * Columns: Discount Name, Count, Discount Amount, Profitability, Percent of Total Sales
 *
 * Each discount is auto-categorized into: new_customer, loyalty, software_vendor,
 * print, operations, marketing, or other.
 */

import * as XLSX from 'xlsx';
import type { DiscountSummary } from '../types.ts';

// ─── Period Parsing ──────────────────────────────────────────────

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

interface PeriodInfo {
  period: string;
  periodType: string;
}

function parseSheetPeriod(sheetName: string): PeriodInfo | null {
  const trimmed = sheetName.trim();

  // Quarter: "Q2 2025" → 2025-Q2
  const qMatch = trimmed.match(/^Q(\d)\s+(\d{4})$/i);
  if (qMatch) {
    return { period: `${qMatch[2]}-Q${qMatch[1]}`, periodType: 'quarter' };
  }

  // Month: "Jan 2026" → 2026-01
  const mMatch = trimmed.match(/^(\w{3})\s+(\d{4})$/i);
  if (mMatch) {
    const monthNum = MONTH_MAP[mMatch[1].toLowerCase()];
    if (monthNum) {
      return { period: `${mMatch[2]}-${monthNum}`, periodType: 'month' };
    }
  }

  return null;
}

// ─── Category Classification ─────────────────────────────────────

/**
 * Stack Wellness 7-Category Discount Classification:
 * 1. loyalty_redemption  — Points, birthday, earned rewards
 * 2. acquisition         — Sign-up, referral offers
 * 3. meal_deal           — Meal deals, breakfast deals, bundles
 * 4. seasonal_lto        — BOGO, seasonal promos, LTOs
 * 5. community_service   — Military, heroes, case discount, VIP
 * 6. operations          — Employee, manager comp, spillage, open discounts
 * 7. partner_marketing   — Momo's, in-kind marketing, influencer
 */
export function categorizeDiscount(name: string): string {
  const l = name.toLowerCase();

  // Cat 2: Acquisition & Referral
  if (/sign\s*up|signup|referr?al|referal/.test(l)) return 'acquisition';

  // Cat 1: Loyalty Redemptions
  if (/points|birthday|free delivery/.test(l)) return 'loyalty_redemption';

  // Cat 3: Meal Deals & Bundles
  if (/meal deal|breakfast deal|app - meal|app - breakfast|web\/app|kiosk/.test(l)) return 'meal_deal';

  // Cat 4: Seasonal & LTO
  if (/bogo|val20|vip discount|10% off|egg bite|stackwich|chck 20|friends & family|ubereats/.test(l)) return 'seasonal_lto';

  // Cat 5: Community & Service
  if (/military|first responder|service 20%|heroes|case discount/.test(l)) return 'community_service';

  // Cat 6: Internal & Operational
  if (/employee|manager comp|open \$|open %|spillage|food quality|employee meal/.test(l)) return 'operations';

  // Cat 7: Partner & In-Kind Marketing
  if (/momo|in-kind|in kind|influencer/.test(l)) return 'partner_marketing';

  return 'other';
}

// ─── Parser ──────────────────────────────────────────────────────

export function parseDiscountSummary(buffer: Buffer): DiscountSummary[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const results: DiscountSummary[] = [];

  for (const sheetName of wb.SheetNames) {
    const periodInfo = parseSheetPeriod(sheetName);
    if (!periodInfo) continue;

    const ws = wb.Sheets[sheetName];

    // Some sheets have a title row ("Discount Summary") before the actual headers.
    // Detect header row by scanning raw rows for "Discount Name" in first cell.
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
    let headerRowIdx = 0;
    for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
      const firstCell = String(rawRows[i]?.[0] || '').trim();
      if (firstCell === 'Discount Name') {
        headerRowIdx = i;
        break;
      }
    }

    // Re-parse using the correct header row by setting range
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
      defval: '',
      range: headerRowIdx,
    });

    for (const row of rows) {
      const discountName = String(row['Discount Name'] || '').trim();
      if (!discountName) continue;

      const usageCount = typeof row['Count'] === 'number'
        ? row['Count']
        : parseInt(String(row['Count'] || '0').replace(/,/g, ''), 10) || 0;

      const discountAmount = typeof row['Discount Amount'] === 'number'
        ? row['Discount Amount']
        : parseFloat(String(row['Discount Amount'] || '0').replace(/[$,]/g, '')) || 0;

      const profitability = typeof row['Profitability'] === 'number'
        ? row['Profitability']
        : parseFloat(String(row['Profitability'] || '0').replace(/[$,]/g, '')) || 0;

      const pctRaw = row['Percent of Total Sales'];
      let pctOfTotalSales = 0;
      if (typeof pctRaw === 'number') {
        // XLSX may return percentages as decimals (0.05 = 5%)
        pctOfTotalSales = pctRaw > 1 ? pctRaw : pctRaw * 100;
      } else {
        pctOfTotalSales = parseFloat(String(pctRaw || '0').replace(/%/g, '')) || 0;
      }

      results.push({
        period: periodInfo.period,
        periodType: periodInfo.periodType,
        discountName,
        discountCategory: categorizeDiscount(discountName),
        usageCount,
        discountAmount: Math.round(discountAmount * 100) / 100,
        profitability: Math.round(profitability * 100) / 100,
        pctOfTotalSales: Math.round(pctOfTotalSales * 10000) / 10000,
      });
    }
  }

  return results;
}
