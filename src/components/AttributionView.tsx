import { useMemo, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, ComposedChart, Area,
} from 'recharts';
import { KPICard } from './KPICard';
import { ExportButton } from './ExportButton';
import { exportData, todayString } from '../utils/export';
import type { ExportFormat } from '../utils/export';
import type { MonthlySnapshot } from '../types';

interface AttributionViewProps {
  snapshots: MonthlySnapshot[];
}

function formatCurrency(n: number): string {
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatMonth(m: string): string {
  const [year, month] = m.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[parseInt(month) - 1]} ${year.slice(2)}`;
}

export function AttributionView({ snapshots }: AttributionViewProps) {
  const latest = snapshots[snapshots.length - 1];
  const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;

  const cacTrend = useMemo(() =>
    snapshots.map(s => ({
      month: formatMonth(s.month),
      cac: Math.round(s.estimatedCAC),
      roi: Math.round(s.estimatedROI),
      newCustomers: s.newCustomers,
      spend: Math.round(s.totalSpend),
    }))
  , [snapshots]);

  const channelROI = useMemo(() => {
    if (!latest) return [];
    const channels: { name: string; spend: number; contribution: string }[] = [];

    if (latest.metaSpend > 0) {
      channels.push({ name: 'Meta / Facebook', spend: latest.metaSpend, contribution: `${latest.metaClicks} clicks` });
    }
    if (latest.googleSpend > 0) {
      channels.push({ name: 'Google Ads', spend: latest.googleSpend, contribution: `${latest.googleClicks} clicks` });
    }

    const totalTracked = channels.reduce((s, c) => s + c.spend, 0);
    const remaining = latest.totalSpend - totalTracked;
    if (remaining > 0) {
      channels.push({ name: 'Other Marketing', spend: remaining, contribution: 'Various channels' });
    }
    return channels;
  }, [latest]);

  // LTV analysis
  const ltvData = useMemo(() =>
    snapshots.map(s => {
      const estimatedLTV = s.avgOrderValue * 2.5; // 90-day window assumption
      return {
        month: formatMonth(s.month),
        avgOrderValue: Math.round(s.avgOrderValue * 100) / 100,
        estimatedLTV: Math.round(estimatedLTV),
        cac: Math.round(s.estimatedCAC),
        ltvCacRatio: s.estimatedCAC > 0 ? Math.round((estimatedLTV / s.estimatedCAC) * 100) / 100 : 0,
      };
    })
  , [snapshots]);

  const handleExport = useCallback((format: ExportFormat) => {
    exportData(snapshots as unknown as Record<string, unknown>[], {
      filename: `stack-attribution-${todayString()}`,
      format,
    });
  }, [snapshots]);

  if (!latest) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <p className="text-lg font-medium mb-2">No attribution data</p>
        <p className="text-sm">Upload expense and sales data to calculate CAC & ROI</p>
      </div>
    );
  }

  const cacChange = previous ? ((latest.estimatedCAC - previous.estimatedCAC) / (previous.estimatedCAC || 1)) * 100 : undefined;
  const custChange = previous ? ((latest.newCustomers - previous.newCustomers) / (previous.newCustomers || 1)) * 100 : undefined;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Attribution & ROI</h2>
        <ExportButton onExport={handleExport} />
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Customer Acq. Cost"
          value={formatCurrency(latest.estimatedCAC)}
          change={cacChange}
          changeLabel="MoM"
          color="#f59e0b"
        />
        <KPICard
          label="Estimated ROI"
          value={`${latest.estimatedROI.toFixed(0)}%`}
          subtitle="Based on LTV 2.5x AOV"
          color={latest.estimatedROI > 100 ? '#10b981' : '#ef4444'}
        />
        <KPICard
          label="New Customers"
          value={latest.newCustomers.toLocaleString()}
          change={custChange}
          changeLabel="MoM"
          color="#2D5A3D"
        />
        <KPICard
          label="Avg Order Value"
          value={`$${latest.avgOrderValue.toFixed(2)}`}
          subtitle={`Est. LTV: $${(latest.avgOrderValue * 2.5).toFixed(0)}`}
          color="#8b5cf6"
        />
      </div>

      {/* CAC + New Customers Trend */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">CAC & New Customer Trend</h3>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={cacTrend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            <Bar yAxisId="right" dataKey="newCustomers" name="New Customers" fill="#7CB342" radius={[4,4,0,0]} />
            <Line yAxisId="left" type="monotone" dataKey="cac" name="CAC ($)" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* LTV vs CAC */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">LTV vs CAC (90-Day Window)</h3>
        <p className="text-xs text-gray-400 mb-4">LTV estimated as 2.5x avg order value over 90-day loyalty window</p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={ltvData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
            <Tooltip formatter={(v: number) => `$${v}`} />
            <Legend />
            <Bar dataKey="estimatedLTV" name="Estimated LTV" fill="#10b981" radius={[4,4,0,0]} />
            <Bar dataKey="cac" name="CAC" fill="#ef4444" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ROI Trend */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">ROI Trend (%)</h3>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={cacTrend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
            <Tooltip formatter={(v: number) => `${v}%`} />
            <Area type="monotone" dataKey="roi" fill="#dcfce7" stroke="none" />
            <Line type="monotone" dataKey="roi" name="ROI %" stroke="#2D5A3D" strokeWidth={3} dot={{ r: 4, fill: '#2D5A3D' }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Channel Attribution Table */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Channel Spend Attribution (Latest Month)</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100">
              <th className="pb-2">Channel</th>
              <th className="pb-2 text-right">Spend</th>
              <th className="pb-2 text-right">% of Total</th>
              <th className="pb-2 text-right">Key Metric</th>
            </tr>
          </thead>
          <tbody>
            {channelROI.map((ch, i) => (
              <tr key={i} className="border-b border-gray-50">
                <td className="py-2 text-gray-800 font-medium">{ch.name}</td>
                <td className="py-2 text-right">{formatCurrency(ch.spend)}</td>
                <td className="py-2 text-right">
                  {latest.totalSpend > 0 ? `${((ch.spend / latest.totalSpend) * 100).toFixed(1)}%` : '0%'}
                </td>
                <td className="py-2 text-right text-gray-500">{ch.contribution}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
