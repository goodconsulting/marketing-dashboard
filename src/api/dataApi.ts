/**
 * Client-side fetch wrappers for all /api/data/* endpoints.
 *
 * Every function returns typed data directly (throws on HTTP errors).
 * The base URL is relative — Vite dev server proxies /api/* to the
 * server-side middleware automatically.
 */

import type {
  MonthlyExpense, MetaCampaign, GoogleCampaign,
  GoogleDaily, ToastSales, MonthlyBudget, CRMCustomerRecord,
  MenuIntelligenceItem, IncentivioMetrics, UploadedFile,
  MonthlySnapshot, UploadPreview, ConfirmResult,
} from '../types';

// ─── Helpers ──────────────────────────────────────────────────────

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(
    (pair): pair is [string, string] => pair[1] !== undefined
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries).toString();
}

// ─── Full State Hydration ─────────────────────────────────────────

export interface ServerState {
  snapshots: MonthlySnapshot[];
  expenses: MonthlyExpense[];
  metaCampaigns: MetaCampaign[];
  googleCampaigns: GoogleCampaign[];
  googleDaily: GoogleDaily[];
  toastSales: ToastSales[];
  crmCustomers: CRMCustomerRecord[];
  menuIntelligence: MenuIntelligenceItem[];
  incentivioMetrics: IncentivioMetrics[];
  budgets: MonthlyBudget[];
  uploads: UploadedFile[];
  annualBudget: number;
}

/** Fetch the entire dashboard state in one request (initial hydration). */
export function fetchState(): Promise<ServerState> {
  return fetchJson<ServerState>('/api/data/state');
}

// ─── Snapshots ────────────────────────────────────────────────────

export function fetchSnapshots(from?: string, to?: string): Promise<MonthlySnapshot[]> {
  return fetchJson<MonthlySnapshot[]>('/api/data/snapshots' + qs({ from, to }));
}

// ─── Per-Table Getters ────────────────────────────────────────────

export function fetchExpenses(month?: string): Promise<MonthlyExpense[]> {
  return fetchJson<MonthlyExpense[]>('/api/data/expenses' + qs({ month }));
}

export function fetchMetaCampaigns(month?: string): Promise<MetaCampaign[]> {
  return fetchJson<MetaCampaign[]>('/api/data/meta-campaigns' + qs({ month }));
}

export function fetchGoogleCampaigns(month?: string): Promise<GoogleCampaign[]> {
  return fetchJson<GoogleCampaign[]>('/api/data/google-campaigns' + qs({ month }));
}

export function fetchGoogleDaily(from?: string, to?: string): Promise<GoogleDaily[]> {
  return fetchJson<GoogleDaily[]>('/api/data/google-daily' + qs({ from, to }));
}

export function fetchToastSales(month?: string): Promise<ToastSales[]> {
  return fetchJson<ToastSales[]>('/api/data/toast-sales' + qs({ month }));
}

export function fetchCRMCustomers(month?: string, stage?: string): Promise<CRMCustomerRecord[]> {
  return fetchJson<CRMCustomerRecord[]>('/api/data/crm-customers' + qs({ month, stage }));
}

export function fetchMenuIntelligence(month?: string): Promise<MenuIntelligenceItem[]> {
  return fetchJson<MenuIntelligenceItem[]>('/api/data/menu-intelligence' + qs({ month }));
}

export function fetchIncentivioMetrics(): Promise<IncentivioMetrics[]> {
  return fetchJson<IncentivioMetrics[]>('/api/data/incentivio-metrics');
}

export function fetchBudgets(): Promise<MonthlyBudget[]> {
  return fetchJson<MonthlyBudget[]>('/api/data/budgets');
}

export function fetchUploads(): Promise<UploadedFile[]> {
  return fetchJson<UploadedFile[]>('/api/data/uploads');
}

// ─── Upload Pipeline ──────────────────────────────────────────────

/** Upload a file for preview (stage in memory, no DB write yet). */
export async function uploadFile(file: File, month?: string): Promise<UploadPreview> {
  const buffer = await file.arrayBuffer();
  const params = qs({ filename: file.name, month });
  return fetchJson<UploadPreview>('/api/data/upload' + params, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: buffer,
  });
}

/** Confirm a staged upload — writes to SQLite. */
export function confirmUpload(uploadId: string): Promise<ConfirmResult> {
  return fetchJson<ConfirmResult>('/api/data/upload/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId }),
  });
}

/** Cancel a staged upload — discards from memory. */
export function cancelUpload(uploadId: string): Promise<{ success: boolean }> {
  return fetchJson<{ success: boolean }>('/api/data/upload/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId }),
  });
}

// ─── Direct Data Insert (Toast API sync) ──────────────────────────

/** Push Toast sales data directly (used by the live Toast API sync). */
export function pushToastSales(sales: ToastSales[]): Promise<{ insertedCount: number }> {
  return fetchJson<{ insertedCount: number }>('/api/data/toast-sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sales }),
  });
}

// ─── Settings ─────────────────────────────────────────────────────

export function updateSetting(key: string, value: string | number | boolean): Promise<{ success: boolean }> {
  return fetchJson<{ success: boolean }>(`/api/data/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
}

// ─── Clear All ────────────────────────────────────────────────────

export function clearAllData(): Promise<{ success: boolean }> {
  return fetchJson<{ success: boolean }>('/api/data/all', {
    method: 'DELETE',
  });
}
