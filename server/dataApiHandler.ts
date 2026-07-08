/**
 * Runtime-agnostic data API handler.
 *
 * Used by:
 *   - server/viteDataPlugin.ts   (development, via Vite middleware)
 *   - server/production.ts       (production, via Express — coming in Task 3)
 *
 * Takes a Node IncomingMessage + ServerResponse and routes all
 * /api/data/* requests. No Vite-specific dependencies.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  getHealthInfo,
  getUploadLog,
  computeSnapshots,
  getExpenses,
  getMetaCampaigns,
  getMetaAdSets,
  getGoogleCampaigns,
  getGoogleDaily,
  getToastSales,
  insertToastSales,
  getCRMCustomers,
  getLatestCRMCustomers,
  getMenuIntelligence,
  getIncentivioMetrics,
  getBudgets,
  getAnnualBudgetForYear,
  getOneLinkDaily,
  getDiscountSummary,
  getAmpCampaigns,
  getBillboardMonthly,
  getSocialMonthly,
  getMonthStatus,
  getOtherCampaigns,
  getStageTransitions,
  getStageTransitionMatrix,
  getStageStats,
  setSetting,
  clearAllData,
} from './db/queries.ts';
import { stageUpload, confirmUpload, cancelUpload } from './api/uploadPipeline.ts';

// ─── Helpers ─────────────────────────────────────────────────────

/** Collect raw body as Buffer (supports both text CSV and binary XLSX). */
export function parseRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Parse JSON body from an incoming request. */
export function parseJsonBody(req: IncomingMessage): Promise<unknown> {
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
export function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** Extract query parameters from URL. */
export function getQuery(url: string): URLSearchParams {
  const qIdx = url.indexOf('?');
  return new URLSearchParams(qIdx >= 0 ? url.substring(qIdx + 1) : '');
}

// ─── Route Handler ───────────────────────────────────────────────

/**
 * Main request handler. Returns true if the request was handled (matched a
 * known /api/data/* route), false otherwise. Callers should fall through
 * to next middleware when false.
 */
export async function handleDataRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url ?? '';
  const method = req.method ?? 'GET';
  const path = url.split('?')[0];
  const query = getQuery(url);

  // Fall through if this isn't a data API request at all
  if (!path.startsWith('/api/data')) return false;

  // ══════════════════════════════════════════════════════════════════
  // GET endpoints
  // ══════════════════════════════════════════════════════════════════

  if (method === 'GET') {

    // ── Health ────────────────────────────────────────────────────
    if (path === '/api/data/health') {
      json(res, 200, getHealthInfo());
      return true;
    }

    // ── Upload log ───────────────────────────────────────────────
    if (path === '/api/data/uploads') {
      json(res, 200, getUploadLog());
      return true;
    }

    // ── Snapshots ────────────────────────────────────────────────
    if (path === '/api/data/snapshots') {
      json(res, 200, computeSnapshots());
      return true;
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
      const allCrmCustomers = getLatestCRMCustomers(undefined, false);
      const menuIntelligence = getMenuIntelligence();
      const incentivioMetrics = getIncentivioMetrics();
      const budgets = getBudgets();
      const onelinkData = getOneLinkDaily();
      const discountSummary = getDiscountSummary();
      const ampCampaigns = getAmpCampaigns();
      const billboardData = getBillboardMonthly();
      const otherCampaigns = getOtherCampaigns();
      const socialMonthly = getSocialMonthly();
      const stageTransitions = getStageTransitions(5000);
      const uploads = getUploadLog();
      const currentYear = new Date().getFullYear().toString();
      const annualBudget = getAnnualBudgetForYear(currentYear);

      json(res, 200, {
        snapshots,
        expenses,
        metaCampaigns,
        googleCampaigns,
        googleDaily,
        toastSales,
        crmCustomers,
        allCrmCustomers,
        menuIntelligence,
        incentivioMetrics,
        budgets,
        onelinkData,
        discountSummary,
        ampCampaigns,
        billboardData,
        otherCampaigns,
        socialMonthly,
        stageTransitions,
        uploads,
        annualBudget,
      });
      return true;
    }

    // ── Expenses ─────────────────────────────────────────────────
    if (path === '/api/data/expenses') {
      json(res, 200, getExpenses(query.get('month') || undefined));
      return true;
    }

    // ── Meta campaigns ───────────────────────────────────────────
    if (path === '/api/data/meta-campaigns') {
      json(res, 200, getMetaCampaigns(query.get('month') || undefined));
      return true;
    }

    // ── Meta ad sets ────────────────────────────────────────────
    if (path === '/api/data/meta-ad-sets') {
      json(res, 200, getMetaAdSets(
        query.get('month') || undefined,
        query.get('campaign') || undefined,
      ));
      return true;
    }

    // ── Google campaigns ─────────────────────────────────────────
    if (path === '/api/data/google-campaigns') {
      json(res, 200, getGoogleCampaigns(query.get('month') || undefined));
      return true;
    }

    // ── Google daily ─────────────────────────────────────────────
    if (path === '/api/data/google-daily') {
      json(res, 200, getGoogleDaily(
        query.get('from') || undefined,
        query.get('to') || undefined,
      ));
      return true;
    }

    // ── Toast sales ──────────────────────────────────────────────
    if (path === '/api/data/toast-sales') {
      json(res, 200, getToastSales(query.get('month') || undefined));
      return true;
    }

    // ── CRM customers ────────────────────────────────────────────
    if (path === '/api/data/crm-customers') {
      json(res, 200, getCRMCustomers(
        query.get('month') || undefined,
        query.get('stage') || undefined,
      ));
      return true;
    }

    // ── Menu intelligence ────────────────────────────────────────
    if (path === '/api/data/menu-intelligence') {
      json(res, 200, getMenuIntelligence(query.get('month') || undefined));
      return true;
    }

    // ── Incentivio metrics ───────────────────────────────────────
    if (path === '/api/data/incentivio-metrics') {
      json(res, 200, getIncentivioMetrics());
      return true;
    }

    // ── OneLink QR tracking ─────────────────────────────────────
    if (path === '/api/data/onelink') {
      json(res, 200, getOneLinkDaily(query.get('month') || undefined));
      return true;
    }

    // ── AMP Campaigns ─────────────────────────────────────────────
    if (path === '/api/data/amp-campaigns') {
      json(res, 200, getAmpCampaigns(query.get('month') || undefined));
      return true;
    }

    // ── Billboard ────────────────────────────────────────────────
    if (path === '/api/data/billboard') {
      json(res, 200, getBillboardMonthly(query.get('month') || undefined));
      return true;
    }

    // ── Social monthly KPIs (Hello Digital) ──────────────────────
    if (path === '/api/data/social') {
      json(res, 200, getSocialMonthly(query.get('month') || undefined));
      return true;
    }

    // ── Month close status (scorecard) ───────────────────────────
    // ?month=YYYY-MM for one month; ?year=YYYY for all 12 (Data Health grid).
    if (path === '/api/data/month-status') {
      const year = query.get('year');
      if (year && /^\d{4}$/.test(year)) {
        const statuses = Array.from({ length: 12 }, (_, i) =>
          getMonthStatus(`${year}-${String(i + 1).padStart(2, '0')}`));
        json(res, 200, statuses);
        return true;
      }
      let month = query.get('month');
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        const now = new Date();
        const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        month = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
      }
      json(res, 200, getMonthStatus(month));
      return true;
    }

    // ── Other Campaigns (Yelp, TikTok, etc.) ─────────────────────
    if (path === '/api/data/other-campaigns') {
      json(res, 200, getOtherCampaigns(query.get('month') || undefined));
      return true;
    }

    // ── Stage Transitions ────────────────────────────────────────
    if (path === '/api/data/stage-transitions') {
      const limit = parseInt(query.get('limit') || '5000', 10);
      json(res, 200, getStageTransitions(limit));
      return true;
    }

    if (path === '/api/data/stage-transition-matrix') {
      json(res, 200, getStageTransitionMatrix());
      return true;
    }

    if (path === '/api/data/stage-stats') {
      json(res, 200, getStageStats());
      return true;
    }

    // ── Budgets ──────────────────────────────────────────────────
    if (path === '/api/data/budgets') {
      json(res, 200, getBudgets());
      return true;
    }

    // ── Discount Summary ─────────────────────────────────────────
    if (path === '/api/data/discount-summary') {
      json(res, 200, getDiscountSummary(query.get('period') || undefined));
      return true;
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
      const sourceOverride = query.get('source') || undefined;
      const body = await parseRawBody(req);

      if (body.length === 0) {
        json(res, 400, { error: 'Empty file body' });
        return true;
      }

      try {
        const preview = await stageUpload(body, filename, monthHint, sourceOverride);
        console.log(`[Data API] Staged upload: ${filename} → ${preview.detectedSource} (${preview.recordCount} records)`);
        json(res, 200, preview);
      } catch (err) {
        console.error('[Data API] Upload parse error:', err);
        json(res, 422, { error: `Failed to parse file: ${(err as Error).message}` });
      }
      return true;
    }

    // ── Confirm staged upload ────────────────────────────────────
    if (path === '/api/data/upload/confirm') {
      const body = await parseJsonBody(req) as { uploadId?: string } | null;
      const uploadId = body?.uploadId;

      if (!uploadId) {
        json(res, 400, { error: 'Missing uploadId' });
        return true;
      }

      try {
        const result = confirmUpload(uploadId);
        console.log(`[Data API] Confirmed upload ${uploadId}: ${result.insertedCount} records → ${result.source}`);
        json(res, 200, result);
      } catch (err) {
        json(res, 404, { error: (err as Error).message });
      }
      return true;
    }

    // ── Cancel staged upload ─────────────────────────────────────
    if (path === '/api/data/upload/cancel') {
      const body = await parseJsonBody(req) as { uploadId?: string } | null;
      const uploadId = body?.uploadId;

      if (!uploadId) {
        json(res, 400, { error: 'Missing uploadId' });
        return true;
      }

      cancelUpload(uploadId);
      json(res, 200, { success: true });
      return true;
    }

    // ── Direct Toast sales insert (from live API sync) ────────────
    if (path === '/api/data/toast-sales') {
      const body = await parseJsonBody(req) as { sales?: unknown[] } | null;
      const sales = body?.sales;

      if (!Array.isArray(sales) || sales.length === 0) {
        json(res, 400, { error: 'Missing or empty sales array' });
        return true;
      }

      try {
        const insertedCount = insertToastSales(sales as import('./types.ts').ToastSales[]);
        console.log(`[Data API] Toast direct insert: ${insertedCount} records`);
        json(res, 200, { insertedCount });
      } catch (err) {
        json(res, 422, { error: `Failed to insert Toast sales: ${(err as Error).message}` });
      }
      return true;
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
        return true;
      }

      setSetting(key, String(body.value));
      json(res, 200, { success: true, key, value: body.value });
      return true;
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
      return true;
    }
  }

  // ── 404 ────────────────────────────────────────────────────────
  json(res, 404, { error: `Unknown data API route: ${method} ${path}` });
  return true;
}
