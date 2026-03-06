import { useState } from 'react';
import { Save, DollarSign, Info } from 'lucide-react';
import { ToastConnectionCard } from './ToastConnectionCard';
import type { ToastSyncState } from '../hooks/useToastSync';
import type { ToastDiscrepancy } from '../types';

interface SettingsViewProps {
  annualBudget: number;
  onBudgetChange: (budget: number) => void;
  toastSyncState: ToastSyncState;
  onCheckToastConnection: () => Promise<boolean>;
  onToastSync: (months: string[]) => Promise<unknown>;
  toastDiscrepancies: ToastDiscrepancy[];
}

export function SettingsView({
  annualBudget, onBudgetChange,
  toastSyncState, onCheckToastConnection, onToastSync, toastDiscrepancies,
}: SettingsViewProps) {
  const [budgetInput, setBudgetInput] = useState(annualBudget.toString());
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    const parsed = parseFloat(budgetInput.replace(/[$,]/g, ''));
    if (!isNaN(parsed) && parsed > 0) {
      onBudgetChange(parsed);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">Dashboard Settings</h2>

      {/* Annual Budget */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <DollarSign size={18} className="text-[#2D5A3D]" />
          <h3 className="text-sm font-semibold text-gray-700">Annual Marketing Budget</h3>
        </div>
        <p className="text-xs text-gray-500">
          This is used to calculate budget utilization and monthly variance.
          Currently set from the 15-month operating budget ($533K).
        </p>
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
            <input
              type="text"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              className="w-full pl-7 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#2D5A3D] focus:ring-1 focus:ring-[#2D5A3D]"
              placeholder="533000"
            />
          </div>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 bg-[#2D5A3D] text-white rounded-lg text-sm hover:bg-[#4A7C5C] transition-colors"
          >
            <Save size={14} />
            {saved ? 'Saved!' : 'Save'}
          </button>
        </div>
        <p className="text-xs text-gray-400">Monthly allocation: ${(parseFloat(budgetInput.replace(/[$,]/g, '')) / 12 || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo</p>
      </div>

      {/* Toast POS Integration */}
      <ToastConnectionCard
        syncState={toastSyncState}
        onCheckConnection={onCheckToastConnection}
        onSync={onToastSync}
        discrepancies={toastDiscrepancies}
      />

      {/* Model Info */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <Info size={18} className="text-[#2D5A3D]" />
          <h3 className="text-sm font-semibold text-gray-700">Attribution Model Notes</h3>
        </div>
        <div className="text-xs text-gray-600 space-y-2">
          <p>
            <strong>CAC Calculation:</strong> Total marketing spend / New customers (from Incentivio new accounts or 15% order estimate as fallback).
          </p>
          <p>
            <strong>LTV Estimate:</strong> Average Order Value x 2.5 (90-day loyalty window). This is based on the assumption that loyalty customers return 2-3x within 90 days of acquisition.
          </p>
          <p>
            <strong>ROI Formula:</strong> (Estimated LTV - CAC) / CAC x 100%. A positive ROI means the revenue from acquired customers exceeds the cost of acquiring them.
          </p>
          <p>
            <strong>Budget Allocation:</strong> Annual budget is split evenly across 12 months. Actual budget may vary seasonally - consider adjusting as needed.
          </p>
          <p>
            <strong>Toast Attribution:</strong> Discount codes on Toast POS (e.g., "Val20" = ValPak) can be used to attribute in-store conversions to specific channels.
          </p>
        </div>
      </div>

      {/* Data Sources Info */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">Supported Data Sources</h3>
        <div className="text-xs text-gray-600 space-y-1">
          <p><strong>Marketing Expenses:</strong> QuickBooks XLSX or CSV exports. Auto-categorizes by vendor name.</p>
          <p><strong>Meta Campaigns:</strong> Facebook/Instagram Ads Manager CSV export with reporting dates.</p>
          <p><strong>Google Ads:</strong> Campaign overview CSVs and time series (daily) exports.</p>
          <p><strong>Toast POS:</strong> Sales summary reports by location (gross/net sales, orders, discounts).</p>
          <p><strong>Incentivio:</strong> Loyalty KPIs, customer exports (new accounts, AOV, LTV).</p>
          <p><strong>3rd Party:</strong> UberEats, DoorDash, GrubHub order/revenue data.</p>
        </div>
      </div>
    </div>
  );
}
