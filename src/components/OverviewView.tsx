import { useMemo, useCallback, useState } from 'react';
import { Info } from 'lucide-react';
import { Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ComposedChart, Line, Legend, ReferenceLine } from 'recharts';
import { KPICard } from './KPICard';
import { ExportButton } from './ExportButton';
import { exportData, todayString } from '../utils/export';
import type { ExportFormat } from '../utils/export';
import type { MonthlySnapshot, CRMCustomerRecord, AmpCampaign, BillboardMonthly, OneLinkDaily } from '../types';

interface OverviewViewProps {
  snapshots: MonthlySnapshot[];
  annualBudget: number;
  customers: CRMCustomerRecord[];
  ampCampaigns?: AmpCampaign[];
  billboardData?: BillboardMonthly[];
  onelinkData?: OneLinkDaily[];
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

export function OverviewView({ snapshots, annualBudget, customers, ampCampaigns = [], billboardData = [], onelinkData = [] }: OverviewViewProps) {
  // Find the most recent month with actual spend data (skip future budget-only months)
  const latestWithData = useMemo(() => {
    for (let i = snapshots.length - 1; i >= 0; i--) {
      if (snapshots[i].totalSpend > 0 || snapshots[i].totalRevenue > 0) return snapshots[i];
    }
    return snapshots[snapshots.length - 1]; // fallback
  }, [snapshots]);

  const latest = latestWithData;
  const latestIdx = snapshots.indexOf(latest);
  const previous = latestIdx > 0 ? snapshots[latestIdx - 1] : null;

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

  // Acquisition spend categories (mirrors AttributionView logic)
  const ACQUISITION_CATS: Array<'paid_media' | 'direct_mail_print' | 'ooh' | 'sponsorship'> = ['paid_media', 'direct_mail_print', 'ooh', 'sponsorship'];

  const kpis = useMemo(() => {
    if (!latest) return null;
    const spendChange = previous ? ((latest.totalSpend - previous.totalSpend) / (previous.totalSpend || 1)) * 100 : undefined;
    const revenueChange = previous ? ((latest.totalRevenue - previous.totalRevenue) / (previous.totalRevenue || 1)) * 100 : undefined;

    // YTD spend + budget
    const currentYear = latest.month.slice(0, 4);
    const yearSnaps = snapshots.filter(s => s.month.startsWith(currentYear) && s.totalSpend > 0);
    const ytdSpend = yearSnaps.reduce((sum, s) => sum + s.totalSpend, 0);
    const budgetUsed = annualBudget > 0 ? (ytdSpend / annualBudget) * 100 : 0;

    // YTD CAC — same logic as Attribution tab: acquisition spend ÷ new customers (CRM)
    const ytdAcqSpend = yearSnaps.reduce((sum, s) => {
      const cats = s.spendByCategory || {};
      return sum + ACQUISITION_CATS.reduce((cs, cat) => cs + (cats[cat] || 0), 0);
    }, 0);
    const ytdNewCustomers = yearSnaps.reduce((sum, s) => sum + (crmNewByMonth.get(s.month) ?? s.newCustomers), 0);
    const ytdCAC = ytdNewCustomers > 0 ? Math.round(ytdAcqSpend / ytdNewCustomers) : 0;

    // YTD ROI — projected LTV / CAC approach (mirrors Attribution)
    const activeCustomers = customers.filter(c => c.lifetimeSpend > 0 && c.lifetimeVisits > 0);
    const avgLTV = activeCustomers.length > 0
      ? activeCustomers.reduce((s, c) => s + c.lifetimeSpend, 0) / activeCustomers.length
      : 0;
    const RETENTION: Record<string, number> = { WHALE: 36, LOYALIST: 24, REGULAR: 12, ROOKIE: 6, CHURNED: 0, SLIDER: 3, UNKNOWN: 6 };
    const projectedLTV = activeCustomers.length > 0
      ? activeCustomers.reduce((s, c) => {
          const ret = RETENTION[c.journeyStage] || 6;
          const basket = c.avgBasketValue || 0;
          const freq = c.purchasesPerMonth || 0;
          return s + basket * freq * ret;
        }, 0) / activeCustomers.length
      : avgLTV;
    const ytdROI = ytdCAC > 0 ? ((projectedLTV - ytdCAC) / ytdCAC) * 100 : 0;

    // 2025 comparison for CAC (mirrors Attribution: 60% est. for uncategorized 2025 spend)
    const prevYear = (parseInt(currentYear) - 1).toString();
    const prevYearSnaps = snapshots.filter(s => s.month.startsWith(prevYear) && s.month >= '2025-06' && s.totalSpend > 0);
    const prevAcqSpend = prevYearSnaps.reduce((sum, s) => sum + Math.round(s.totalSpend * 0.6), 0);
    const prevNewCustomers = prevYearSnaps.reduce((sum, s) => sum + (crmNewByMonth.get(s.month) ?? s.newCustomers), 0);
    const prevCAC = prevNewCustomers > 0 ? Math.round(prevAcqSpend / prevNewCustomers) : 0;
    const cacChange = prevCAC > 0 ? ((ytdCAC - prevCAC) / prevCAC) * 100 : undefined;

    return { spendChange, revenueChange, ytdSpend, budgetUsed, ytdCAC, ytdROI, projectedLTV, ytdNewCustomers, prevCAC, cacChange };
  }, [snapshots, latest, previous, annualBudget, crmNewByMonth, customers]);

  // ─── Funnel ───────────────────────────────────────────────────────
  type FunnelGranularity = 'monthly' | 'quarterly' | 'ytd';
  const [funnelGranularity, setFunnelGranularity] = useState<FunnelGranularity>('ytd');
  const [hoveredStage, setHoveredStage] = useState<number | null>(null);

  const funnelData = useMemo(() => {
    if (!latest) return null;

    const currentYear = latest.month.slice(0, 4);
    const currentMonth = latest.month;
    const currentQ = Math.ceil(parseInt(currentMonth.split('-')[1]) / 3);

    // Filter snapshots by granularity period
    let periodSnaps: MonthlySnapshot[];
    let periodLabel: string;
    if (funnelGranularity === 'monthly') {
      periodSnaps = snapshots.filter(s => s.month === currentMonth);
      periodLabel = formatMonth(currentMonth);
    } else if (funnelGranularity === 'quarterly') {
      const qStartMonth = ((currentQ - 1) * 3) + 1;
      const qStart = `${currentYear}-${String(qStartMonth).padStart(2, '0')}`;
      const qEnd = `${currentYear}-${String(qStartMonth + 2).padStart(2, '0')}`;
      periodSnaps = snapshots.filter(s => s.month >= qStart && s.month <= qEnd && s.month.startsWith(currentYear));
      periodLabel = `Q${currentQ} ${currentYear}`;
    } else {
      periodSnaps = snapshots.filter(s => s.month.startsWith(currentYear) && (s.totalSpend > 0 || s.totalRevenue > 0));
      periodLabel = `YTD ${currentYear}`;
    }

    // Stage 1: Total Impressions — per channel
    const periodMonths = new Set(periodSnaps.map(s => s.month));
    const metaImps = periodSnaps.reduce((sum, s) => sum + s.metaImpressions, 0);
    const googleImps = periodSnaps.reduce((sum, s) => sum + s.googleImpressions, 0);
    const billboardImps = billboardData
      .filter(b => periodMonths.has(b.month))
      .reduce((sum, b) => sum + b.impressionsDelivered, 0);
    const ctvImps = ampCampaigns
      .filter(a => periodMonths.has(a.month) && a.campaignType === 'streaming')
      .reduce((sum, a) => sum + a.impressions, 0);
    const impressions = metaImps + googleImps + billboardImps + ctvImps;

    const impressionChannels = impressions > 0 ? [
      { name: 'Billboard', pct: (billboardImps / impressions) * 100, color: '#f59e0b' },
      { name: 'Meta', pct: (metaImps / impressions) * 100, color: '#3b82f6' },
      { name: 'Google', pct: (googleImps / impressions) * 100, color: '#ef4444' },
      { name: 'CTV', pct: (ctvImps / impressions) * 100, color: '#8b5cf6' },
    ].filter(ch => ch.pct > 0) : undefined;

    // Stage 2: Clicks / Engagement — per channel
    const metaClx = periodSnaps.reduce((sum, s) => sum + s.metaClicks, 0);
    const googleClx = periodSnaps.reduce((sum, s) => sum + s.googleClicks, 0);
    const emailClx = ampCampaigns
      .filter(a => periodMonths.has(a.month) && a.campaignType === 'email')
      .reduce((sum, a) => sum + a.clicks, 0);
    const qrClx = onelinkData
      .filter(o => periodMonths.has(o.month))
      .reduce((sum, o) => sum + o.total, 0);
    const clicks = metaClx + googleClx + emailClx + qrClx;

    const clickChannels = clicks > 0 ? [
      { name: 'Meta', pct: (metaClx / clicks) * 100, color: '#3b82f6' },
      { name: 'Google', pct: (googleClx / clicks) * 100, color: '#ef4444' },
      { name: 'Email', pct: (emailClx / clicks) * 100, color: '#ec4899' },
      { name: 'QR/OneLink', pct: (qrClx / clicks) * 100, color: '#2D5A3D' },
    ].filter(ch => ch.pct > 0) : undefined;

    // Stage 3: App Signups
    const signups = periodSnaps.reduce((sum, s) => sum + (crmNewByMonth.get(s.month) ?? s.newCustomers), 0);

    // Stage 4: Active Customers (cumulative — customers with lifetime_spend > 0)
    const activeCustomers = customers.filter(c => c.lifetimeSpend > 0).length;

    // Stage 5: Loyal / Repeat — defined strictly as LOYALIST + WHALE stages
    // (moved to stage-based after April 2026 snapshot. Prior definition
    // mixed 3+ visits OR REGULAR/LOYALIST/WHALE which double-counted
    // customers who were Regular but had 3+ visits; cleaner to use the
    // Incentivio ladder directly.)
    const loyal = customers.filter(c =>
      c.journeyStage === 'LOYALIST' || c.journeyStage === 'WHALE'
    ).length;

    return {
      periodLabel,
      stages: [
        { name: 'Impressions', count: impressions, tooltip: 'Total ad impressions across all channels: Meta Ads + Google Ads + CTV Streaming + Lamar Billboard delivered impressions', channels: impressionChannels },
        { name: 'Clicks / Engagement', count: clicks, tooltip: 'Total engagement actions: Meta link clicks + Google clicks + AMP email clicks + OneLink QR scans', channels: clickChannels },
        { name: 'App Signups', count: signups, tooltip: 'New CRM accounts created (Incentivio) — customers who downloaded the app and registered' },
        { name: 'Active Customers', count: activeCustomers, tooltip: 'Customers with at least 1 purchase (lifetime spend > $0) — cumulative active base' },
        { name: 'Loyal / Repeat', count: loyal, tooltip: 'Customers classified as LOYALIST or WHALE in Incentivio journey stage' },
      ],
    };
  }, [snapshots, latest, funnelGranularity, customers, crmNewByMonth, billboardData, ampCampaigns, onelinkData]);

  // ─── Funnel sidebar data ─────────────────────────────────────────
  const funnelSidebarData = useMemo(() => {
    if (!latest) return null;
    const currentYear = latest.month.slice(0, 4);
    const currentMonth = latest.month;
    const currentQ = Math.ceil(parseInt(currentMonth.split('-')[1]) / 3);

    // Use same period filter as the funnel
    let periodSnaps: MonthlySnapshot[];
    let periodLabel: string;
    if (funnelGranularity === 'monthly') {
      periodSnaps = snapshots.filter(s => s.month === currentMonth);
      periodLabel = formatMonth(currentMonth);
    } else if (funnelGranularity === 'quarterly') {
      const qStartMonth = ((currentQ - 1) * 3) + 1;
      const qStart = `${currentYear}-${String(qStartMonth).padStart(2, '0')}`;
      const qEnd = `${currentYear}-${String(qStartMonth + 2).padStart(2, '0')}`;
      periodSnaps = snapshots.filter(s => s.month >= qStart && s.month <= qEnd && s.month.startsWith(currentYear));
      periodLabel = `Q${currentQ} ${currentYear}`;
    } else {
      periodSnaps = snapshots.filter(s => s.month.startsWith(currentYear) && s.totalSpend > 0);
      periodLabel = `YTD ${currentYear}`;
    }

    // Left: Acquisition Cost
    const paidMediaSpend = periodSnaps.reduce((sum, s) => {
      const cats = s.spendByCategory || {};
      return sum + (cats.paid_media || 0);
    }, 0);
    const periodSignups = periodSnaps.reduce((sum, s) => sum + (crmNewByMonth.get(s.month) ?? s.newCustomers), 0);
    const costPerSignup = periodSignups > 0 ? Math.round(paidMediaSpend / periodSignups) : 0;

    // Right: Funnel Efficiency
    const totalAcqSpend = periodSnaps.reduce((sum, s) => {
      const cats = s.spendByCategory || {};
      return sum + (cats.paid_media || 0) + (cats.direct_mail_print || 0) + (cats.ooh || 0) + (cats.sponsorship || 0);
    }, 0);
    const activeCustomerCount = customers.filter(c => c.lifetimeSpend > 0).length;
    const costPerActiveCustomer = activeCustomerCount > 0 ? Math.round(totalAcqSpend / activeCustomerCount) : 0;
    const totalRevenue = periodSnaps.reduce((sum, s) => sum + s.totalRevenue, 0);
    const totalSpend = periodSnaps.reduce((sum, s) => sum + s.totalSpend, 0);
    const revenuePerDollarSpent = totalSpend > 0 ? (totalRevenue / totalSpend) : 0;

    return { paidMediaSpend, costPerSignup, costPerActiveCustomer, revenuePerDollarSpent, periodLabel };
  }, [snapshots, latest, customers, crmNewByMonth, funnelGranularity]);

  const chartData = useMemo(() =>
    snapshots.map(s => ({
      month: formatMonth(s.month),
      spend: Math.round(s.totalSpend),
      revenue: Math.round(s.totalRevenue),
      budget: Math.round(s.budgetedSpend),
      spendPct: s.totalRevenue > 0 ? parseFloat(((s.totalSpend / s.totalRevenue) * 100).toFixed(1)) : 0,
    }))
  , [snapshots]);

  const avgSpendPct = useMemo(() => {
    const withData = chartData.filter(d => d.revenue > 0 && d.spend > 0);
    if (withData.length === 0) return 0;
    return parseFloat((withData.reduce((sum, d) => sum + d.spendPct, 0) / withData.length).toFixed(1));
  }, [chartData]);

  const performanceData = useMemo(() =>
    snapshots.map(s => {
      const newCust = crmNewByMonth.get(s.month) ?? s.newCustomers;
      return {
        month: formatMonth(s.month),
        totalClicks: s.metaClicks + s.googleClicks,
        newCustomers: newCust,
        costPerCustomer: s.totalSpend > 0 && newCust > 0 ? Math.round(s.totalSpend / newCust) : 0,
      };
    })
  , [snapshots, crmNewByMonth]);

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
          label={`Marketing Spend — ${formatMonth(latest.month)}`}
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
          label="Customer Acq. Cost (YTD)"
          value={formatCurrency(kpis?.ytdCAC || 0)}
          subtitle={`2025 est: ${formatCurrency(kpis?.prevCAC || 0)} · ${(kpis?.ytdNewCustomers || 0).toLocaleString()} new customers`}
          change={kpis?.cacChange}
          changeLabel="vs 2025"
          color="#f59e0b"
          tooltip="YTD Acquisition Spend (Paid Media + Direct Mail + OOH + Sponsorship) ÷ New CRM Signups"
        />
        <KPICard
          label="Est. ROI (YTD)"
          value={`${((kpis?.ytdROI || 0) / 100).toFixed(1)}x`}
          subtitle={`Projected LTV: ${formatCurrency(kpis?.projectedLTV || 0)}`}
          color="#8b5cf6"
          tooltip="(Projected LTV − CAC) ÷ CAC"
        />
        <KPICard
          label="YTD Budget Used"
          value={`${(kpis?.budgetUsed ?? 0).toFixed(1)}%`}
          subtitle={`${formatCurrency(kpis?.ytdSpend || 0)} of ${formatCurrency(annualBudget)}`}
          color={kpis && kpis.budgetUsed > 90 ? '#ef4444' : '#2D5A3D'}
        />
      </div>

      {/* Marketing Funnel */}
      {funnelData && funnelData.stages[0].count > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Marketing Funnel</h3>
              <p className="text-xs text-gray-400 mt-0.5">{funnelData.periodLabel}</p>
            </div>
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {(['monthly', 'quarterly', 'ytd'] as FunnelGranularity[]).map(g => (
                <button
                  key={g}
                  onClick={() => setFunnelGranularity(g)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    funnelGranularity === g
                      ? 'bg-white text-[#2D5A3D] shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {g === 'ytd' ? 'YTD' : g === 'quarterly' ? 'Quarterly' : 'Monthly'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[1fr_2fr_1fr] gap-4 mt-4">
            {/* Left sidebar — Acquisition Cost */}
            <div className="flex items-center">
              <div className="bg-gray-50 rounded-lg p-3 w-full border border-gray-100">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Acquisition Cost</p>
                <p className="text-[11px] text-gray-600">Paid Media Spend</p>
                <p className="text-lg font-bold text-[#2D5A3D]">{formatCurrency(funnelSidebarData?.paidMediaSpend ?? 0)} <span className="text-[10px] font-normal text-gray-400">{funnelSidebarData?.periodLabel ?? 'YTD'}</span></p>
                <p className="text-[11px] text-gray-500 mt-1">&rarr; {formatCurrency(funnelSidebarData?.costPerSignup ?? 0)} per signup</p>
              </div>
            </div>

            {/* Center — Funnel */}
            <div className="flex flex-col items-center w-full">
              {funnelData.stages.map((stage, i) => {
                const stageColors = ['#7CB342', '#5E9A30', '#458A2F', '#356F2B', '#2D5A3D'];
                const widthPcts = [100, 78, 58, 42, 30];
                const prevCount = i > 0 ? funnelData.stages[i - 1].count : null;
                const convRate = prevCount && prevCount > 0 ? ((stage.count / prevCount) * 100) : null;

                const formatCount = (n: number) => {
                  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
                  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
                  return n.toLocaleString();
                };

                return (
                  <div key={stage.name} className="w-full flex flex-col items-center">
                    {/* Conversion rate arrow between stages */}
                    {i > 0 && convRate !== null && (
                      <div className="flex items-center gap-1 py-1.5 text-gray-400">
                        <svg width="12" height="12" viewBox="0 0 12 12" className="text-gray-300">
                          <path d="M6 0 L6 8 M2 5 L6 9 L10 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                        </svg>
                        <span className="text-[11px] font-medium">{convRate.toFixed(1)}%</span>
                      </div>
                    )}

                    {/* Funnel stage trapezoid */}
                    <div
                      className="relative flex items-center justify-between px-4 py-3 rounded-lg transition-all"
                      style={{
                        width: `${widthPcts[i]}%`,
                        backgroundColor: stageColors[i],
                        minHeight: '44px',
                      }}
                    >
                      <span className="text-white text-xs font-medium truncate flex items-center gap-1.5">
                        {stage.name}
                        <span
                          className="relative inline-flex"
                          onMouseEnter={() => setHoveredStage(i)}
                          onMouseLeave={() => setHoveredStage(null)}
                        >
                          <Info size={12} className="text-white/60 cursor-help" />
                          {hoveredStage === i && (
                            <span className="absolute bottom-full left-0 mb-2 px-3 py-2 bg-gray-900 text-white text-[10px] leading-relaxed rounded-lg w-[240px] text-left z-50 shadow-lg">
                              {stage.tooltip}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="text-white text-sm font-bold ml-2 whitespace-nowrap">{formatCount(stage.count)}</span>
                    </div>
                    {stage.channels && stage.channels.length > 0 && (
                      <div className="flex rounded-full overflow-hidden h-1 mt-1" style={{ width: `${widthPcts[i]}%` }}>
                        {stage.channels.map((ch, j) => (
                          <div key={j} style={{ width: `${ch.pct}%`, backgroundColor: ch.color }} title={`${ch.name}: ${ch.pct.toFixed(0)}%`} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Right sidebar — Funnel Efficiency */}
            <div className="flex items-center">
              <div className="bg-gray-50 rounded-lg p-3 w-full border border-gray-100">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Funnel Efficiency</p>
                <p className="text-[11px] text-gray-600">Cost per Active Customer</p>
                <p className="text-lg font-bold text-[#2D5A3D]">{formatCurrency(funnelSidebarData?.costPerActiveCustomer ?? 0)}</p>
                <p className="text-[11px] text-gray-600 mt-1.5">Revenue per $1 Spent</p>
                <p className="text-lg font-bold text-[#2D5A3D]">${(funnelSidebarData?.revenuePerDollarSpent ?? 0).toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Channel Legend */}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-gray-100">
            {[
              { name: 'Billboard', color: '#f59e0b' },
              { name: 'Meta', color: '#3b82f6' },
              { name: 'Google', color: '#ef4444' },
              { name: 'CTV', color: '#8b5cf6' },
              { name: 'Email', color: '#ec4899' },
              { name: 'QR/OneLink', color: '#2D5A3D' },
            ].map(ch => (
              <div key={ch.name} className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: ch.color }} />
                <span className="text-[10px] text-gray-500">{ch.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Spend vs Revenue Chart */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">
          Spend vs Revenue (Monthly) <span className="text-gray-400 font-normal">&middot; Avg {avgSpendPct}% of Revenue</span>
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 12 }} tickFormatter={(v) => formatCurrency(v)} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} domain={[0, 'auto']} />
            <Tooltip formatter={(v: number, name: string) => name === 'Spend % of Revenue' ? `${v}%` : formatCurrency(v)} />
            <Legend />
            <Bar yAxisId="left" dataKey="revenue" name="Gross Revenue" fill="#7CB342" radius={[4,4,0,0]} />
            <Bar yAxisId="left" dataKey="spend" name="Marketing Spend" fill="#2D5A3D" radius={[4,4,0,0]} />
            <ReferenceLine yAxisId="left" y={0} stroke="transparent" />
            <Line yAxisId="right" type="monotone" dataKey="spendPct" name="Spend % of Revenue" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
            <ReferenceLine yAxisId="right" y={avgSpendPct} stroke="#f59e0b" strokeDasharray="6 3" strokeWidth={1} label={{ value: `Avg ${avgSpendPct}%`, position: 'right', fontSize: 10, fill: '#f59e0b' }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* New Customer Acquisition vs. Marketing Reach */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">New Customer Acquisition vs. Marketing Reach</h3>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={performanceData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 12 }} label={{ value: 'New Customers', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#6b7280' } }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : `$${v}`} label={{ value: 'Clicks / Cost', angle: 90, position: 'insideRight', style: { fontSize: 11, fill: '#6b7280' } }} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const newCust = (payload.find(p => p.dataKey === 'newCustomers')?.value ?? 0) as number;
                const clicks = (payload.find(p => p.dataKey === 'totalClicks')?.value ?? 0) as number;
                const cpc = (payload.find(p => p.dataKey === 'costPerCustomer')?.value ?? 0) as number;
                const clickToSignup = clicks > 0 ? ((newCust / clicks) * 100) : 0;
                return (
                  <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
                    <p className="font-semibold text-gray-800 mb-1.5">{label}</p>
                    <p className="flex justify-between gap-6">
                      <span className="text-gray-500">New Customers</span>
                      <span className="font-bold text-[#2D5A3D]">{newCust.toLocaleString()}</span>
                    </p>
                    <p className="flex justify-between gap-6">
                      <span className="text-gray-500">Total Clicks</span>
                      <span className="font-medium text-blue-600">{clicks >= 1000 ? `${(clicks / 1000).toFixed(1)}K` : clicks.toLocaleString()}</span>
                    </p>
                    <p className="flex justify-between gap-6">
                      <span className="text-gray-500">Cost / Customer</span>
                      <span className="font-medium text-amber-600">{formatCurrency(cpc)}</span>
                    </p>
                    {clicks > 0 && newCust > 0 && (
                      <div className="border-t border-gray-100 mt-1.5 pt-1.5">
                        <p className="flex justify-between gap-6 text-xs">
                          <span className="text-gray-400">Click → Signup Rate</span>
                          <span className="font-semibold text-emerald-600">{clickToSignup.toFixed(1)}%</span>
                        </p>
                      </div>
                    )}
                  </div>
                );
              }}
            />
            <Legend />
            <Bar yAxisId="left" dataKey="newCustomers" name="New Customers" fill="#2D5A3D" radius={[4,4,0,0]} />
            <Line yAxisId="right" type="monotone" dataKey="totalClicks" name="Total Clicks" stroke="#3b82f6" strokeWidth={2} strokeDasharray="6 3" dot={{ r: 3 }} />
            <Line yAxisId="right" type="monotone" dataKey="costPerCustomer" name="Cost / Customer" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
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
