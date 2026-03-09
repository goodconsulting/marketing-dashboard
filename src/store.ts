import { useState, useCallback, useEffect } from 'react';
import type {
  DashboardState, MonthlySnapshot, ToastSales,
} from './types';
import {
  fetchState, pushToastSales, updateSetting,
  clearAllData as clearAllServerData,
} from './api/dataApi';
import { useToast } from './components/Toast';

function getInitialState(): DashboardState {
  return {
    expenses: [],
    budgets: [],
    metaCampaigns: [],
    googleCampaigns: [],
    googleDaily: [],
    toastSales: [],
    incentivio: [],
    organic: [],
    thirdParty: [],
    snapshots: [],
    uploadedFiles: [],
    annualBudget: 533000,
    toastDiscrepancies: [],
    crmCustomers: [],
    menuIntelligence: [],
  };
}

export function useDashboardStore() {
  const [state, setState] = useState<DashboardState>(getInitialState);
  const [isLoading, setIsLoading] = useState(true);
  const { addToast } = useToast();

  // ─── Hydrate from server on mount ──────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const data = await fetchState();

      setState(prev => ({
        ...prev,
        expenses: data.expenses,
        budgets: data.budgets,
        metaCampaigns: data.metaCampaigns,
        googleCampaigns: data.googleCampaigns,
        googleDaily: data.googleDaily,
        toastSales: data.toastSales,
        incentivio: data.incentivioMetrics,
        crmCustomers: data.crmCustomers,
        menuIntelligence: data.menuIntelligence,
        uploadedFiles: data.uploads,
        annualBudget: data.annualBudget || 533000,
        snapshots: data.snapshots,
        // Keep local-only fields
        organic: prev.organic,
        thirdParty: prev.thirdParty,
        toastDiscrepancies: prev.toastDiscrepancies,
      }));
    } catch {
      addToast({ type: 'error', message: 'Failed to load data from server' });
    }
  }, [addToast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchState();
        if (!cancelled) {
          setState(prev => ({
            ...prev,
            expenses: data.expenses,
            budgets: data.budgets,
            metaCampaigns: data.metaCampaigns,
            googleCampaigns: data.googleCampaigns,
            googleDaily: data.googleDaily,
            toastSales: data.toastSales,
            incentivio: data.incentivioMetrics,
            crmCustomers: data.crmCustomers,
            menuIntelligence: data.menuIntelligence,
            uploadedFiles: data.uploads,
            annualBudget: data.annualBudget || 533000,
            snapshots: data.snapshots,
            organic: [],
            thirdParty: [],
            toastDiscrepancies: [],
          }));
        }
      } catch {
        if (!cancelled) {
          setState(getInitialState());
          addToast({ type: 'warning', message: 'Could not load data from server — starting fresh' });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [addToast]);

  // ─── Toast API Sync (direct JSON push, bypasses file upload pipeline) ─
  const addToastSales = useCallback(async (sales: ToastSales[]) => {
    if (sales.length === 0) return;
    try {
      await pushToastSales(sales);
      await refresh();
    } catch {
      addToast({ type: 'error', message: 'Failed to save Toast sales data' });
    }
  }, [refresh, addToast]);

  // ─── Settings ──────────────────────────────────────────────────
  const setAnnualBudget = useCallback(async (budget: number) => {
    try {
      await updateSetting('annualBudget', budget);
      setState(prev => ({ ...prev, annualBudget: budget }));
    } catch {
      addToast({ type: 'error', message: 'Failed to save budget setting' });
    }
  }, [addToast]);

  // ─── Clear All Data ────────────────────────────────────────────
  const clearAllData = useCallback(async () => {
    try {
      await clearAllServerData();
      setState(getInitialState());
      addToast({ type: 'success', message: 'All data cleared' });
    } catch {
      addToast({ type: 'error', message: 'Failed to clear data' });
    }
  }, [addToast]);

  // ─── Server-computed snapshots ─────────────────────────────────
  // Snapshots now come directly from the server state (computed via SQL).
  const snapshots: MonthlySnapshot[] = state.snapshots;

  return {
    state,
    isLoading,
    snapshots,
    refresh,
    addToastSales,
    setAnnualBudget,
    clearAllData,
  };
}
