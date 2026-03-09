/**
 * Vite plugin that mounts the data API middleware at /api/data/*.
 *
 * Mirrors the pattern from viteToastPlugin.ts — intercepts requests
 * before Vite's own middleware so the React dev server and the data
 * API coexist on the same port.
 *
 * Routes:
 *   GET  /api/data/health           → database health info
 *   GET  /api/data/state            → full DashboardState for initial hydration
 *   GET  /api/data/snapshots        → computed MonthlySnapshot[]
 *   GET  /api/data/uploads          → upload log
 *   GET  /api/data/expenses         → expenses (?month=YYYY-MM)
 *   GET  /api/data/meta-campaigns   → Meta campaigns (?month=)
 *   GET  /api/data/google-campaigns → Google campaigns (?month=)
 *   GET  /api/data/google-daily     → Google daily (?from=&to=)
 *   GET  /api/data/toast-sales      → Toast sales (?month=)
 *   GET  /api/data/crm-customers    → CRM records (?month=&stage=)
 *   GET  /api/data/menu-intelligence → Menu items (?month=)
 *   GET  /api/data/budgets          → budgets
 *   POST /api/data/upload           → stage file (raw body, ?filename=&month=)
 *   POST /api/data/upload/confirm   → confirm staged upload { uploadId }
 *   POST /api/data/upload/cancel    → cancel staged upload { uploadId }
 *   PUT  /api/data/settings/:key    → update setting { value }
 *   DELETE /api/data/all            → clear database
 */

import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import {
  initializeDatabase,
  getHealthInfo,
  getUploadLog,
  computeSnapshots,
  getExpenses,
  getMetaCampaigns,
  getGoogleCampaigns,
  getGoogleDaily,
  getToastSales,
  insertToastSales,
  getCRMCustomers,
  getLatestCRMCustomers,
  getMenuIntelligence,
  getIncentivioMetrics,
  getBudgets,
  getSetting,
  setSetting,
  clearAllData,
} from './db/queries.ts';
import { stageUpload, confirmUpload, cancelUpload } from './api/uploadPipeline.ts';

// ─── Helpers ─────────────────────────────────────────────────────

/** Collect raw body as Buffer (supports both text CSV and binary XLSX). */
function parseRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Parse JSON body from an incoming request. */
function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) { resolve(null); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

/** Send a JSON response with the given status code. */
function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** Extract query parameters from URL. */
function getQuery(url: string): URLSearchParams {
  const qIdx = url.indexOf('?');
  return new URLSearchParams(qIdx >= 0 ? url.substring(qIdx + 1) : '');
}

// ─── Route Handler ───────────────────────────────────────────────

async function handleDataRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '';
  const method = req.method ?? 'GET';
  const path = url.split('?')[0];
  const query = getQuery(url);

  // ══════════════════════════════════════════════════════════════════
  // GET endpoints
  // ══════════════════════════════════════════════════════════════════

  if (method === 'GET') {

    // ── Health ────────────────────────────────────────────────────
    if (path === '/api/data/health') {
      json(res, 200, getHealthInfo());
      return;
    }

    // ── Upload log ───────────────────────────────────────────────
    if (path === '/api/data/uploads') {
      json(res, 200, getUploadLog());
      return;
    }

    // ── Snapshots ────────────────────────────────────────────────
    if (path === '/api/data/snapshots') {
      json(res, 200, computeSnapshots());
      return;
    }

    // ── Full state (initial hydration) ───────────────────────────
    if (path === '/api/data/state') {
      const snapshots = computeSnapshots();
      const expenses = getExpenses();
      const metaCampaigns = getMetaCampaigns();
      const googleCampaigns = getGoogleCampaigns();
      const googleDaily = getGoogleDaily();
      const toastSales = getToastSales();
      const crmCustomers = getLatestCRMCustomers();
      const menuIntelligence = getMenuIntelligence();
      const incentivioMetrics = getIncentivioMetrics();
      const budgets = getBudgets();
      const uploads = getUploadLog();
      const annualBudget = parseFloat(getSetting('annualBudget') || '533000');

      json(res, 200, {
        snapshots,
        expenses,
        metaCampaigns,
        googleCampaigns,
        googleDaily,
        toastSales,
        crmCustomers,
        menuIntelligence,
        incentivioMetrics,
        budgets,
        uploads,
        annualBudget,
      });
      return;
    }

    // ── Expenses ─────────────────────────────────────────────────
    if (path === '/api/data/expenses') {
      json(res, 200, getExpenses(query.get('month') || undefined));
      return;
    }

    // ── Meta campaigns ───────────────────────────────────────────
    if (path === '/api/data/meta-campaigns') {
      json(res, 200, getMetaCampaigns(query.get('month') || undefined));
      return;
    }

    // ── Google campaigns ─────────────────────────────────────────
    if (path === '/api/data/google-campaigns') {
      json(res, 200, getGoogleCampaigns(query.get('month') || undefined));
      return;
    }

    // ── Google daily ─────────────────────────────────────────────
    if (path === '/api/data/google-daily') {
      json(res, 200, getGoogleDaily(
        query.get('from') || undefined,
        query.get('to') || undefined,
      ));
      return;
    }

    // ── Toast sales ──────────────────────────────────────────────
    if (path === '/api/data/toast-sales') {
      json(res, 200, getToastSales(query.get('month') || undefined));
      return;
    }

    // ── CRM customers ────────────────────────────────────────────
    if (path === '/api/data/crm-customers') {
      json(res, 200, getCRMCustomers(
        query.get('month') || undefined,
        query.get('stage') || undefined,
      ));
      return;
    }

    // ── Menu intelligence ────────────────────────────────────────
    if (path === '/api/data/menu-intelligence') {
      json(res, 200, getMenuIntelligence(query.get('month') || undefined));
      return;
    }

    // ── Incentivio metrics ───────────────────────────────────────
    if (path === '/api/data/incentivio-metrics') {
      json(res, 200, getIncentivioMetrics());
      return;
    }

    // ── Budgets ──────────────────────────────────────────────────
    if (path === '/api/data/budgets') {
      json(res, 200, getBudgets());
      return;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // POST endpoints
  // ══════════════════════════════════════════════════════════════════

  if (method === 'POST') {

    // ── Upload preview (stage file) ──────────────────────────────
    if (path === '/api/data/upload') {
      const filename = query.get('filename') || 'upload.csv';
      const monthHint = query.get('month') || undefined;
      const body = await parseRawBody(req);

      if (body.length === 0) {
        json(res, 400, { error: 'Empty file body' });
        return;
      }

      try {
        const preview = stageUpload(body, filename, monthHint);
        console.log(`[Data API] Staged upload: ${filename} → ${preview.detectedSource} (${preview.recordCount} records)`);
        json(res, 200, preview);
      } catch (err) {
        console.error('[Data API] Upload parse error:', err);
        json(res, 422, { error: `Failed to parse file: ${(err as Error).message}` });
      }
      return;
    }

    // ── Confirm staged upload ────────────────────────────────────
    if (path === '/api/data/upload/confirm') {
      const body = await parseJsonBody(req) as { uploadId?: string } | null;
      const uploadId = body?.uploadId;

      if (!uploadId) {
        json(res, 400, { error: 'Missing uploadId' });
        return;
      }

      try {
        const result = confirmUpload(uploadId);
        console.log(`[Data API] Confirmed upload ${uploadId}: ${result.insertedCount} records → ${result.source}`);
        json(res, 200, result);
      } catch (err) {
        json(res, 404, { error: (err as Error).message });
      }
      return;
    }

    // ── Cancel staged upload ─────────────────────────────────────
    if (path === '/api/data/upload/cancel') {
      const body = await parseJsonBody(req) as { uploadId?: string } | null;
      const uploadId = body?.uploadId;

      if (!uploadId) {
        json(res, 400, { error: 'Missing uploadId' });
        return;
      }

      cancelUpload(uploadId);
      json(res, 200, { success: true });
      return;
    }

    // ── Direct Toast sales insert (from live API sync) ────────────
    if (path === '/api/data/toast-sales') {
      const body = await parseJsonBody(req) as { sales?: unknown[] } | null;
      const sales = body?.sales;

      if (!Array.isArray(sales) || sales.length === 0) {
        json(res, 400, { error: 'Missing or empty sales array' });
        return;
      }

      try {
        const insertedCount = insertToastSales(sales as import('./types.ts').ToastSales[]);
        console.log(`[Data API] Toast direct insert: ${insertedCount} records`);
        json(res, 200, { insertedCount });
      } catch (err) {
        json(res, 422, { error: `Failed to insert Toast sales: ${(err as Error).message}` });
      }
      return;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // PUT endpoints
  // ══════════════════════════════════════════════════════════════════

  if (method === 'PUT') {
    // ── Update setting ───────────────────────────────────────────
    const settingsMatch = path.match(/^\/api\/data\/settings\/(.+)$/);
    if (settingsMatch) {
      const key = decodeURIComponent(settingsMatch[1]);
      const body = await parseJsonBody(req) as { value?: unknown } | null;

      if (body?.value === undefined || body?.value === null) {
        json(res, 400, { error: 'Missing value' });
        return;
      }

      setSetting(key, String(body.value));
      json(res, 200, { success: true, key, value: body.value });
      return;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // DELETE endpoints
  // ══════════════════════════════════════════════════════════════════

  if (method === 'DELETE') {
    if (path === '/api/data/all') {
      clearAllData();
      console.log('[Data API] All data cleared');
      json(res, 200, { success: true });
      return;
    }
  }

  // ── 404 ────────────────────────────────────────────────────────
  json(res, 404, { error: `Unknown data API route: ${method} ${path}` });
}

// ═══════════════════════════════════════════════════════════════════
// Vite Plugin
// ═══════════════════════════════════════════════════════════════════

export function dataApiPlugin(): Plugin {
  return {
    name: 'data-api',

    configureServer(server) {
      // Initialize SQLite schema on server start
      initializeDatabase();
      console.log('[Data API] SQLite initialized — database ready');

      // Mount middleware before Vite's internal middleware
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/api/data')) {
          try {
            await handleDataRequest(req, res);
          } catch (err) {
            console.error('[Data API] Unhandled error:', err);
            json(res, 500, { error: 'Internal server error' });
          }
        } else {
          next();
        }
      });

      console.log('[Data API] Routes mounted at /api/data/*');
    },
  };
}
