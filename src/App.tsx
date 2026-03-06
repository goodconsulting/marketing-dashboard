import { useState, useCallback, lazy, Suspense } from 'react';
import { Header } from './components/Header';
import { FileUpload } from './components/FileUpload';
import { useDashboardStore } from './store';
import { useToastSync } from './hooks/useToastSync';
import type { ToastSales } from './types';

// ─── Lazy-loaded view components (code-split per tab) ───────────────
const OverviewView = lazy(() =>
  import('./components/OverviewView').then(m => ({ default: m.OverviewView }))
);
const SpendView = lazy(() =>
  import('./components/SpendView').then(m => ({ default: m.SpendView }))
);
const PerformanceView = lazy(() =>
  import('./components/PerformanceView').then(m => ({ default: m.PerformanceView }))
);
const AttributionView = lazy(() =>
  import('./components/AttributionView').then(m => ({ default: m.AttributionView }))
);
const CustomerHealthView = lazy(() =>
  import('./components/CustomerHealthView').then(m => ({ default: m.CustomerHealthView }))
);
const MenuIntelligenceView = lazy(() =>
  import('./components/MenuIntelligenceView').then(m => ({ default: m.MenuIntelligenceView }))
);
const LocationComparatorView = lazy(() =>
  import('./components/LocationComparatorView').then(m => ({ default: m.LocationComparatorView }))
);
const ReportView = lazy(() =>
  import('./components/ReportView').then(m => ({ default: m.ReportView }))
);
const SettingsView = lazy(() =>
  import('./components/SettingsView').then(m => ({ default: m.SettingsView }))
);

// ─── Tab loading spinner ────────────────────────────────────────────
function TabSpinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="animate-spin h-6 w-6 border-2 border-gray-300 border-t-[#2D5A3D] rounded-full" />
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const store = useDashboardStore();

  // Snapshots are now pre-computed via useMemo inside the store hook
  const { snapshots } = store;

  // Toast POS sync hook — wired to store's source-aware addToastSales
  const handleToastSales = useCallback(
    (sales: ToastSales[], source: 'api') => store.addToastSales(sales, source),
    [store.addToastSales],
  );
  const { syncState: toastSyncState, checkConnection: checkToastConnection, sync: toastSync } =
    useToastSync(handleToastSales);

  // ─── Loading state while IndexedDB hydrates ─────────────────────
  if (store.isLoading) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex flex-col items-center justify-center">
        <div className="animate-spin h-8 w-8 border-3 border-gray-300 border-t-[#2D5A3D] rounded-full mb-4" />
        <p className="text-gray-500 text-sm font-medium">Loading dashboard data…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="max-w-[1600px] mx-auto px-6 py-6">
        <Suspense fallback={<TabSpinner />}>
          {activeTab === 'overview' && (
            <OverviewView snapshots={snapshots} annualBudget={store.state.annualBudget} />
          )}

          {activeTab === 'spend' && (
            <SpendView
              snapshots={snapshots}
              expenses={store.state.expenses}
              annualBudget={store.state.annualBudget}
            />
          )}

          {activeTab === 'performance' && (
            <PerformanceView
              metaCampaigns={store.state.metaCampaigns}
              googleCampaigns={store.state.googleCampaigns}
              googleDaily={store.state.googleDaily}
            />
          )}

          {activeTab === 'attribution' && (
            <AttributionView snapshots={snapshots} />
          )}

          {activeTab === 'customers' && (
            <CustomerHealthView
              customers={store.state.crmCustomers}
              snapshots={snapshots}
            />
          )}

          {activeTab === 'menu' && (
            <MenuIntelligenceView items={store.state.menuIntelligence} />
          )}

          {activeTab === 'locations' && (
            <LocationComparatorView
              snapshots={snapshots}
              crmCustomers={store.state.crmCustomers}
              toastSales={store.state.toastSales}
            />
          )}

          {activeTab === 'report' && (
            <ReportView snapshots={snapshots} />
          )}

          {activeTab === 'upload' && (
            <FileUpload
              onExpensesParsed={store.addExpenses}
              onMetaParsed={store.addMetaCampaigns}
              onGoogleCampaignsParsed={store.addGoogleCampaigns}
              onGoogleDailyParsed={store.addGoogleDaily}
              onToastSalesParsed={(sales) => store.addToastSales(sales, 'csv')}
              onIncentivioData={store.addIncentivio}
              onCRMCustomers={store.addCRMCustomers}
              onMenuIntelligence={store.addMenuIntelligence}
              onBudgetsParsed={store.addBudgets}
              onFileUploaded={store.addUploadedFile}
              uploadedFiles={store.state.uploadedFiles}
              onClearData={store.clearAllData}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              annualBudget={store.state.annualBudget}
              onBudgetChange={store.setAnnualBudget}
              toastSyncState={toastSyncState}
              onCheckToastConnection={checkToastConnection}
              onToastSync={toastSync}
              toastDiscrepancies={store.state.toastDiscrepancies}
            />
          )}
        </Suspense>
      </main>
    </div>
  );
}
