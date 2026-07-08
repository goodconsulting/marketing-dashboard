import { useState, useCallback, lazy, Suspense } from 'react';
import { Header } from './components/Header';
import { FileUpload } from './components/FileUpload';
import { MonthCloseCard } from './components/MonthCloseCard';
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
const JourneyMapView = lazy(() =>
  import('./components/JourneyMapView').then(m => ({ default: m.JourneyMapView }))
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
const SocialView = lazy(() =>
  import('./components/SocialView').then(m => ({ default: m.SocialView }))
);
const DataHealthView = lazy(() =>
  import('./components/DataHealthView').then(m => ({ default: m.DataHealthView }))
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
  const { snapshots, addToastSales } = store;

  // Scorecard → Upload navigation (red ✗ chips preselect source + month)
  const [pendingUploadSource, setPendingUploadSource] = useState<string | null>(null);
  const [pendingUploadMonth, setPendingUploadMonth] = useState<string | null>(null);
  const goToUpload = useCallback((sourceKey: string, month: string) => {
    setPendingUploadSource(sourceKey);
    setPendingUploadMonth(month);
    setActiveTab('upload');
  }, []);

  // Toast POS sync hook — pushes API data through the store to SQLite
  const handleToastSales = useCallback(
    (sales: ToastSales[]) => addToastSales(sales),
    [addToastSales],
  );
  const { syncState: toastSyncState, checkConnection: checkToastConnection, sync: toastSync } =
    useToastSync(handleToastSales);

  // ─── Loading state while server hydrates ────────────────────────
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

      <main className="ml-[220px] min-h-screen px-6 py-6 max-w-[1400px]">
        <Suspense fallback={<TabSpinner />}>
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <MonthCloseCard
                onGoToUpload={goToUpload}
                refreshToken={store.state.uploadedFiles.length}
              />
              <OverviewView snapshots={snapshots} annualBudget={store.state.annualBudget} customers={store.state.crmCustomers} ampCampaigns={store.state.ampCampaigns} billboardData={store.state.billboardData} onelinkData={store.state.onelinkData} />
            </div>
          )}

          {activeTab === 'social' && (
            <SocialView social={store.state.socialMonthly} />
          )}

          {activeTab === 'datahealth' && (
            <DataHealthView onGoToUpload={goToUpload} />
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
              onelinkData={store.state.onelinkData}
              ampCampaigns={store.state.ampCampaigns}
              billboardData={store.state.billboardData}
              otherCampaigns={store.state.otherCampaigns}
            />
          )}

          {activeTab === 'attribution' && (
            <AttributionView snapshots={snapshots} customers={store.state.crmCustomers} allCustomers={store.state.allCrmCustomers} discountSummary={store.state.discountSummary} stageTransitions={store.state.stageTransitions} />
          )}

          {activeTab === 'customers' && (
            <CustomerHealthView
              customers={store.state.crmCustomers}
              snapshots={snapshots}
              stageTransitions={store.state.stageTransitions}
            />
          )}

          {activeTab === 'valuemap' && (
            <JourneyMapView
              snapshots={snapshots}
              allCustomers={store.state.allCrmCustomers}
              stageTransitions={store.state.stageTransitions}
              discountSummary={store.state.discountSummary}
              metaCampaigns={store.state.metaCampaigns}
              googleCampaigns={store.state.googleCampaigns}
              incentivioMetrics={store.state.incentivio}
              toastSales={store.state.toastSales}
              billboardData={store.state.billboardData}
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
            <ReportView snapshots={snapshots} customers={store.state.crmCustomers} />
          )}

          {activeTab === 'upload' && (
            <FileUpload
              uploadedFiles={store.state.uploadedFiles}
              onClearData={store.clearAllData}
              onUploadConfirmed={store.refresh}
              preselectSource={pendingUploadSource}
              preselectMonth={pendingUploadMonth}
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
