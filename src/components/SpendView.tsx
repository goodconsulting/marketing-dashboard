import { useMemo, useState, useCallback } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, LabelList,
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

  // Category drill-down
  const categories = Object.keys(CATEGORY_LABELS) as SpendCategory[];
  const [drillCategory, setDrillCategory] = useState<SpendCategory>('paid_media');
  const [drillMonth, setDrillMonth] = useState<string | null>(null);

  // Top Vendors defaults to most recent month with expense data
  const latestExpenseMonth = useMemo(() => {
    const sorted = [...new Set(expenses.map(e => e.month))].sort();
    return sorted[sorted.length - 1] || 'all';
  }, [expenses]);
  const [vendorMonth, setVendorMonth] = useState<string | null>(null);
  const effectiveVendorMonth = vendorMonth ?? latestExpenseMonth;
  const [vendorCategoryFilter, setVendorCategoryFilter] = useState<SpendCategory | 'all'>('all');

  // Category breakdown helper — excludes "other" to avoid visual dilution
  function buildCategoryData(source: MonthlySnapshot[]) {
    const totals: Record<SpendCategory, number> = {
      paid_media: 0, direct_mail_print: 0, ooh: 0, software_fees: 0, labor: 0, organic_marketing: 0, sponsorship: 0, other: 0,
    };
    source.forEach(s => {
      for (const cat of Object.keys(totals) as SpendCategory[]) {
        totals[cat] += s.spendByCategory[cat] || 0;
      }
    });
    return Object.entries(totals)
      .filter(([key, v]) => v > 0 && key !== 'other')
      .map(([key, value]) => ({
        name: CATEGORY_LABELS[key as SpendCategory],
        value: Math.round(value),
        color: CATEGORY_COLORS[key as SpendCategory],
      }))
      .sort((a, b) => b.value - a.value);
  }

  const currentYear = new Date().getFullYear().toString();

  // Current month pie (most recent month with spend in current year)
  const currentMonthCategoryData = useMemo(() => {
    const latestSnap = [...snapshots]
      .filter(s => s.month.startsWith(currentYear) && s.totalSpend > 0)
      .sort((a, b) => b.month.localeCompare(a.month))[0];
    return latestSnap ? { data: buildCategoryData([latestSnap]), label: formatMonth(latestSnap.month) } : null;
  }, [snapshots]);

  // YTD pie (all months in current year with spend)
  const ytdCategoryData = useMemo(() => {
    const yearSnaps = snapshots.filter(s => s.month.startsWith(currentYear) && s.totalSpend > 0);
    return { data: buildCategoryData(yearSnaps), label: `${currentYear} YTD` };
  }, [snapshots]);

  // Monthly spend stacked bar data
  const monthlyStackData = useMemo(() =>
    snapshots.map(s => ({
      month: formatMonth(s.month),
      ...Object.fromEntries(
        (Object.keys(CATEGORY_LABELS) as SpendCategory[]).map(cat => [cat, Math.round(s.spendByCategory[cat] || 0)])
      ),
      total: Math.round(s.totalSpend),
      budget: Math.round(s.budgetedSpend),
    }))
  , [snapshots]);

  // Top vendors — uses its own month filter (defaults to most recent month)
  const topVendors = useMemo(() => {
    const filtered = effectiveVendorMonth === 'all' ? expenses : expenses.filter(e => e.month === effectiveVendorMonth);
    const byVendor: Record<string, { amount: number; category: SpendCategory }> = {};
    filtered.forEach(e => {
      const key = e.vendor || 'Unknown';
      if (!byVendor[key]) byVendor[key] = { amount: 0, category: (e.category || 'other') as SpendCategory };
      byVendor[key].amount += e.amount;
    });
    return Object.entries(byVendor)
      .sort(([, a], [, b]) => b.amount - a.amount)
      .slice(0, 10)
      .map(([vendor, { amount, category }]) => ({ vendor, amount: Math.round(amount), category }));
  }, [expenses, effectiveVendorMonth]);

  const filteredVendors = useMemo(() => {
    if (vendorCategoryFilter === 'all') return topVendors;
    return topVendors.filter(v => v.category === vendorCategoryFilter);
  }, [topVendors, vendorCategoryFilter]);

  // Category drill-down expenses
  const effectiveDrillMonth = drillMonth ?? latestExpenseMonth;
  const drillExpenses = useMemo(() => {
    return expenses
      .filter(e => e.category === drillCategory && (effectiveDrillMonth === 'all' || e.month === effectiveDrillMonth))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [expenses, drillCategory, effectiveDrillMonth]);

  const drillTotal = useMemo(() => drillExpenses.reduce((s, e) => s + e.amount, 0), [drillExpenses]);

  // Monthly spend vs budget variance table (2026 only)
  const monthlyVariance = useMemo(() => {
    const currentYear = new Date().getFullYear().toString();
    const monthlyBudget = annualBudget / 12;
    return snapshots
      .filter(s => s.month.startsWith(currentYear))
      .map(s => {
        const budget = s.budgetedSpend > 0 ? s.budgetedSpend : monthlyBudget;
        const delta = s.totalSpend - budget;
        const pctDelta = budget > 0 ? (delta / budget) * 100 : 0;
        return {
          month: s.month,
          label: formatMonth(s.month),
          spend: s.totalSpend,
          budget,
          delta,
          pctDelta,
        };
      });
  }, [snapshots, annualBudget]);

  // Budget utilization — YTD spend vs full annual budget for current year
  const budgetSummary = useMemo(() => {
    const currentYear = new Date().getFullYear().toString();
    const yearSnapshots = snapshots.filter(s => s.month.startsWith(currentYear) && s.totalSpend > 0);
    const ytdSpend = yearSnapshots.reduce((sum, s) => sum + s.totalSpend, 0);
    const monthsPassed = yearSnapshots.length;
    const remaining = annualBudget - ytdSpend;
    const pctUsed = annualBudget > 0 ? (ytdSpend / annualBudget) * 100 : 0;
    return { ytdSpend, remaining, pctUsed, monthsPassed, year: currentYear };
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
            <span className="text-gray-500">{budgetSummary.year} Spend:</span>{' '}
            <span className="font-semibold">{formatCurrency(budgetSummary.ytdSpend)}</span>
          </div>
          <div>
            <span className="text-gray-500">Annual Budget:</span>{' '}
            <span className="font-semibold">{formatCurrency(annualBudget)}</span>
          </div>
          <div>
            <span className="text-gray-500">Remaining:</span>{' '}
            <span className={`font-semibold ${budgetSummary.remaining >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {formatCurrency(Math.abs(budgetSummary.remaining))}
              {budgetSummary.remaining < 0 ? ' over' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Budget progress bar */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-sm font-semibold text-gray-700">Budget Utilization — {budgetSummary.year} ({budgetSummary.monthsPassed} months)</h3>
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

      {/* Spend by Category — two side-by-side pies */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Spend by Category</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Current Month */}
          {currentMonthCategoryData && currentMonthCategoryData.data.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 text-center mb-2 font-medium">{currentMonthCategoryData.label}</p>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={currentMonthCategoryData.data}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  >
                    {currentMonthCategoryData.data.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number | undefined) => formatCurrency(v ?? 0)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          {/* YTD */}
          {ytdCategoryData.data.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 text-center mb-2 font-medium">{ytdCategoryData.label}</p>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={ytdCategoryData.data}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  >
                    {ytdCategoryData.data.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number | undefined) => formatCurrency(v ?? 0)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Monthly Stacked Bar */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Monthly Spend by Category</h3>
        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={monthlyStackData} margin={{ top: 24, right: 10, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatCurrency(v)} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const totalVal = payload.find(p => p.dataKey === 'total')?.value as number | undefined;
                const categories = payload.filter(p => p.dataKey !== 'total' && (p.value as number) > 0);
                return (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
                    <p className="font-semibold text-gray-800 mb-1.5">{label}</p>
                    {totalVal != null && (
                      <p className="font-bold text-gray-900 border-b border-gray-100 pb-1.5 mb-1.5">
                        Total: {formatCurrency(totalVal)}
                      </p>
                    )}
                    {categories.map((entry, i) => (
                      <p key={i} className="flex justify-between gap-4" style={{ color: entry.color }}>
                        <span>{entry.name}</span>
                        <span className="font-medium">{formatCurrency(entry.value as number)}</span>
                      </p>
                    ))}
                  </div>
                );
              }}
            />
            <Legend />
            {(Object.keys(CATEGORY_LABELS) as SpendCategory[]).map(cat => (
              <Bar key={cat} dataKey={cat} name={CATEGORY_LABELS[cat]} stackId="spend" fill={CATEGORY_COLORS[cat]} />
            ))}
            {/* Invisible bar that carries the total label above the stack */}
            <Bar dataKey="total" stackId="total" fill="transparent" legendType="none" isAnimationActive={false}>
              <LabelList
                dataKey="total"
                position="top"
                formatter={(v: unknown) => formatCurrency(Number(v))}
                style={{ fontSize: 11, fontWeight: 600, fill: '#374151' }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Top Vendors */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">
            Top Vendors
            <span className="font-normal text-gray-400 ml-1">
              — {effectiveVendorMonth === 'all' ? 'All Months (YTD)' : formatMonth(effectiveVendorMonth)}
            </span>
          </h3>
          <div className="flex items-center gap-2">
            <select
              value={vendorCategoryFilter}
              onChange={e => setVendorCategoryFilter(e.target.value as SpendCategory | 'all')}
              className="text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-600"
            >
              <option value="all">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
              ))}
            </select>
            <select
              value={effectiveVendorMonth}
              onChange={e => setVendorMonth(e.target.value)}
              className="text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-600"
            >
              <option value="all">All Months</option>
              {months.filter(m => expenses.some(e => e.month === m)).map(m => (
                <option key={m} value={m}>{formatMonth(m)}</option>
              ))}
            </select>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-gray-400 text-xs uppercase tracking-wider">
              <th className="text-left py-1.5 pr-2" style={{ width: '20%' }}>Vendor</th>
              <th className="text-left py-1.5 pr-2" style={{ width: '10%' }}>Category</th>
              <th className="py-1.5 px-2" style={{ width: '58%' }}></th>
              <th className="text-right py-1.5" style={{ width: '12%' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {filteredVendors.map((v, i) => {
              const maxAmount = filteredVendors[0]?.amount || 1;
              const pct = (v.amount / maxAmount) * 100;
              return (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-2 pr-2 text-gray-800">{v.vendor}</td>
                  <td className="py-2 pr-2">
                    <span
                      className="inline-block px-2 py-1 rounded text-[11px] font-semibold text-white leading-none whitespace-nowrap"
                      style={{ backgroundColor: CATEGORY_COLORS[v.category] || '#6b7280' }}
                    >
                      {CATEGORY_LABELS[v.category]?.replace('Direct Mail & Print', 'Print').replace('Out-of-Home (OOH)', 'OOH').replace('Marketing Labor', 'Labor').replace('Software Fees', 'Software') || 'Other'}
                    </span>
                  </td>
                  <td className="py-2 px-2">
                    <div className="bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: CATEGORY_COLORS[v.category] || '#4A7C5C' }} />
                    </div>
                  </td>
                  <td className="py-2 text-right font-medium text-gray-800">{formatCurrency(v.amount)}</td>
                </tr>
              );
            })}
            {filteredVendors.length === 0 && (
              <tr><td colSpan={4} className="py-4 text-center text-gray-400">No vendor data</td></tr>
            )}
          </tbody>
          {filteredVendors.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-200">
                <td colSpan={3} className="py-2 font-bold text-gray-800">Total ({filteredVendors.length} vendors)</td>
                <td className="py-2 text-right font-bold text-gray-900">
                  {formatCurrency(filteredVendors.reduce((s, v) => s + v.amount, 0))}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Monthly Spend vs Budget Variance */}
      {monthlyVariance.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm overflow-x-auto">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Monthly Spend vs. Budget — {new Date().getFullYear()}
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wider">
                <th className="text-left py-2 pr-4">Month</th>
                <th className="text-right py-2 pr-4">Actual Spend</th>
                <th className="text-right py-2 pr-4">Budget</th>
                <th className="text-right py-2 pr-4">Difference</th>
                <th className="text-right py-2">Variance %</th>
              </tr>
            </thead>
            <tbody>
              {monthlyVariance.map(row => {
                const isOver = row.delta > 0;
                const isUnder = row.delta < 0;
                const hasSpend = row.spend > 0;
                return (
                  <tr key={row.month} className="border-b border-gray-50">
                    <td className="py-2.5 pr-4 font-medium text-gray-800">{row.label}</td>
                    <td className="py-2.5 pr-4 text-right text-gray-800">
                      {hasSpend ? formatCurrency(row.spend) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-gray-500">{formatCurrency(row.budget)}</td>
                    <td className={`py-2.5 pr-4 text-right font-semibold ${
                      !hasSpend ? 'text-gray-300' : isOver ? 'text-red-600' : isUnder ? 'text-emerald-600' : 'text-gray-500'
                    }`}>
                      {!hasSpend ? '—' : `${isOver ? '+' : '-'}${formatCurrency(Math.abs(row.delta))}`}
                    </td>
                    <td className="py-2.5 text-right">
                      {!hasSpend ? (
                        <span className="text-gray-300">—</span>
                      ) : (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          isOver
                            ? row.pctDelta > 20 ? 'bg-red-100 text-red-700' : 'bg-red-50 text-red-600'
                            : isUnder
                              ? row.pctDelta < -20 ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-50 text-emerald-600'
                              : 'bg-gray-100 text-gray-600'
                        }`}>
                          {isOver ? '+' : ''}{row.pctDelta.toFixed(1)}%
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {monthlyVariance.filter(r => r.spend > 0).length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-gray-200">
                  <td className="py-2.5 pr-4 font-bold text-gray-800">YTD Total</td>
                  <td className="py-2.5 pr-4 text-right font-bold text-gray-800">
                    {formatCurrency(monthlyVariance.filter(r => r.spend > 0).reduce((s, r) => s + r.spend, 0))}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-bold text-gray-500">
                    {formatCurrency(monthlyVariance.filter(r => r.spend > 0).reduce((s, r) => s + r.budget, 0))}
                  </td>
                  <td className={`py-2.5 pr-4 text-right font-bold ${
                    monthlyVariance.filter(r => r.spend > 0).reduce((s, r) => s + r.delta, 0) > 0 ? 'text-red-600' : 'text-emerald-600'
                  }`}>
                    {(() => {
                      const totalDelta = monthlyVariance.filter(r => r.spend > 0).reduce((s, r) => s + r.delta, 0);
                      return `${totalDelta > 0 ? '+' : '-'}${formatCurrency(Math.abs(totalDelta))}`;
                    })()}
                  </td>
                  <td className="py-2.5 text-right">
                    {(() => {
                      const totalSpend = monthlyVariance.reduce((s, r) => s + r.spend, 0);
                      const totalBudget = monthlyVariance.filter(r => r.spend > 0).reduce((s, r) => s + r.budget, 0);
                      const pct = totalBudget > 0 ? ((totalSpend - totalBudget) / totalBudget) * 100 : 0;
                      return (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          pct > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Category Expense Drill-Down */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">Expenses by Category</h3>
          <select
            value={effectiveDrillMonth}
            onChange={e => setDrillMonth(e.target.value)}
            className="text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-600"
          >
            <option value="all">All Months</option>
            {months.filter(m => expenses.some(e => e.month === m)).map(m => (
              <option key={m} value={m}>{formatMonth(m)}</option>
            ))}
          </select>
        </div>

        {/* Category Tabs */}
        <div className="flex flex-wrap gap-1 mb-4">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setDrillCategory(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border ${
                drillCategory === cat
                  ? 'text-white shadow-sm'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
              style={drillCategory === cat ? { backgroundColor: CATEGORY_COLORS[cat], borderColor: CATEGORY_COLORS[cat] } : undefined}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        {/* Expense Table */}
        {drillExpenses.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wider">
                    <th className="text-left py-2 pr-4">Date</th>
                    <th className="text-left py-2 pr-4">Vendor</th>
                    <th className="text-left py-2 pr-4">Description</th>
                    <th className="text-right py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {drillExpenses.map((e, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">{e.date}</td>
                      <td className="py-2 pr-4 text-gray-800 font-medium">{e.vendor}</td>
                      <td className="py-2 pr-4 text-gray-500 truncate max-w-[300px]">{e.description || '—'}</td>
                      <td className="py-2 text-right font-medium text-gray-800">${e.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200">
                    <td colSpan={3} className="py-2 text-sm font-semibold text-gray-700">
                      {CATEGORY_LABELS[drillCategory]} Total ({drillExpenses.length} items)
                    </td>
                    <td className="py-2 text-right font-bold text-gray-900">${drillTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-400 text-center py-6">No {CATEGORY_LABELS[drillCategory]} expenses for {effectiveDrillMonth === 'all' ? 'this period' : formatMonth(effectiveDrillMonth)}</p>
        )}
      </div>
    </div>
  );
}
