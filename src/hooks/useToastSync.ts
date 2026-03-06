/**
 * React hook encapsulating the Toast API sync lifecycle.
 * Manages connection checking, sync progress, and state transitions.
 */

import { useState, useCallback } from 'react';
import { checkToastConnection, syncToastData } from '../api/toastApi';
import type { ToastSales } from '../types';
import type { ToastSyncResult } from '../api/toastApi';

export type ToastConnectionStatus = 'unknown' | 'checking' | 'connected' | 'disconnected' | 'error';

export interface ToastSyncState {
  connectionStatus: ToastConnectionStatus;
  locations: string[];
  isSyncing: boolean;
  syncProgress: string;
  lastSyncedAt: string | null;
  lastSyncResult: ToastSyncResult | null;
  error: string | null;
}

const LAST_SYNCED_KEY = 'toast_last_synced';

function loadLastSynced(): string | null {
  try {
    return localStorage.getItem(LAST_SYNCED_KEY);
  } catch {
    return null;
  }
}

export function useToastSync(
  onSalesReceived: (sales: ToastSales[], source: 'api') => void,
) {
  const [syncState, setSyncState] = useState<ToastSyncState>({
    connectionStatus: 'unknown',
    locations: [],
    isSyncing: false,
    syncProgress: '',
    lastSyncedAt: loadLastSynced(),
    lastSyncResult: null,
    error: null,
  });

  const checkConnection = useCallback(async () => {
    setSyncState(prev => ({ ...prev, connectionStatus: 'checking', error: null }));
    try {
      const status = await checkToastConnection();
      setSyncState(prev => ({
        ...prev,
        connectionStatus: status.connected ? 'connected' : 'disconnected',
        locations: status.locations,
        error: status.error || null,
      }));
      return status.connected;
    } catch (err) {
      setSyncState(prev => ({
        ...prev,
        connectionStatus: 'error',
        error: err instanceof Error ? err.message : 'Connection check failed',
      }));
      return false;
    }
  }, []);

  const sync = useCallback(async (months: string[]) => {
    setSyncState(prev => ({
      ...prev,
      isSyncing: true,
      syncProgress: `Syncing ${months.length} month(s) across all locations...`,
      error: null,
    }));

    try {
      const result = await syncToastData(months);

      // Send all sales to the store (tagged as 'api' source)
      if (result.sales.length > 0) {
        onSalesReceived(result.sales, 'api');
      }

      const now = new Date().toISOString();
      try { localStorage.setItem(LAST_SYNCED_KEY, now); } catch { /* noop */ }

      setSyncState(prev => ({
        ...prev,
        isSyncing: false,
        syncProgress: '',
        lastSyncedAt: now,
        lastSyncResult: result,
        error: result.errors.length > 0
          ? `Synced with ${result.errors.length} error(s): ${result.errors.map(e => `${e.location} ${e.month}`).join(', ')}`
          : null,
      }));

      return result;
    } catch (err) {
      setSyncState(prev => ({
        ...prev,
        isSyncing: false,
        syncProgress: '',
        error: err instanceof Error ? err.message : 'Sync failed',
      }));
      throw err;
    }
  }, [onSalesReceived]);

  return { syncState, checkConnection, sync };
}
