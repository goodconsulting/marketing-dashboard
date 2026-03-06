import { useMemo, useState, useCallback } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts';
import { CATEGORY_LABELS, CATEGORY_COLORS } from '../utils/categorize';
import { ExportButton } from './ExportButton';
import { exportData, todayString } from '../utils/export';
import type { ExportFormat } from '../utils/export';
import type { MonthlySnapshot, MonthlyExpense, SpendCategory } from '../types';

interface SpendViewProps {
  snapshots: MonthlySnapshot[];
  expenses: MonthlyExpense[];
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

export function SpendView({ snapshots, expenses, annualBudget }: SpendViewProps) {
  const months = useMemo(() => snapshots.map(s => s.month), [snapshots]);
  const [selectedMonth, setSelectedMonth] = useState<string>('all');

  // Category breakdown for selected period
  const categoryData = useMemo(() => {
    const source = selectedMonth === 'all' ? snapshots : snapshots.filter(s => s.month === selectedMonth);
    const totals: Record<SpendCategory, number> = {
      paid_media: 0, direct_mail_print: 0, ooh: 0, software_fees: 0, labor: 0, other: 0,
    };
    source.forEach(s => {
      for (const cat of Object.keys(totals) as SpendCategory[]) {
        totals[cat] += s.spendByCategory[cat] || 0;
      }
    });
    return Object.entries(totals)
      .filter(([, v]) => v > 0)
      .map(([key, value]) => ({
        name: CATEGORY_LABELS[key as SpendCategory],
        value: Math.round(value),
        color: CATEGORY_COLORS[key as SpendCategory],
      }))
      .sort((a, b) => b.value - a.value);
  }, [snapshots, selectedMonth]);

  // Monthly spend stacked bar data
  const monthlyStackData = useMemo(() =>
    snapshots.map(s => ({
      month: formatMonth(s.month),
      ...Object.fromEntries(
        (Object.keys(CATEGORY_LABELS) as SpendCategory[]).map(cat => [cat, Math.round(s.spendByCategory[cat] || 0)])
      ),
      budget: Math.round(s.budgetedSpend),
    }))
  , [snapshots]);

  // Top vendors
  const topVendors = useMemo(() => {
    const filtered = selectedMonth === 'all' ? expenses : expenses.filter(e => e.month === selectedMonth);
    const byVendor: Record<string, number> = {};
    filtered.forEach(e => {
      const key = e.vendor || 'Unknown';
      byVendor[key] = (byVendor[key] || 0) + e.amount;
    });
    return Object.entries(byVendor)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([vendor, amount]) => ({ vendor, amount: Math.round(amount) }));
  }, [expenses, selectedMonth]);

  // Budget variance
  const budgetSummary = useMemo(() => {
    const ytdSpend = snapshots.reduce((sum, s) => sum + s.totalSpend, 0);
    const monthsPassed = snapshots.length || 1;
    const proratedBudget = (annualBudget / 12) * monthsPassed;
    const variance = proratedBudget - ytdSpend;
    const pctUsed = proratedBudget > 0 ? (ytdSpend / proratedBudget) * 100 : 0;
    return { ytdSpend, proratedBudget, variance, pctUsed, monthsPassed };
  }, [snapshots, annualBudget]);

  const handleExport = useCallback((format: ExportFormat) => {
    const filtered = selectedMonth === 'all'
      ? expenses
      : expenses.filter(e => e.month === selectedMonth);
    exportData(filtered as unknown as Record<string, unknown>[], {
      filename: `stack-spend-${todayString()}`,
      format,
    });
  }, [expenses, selectedMonth]);

  if (snapshots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <p className="text-lg font-medium mb-2">No spend data</p>
        <p className="text-sm">Upload expense files to view spend breakdown</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Period selector + Budget Summary */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
          >
            <option value="all">All Months (YTD)</option>
            {months.map(m => <option key={m} value={m}>{formatMonth(m)}</option>)}
          </select>
          <ExportButton onExport={handleExport} />
        </div>

        <div className="flex gap-6 text-sm">
          <div>
            <span className="text-gray-500">YTD Spend:</span>{' '}
            <span className="font-semibold">{formatCurrency(budgetSummary.ytdSpend)}</span>
          </div>
          <div>
            <span className="text-gray-500">Prorated Budget:</span>{' '}
            <span className="font-semibold">{formatCurrency(budgetSummary.proratedBudget)}</span>
          </div>
          <div>
            <span className="text-gray-500">Variance:</span>{' '}
            <span className={`font-semibold ${budgetSummary.variance >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {budgetSummary.variance >= 0 ? '+' : ''}{formatCurrency(budgetSummary.variance)}
            </span>
          </div>
        </div>
      </div>

      {/* Budget progress bar */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-sm font-semibold text-gray-700">Budget Utilization ({budgetSummary.monthsPassed} months)</h3>
          <span className="text-sm font-medium" style={{ color: budgetSummary.pctUsed > 100 ? '#ef4444' : '#2D5A3D' }}>
            {budgetSummary.pctUsed.toFixed(1)}%
          </span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-5 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(budgetSummary.pctUsed, 100)}%`,
              background: budgetSummary.pctUsed > 100 ? '#ef4444' : budgetSummary.pctUsed > 85 ? '#f59e0b' : '#2D5A3D',
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Pie Chart */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Spend by Category</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={categoryData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={3}
                dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {categoryData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Top Vendors */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Top Vendors</h3>
          <div className="space-y-2">
            {topVendors.map((v, i) => {
              const maxAmount = topVendors[0]?.amount || 1;
              const pct = (v.amount / maxAmount) * 100;
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 w-36 truncate">{v.vendor}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full bg-[#4A7C5C]" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm font-medium text-gray-700 w-20 text-right">{formatCurrency(v.amount)}</span>
                </div>
              );
            })}
            {topVendors.length === 0 && <p className="text-sm text-gray-400">No vendor data available</p>}
          </div>
        </div>
      </div>

      {/* Monthly Stacked Bar */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Monthly Spend by Category</h3>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={monthlyStackData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatCurrency(v)} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} />
            <Legend />
            {(Object.keys(CATEGORY_LABELS) as SpendCategory[]).map(cat => (
              <Bar key={cat} dataKey={cat} name={CATEGORY_LABELS[cat]} stackId="spend" fill={CATEGORY_COLORS[cat]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
