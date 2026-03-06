/**
 * Generic CSV / JSON export utility for Stack Marketing Dashboard.
 *
 * Handles:
 * - CSV generation with proper RFC 4180 quoting
 * - JSON download
 * - Nested object flattening (spendByCategory, segmentCounts, etc.)
 * - Browser download via Blob + object URL
 */

export type ExportFormat = 'csv' | 'json';

interface ExportOptions {
  filename: string;          // without extension — added automatically
  format: ExportFormat;
  columns?: string[];        // subset of keys to include (all if omitted)
  columnLabels?: Record<string, string>; // rename columns in CSV header
}

// ─── CSV Escaping (RFC 4180) ────────────────────────────────
function escapeCSV(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Wrap in quotes if contains comma, quote, or newline
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ─── Flatten Nested Objects ─────────────────────────────────
// Converts { spendByCategory: { paid_media: 100, ooh: 50 } }
// into { spend_paid_media: 100, spend_ooh: 50 }
function flattenObject(
  obj: Record<string, unknown>,
  prefix = '',
  separator = '_',
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const flatKey = prefix ? `${prefix}${separator}${key}` : key;

    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      Object.assign(flat, flattenObject(value as Record<string, unknown>, flatKey, separator));
    } else {
      flat[flatKey] = value;
    }
  }

  return flat;
}

// ─── CSV Generation ─────────────────────────────────────────
function toCSV(
  data: Record<string, unknown>[],
  columns?: string[],
  columnLabels?: Record<string, string>,
): string {
  if (data.length === 0) return '';

  // Flatten all rows first
  const flatData = data.map(row => flattenObject(row));

  // Determine column order
  const allKeys = columns || [...new Set(flatData.flatMap(row => Object.keys(row)))];

  // Header row
  const headerRow = allKeys.map(key => escapeCSV(columnLabels?.[key] || key));

  // Data rows
  const dataRows = flatData.map(row =>
    allKeys.map(key => escapeCSV(row[key])).join(',')
  );

  return [headerRow.join(','), ...dataRows].join('\n');
}

// ─── Browser Download ───────────────────────────────────────
function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();

  // Clean up
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 100);
}

// ─── Main Export Function ───────────────────────────────────
export function exportData(
  data: Record<string, unknown>[],
  options: ExportOptions,
): void {
  const { filename, format, columns, columnLabels } = options;

  if (format === 'json') {
    const json = JSON.stringify(data, null, 2);
    triggerDownload(json, `${filename}.json`, 'application/json');
  } else {
    const csv = toCSV(data, columns, columnLabels);
    triggerDownload(csv, `${filename}.csv`, 'text/csv;charset=utf-8');
  }
}

// ─── Snapshot Flattener ─────────────────────────────────────
// Convenience wrapper: flattens MonthlySnapshot[] for export
// (expands nested objects like spendByCategory, revenueByLocation, segmentCounts)
export function flattenSnapshots(
  snapshots: Record<string, unknown>[],
): Record<string, unknown>[] {
  return snapshots.map(s => flattenObject(s));
}

// ─── Today's Date String for Filenames ──────────────────────
export function todayString(): string {
  return new Date().toISOString().substring(0, 10);
}
