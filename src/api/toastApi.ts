/**
 * Client-side Toast API helpers.
 * These call our Vite middleware proxy at /api/toast/* — no credentials in this file.
 */

import type { ToastSales } from '../types';

export interface ToastConnectionStatus {
  connected: boolean;
  locations: string[];
  locationCount: number;
  error?: string;
  /** True when auth succeeds but scopes are wrong */
  authenticated?: boolean;
  /** Current JWT scope string */
  scope?: string;
  /** Scopes that are required but missing from the token */
  missingScopes?: string[];
}

export interface ToastSyncResult {
  sales: ToastSales[];
  errors: Array<{ location: string; month: string; error: string }>;
  syncedAt: string;
}

export interface ToastLocationInfo {
  guid: string;
  name: string;
  rawName: string;
}

/** Check if Toast API credentials are valid and discover locations */
export async function checkToastConnection(): Promise<ToastConnectionStatus> {
  try {
    const res = await fetch('/api/toast/status');
    if (!res.ok) {
      return { connected: false, locations: [], locationCount: 0, error: `HTTP ${res.status}` };
    }
    return await res.json();
  } catch (err) {
    return {
      connected: false,
      locations: [],
      locationCount: 0,
      error: err instanceof Error ? err.message : 'Network error',
    };
  }
}

/** Get detailed location info including GUIDs */
export async function fetchToastLocations(): Promise<ToastLocationInfo[]> {
  const res = await fetch('/api/toast/locations');
  if (!res.ok) throw new Error(`Failed to fetch locations: ${res.status}`);
  return res.json();
}

/** Fetch aggregated sales for a single month (all locations or one) */
export async function fetchToastSales(month: string, location?: string): Promise<ToastSales[]> {
  const params = new URLSearchParams({ month });
  if (location) params.set('location', location);
  const res = await fetch(`/api/toast/sales?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch sales: ${res.status}`);
  return res.json();
}

/** Bulk sync: fetch all locations for multiple months */
export async function syncToastData(months: string[]): Promise<ToastSyncResult> {
  const res = await fetch('/api/toast/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ months }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sync failed (${res.status}): ${text}`);
  }
  return res.json();
}
