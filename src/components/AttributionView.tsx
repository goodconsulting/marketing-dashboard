import { useMemo, useCallback, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Line, Legend, ComposedChart, Area, PieChart, Pie, Cell, LabelList,
} from 'recharts';
import { KPICard } from './KPICard';
import { ExportButton } from './ExportButton';
import { exportData, todayString } from '../utils/export';
import type { ExportFormat } from '../utils/export';
import { Users, Heart, TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';
import type { MonthlySnapshot, CRMCustomerRecord, SpendCategory } from '../types';

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

/** Only show CAC / LTV / ROI trend data from when Incentivio tracking began */
const INCENTIVIO_START = '2025-06';

/** 2025 spend isn't categorized, so only ~60% is attributed to acquisition */
const MARKETING_ATTRIBUTION_FACTOR_2025 = 0.6;
const FULL_ATTRIBUTION_YEAR = '2026';

/** Acquisition-relevant spend categories (excludes labor, software_fees, other) */
const ACQUISITION_CATEGORIES: SpendCategory[] = ['paid_media', 'direct_mail_print', 'ooh', 'sponsorship'];

function getAcquisitionSpend(spendByCategory: Record<SpendCategory, number>): number {
  return ACQUISITION_CATEGORIES.reduce((sum, cat) => sum + (spendByCategory[cat] || 0), 0);
}

function getAttributedSpend(
  totalSpend: number,
  month: string,
  spendByCategory?: Record<SpendCategory, number>,
): { spend: number; isEstimated: boolean } {
  const isEstimated = month < FULL_ATTRIBUTION_YEAR;
  if (isEstimated) {
    // 2025: no category breakdown available, use 60% estimate of total
    return { spend: Math.round(totalSpend * MARKETING_ATTRIBUTION_FACTOR_2025), isEstimated };
  }
  // 2026+: use actual acquisition categories (paid media, direct mail, OOH, sponsorship)
  const acqSpend = spendByCategory ? getAcquisitionSpend(spendByCategory) : totalSpend;
  return { spend: Math.round(acqSpend), isEstimated };
}

function EstimatedBadge() {
  return (
    <span className="relative group ml-1.5 inline-flex">
      <Info size={14} className="text-amber-500 cursor-help" />
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-800 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
        2025 uses 60% est. · 2026 uses acquisition categories only
      </span>
    </span>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function CACTooltip({ active, payload, label }: any) {
  if (!active || !payload) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((entry: any) => {
        const isEstMonth = entry.payload?.isEstimated;
        const isCACField = entry.dataKey === 'cac';
        return (
          <p key={entry.dataKey} className="flex items-center gap-1.5" style={{ color: entry.color }}>
            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: entry.color }} />
            {entry.name}: {isCACField ? `$${entry.value}` : entry.value.toLocaleString()}
            {isCACField && isEstMonth && <span className="text-amber-500 font-medium">(60% est.)</span>}
          </p>
        );
      })}
    </div>
  );
}

function LTVCACTooltip({ active, payload, label }: any) {
  if (!active || !payload) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-md px-3 py-2 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((entry: any) => {
        const isEstMonth = entry.payload?.isEstimated;
        const isCACField = entry.dataKey === 'cac';
        const isROI = entry.dataKey === 'roi';
        return (
          <p key={entry.dataKey} className="flex items-center gap-1.5" style={{ color: entry.color }}>
            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: entry.color }} />
            {entry.name}: {isROI ? `${(entry.value / 100).toFixed(2)}x` : `$${entry.value}`}
            {isCACField && isEstMonth && <span className="text-amber-500 font-medium">(60% est.)</span>}
          </p>
        );
      })}
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function AttributionView({ snapshots, customers }: AttributionViewProps) {
  const latest = snapshots[snapshots.length - 1];
  const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;

  // Build month → new-customer count from CRM records (ground truth)
  const crmNewByMonth = useMemo(() => {
    const map = new Map<string, number>();
    customers.forEach(c => {
      if (!c.accountCreatedDate || c.accountCreatedDate === '-') return;
      const month = c.accountCreatedDate.slice(0, 7);
      if (!month.match(/^\d{4}-\d{2}$/)) return;
      map.set(month, (map.get(month) ?? 0) + 1);
    });
    return map;
  }, [customers]);

  // Overall avg CRM lifetime spend — used as actual LTV for CAC/ROI calculations
  const overallCrmLTV = useMemo(() => {
    const active = customers.filter(c => c.lifetimeSpend > 0 && c.lifetimeVisits > 0);
    if (active.length === 0) return 0;
    return active.reduce((sum, c) => sum + c.lifetimeSpend, 0) / active.length;
  }, [customers]);

  // Projected LTV: basket × freq × retention months (weighted avg across stages)
  const RETENTION_MONTHS_ATTR: Record<string, number> = {
    WHALE: 36, LOYALIST: 24, REGULAR: 12, ROOKIE: 6,
    CHURNED: 0, SLIDER: 3, UNKNOWN: 6,
  };

  const overallProjectedLTV = useMemo(() => {
    const active = customers.filter(c => c.lifetimeSpend > 0 && c.lifetimeVisits > 0);
    if (active.length === 0) return 0;
    const total = active.reduce((sum, c) => {
      const retention = RETENTION_MONTHS_ATTR[c.journeyStage] || 6;
      return sum + c.avgBasketValue * c.purchasesPerMonth * retention;
    }, 0);
    return total / active.length;
  }, [customers]);

  const cacTrend = useMemo(() =>
    snapshots
      .filter(s => s.month >= INCENTIVIO_START)
      .map(s => {
        // Prefer CRM-derived count; fall back to Incentivio aggregate
        const newCust = crmNewByMonth.get(s.month) ?? s.newCustomers;
        const { spend, isEstimated } = getAttributedSpend(s.totalSpend, s.month, s.spendByCategory);
        const cac = newCust > 0 ? Math.round(spend / newCust) : 0;
        // Use actual CRM lifetime spend as LTV; fall back to AOV×2.5 only when no CRM data
        const estimatedLTV = overallCrmLTV > 0 ? Math.round(overallCrmLTV) : Math.round(s.avgOrderValue * 2.5);
        const roi = newCust > 0 && cac > 0 ? Math.round(((estimatedLTV - cac) / cac) * 100) : 0;
        return {
          month: formatMonth(s.month),
          rawMonth: s.month,
          cac,
          roi,
          newCustomers: newCust,
          spend,
          estimatedLTV,
          isEstimated,
        };
      })
  , [snapshots, crmNewByMonth, overallCrmLTV]);

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

  // LTV analysis — scoped to Incentivio era, using CRM-derived new-customer counts
  const ltvData = useMemo(() =>
    snapshots
      .filter(s => s.month >= INCENTIVIO_START)
      .map(s => {
        const estimatedLTV = overallCrmLTV > 0 ? Math.round(overallCrmLTV) : Math.round(s.avgOrderValue * 2.5);
        const newCust = crmNewByMonth.get(s.month) ?? s.newCustomers;
        const { spend, isEstimated } = getAttributedSpend(s.totalSpend, s.month, s.spendByCategory);
        const cac = newCust > 0 ? Math.round(spend / newCust) : 0;
        const roi = newCust > 0 && cac > 0 ? Math.round(((estimatedLTV - cac) / cac) * 100) : 0;
        return {
          month: formatMonth(s.month),
          rawMonth: s.month,
          avgOrderValue: Math.round(s.avgOrderValue * 100) / 100,
          estimatedLTV,
          cac,
          roi,
          ltvCacRatio: cac > 0 ? Math.round((estimatedLTV / cac) * 100) / 100 : 0,
          isEstimated,
        };
      })
  , [snapshots, crmNewByMonth, overallCrmLTV]);

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
      .filter(d => d.period >= INCENTIVIO_START)
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

  // ─── Period comparison for New Customer Acquisition (MoM / QoQ / YoY) ───
  const acquisitionComparison = useMemo(() => {
    if (acquisitionData.length < 2) return null;
    const current = acquisitionData[acquisitionData.length - 1];
    const prev = acquisitionData[acquisitionData.length - 2];
    if (!prev || prev.newCustomers === 0) return null;
    const value = ((current.newCustomers - prev.newCustomers) / prev.newCustomers) * 100;
    const labelMap = { monthly: 'MoM', quarterly: 'QoQ', yearly: 'YoY' } as const;
    return {
      value,
      currentPeriod: current.period,
      prevPeriod: prev.period,
      label: labelMap[acquisitionGranularity],
    };
  }, [acquisitionData, acquisitionGranularity]);

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

  // ─── YTD Metrics: 2026 vs 2025 for KPI comparisons ───
  const ytdMetrics = useMemo(() => {
    // Only include months with actual expense data so CAC isn't diluted by months with
    // customers but no uploaded spend data
    const y26 = snapshots.filter(s => s.month.startsWith('2026') && s.totalSpend > 0);
    const y25 = snapshots.filter(s => s.month.startsWith('2025') && s.month >= INCENTIVIO_START && s.totalSpend > 0);

    const sum26Spend = y26.reduce((s, snap) => s + getAttributedSpend(snap.totalSpend, snap.month, snap.spendByCategory).spend, 0);
    const sum25Spend = y25.reduce((s, snap) => s + getAttributedSpend(snap.totalSpend, snap.month, snap.spendByCategory).spend, 0);

    const new26 = y26.reduce((s, snap) => s + (crmNewByMonth.get(snap.month) ?? snap.newCustomers), 0);
    const new25 = y25.reduce((s, snap) => s + (crmNewByMonth.get(snap.month) ?? snap.newCustomers), 0);

    // Also compute total new customers across ALL months (including those without spend)
    const allNew26 = snapshots.filter(s => s.month.startsWith('2026'))
      .reduce((s, snap) => s + (crmNewByMonth.get(snap.month) ?? snap.newCustomers), 0);
    const allNew25 = snapshots.filter(s => s.month.startsWith('2025') && s.month >= INCENTIVIO_START)
      .reduce((s, snap) => s + (crmNewByMonth.get(snap.month) ?? snap.newCustomers), 0);

    const cac26 = new26 > 0 ? sum26Spend / new26 : 0;
    const cac25 = new25 > 0 ? sum25Spend / new25 : 0;
    const cacChange = cac25 > 0 ? ((cac26 - cac25) / cac25) * 100 : null;

    const custChange = allNew25 > 0 ? ((allNew26 - allNew25) / allNew25) * 100 : null;

    // Avg basket from CRM by signup cohort year
    const basket26Custs = customers.filter(c => c.accountCreatedDate?.startsWith('2026') && c.avgBasketValue > 0);
    const basket25Custs = customers.filter(c => c.accountCreatedDate?.startsWith('2025') && c.avgBasketValue > 0);
    const avgBasket26 = basket26Custs.length > 0
      ? basket26Custs.reduce((s, c) => s + c.avgBasketValue, 0) / basket26Custs.length : 0;
    const avgBasket25 = basket25Custs.length > 0
      ? basket25Custs.reduce((s, c) => s + c.avgBasketValue, 0) / basket25Custs.length : 0;
    const basketChange = avgBasket25 > 0 ? ((avgBasket26 - avgBasket25) / avgBasket25) * 100 : null;

    return { cac26, cac25, cacChange, new26: allNew26, new25: allNew25, custChange, avgBasket26, avgBasket25, basketChange };
  }, [snapshots, crmNewByMonth, customers]);

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

  // Projected ROI uses projected LTV for a forward-looking view
  const projectedROI = ytdMetrics.cac26 > 0
    ? ((overallProjectedLTV - ytdMetrics.cac26) / ytdMetrics.cac26) * 100
    : 0;

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
          value={formatCurrency(ytdMetrics.cac26)}
          subtitle={`2025 est: ${formatCurrency(ytdMetrics.cac25)}`}
          change={ytdMetrics.cacChange ?? undefined}
          changeLabel="vs 2025"
          tooltip="YTD 2026 · Acquisition spend only (Paid Media + Direct Mail + OOH + Sponsorship) · 2025 uses 60% est."
          color="#f59e0b"
        />
        <KPICard
          label="Estimated ROI"
          value={`${(projectedROI / 100).toFixed(2)}x`}
          subtitle={`Projected LTV: ${formatCurrency(overallProjectedLTV)}`}
          color={projectedROI > 100 ? '#10b981' : '#ef4444'}
        />
        <KPICard
          label="New Customers"
          value={ytdMetrics.new26.toLocaleString()}
          subtitle={`2025: ${ytdMetrics.new25.toLocaleString()}`}
          change={ytdMetrics.custChange ?? undefined}
          changeLabel="vs 2025"
          color="#2D5A3D"
        />
        <KPICard
          label="Avg Order Value"
          value={formatCurrency(ytdMetrics.avgBasket26 > 0 ? ytdMetrics.avgBasket26 : latest.avgOrderValue)}
          subtitle={`2025: ${formatCurrency(ytdMetrics.avgBasket25 > 0 ? ytdMetrics.avgBasket25 : latest.avgOrderValue)}`}
          change={ytdMetrics.basketChange ?? undefined}
          changeLabel="vs 2025"
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
                <p className="text-[10px] text-gray-400 mt-0.5">Since Jun 2025 · Active accounts only (excludes 0-activity signups)</p>
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

          {/* Period comparison footer (MoM / QoQ / YoY) */}
          {acquisitionComparison && (
            <div className="border-t border-gray-100 pt-3 mt-2 flex items-center gap-2 text-sm">
              {acquisitionComparison.value > 0 ? (
                <TrendingUp size={16} className="text-emerald-500" />
              ) : acquisitionComparison.value < 0 ? (
                <TrendingDown size={16} className="text-red-500" />
              ) : (
                <Minus size={16} className="text-gray-400" />
              )}
              <span className={`font-semibold ${acquisitionComparison.value > 0 ? 'text-emerald-600' : acquisitionComparison.value < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                {acquisitionComparison.value > 0 ? '+' : ''}{acquisitionComparison.value.toFixed(1)}% {acquisitionComparison.label}
              </span>
              <span className="text-xs text-gray-400">
                ({acquisitionComparison.prevPeriod} → {acquisitionComparison.currentPeriod})
              </span>
            </div>
          )}
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
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center">
          CAC & New Customer Trend
          {cacTrend.some(d => d.isEstimated) && <EstimatedBadge />}
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={cacTrend}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
            <Tooltip content={<CACTooltip />} />
            <Legend />
            <Bar yAxisId="right" dataKey="newCustomers" name="New Customers" fill="#7CB342" radius={[4,4,0,0]} />
            <Line yAxisId="left" type="monotone" dataKey="cac" name="CAC ($)" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* LTV vs CAC + ROI */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-1 flex items-center">
          LTV vs CAC
          {ltvData.some(d => d.isEstimated) && <EstimatedBadge />}
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          Estimated LTV = Avg Basket &times; Purchases/Mo &times; Retention Months (by stage) &middot; Weighted avg across {customers.filter(c => c.lifetimeVisits > 0).length.toLocaleString()} active accounts
        </p>
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={ltvData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} tickFormatter={(v) => `${(v / 100).toFixed(1)}x`} />
            <Tooltip content={<LTVCACTooltip />} />
            <Legend />
            <Bar yAxisId="left" dataKey="estimatedLTV" name="Estimated LTV" fill="#10b981" radius={[4,4,0,0]} />
            <Bar yAxisId="left" dataKey="cac" name="CAC" fill="#ef4444" radius={[4,4,0,0]} />
            <Area yAxisId="right" type="monotone" dataKey="roi" fill="#dcfce7" stroke="none" name="ROI Area" legendType="none" />
            <Line yAxisId="right" type="monotone" dataKey="roi" name="ROI" stroke="#2D5A3D" strokeWidth={3} dot={{ r: 4, fill: '#2D5A3D' }}>
              <LabelList dataKey="roi" position="top" formatter={(v: number) => `${(v / 100).toFixed(1)}x`} style={{ fontSize: 10, fill: '#2D5A3D', fontWeight: 600 }} />
            </Line>
          </ComposedChart>
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
