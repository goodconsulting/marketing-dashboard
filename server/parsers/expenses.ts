/**
 * Expense parser — handles both QuickBooks CSV and XLSX exports.
 *
 * CSV input: string content with headers like "Transaction date", "Name", "Amount"
 * XLSX input: Buffer from file upload, column-index-based (no headers in row 1)
 *
 * Each record gets auto-categorized via `categorizeExpense()`.
 */

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { MonthlyExpense } from '../types.ts';
import { categorizeExpense } from './categorize.ts';
import { generateId, parseMonth, parseNum } from './utils.ts';

/**
 * Parse QuickBooks CSV expense export.
 * Expected headers: "Transaction date", "Name", "Memo/Description", "Amount"
 */
export function parseExpensesCSV(csvContent: string, sourceFilename = ''): MonthlyExpense[] {
  const result = Papa.parse(csvContent, { header: true, skipEmptyLines: true });

  if (result.errors.length > 0) {
    console.warn(`[Expense CSV Parser] ${result.errors.length} row-level warnings`);
  }

  const expenses: MonthlyExpense[] = [];

  for (const row of result.data as Record<string, string>[]) {
    const date = row['Transaction date'] || row['Date'] || '';
    const vendor = row['Name'] || row['Vendor'] || row['Merchant'] || '';
    const desc = row['Memo/Description'] || row['Description'] || '';
    const amountStr = row['Amount'] || '0';
    const amount = Math.abs(parseNum(amountStr));

    if (!date || amount === 0) continue;

    expenses.push({
      id: generateId(),
      date,
      month: parseMonth(date),
      vendor,
      description: desc,
      amount,
      category: categorizeExpense(vendor, desc),
      source: sourceFilename,
    });
  }

  return expenses;
}

/**
 * Parse QuickBooks XLSX expense export.
 *
 * XLSX uses column indices (no header row):
 *   [1] = Date, [4] = Vendor, [5] = Description, [8] = Amount
 *
 * Date cells may be Excel serial numbers — XLSX.SSF handles conversion.
 */
export function parseExpensesXLSX(buffer: Buffer, sourceFilename = ''): MonthlyExpense[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });

  const expenses: MonthlyExpense[] = [];

  for (const row of rows) {
    if (!Array.isArray(row)) continue;

    const dateVal = row[1];
    const vendor = row[4];
    const desc = row[5];
    const amount = row[8];

    if (!dateVal || !amount || typeof amount !== 'number' || amount <= 0) continue;

    let dateStr = '';
    if (typeof dateVal === 'string') {
      dateStr = dateVal;
    } else if (typeof dateVal === 'number') {
      const d = XLSX.SSF.parse_date_code(dateVal);
      dateStr = `${d.m.toString().padStart(2, '0')}/${d.d.toString().padStart(2, '0')}/${d.y}`;
    }

    if (!dateStr || !dateStr.match(/\d/)) continue;

    const vendorStr = String(vendor || '');
    const descStr = String(desc || '');

    expenses.push({
      id: generateId(),
      date: dateStr,
      month: parseMonth(dateStr),
      vendor: vendorStr,
      description: descStr,
      amount,
      category: categorizeExpense(vendorStr, descStr),
      source: sourceFilename,
    });
  }

  return expenses;
}
