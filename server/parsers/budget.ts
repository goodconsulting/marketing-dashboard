/**
 * Budget XLSX parser — reads the operating budget workbook.
 *
 * Layout: Prefers a sheet named "STACK" (consolidated view).
 * - A date header row has month columns (Date objects or strings).
 * - An "Advertising & Marketing" row has the budget amounts per month.
 *
 * Category allocation uses the $533K annual split from the business plan:
 *   25% Paid Social, 15% Print, 10% Billboards,
 *   5% Email/CRM, 20% Community & Events labor, 25% NIL + SEO + other
 */

import * as XLSX from 'xlsx';
import type { MonthlyBudget, SpendCategory } from '../types.ts';
import { parseMonth } from './utils.ts';

export function parseBudgetXLSX(buffer: Buffer): MonthlyBudget[] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });

  // Prefer the "STACK" sheet (consolidated view) if available
  const sheetName = wb.SheetNames.find(n => n.toUpperCase() === 'STACK') || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });

  const budgets: MonthlyBudget[] = [];

  // Scan the first 20 rows for date header and marketing budget rows
  let dateRowIdx = -1;
  let marketingRowIdx = -1;

  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!row || !Array.isArray(row)) continue;

    // Check if this row has dates in columns
    for (let j = 1; j < row.length; j++) {
      const val = row[j];
      if (val instanceof Date || (typeof val === 'string' && val.match(/^\d{4}-\d{2}/))) {
        dateRowIdx = i;
        break;
      }
    }

    // Find the "Advertising & Marketing" row
    const label = String(row[0] || '').toLowerCase().trim();
    if (label.includes('advertising') || label.includes('marketing')) {
      marketingRowIdx = i;
    }
  }

  if (dateRowIdx === -1 || marketingRowIdx === -1) return budgets;

  const dateRow = rows[dateRowIdx] as unknown[];
  const marketingRow = rows[marketingRowIdx] as unknown[];

  for (let col = 1; col < dateRow.length; col++) {
    const dateVal = dateRow[col];
    let monthStr = '';

    if (dateVal instanceof Date) {
      const y = dateVal.getFullYear();
      const m = (dateVal.getMonth() + 1).toString().padStart(2, '0');
      monthStr = `${y}-${m}`;
    } else if (typeof dateVal === 'string') {
      monthStr = parseMonth(dateVal);
    } else if (typeof dateVal === 'number') {
      // Excel serial date
      const d = XLSX.SSF.parse_date_code(dateVal);
      monthStr = `${d.y}-${d.m.toString().padStart(2, '0')}`;
    }

    if (!monthStr || !monthStr.match(/^\d{4}-\d{2}$/)) continue;

    const rawAmount = marketingRow[col];
    const amount = Math.abs(typeof rawAmount === 'number' ? rawAmount : parseFloat(String(rawAmount || '0')));

    if (amount === 0) continue;

    // Default category split based on the $533K annual allocation
    const byCategory: Record<SpendCategory, number> = {
      paid_media: amount * 0.25,
      direct_mail_print: amount * 0.15,
      ooh: amount * 0.10,
      software_fees: amount * 0.05,
      labor: amount * 0.20,
      other: amount * 0.25,
    };

    budgets.push({
      month: monthStr,
      totalBudget: Math.round(amount * 100) / 100,
      byCategory,
    });
  }

  return budgets;
}
