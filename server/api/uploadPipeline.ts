/**
 * Upload pipeline — preview / confirm / cancel flow.
 *
 * Lifecycle:
 *   1. Client sends file body → POST /api/data/upload?filename=X&month=YYYY-MM
 *   2. Server detects source, parses, runs dedup analysis, stages in memory.
 *   3. Returns UploadPreview (uploadId, source, month, records, dedup warnings).
 *   4. Client shows preview card → Confirm or Cancel.
 *   5. Confirm  → POST /api/data/upload/confirm  { uploadId }
 *      Cancel   → POST /api/data/upload/cancel   { uploadId }
 *   6. Confirm writes to SQLite in a single transaction.
 *
 * In-memory staging auto-expires after 30 minutes.
 */

import { randomBytes } from 'crypto';
import {
  detectSourceType,
  parseCRM,
  parseMenuIntelligence,
  parseExpensesCSV,
  parseExpensesXLSX,
  parseMetaCampaigns,
  parseGoogleCampaigns,
  parseGoogleDaily,
  parseToastCSV,
  parseBudgetXLSX,
} from '../parsers/index.ts';
import {
  insertExpenses,
  insertMetaCampaigns,
  insertGoogleCampaigns,
  insertGoogleDaily,
  insertToastSales,
  insertCRMSnapshot,
  insertMenuSnapshot,
  insertIncentivioMetrics,
  insertBudgets,
  createUploadEntry,
  analyzeExpenseDedup,
  analyzeCRMDedup,
  analyzeMenuDedup,
  analyzeMetaDedup,
  analyzeGoogleDedup,
} from '../db/queries.ts';
import type { DataSourceType } from '../types.ts';
import type { DedupAnalysis } from '../db/queries.ts';

// ─── Types ────────────────────────────────────────────────────────

export interface UploadPreview {
  uploadId: string;
  detectedSource: DataSourceType;
  detectedMonth: string;
  recordCount: number;
  sampleRows: unknown[];
  dedup: DedupAnalysis | null;
  filename: string;
}

interface StagedUpload {
  preview: UploadPreview;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parsedData: any;
  expiresAt: number;
}

// ─── In-memory staging ────────────────────────────────────────────

const staged = new Map<string, StagedUpload>();
const STAGE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Evict expired staged uploads. Called on each new stage operation. */
function evictExpired(): void {
  const now = Date.now();
  for (const [id, entry] of staged) {
    if (entry.expiresAt < now) staged.delete(id);
  }
}

// ─── Month detection from filename ────────────────────────────────

/**
 * Try to extract YYYY-MM from a filename like "report_2026-02.csv".
 * Returns empty string if no month pattern found.
 */
function extractMonthFromFilename(filename: string): string {
  // YYYY-MM pattern
  const m1 = filename.match(/(\d{4})-(\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}`;

  // Month name + year: "Feb 2026", "February_2026"
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  const m2 = filename.match(/(\w{3,9})[_\s-]*(\d{4})/i);
  if (m2) {
    const mon = months[m2[1].substring(0, 3).toLowerCase()];
    if (mon) return `${m2[2]}-${mon}`;
  }

  return '';
}

// ─── Stage an upload (parse + dedup) ──────────────────────────────

export function stageUpload(
  fileBuffer: Buffer,
  filename: string,
  monthHint?: string,
): UploadPreview {
  evictExpired();

  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const isXlsx = ext === 'xlsx' || ext === 'xls';
  const content = isXlsx ? '' : fileBuffer.toString('utf-8');

  // 1. Detect source type
  const source = detectSourceType(filename, content || undefined);

  // 2. Derive month
  const detectedMonth = monthHint || extractMonthFromFilename(filename) || '';

  // 3. Parse + analyze dedup
  const uploadId = randomBytes(8).toString('hex');
  let recordCount = 0;
  let sampleRows: unknown[] = [];
  let dedup: DedupAnalysis | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsedData: any = null;

  switch (source) {
    // ── Expenses ──
    case 'expenses': {
      const records = isXlsx
        ? parseExpensesXLSX(fileBuffer, filename)
        : parseExpensesCSV(content, filename);
      recordCount = records.length;
      sampleRows = records.slice(0, 5);
      dedup = analyzeExpenseDedup(records);
      parsedData = { type: 'expenses', records };
      break;
    }

    // ── Meta campaigns ──
    case 'meta': {
      const records = parseMetaCampaigns(content);
      // Backfill empty months from filename/hint detection
      if (detectedMonth) {
        for (const r of records) {
          if (!r.month || !r.month.match(/^\d{4}-\d{2}$/)) r.month = detectedMonth;
        }
      }
      recordCount = records.length;
      sampleRows = records.slice(0, 5);
      dedup = analyzeMetaDedup(records);
      parsedData = { type: 'meta', records };
      break;
    }

    // ── Google Ads ──
    case 'google': {
      // Determine if this is a daily time-series or campaign-level CSV
      const lowerFilename = filename.toLowerCase();
      const isDaily = lowerFilename.includes('time_series') || lowerFilename.includes('daily');

      if (isDaily) {
        const records = parseGoogleDaily(content);
        recordCount = records.length;
        sampleRows = records.slice(0, 5);
        dedup = null; // daily uses INSERT OR REPLACE
        parsedData = { type: 'google_daily', records };
      } else {
        // Google campaign CSVs never contain date columns —
        // month comes from filename or user-supplied hint
        const month = detectedMonth || '';
        const records = parseGoogleCampaigns(content);
        // Pre-assign month to records so they're ready for insert
        for (const r of records) { r.month = month; }
        recordCount = records.length;
        sampleRows = records.slice(0, 5);
        dedup = month ? analyzeGoogleDedup(records, month) : null;
        parsedData = { type: 'google_campaigns', records, month };
      }
      break;
    }

    // ── Toast POS ──
    case 'toast': {
      const records = parseToastCSV(content);
      recordCount = records.length;
      sampleRows = records.slice(0, 5);
      dedup = null; // uses INSERT OR REPLACE
      parsedData = { type: 'toast', records };
      break;
    }

    // ── Incentivio CRM ──
    case 'incentivio':
    case 'incentivio_crm': {
      const result = parseCRM(content);
      const month = detectedMonth || new Date().toISOString().substring(0, 7);
      recordCount = result.customers.length;
      sampleRows = result.customers.slice(0, 5).map(c => ({
        name: `${c.firstName} ${c.lastName}`,
        stage: c.journeyStage,
        lifetimeSpend: c.lifetimeSpend,
        lastVisit: c.lastVisitDate,
      }));
      dedup = analyzeCRMDedup(month, recordCount);
      parsedData = { type: 'crm', result, month };
      break;
    }

    // ── Menu Intelligence ──
    case 'incentivio_menu': {
      const items = parseMenuIntelligence(content);
      const month = detectedMonth || new Date().toISOString().substring(0, 7);
      recordCount = items.length;
      sampleRows = items.slice(0, 5).map(i => ({
        name: i.name,
        score: i.score,
        quadrant: i.menuQuadrant,
        revenue: i.revenueLastYear,
      }));
      dedup = analyzeMenuDedup(month, recordCount);
      parsedData = { type: 'menu', items, month };
      break;
    }

    // ── Budget ──
    case 'budget': {
      const records = parseBudgetXLSX(fileBuffer);
      recordCount = records.length;
      sampleRows = records.slice(0, 5);
      dedup = null; // uses INSERT OR REPLACE
      parsedData = { type: 'budget', records };
      break;
    }

    // ── Organic / 3PO (not yet supported, just preview) ──
    default: {
      recordCount = 0;
      parsedData = { type: 'unsupported' };
      break;
    }
  }

  const preview: UploadPreview = {
    uploadId,
    detectedSource: source,
    detectedMonth,
    recordCount,
    sampleRows,
    dedup,
    filename,
  };

  // Stage for later confirmation
  staged.set(uploadId, {
    preview,
    parsedData,
    expiresAt: Date.now() + STAGE_TTL_MS,
  });

  return preview;
}

// ─── Confirm a staged upload ──────────────────────────────────────

export interface ConfirmResult {
  success: boolean;
  recordCount: number;
  insertedCount: number;
  source: DataSourceType;
  month: string;
}

export function confirmUpload(uploadId: string): ConfirmResult {
  const entry = staged.get(uploadId);
  if (!entry) {
    throw new Error(`Upload ${uploadId} not found or expired. Please re-upload.`);
  }

  const { preview, parsedData } = entry;
  let insertedCount = 0;

  switch (parsedData.type) {
    case 'expenses':
      insertedCount = insertExpenses(parsedData.records);
      break;

    case 'meta':
      insertedCount = insertMetaCampaigns(parsedData.records);
      break;

    case 'google_campaigns':
      insertedCount = insertGoogleCampaigns(parsedData.records, parsedData.month);
      break;

    case 'google_daily':
      insertedCount = insertGoogleDaily(parsedData.records);
      break;

    case 'toast':
      insertedCount = insertToastSales(parsedData.records);
      break;

    case 'crm': {
      const { result, month } = parsedData;
      insertedCount = insertCRMSnapshot(result.customers, month);
      // Also insert aggregate metrics
      insertIncentivioMetrics(result.metrics);
      break;
    }

    case 'menu': {
      const { items, month } = parsedData;
      insertedCount = insertMenuSnapshot(items, month);
      break;
    }

    case 'budget':
      insertedCount = insertBudgets(parsedData.records);
      break;

    default:
      throw new Error(`Unsupported source type: ${parsedData.type}`);
  }

  // Log to upload_log
  createUploadEntry(
    uploadId,
    preview.filename,
    preview.detectedSource,
    insertedCount,
    preview.detectedMonth || null,
    preview.dedup ? JSON.stringify(preview.dedup) : undefined,
  );

  // Remove from staging
  staged.delete(uploadId);

  return {
    success: true,
    recordCount: preview.recordCount,
    insertedCount,
    source: preview.detectedSource,
    month: preview.detectedMonth,
  };
}

// ─── Cancel a staged upload ───────────────────────────────────────

export function cancelUpload(uploadId: string): boolean {
  return staged.delete(uploadId);
}
