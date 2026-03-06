import { useMemo, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, Legend } from 'recharts';
import { KPICard } from './KPICard';
import { ExportButton } from './ExportButton';
import { exportData, todayString } from '../utils/export';
import type { ExportFormat } from '../utils/export';
import type { MonthlySnapshot } from '../types';

interface OverviewViewProps {
  snapshots: MonthlySnapshot[];
  annualBudget: number;
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatMonth(m: string): string {
  const [year, month] = m.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[parseInt(month) - 1]} ${year.slice(2)}`;
}

export function OverviewView({ snapshots, annualBudget }: OverviewViewProps) {
  const latest = snapshots[snapshots.length - 1];
  const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;

  const kpis = useMemo(() => {
    if (!latest) return null;
    const spendChange = previous ? ((latest.totalSpend - previous.totalSpend) / (previous.totalSpend || 1)) * 100 : undefined;
    const revenueChange = previous ? ((latest.totalRevenue - previous.totalRevenue) / (previous.totalRevenue || 1)) * 100 : undefined;
    const cacChange = previous ? ((latest.estimatedCAC - previous.estimatedCAC) / (previous.estimatedCAC || 1)) * 100 : undefined;

    const ytdSpend = snapshots.reduce((sum, s) => sum + s.totalSpend, 0);
    const budgetUsed = (ytdSpend / annualBudget) * 100;

    return { spendChange, revenueChange, cacChange, ytdSpend, budgetUsed };
  }, [snapshots, latest, previous, annualBudget]);

  const chartData = useMemo(() =>
    snapshots.map(s => ({
      month: formatMonth(s.month),
      spend: Math.round(s.totalSpend),
      revenue: Math.round(s.totalRevenue),
      budget: Math.round(s.budgetedSpend),
    }))
  , [snapshots]);

  const performanceData = useMemo(() =>
    snapshots.map(s => ({
      month: formatMonth(s.month),
      metaClicks: s.metaClicks,
      googleClicks: s.googleClicks,
      newCustomers: s.newCustomers,
    }))
  , [snapshots]);

  const handleExport = useCallback((format: ExportFormat) => {
    exportData(snapshots as unknown as Record<string, unknown>[], {
      filename: `stack-overview-${todayString()}`,
      format,
    });
  }, [snapshots]);

  if (!latest) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <p className="text-lg font-medium mb-2">No data yet</p>
        <p className="text-sm">Upload marketing expense files to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Dashboard Overview</h2>
        <ExportButton onExport={handleExport} />
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          label="Monthly Spend"
          value={formatCurrency(latest.totalSpend)}
          change={kpis?.spendChange}
          changeLabel="vs prev month"
        />
        <KPICard
          label="Monthly Revenue"
          value={formatCurrency(latest.totalRevenue)}
          change={kpis?.revenueChange}
          changeLabel="vs prev month"
          color="#10b981"
        />
        <KPICard
          label="Est. CAC"
          value={formatCurrency(latest.estimatedCAC)}
          change={kpis?.cacChange}
          changeLabel="vs prev month"
          color="#f59e0b"
        />
        <KPICard
          label="Est. ROI"
          value={`${latest.estimatedROI.toFixed(0)}%`}
          subtitle="LTV / CAC based"
          color="#8b5cf6"
        />
        <KPICard
          label="YTD Budget Used"
          value={`${kpis?.budgetUsed.toFixed(1)}%`}
          subtitle={`${formatCurrency(kpis?.ytdSpend || 0)} of ${formatCurrency(annualBudget)}`}
          color={kpis && kpis.budgetUsed > 90 ? '#ef4444' : '#2D5A3D'}
        />
      </div>

      {/* Spend vs Revenue Chart */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Spend vs Revenue (Monthly)</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatCurrency(v)} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} />
            <Legend />
            <Bar dataKey="spend" name="Marketing Spend" fill="#2D5A3D" radius={[4,4,0,0]} />
            <Bar dataKey="revenue" name="Gross Revenue" fill="#7CB342" radius={[4,4,0,0]} />
            <Bar dataKey="budget" name="Budget Alloc." fill="#e5e7eb" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Performance Trends */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Performance Trends</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={performanceData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="metaClicks" name="Meta Clicks" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="googleClicks" name="Google Clicks" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="newCustomers" name="New Customers" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Location Revenue Breakdown */}
      {Object.keys(latest.revenueByLocation).length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Revenue by Location (Latest Month)</h3>
          <div className="space-y-2">
            {Object.entries(latest.revenueByLocation)
              .sort(([,a],[,b]) => b - a)
              .map(([loc, rev]) => {
                const maxRev = Math.max(...Object.values(latest.revenueByLocation));
                const pct = maxRev > 0 ? (rev / maxRev) * 100 : 0;
                return (
                  <div key={loc} className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 w-40 truncate">{loc}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div className="h-full rounded-full bg-[#2D5A3D]" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-sm font-medium text-gray-700 w-24 text-right">{formatCurrency(rev)}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
