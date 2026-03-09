import { useMemo, useCallback, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, ComposedChart, Area, PieChart, Pie, Cell,
} from 'recharts';
import { KPICard } from './KPICard';
import { ExportButton } from './ExportButton';
import { exportData, todayString } from '../utils/export';
import type { ExportFormat } from '../utils/export';
import { Users, Heart } from 'lucide-react';
import type { MonthlySnapshot, CRMCustomerRecord } from '../types';

interface AttributionViewProps {
  snapshots: MonthlySnapshot[];
  customers: CRMCustomerRecord[];
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

const REV_COLORS = ['#10b981', '#3b82f6']; // new, returning

export function AttributionView({ snapshots, customers }: AttributionViewProps) {
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

  // ─── New Customer Acquisition (MoM / QoQ / YoY) ───
  const [acquisitionGranularity, setAcquisitionGranularity] = useState<'monthly' | 'quarterly' | 'yearly'>('monthly');

  const acquisitionData = useMemo(() => {
    // Group customers by their account creation month
    const monthlyMap = new Map<string, { newCustomers: number; cohortRevenue90d: number }>();

    customers.forEach(c => {
      if (!c.accountCreatedDate || c.accountCreatedDate === '-') return;
      const month = c.accountCreatedDate.slice(0, 7); // YYYY-MM
      if (!month.match(/^\d{4}-\d{2}$/)) return;
      if (!monthlyMap.has(month)) monthlyMap.set(month, { newCustomers: 0, cohortRevenue90d: 0 });
      const entry = monthlyMap.get(month)!;
      entry.newCustomers++;
      entry.cohortRevenue90d += c.last90DaysSpend;
    });

    const monthlyData = Array.from(monthlyMap.entries())
      .map(([month, data]) => ({ period: month, ...data }))
      .sort((a, b) => a.period.localeCompare(b.period));

    if (acquisitionGranularity === 'monthly') return monthlyData;

    // Aggregate to quarters or years
    const grouped = new Map<string, { newCustomers: number; cohortRevenue90d: number }>();
    monthlyData.forEach(d => {
      let key: string;
      if (acquisitionGranularity === 'quarterly') {
        const [y, m] = d.period.split('-');
        const q = Math.ceil(parseInt(m) / 3);
        key = `${y} Q${q}`;
      } else {
        key = d.period.slice(0, 4);
      }
      if (!grouped.has(key)) grouped.set(key, { newCustomers: 0, cohortRevenue90d: 0 });
      const g = grouped.get(key)!;
      g.newCustomers += d.newCustomers;
      g.cohortRevenue90d += d.cohortRevenue90d;
    });

    return Array.from(grouped.entries())
      .map(([period, data]) => ({ period, ...data }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }, [customers, acquisitionGranularity]);

  // ─── New vs Returning Revenue (90-day window snapshot) ───
  const revenueBreakdown = useMemo(() => {
    const total90d = customers.reduce((s, c) => s + c.last90DaysSpend, 0);
    if (total90d === 0) return null;

    // "New" = signed up within the last 90 days from the most recent account date
    const sortedDates = customers
      .map(c => c.accountCreatedDate)
      .filter(d => d && d !== '-')
      .sort();
    const latestDate = sortedDates[sortedDates.length - 1] || '';
    if (!latestDate) return null;

    // Approximate 90 days before latest export date
    const latestDt = new Date(latestDate);
    const cutoff = new Date(latestDt.getTime() - 90 * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const newCusts = customers.filter(c => c.accountCreatedDate >= cutoffStr);
    const retCusts = customers.filter(c => c.accountCreatedDate && c.accountCreatedDate !== '-' && c.accountCreatedDate < cutoffStr);

    const newRev = newCusts.reduce((s, c) => s + c.last90DaysSpend, 0);
    const retRev = retCusts.reduce((s, c) => s + c.last90DaysSpend, 0);

    return {
      total90d,
      newCustomerCount: newCusts.length,
      returningCustomerCount: retCusts.length,
      newRevenue: newRev,
      returningRevenue: retRev,
      newPct: (newRev / total90d) * 100,
      retPct: (retRev / total90d) * 100,
      pieData: [
        { name: 'New Customers', value: newRev },
        { name: 'Returning Customers', value: retRev },
      ],
    };
  }, [customers]);

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

      {/* ─── New Customer Acquisition Chart ─── */}
      {acquisitionData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users size={18} className="text-emerald-600" />
              <div>
                <h3 className="text-sm font-semibold text-gray-700">New Customer Acquisition</h3>
                <p className="text-[10px] text-gray-400 mt-0.5">Active accounts only (excludes 0-activity signups)</p>
              </div>
            </div>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
              {(['monthly', 'quarterly', 'yearly'] as const).map(g => (
                <button
                  key={g}
                  onClick={() => setAcquisitionGranularity(g)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    acquisitionGranularity === g
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {g === 'monthly' ? 'Monthly' : g === 'quarterly' ? 'Quarterly' : 'Yearly'}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={acquisitionData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Tooltip
                formatter={((value: number, name: string) => [
                  name.includes('Revenue') ? formatCurrency(value) : value.toLocaleString(),
                  name,
                ]) as any}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="newCustomers" name="New Customers" fill="#2D5A3D" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ─── New vs Returning Revenue (90-Day Window) ─── */}
      {revenueBreakdown && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Heart size={18} className="text-rose-500" />
            <h3 className="text-sm font-semibold text-gray-700">
              New vs Returning Revenue
              <span className="ml-2 text-xs font-normal text-gray-400">(Last 90 Days)</span>
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-emerald-50 rounded-lg p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">New Customer Revenue</p>
              <p className="text-xl font-bold text-emerald-700">{formatCurrency(revenueBreakdown.newRevenue)}</p>
              <p className="text-xs text-emerald-600 mt-1">
                {revenueBreakdown.newPct.toFixed(1)}% of total &middot; {revenueBreakdown.newCustomerCount.toLocaleString()} customers
              </p>
            </div>
            <div className="bg-blue-50 rounded-lg p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">Returning Customer Revenue</p>
              <p className="text-xl font-bold text-blue-700">{formatCurrency(revenueBreakdown.returningRevenue)}</p>
              <p className="text-xs text-blue-600 mt-1">
                {revenueBreakdown.retPct.toFixed(1)}% of total &middot; {revenueBreakdown.returningCustomerCount.toLocaleString()} customers
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">Total 90-Day Revenue</p>
              <p className="text-xl font-bold text-gray-800">{formatCurrency(revenueBreakdown.total90d)}</p>
              <p className="text-xs text-gray-500 mt-1">
                Avg {formatCurrency(revenueBreakdown.total90d / (revenueBreakdown.newCustomerCount + revenueBreakdown.returningCustomerCount))} / customer
              </p>
            </div>
          </div>

          {/* Horizontal stacked bar + mini donut */}
          <div className="flex items-center gap-6">
            <div className="flex-1">
              <div className="w-full h-6 rounded-full overflow-hidden flex bg-gray-100">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${revenueBreakdown.newPct}%` }}
                  title={`New: ${formatCurrency(revenueBreakdown.newRevenue)} (${revenueBreakdown.newPct.toFixed(1)}%)`}
                />
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${revenueBreakdown.retPct}%` }}
                  title={`Returning: ${formatCurrency(revenueBreakdown.returningRevenue)} (${revenueBreakdown.retPct.toFixed(1)}%)`}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> New ({revenueBreakdown.newPct.toFixed(0)}%)
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Returning ({revenueBreakdown.retPct.toFixed(0)}%)
                </span>
              </div>
            </div>
            <div className="w-28 h-28 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={revenueBreakdown.pieData}
                    cx="50%" cy="50%"
                    innerRadius={24} outerRadius={44}
                    paddingAngle={2} dataKey="value"
                  >
                    {revenueBreakdown.pieData.map((_entry, idx) => (
                      <Cell key={idx} fill={REV_COLORS[idx]} />
                    ))}
                  </Pie>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  <Tooltip formatter={((v: number) => formatCurrency(v)) as any} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

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
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <Tooltip formatter={((v: number) => `$${v}`) as any} />
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
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <Tooltip formatter={((v: number) => `${v}%`) as any} />
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
