/**
 * Toast POS CSV parser — sales summary fallback when API is unavailable.
 *
 * Toast CSV exports have daily rows per location. This parser aggregates
 * them to monthly rollups per location, matching the fact_toast_sales schema.
 *
 * Flexible header matching handles Toast report variations:
 *   Location: "Location" | "Restaurant" | "Store"
 *   Date:     "Date" | "Business Date" | "Report Date"
 *   Sales:    "Gross Sales" | "Total Sales", "Net Sales"
 *   Orders:   "Orders" | "Order Count" | "Checks"
 *   Discounts: "Discounts" | "Discount Total"
 */

import Papa from 'papaparse';
import type { ToastSales } from '../types.ts';
import { parseMonth, parseNum, parseInt_ } from './utils.ts';

export function parseToastCSV(csvContent: string): ToastSales[] {
  const result = Papa.parse(csvContent, { header: true, skipEmptyLines: true });

  if (result.errors.length > 0) {
    console.warn(`[Toast Parser] ${result.errors.length} row-level warnings`);
  }

  const sales: ToastSales[] = [];

  for (const row of result.data as Record<string, string>[]) {
    const location = row['Location'] || row['Restaurant'] || row['Store'] || '';
    const date = row['Date'] || row['Business Date'] || row['Report Date'] || '';
    const grossSales = parseNum(row['Gross Sales'] || row['Total Sales']);
    const netSales = parseNum(row['Net Sales']);
    const orders = parseInt_(row['Orders'] || row['Order Count'] || row['Checks']);
    const discounts = Math.abs(parseNum(row['Discounts'] || row['Discount Total']));

    if (!location || grossSales === 0) continue;

    const month = date ? parseMonth(date) : '';
    if (!month || !month.match(/^\d{4}-\d{2}$/)) continue;

    // Aggregate daily rows into monthly rollups per location
    const existing = sales.find(s => s.month === month && s.location === location);
    if (existing) {
      existing.grossSales += grossSales;
      existing.netSales += netSales;
      existing.orders += orders;
      existing.discountTotal += discounts;
    } else {
      sales.push({
        month,
        location,
        grossSales,
        netSales,
        orders,
        discountTotal: discounts,
        source: 'csv',
      });
    }
  }

  return sales;
}
