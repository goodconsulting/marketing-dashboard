import { useState, useCallback, useEffect, useMemo } from 'react';
import type {
  DashboardState, MonthlyExpense, MonthlyBudget, IncentivioMetrics,
  MonthlySnapshot, SpendCategory, ToastDiscrepancy,
  CRMCustomerRecord, MenuIntelligenceItem, JourneyStage,
} from './types';
import {
  loadAllData, migrateFromLocalStorage, clearAllStores,
  putExpenses, putBudgets, putMetaCampaigns, putGoogleCampaigns,
  putGoogleDaily, putToastSales, putToastDiscrepancies,
  putIncentivio, putCRMCustomers, putMenuIntelligence,
  putUploadedFile, putSetting,
} from './db';
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

  // ─── Persist helper — catches IDB errors and surfaces via toast ──
  const persist = useCallback((promise: Promise<void>, label: string) => {
    promise.catch(() => {
      addToast({ type: 'error', message: `Failed to save ${label} — data may not persist after refresh` });
    });
  }, [addToast]);

  // ─── Hydrate from IndexedDB on mount ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Try localStorage migration first (one-time upgrade)
        const migrated = await migrateFromLocalStorage();
        if (!cancelled) {
          if (migrated) {
            setState(migrated);
          } else {
            // Normal load from IndexedDB
            const loaded = await loadAllData();
            setState(loaded);
          }
        }
      } catch {
        // If IndexedDB fails, start fresh and warn user
        if (!cancelled) {
          setState(getInitialState());
          addToast({ type: 'warning', message: 'Could not load saved data — starting fresh' });
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [addToast]);

  // ─── Action: Add Expenses ────────────────────────────────────────
  const addExpenses = useCallback((expenses: MonthlyExpense[]) => {
    setState(prev => {
      const existingKeys = new Set(
        prev.expenses.map(e => `${e.date}|${e.vendor}|${e.amount}`)
      );
      const newExpenses = expenses.filter(
        e => !existingKeys.has(`${e.date}|${e.vendor}|${e.amount}`)
      );
      if (newExpenses.length === 0) return prev; // No change — skip re-render
      persist(putExpenses(newExpenses), 'expenses');
      return { ...prev, expenses: [...prev.expenses, ...newExpenses] };
    });
  }, [persist]);

  // ─── Action: Set Annual Budget ───────────────────────────────────
  const setAnnualBudget = useCallback((budget: number) => {
    setState(prev => {
      persist(putSetting('annualBudget', budget), 'budget setting');
      return { ...prev, annualBudget: budget };
    });
  }, [persist]);

  // ─── Action: Add Uploaded File ───────────────────────────────────
  const addUploadedFile = useCallback((file: { filename: string; sourceType: string; recordCount: number; monthCovered: string }) => {
    setState(prev => {
      const entry = {
        id: Math.random().toString(36).substring(2),
        uploadedAt: new Date().toISOString(),
        ...file,
      } as DashboardState['uploadedFiles'][number];
      persist(putUploadedFile(entry), 'upload record');
      return { ...prev, uploadedFiles: [...prev.uploadedFiles, entry] };
    });
  }, [persist]);

  // ─── Action: Add Meta Campaigns ──────────────────────────────────
  const addMetaCampaigns = useCallback((campaigns: DashboardState['metaCampaigns']) => {
    setState(prev => {
      const existingKeys = new Set(
        prev.metaCampaigns.map(c => `${c.month}|${c.campaignName}`)
      );
      const newCampaigns = campaigns.filter(
        c => !existingKeys.has(`${c.month}|${c.campaignName}`)
      );
      if (newCampaigns.length === 0) return prev; // No change — skip re-render
      persist(putMetaCampaigns(newCampaigns), 'Meta campaigns');
      return { ...prev, metaCampaigns: [...prev.metaCampaigns, ...newCampaigns] };
    });
  }, [persist]);

  // ─── Action: Add Google Campaigns ────────────────────────────────
  const addGoogleCampaigns = useCallback((campaigns: DashboardState['googleCampaigns']) => {
    setState(prev => {
      if (campaigns.length === 0) return prev; // No change — skip re-render
      persist(putGoogleCampaigns(campaigns), 'Google campaigns');
      return { ...prev, googleCampaigns: [...prev.googleCampaigns, ...campaigns] };
    });
  }, [persist]);

  // ─── Action: Add Google Daily ────────────────────────────────────
  const addGoogleDaily = useCallback((daily: DashboardState['googleDaily']) => {
    setState(prev => {
      const existingDates = new Set(prev.googleDaily.map(d => d.date));
      const newDaily = daily.filter(d => !existingDates.has(d.date));
      if (newDaily.length === 0) return prev; // No change — skip re-render
      persist(putGoogleDaily(newDaily), 'Google daily data');
      return { ...prev, googleDaily: [...prev.googleDaily, ...newDaily] };
    });
  }, [persist]);

  // ─── Action: Add Toast Sales (source-aware with discrepancy detection) ──
  const addToastSales = useCallback((sales: DashboardState['toastSales'], source: 'api' | 'csv' = 'csv') => {
    if (sales.length === 0) return; // Nothing to add — skip state update entirely
    setState(prev => {
      const tagged = sales.map(s => ({ ...s, source: s.source || source }));
      const newSales = [...prev.toastSales];
      const discrepancies: ToastDiscrepancy[] = [];

      for (const incoming of tagged) {
        const existingIdx = newSales.findIndex(
          s => s.month === incoming.month && s.location === incoming.location
        );

        if (existingIdx >= 0) {
          const existing = newSales[existingIdx];

          // Log discrepancy if sources differ
          if (existing.source && incoming.source && existing.source !== incoming.source) {
            const apiRecord = incoming.source === 'api' ? incoming : existing;
            const csvRecord = incoming.source === 'csv' ? incoming : existing;

            for (const field of ['grossSales', 'netSales', 'orders', 'discountTotal'] as const) {
              const diff = Math.abs(apiRecord[field] - csvRecord[field]);
              const pctDiff = csvRecord[field] > 0
                ? (diff / csvRecord[field]) * 100
                : (diff > 0 ? 100 : 0);
              if (pctDiff > 1) {
                discrepancies.push({
                  month: incoming.month,
                  location: incoming.location,
                  field,
                  apiValue: apiRecord[field],
                  csvValue: csvRecord[field],
                  percentDiff: Math.round(pctDiff * 10) / 10,
                });
              }
            }
          }

          // API always wins; same-source replaces existing
          if (incoming.source === 'api' || existing.source === incoming.source) {
            newSales[existingIdx] = incoming;
          }
        } else {
          newSales.push(incoming);
        }
      }

      const replacePairs = tagged.map(t => ({ month: t.month, location: t.location }));
      const updatedDiscrepancies = [
        ...prev.toastDiscrepancies.filter(d =>
          !tagged.some(t => t.month === d.month && t.location === d.location)
        ),
        ...discrepancies,
      ];

      // Persist to IndexedDB
      persist(putToastSales(newSales), 'Toast sales');
      persist(putToastDiscrepancies(discrepancies, replacePairs), 'Toast discrepancies');

      return {
        ...prev,
        toastSales: newSales,
        toastDiscrepancies: updatedDiscrepancies,
      };
    });
  }, [persist]);

  // ─── Action: Add Incentivio Metrics ──────────────────────────────
  const addIncentivio = useCallback((metrics: IncentivioMetrics) => {
    setState(prev => {
      const existing = prev.incentivio.filter(i => i.month !== metrics.month);
      persist(putIncentivio(metrics), 'Incentivio metrics');
      return { ...prev, incentivio: [...existing, metrics] };
    });
  }, [persist]);

  // ─── Action: Add CRM Customers (replaces by snapshot month) ─────
  const addCRMCustomers = useCallback((customers: CRMCustomerRecord[]) => {
    if (customers.length === 0) return; // Nothing to add — skip state update entirely
    setState(prev => {
      const incomingMonths = new Set(customers.map(c => c.snapshotMonth));
      const kept = prev.crmCustomers.filter(c => !incomingMonths.has(c.snapshotMonth));
      persist(putCRMCustomers(customers, incomingMonths), 'CRM customers');
      return { ...prev, crmCustomers: [...kept, ...customers] };
    });
  }, [persist]);

  // ─── Action: Add Menu Intelligence (full replace) ───────────────
  const addMenuIntelligence = useCallback((items: MenuIntelligenceItem[]) => {
    if (items.length === 0) return; // Nothing to add — skip state update entirely
    setState(prev => {
      persist(putMenuIntelligence(items), 'menu intelligence');
      return { ...prev, menuIntelligence: items };
    });
  }, [persist]);

  // ─── Action: Add Budgets ─────────────────────────────────────────
  const addBudgets = useCallback((budgets: MonthlyBudget[]) => {
    if (budgets.length === 0) return; // Nothing to add — skip state update entirely
    setState(prev => {
      const existingMonths = new Set(budgets.map(b => b.month));
      const kept = prev.budgets.filter(b => !existingMonths.has(b.month));
      const newAnnualBudget = budgets.reduce((sum, b) => sum + b.totalBudget, 0) || prev.annualBudget;
      persist(putBudgets(budgets), 'budgets');
      persist(putSetting('annualBudget', newAnnualBudget), 'budget setting');
      return {
        ...prev,
        budgets: [...kept, ...budgets],
        annualBudget: newAnnualBudget,
      };
    });
  }, [persist]);

  // ─── Action: Clear All Data ──────────────────────────────────────
  const clearAllData = useCallback(() => {
    clearAllStores();
    setState(getInitialState());
  }, []);

  // ─── Derived: Monthly Snapshots (auto-recomputes when data changes) ──
  const snapshots = useMemo((): MonthlySnapshot[] => {
    const months = new Set<string>();
    state.expenses.forEach(e => months.add(e.month));
    state.metaCampaigns.forEach(c => months.add(c.month));
    state.googleCampaigns.forEach(c => { if (c.month) months.add(c.month); });
    state.toastSales.forEach(s => months.add(s.month));
    state.incentivio.forEach(i => months.add(i.month));
    state.budgets.forEach(b => months.add(b.month));

    // Also add months from Google Daily data
    state.googleDaily.forEach(d => {
      const m = d.date.substring(0, 7);
      if (m.match(/^\d{4}-\d{2}$/)) months.add(m);
    });

    const sortedMonths = Array.from(months).sort();

    return sortedMonths.map(month => {
      const monthExpenses = state.expenses.filter(e => e.month === month);
      const monthMeta = state.metaCampaigns.filter(c => c.month === month);
      const monthGoogle = state.googleCampaigns.filter(c => c.month === month);
      const monthToast = state.toastSales.filter(s => s.month === month);

      const spendByCategory: Record<SpendCategory, number> = {
        paid_media: 0, direct_mail_print: 0, ooh: 0, software_fees: 0, labor: 0, other: 0,
      };
      monthExpenses.forEach(e => {
        spendByCategory[e.category] += e.amount;
      });

      const totalSpend = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
      const totalRevenue = monthToast.reduce((sum, s) => sum + s.grossSales, 0);
      const totalOrders = monthToast.reduce((sum, s) => sum + s.orders, 0);

      const revenueByLocation: Record<string, number> = {};
      monthToast.forEach(s => {
        revenueByLocation[s.location] = (revenueByLocation[s.location] || 0) + s.grossSales;
      });

      const metaImpressions = monthMeta.reduce((sum, c) => sum + c.impressions, 0);
      const metaClicks = monthMeta.reduce((sum, c) => sum + (c.clicks || c.results), 0);
      const metaSpend = monthMeta.reduce((sum, c) => sum + c.spend, 0);

      const googleImpressions = monthGoogle.reduce((sum, c) => sum + c.impressions, 0);
      const googleClicks = monthGoogle.reduce((sum, c) => sum + c.clicks, 0);
      const googleSpend = monthGoogle.reduce((sum, c) => sum + c.cost, 0);

      // Use parsed budget if available, otherwise fall back to annual / 12
      const monthBudget = state.budgets.find(b => b.month === month);
      const budgetedSpend = monthBudget?.totalBudget || (state.annualBudget / 12);
      const budgetVariance = budgetedSpend - totalSpend;

      // New customer estimate from Incentivio data
      const monthIncentivio = state.incentivio.find(i => i.month === month);
      const newCustomers = monthIncentivio?.newAccounts || Math.round(totalOrders * 0.15);

      const estimatedCAC = newCustomers > 0 ? totalSpend / newCustomers : 0;
      const avgOrderValue = monthIncentivio?.avgOrderValue || (totalOrders > 0 ? totalRevenue / totalOrders : 0);
      const estimatedLTV = monthIncentivio?.ltv || avgOrderValue * 2.5;
      const estimatedROI = estimatedCAC > 0 ? ((estimatedLTV - estimatedCAC) / estimatedCAC) * 100 : 0;

      // CRM segment counts for this month
      const monthCRM = state.crmCustomers.filter(c => c.snapshotMonth === month);
      const segmentCounts: Record<JourneyStage, number> = {
        WHALE: 0, LOYALIST: 0, REGULAR: 0, ROOKIE: 0, CHURNED: 0, SLIDER: 0, UNKNOWN: 0,
      };
      let attritionHighCount = 0;
      let sumLTV = 0;
      for (const c of monthCRM) {
        segmentCounts[c.journeyStage]++;
        if (c.attritionRisk === 'high') attritionHighCount++;
        sumLTV += c.lifetimeSpend;
      }
      const avgLTV = monthCRM.length > 0 ? sumLTV / monthCRM.length : (monthIncentivio?.ltv || 0);

      return {
        month,
        totalSpend,
        spendByCategory,
        budgetedSpend,
        budgetVariance,
        totalRevenue,
        revenueByLocation,
        totalOrders,
        metaImpressions,
        metaClicks,
        metaSpend,
        googleImpressions,
        googleClicks,
        googleSpend,
        newCustomers,
        estimatedCAC,
        estimatedROI,
        loyaltyAccounts: monthIncentivio?.totalLoyaltyAccounts || monthCRM.length || 0,
        newLoyaltyAccounts: monthIncentivio?.newAccounts || 0,
        avgOrderValue,
        segmentCounts,
        attritionHighCount,
        avgLTV,
      };
    });
  }, [
    state.expenses, state.metaCampaigns, state.googleCampaigns,
    state.googleDaily, state.toastSales, state.incentivio,
    state.budgets, state.crmCustomers, state.annualBudget,
  ]);

  return {
    state,
    isLoading,
    addExpenses,
    addMetaCampaigns,
    addGoogleCampaigns,
    addGoogleDaily,
    addToastSales,
    addIncentivio,
    addCRMCustomers,
    addMenuIntelligence,
    addBudgets,
    addUploadedFile,
    setAnnualBudget,
    clearAllData,
    snapshots,
  };
}
