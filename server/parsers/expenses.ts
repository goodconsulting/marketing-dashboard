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
    // Sign is preserved: credits/refunds/deposits are negative and must
    // subtract from spend, matching QuickBooks' own report totals.
    const amount = parseNum(amountStr);

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

interface XlsxColumns {
  date: number;
  vendor: number;
  desc: number;
  amount: number;
  headerRowIdx: number;
}

const DATE_HEADERS = ['transaction date', 'date'];
const VENDOR_HEADERS = ['name', 'vendor', 'merchant'];
const DESC_HEADERS = ['memo/description', 'description', 'memo'];

/**
 * Locate the header row and map columns by name. QuickBooks reports put
 * title rows above the header, and place a running "Balance" column right
 * after "Amount" — matching headers exactly is the only safe way to pick
 * the amount column.
 */
function findXlsxColumns(rows: unknown[][]): XlsxColumns | null {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const cells = row.map(c => String(c ?? '').trim().toLowerCase());
    const date = cells.findIndex(c => DATE_HEADERS.includes(c));
    const amount = cells.findIndex(c => c === 'amount');
    if (date === -1 || amount === -1) continue;
    return {
      date,
      amount,
      vendor: cells.findIndex(c => VENDOR_HEADERS.includes(c)),
      desc: cells.findIndex(c => DESC_HEADERS.includes(c)),
      headerRowIdx: i,
    };
  }
  return null;
}

/** Date cells may be strings or Excel serial numbers. */
function xlsxCellToDateString(dateVal: unknown): string {
  if (typeof dateVal === 'string') return dateVal;
  if (typeof dateVal === 'number') {
    const d = XLSX.SSF.parse_date_code(dateVal);
    return `${d.m.toString().padStart(2, '0')}/${d.d.toString().padStart(2, '0')}/${d.y}`;
  }
  return '';
}

/**
 * Amount cells may be numbers or formatted strings ("1,964.52"). Sign is
 * preserved: credits/refunds/deposits are negative and must subtract from
 * spend, matching QuickBooks' own report totals.
 */
function xlsxCellToAmount(val: unknown): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return parseNum(val);
  return 0;
}

/**
 * Parse QuickBooks XLSX expense export.
 *
 * Columns are resolved by header name so a trailing "Balance" column is
 * never mistaken for "Amount". Falls back to the legacy positional layout
 * ([1]=Date, [4]=Vendor, [5]=Description, [8]=Amount) if no header row
 * is found. Section/total/footer rows have no date cell and are skipped.
 */
export function parseExpensesXLSX(buffer: Buffer, sourceFilename = ''): MonthlyExpense[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });

  const cols = findXlsxColumns(rows)
    ?? { date: 1, vendor: 4, desc: 5, amount: 8, headerRowIdx: -1 };

  const expenses: MonthlyExpense[] = [];

  for (let i = cols.headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    const dateStr = xlsxCellToDateString(row[cols.date]);
    const amount = xlsxCellToAmount(row[cols.amount]);

    if (!dateStr || !dateStr.match(/\d/) || amount === 0) continue;

    const vendorStr = cols.vendor === -1 ? '' : String(row[cols.vendor] ?? '');
    const descStr = cols.desc === -1 ? '' : String(row[cols.desc] ?? '');

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
