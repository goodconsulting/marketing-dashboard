import { useMemo, useCallback, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Line, Legend, ComposedChart, Area, PieChart, Pie, Cell, LabelList,
} from 'recharts';
import { KPICard } from './KPICard';
import { ExportButton } from './ExportButton';
import { exportData, todayString } from '../utils/export';
import type { ExportFormat } from '../utils/export';
import { Users, Heart, TrendingUp, TrendingDown, Minus, Info, Tag, ArrowUpDown } from 'lucide-react';
import type { MonthlySnapshot, CRMCustomerRecord, SpendCategory, DiscountSummary, StageTransition } from '../types';
import { ReferenceLine } from 'recharts';

interface AttributionViewProps {
  snapshots: MonthlySnapshot[];
  customers: CRMCustomerRecord[];
  allCustomers: CRMCustomerRecord[];  // includes ghost accounts (0-activity signups)
  discountSummary: DiscountSummary[];
  stageTransitions: StageTransition[];
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

/** Discount category display config */
const DISCOUNT_CATEGORIES: Record<string, { label: string; color: string; description: string; examples: string[]; tracking: string }> = {
  loyalty_redemption: {
    label: 'Loyalty Redemptions', color: '#3B6D11',
    description: 'Earned rewards from loyalty program — reflects program health and retention',
    examples: ['1000 Points = Free Smoothie', 'APP – Birthday Offer', 'Birthday Offer – Free Smoothie'],
    tracking: 'Track: redemption rate vs. loyalty balance growth',
  },
  acquisition: {
    label: 'Acquisition & Referral', color: '#BA7517',
    description: 'New customer acquisition offers — highest ROI-risk category',
    examples: ['APP – Sign up offer Free Smoothie', 'Sign Up Offer – Free Smoothie', 'Referral Offer – Free Smoothie', 'Refferal Offer – New sign up'],
    tracking: 'Track: cost per new customer, LTV of acquired cohort (30/60/90 day retention)',
  },
  meal_deal: {
    label: 'Meal Deals & Bundles', color: '#2D5A3D',
    description: 'Basket-building promotions — strategic when margin per deal is positive',
    examples: ['Meal Deal', 'APP – Meal Deal', 'APP – Breakfast Deal', 'Breakfast Deal', 'Web/app – meal deal'],
    tracking: 'Track: attach rate, avg basket value, net margin per deal',
  },
  seasonal_lto: {
    label: 'Seasonal & LTO', color: '#f59e0b',
    description: 'Time-bound promotions tied to campaigns — evaluate on incremental lift',
    examples: ['BOGO Card', 'APP – FREE Egg Bite with Protein Coffee', 'VAL20', '10% off all in-store'],
    tracking: 'Track: incremental sales lift vs. discount cost',
  },
  community_service: {
    label: 'Community & Service', color: '#185FA5',
    description: 'Brand-intentional discounts for community groups — low volume, intentional',
    examples: ['Military/First Responder Discount', 'Service 20% – Heroes', 'Case Discount (20%)', 'VIP Discount'],
    tracking: 'Track: usage count + profitability; flag if usage spikes',
  },
  operations: {
    label: 'Internal & Operational', color: '#6b7280',
    description: 'Employee benefits, manager comps, spillage — COGS/labor cost, not marketing',
    examples: ['Employee Discount – Item/Check', 'Employee Meal 100%', 'Manager Comp', 'Spillage/Food Quality', 'Open $ / Open %'],
    tracking: 'Flag: Open $ / % are unstructured — monitor for misuse. Track comp cost vs. labor budget',
  },
  partner_marketing: {
    label: 'Partner & In-Kind', color: '#993556',
    description: 'Trade discounts for marketing exposure — requires documentation',
    examples: ["Momo's 20% off", '100% OFF IN-KIND MARKETING', 'Stack Influencer Program'],
    tracking: 'Ensure in-kind trades are documented with clear attribution',
  },
  other: {
    label: 'Other', color: '#d1d5db',
    description: 'Uncategorized discounts — review for proper classification',
    examples: [],
    tracking: '',
  },
};

/** Format discount period values for display */
function formatDiscountPeriod(p: string): string {
  if (p.includes('Q')) {
    // "2025-Q2" → "Q2 2025"
    const [year, q] = p.split('-');
    return `${q} ${year}`;
  }
  // "2026-01" → "Jan 2026"
  const [year, month] = p.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[parseInt(month) - 1]} ${year}`;
}

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

export function AttributionView({ snapshots, customers, allCustomers, discountSummary, stageTransitions }: AttributionViewProps) {
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

  // Projected LTV: basket × freq × retention months (weighted avg across stages).
  // Hardcoded fallbacks — used when observed sample size is below per-stage threshold.
  const HARDCODED_RETENTION_MONTHS: Record<string, number> = {
    WHALE: 36, LOYALIST: 24, REGULAR: 12, ROOKIE: 6,
    CHURNED: 0, SLIDER: 3, UNKNOWN: 6,
  };

  // Per-stage minimum sample size for trusting the observed median dwell time.
  // Thresholds reflect how rare each stage is (WHALE is naturally tiny population).
  const RETENTION_SAMPLE_THRESHOLDS: Record<string, number> = {
    ROOKIE: 200, REGULAR: 100, LOYALIST: 50, WHALE: 20,
    CHURNED: 0, SLIDER: 0, UNKNOWN: 0,
  };

  // Observed retention (median days-in-stage → months) with sample-size-gated fallback.
  const observedRetention = useMemo(() => {
    const out: Record<string, { months: number; n: number; source: 'observed' | 'fallback' }> = {};
    for (const stage of Object.keys(HARDCODED_RETENTION_MONTHS)) {
      const samples = stageTransitions
        .filter(t => t.fromStage === stage && t.daysInFromStage !== null && t.direction !== 'first_seen')
        .map(t => t.daysInFromStage as number);
      const n = samples.length;
      const threshold = RETENTION_SAMPLE_THRESHOLDS[stage] ?? 100;
      if (threshold > 0 && n >= threshold) {
        samples.sort((a, b) => a - b);
        const medianDays = samples[Math.floor(n / 2)];
        out[stage] = { months: medianDays / 30, n, source: 'observed' };
      } else {
        out[stage] = { months: HARDCODED_RETENTION_MONTHS[stage], n, source: 'fallback' };
      }
    }
    return out;
  }, [stageTransitions]);

  const overallProjectedLTV = useMemo(() => {
    const active = customers.filter(c => c.lifetimeSpend > 0 && c.lifetimeVisits > 0);
    if (active.length === 0) return 0;
    const total = active.reduce((sum, c) => {
      const retention = observedRetention[c.journeyStage]?.months ?? 6;
      return sum + c.avgBasketValue * c.purchasesPerMonth * retention;
    }, 0);
    return total / active.length;
  }, [customers, observedRetention]);

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
    // Count active customers by signup month
    const activeMap = new Map<string, { newCustomers: number; cohortRevenue90d: number }>();
    customers.forEach(c => {
      if (!c.accountCreatedDate || c.accountCreatedDate === '-') return;
      const month = c.accountCreatedDate.slice(0, 7);
      if (!month.match(/^\d{4}-\d{2}$/)) return;
      if (!activeMap.has(month)) activeMap.set(month, { newCustomers: 0, cohortRevenue90d: 0 });
      const entry = activeMap.get(month)!;
      entry.newCustomers++;
      entry.cohortRevenue90d += c.last90DaysSpend;
    });

    // Count ALL customers (including ghosts) by signup month
    const allMap = new Map<string, number>();
    allCustomers.forEach(c => {
      if (!c.accountCreatedDate || c.accountCreatedDate === '-') return;
      const month = c.accountCreatedDate.slice(0, 7);
      if (!month.match(/^\d{4}-\d{2}$/)) return;
      allMap.set(month, (allMap.get(month) ?? 0) + 1);
    });

    // Merge: active + ghost count per month
    const allMonths = new Set([...activeMap.keys(), ...allMap.keys()]);
    const monthlyData = Array.from(allMonths)
      .filter(m => m >= INCENTIVIO_START)
      .sort()
      .map(month => {
        const active = activeMap.get(month)?.newCustomers ?? 0;
        const total = allMap.get(month) ?? active;
        return {
          period: month,
          newCustomers: active,
          ghostAccounts: total - active,
          cohortRevenue90d: activeMap.get(month)?.cohortRevenue90d ?? 0,
        };
      });

    // Helper to add MoM % to a sorted array
    const addMoM = (arr: { period: string; newCustomers: number; ghostAccounts: number; cohortRevenue90d: number }[]) => {
      let prev = 0;
      return arr.map((d, i) => {
        const momPct = i > 0 && prev > 0 ? ((d.newCustomers - prev) / prev) * 100 : null;
        prev = d.newCustomers;
        return { ...d, _momPct: momPct };
      });
    };

    if (acquisitionGranularity === 'monthly') return addMoM(monthlyData);

    // Aggregate to quarters or years
    const grouped = new Map<string, { newCustomers: number; ghostAccounts: number; cohortRevenue90d: number }>();
    monthlyData.forEach(d => {
      let key: string;
      if (acquisitionGranularity === 'quarterly') {
        const [y, m] = d.period.split('-');
        const q = Math.ceil(parseInt(m) / 3);
        key = `${y} Q${q}`;
      } else {
        key = d.period.slice(0, 4);
      }
      if (!grouped.has(key)) grouped.set(key, { newCustomers: 0, ghostAccounts: 0, cohortRevenue90d: 0 });
      const g = grouped.get(key)!;
      g.newCustomers += d.newCustomers;
      g.ghostAccounts += d.ghostAccounts;
      g.cohortRevenue90d += d.cohortRevenue90d;
    });

    return addMoM(
      Array.from(grouped.entries())
        .map(([period, data]) => ({ period, ...data }))
        .sort((a, b) => a.period.localeCompare(b.period))
    );
  }, [customers, allCustomers, acquisitionGranularity]);

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

  // ─── Discount Attribution ───
  const discountPeriods = useMemo(() => {
    const set = new Set(discountSummary.map(d => d.period));
    return Array.from(set).sort();
  }, [discountSummary]);

  const [discountPeriod, setDiscountPeriod] = useState<string>('');
  // Default to most recent period on first render
  const selectedDiscountPeriod = discountPeriod || (discountPeriods.length > 0 ? discountPeriods[discountPeriods.length - 1] : '');
  const [discountMetric, setDiscountMetric] = useState<'count' | 'amount'>('count');
  const [discountSortKey, setDiscountSortKey] = useState<'usageCount' | 'discountAmount' | 'profitability' | 'pctOfTotalSales'>('usageCount');
  const [discountSortDir, setDiscountSortDir] = useState<'asc' | 'desc'>('desc');

  // Section A: Category breakdown for selected period
  const discountCategoryData = useMemo(() => {
    const filtered = discountSummary.filter(d => d.period === selectedDiscountPeriod);
    const catMap = new Map<string, { count: number; amount: number }>();
    filtered.forEach(d => {
      const existing = catMap.get(d.discountCategory) || { count: 0, amount: 0 };
      existing.count += d.usageCount;
      existing.amount += d.discountAmount;
      catMap.set(d.discountCategory, existing);
    });
    return Array.from(catMap.entries())
      .map(([cat, data]) => ({
        category: cat,
        label: DISCOUNT_CATEGORIES[cat]?.label ?? cat,
        color: DISCOUNT_CATEGORIES[cat]?.color ?? '#d1d5db',
        count: data.count,
        amount: data.amount,
      }))
      .sort((a, b) => (discountMetric === 'count' ? b.count - a.count : b.amount - a.amount));
  }, [discountSummary, selectedDiscountPeriod, discountMetric]);

  // Section B: Discount-to-Gross-Sales % trend
  // Map discount period to store-sales months for gross sales lookup
  function periodToMonths(period: string): string[] {
    if (period.includes('Q')) {
      const [year, q] = period.split('-');
      const quarter = parseInt(q.replace('Q', ''));
      const startMonth = (quarter - 1) * 3 + 1;
      return [0, 1, 2].map(i => `${year}-${String(startMonth + i).padStart(2, '0')}`);
    }
    return [period];
  }

  const discountTrendData = useMemo(() => {
    if (discountPeriods.length === 0) return [];
    return discountPeriods.map(period => {
      const periodRows = discountSummary.filter(d => d.period === period);
      const totalDiscount = periodRows.reduce((s, d) => s + d.discountAmount, 0);
      // Use actual store gross sales from snapshots
      const months = periodToMonths(period);
      const grossSales = snapshots
        .filter(s => months.includes(s.month))
        .reduce((sum, s) => sum + s.totalRevenue, 0);
      const pct = grossSales > 0 ? (totalDiscount / grossSales) * 100 : 0;
      return {
        period: formatDiscountPeriod(period),
        rawPeriod: period,
        discountPct: Math.round(pct * 100) / 100,
        totalDiscount: Math.round(totalDiscount),
        grossSales: Math.round(grossSales),
      };
    });
  }, [discountSummary, discountPeriods, snapshots]);

  // Section C: Top discounts table for selected period
  const topDiscounts = useMemo(() => {
    const filtered = discountSummary
      .filter(d => d.period === selectedDiscountPeriod)
      .sort((a, b) => {
        const aVal = a[discountSortKey];
        const bVal = b[discountSortKey];
        return discountSortDir === 'desc' ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number);
      })
      .slice(0, 10);
    return filtered;
  }, [discountSummary, selectedDiscountPeriod, discountSortKey, discountSortDir]);

  const handleDiscountSort = (key: typeof discountSortKey) => {
    if (discountSortKey === key) {
      setDiscountSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setDiscountSortKey(key);
      setDiscountSortDir('desc');
    }
  };

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
                <p className="text-[10px] text-gray-400 mt-0.5">Since Jun 2025 · Active customers (green) + ghost accounts (gray)</p>
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
            <ComposedChart data={acquisitionData} margin={{ top: 28, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const activeCust = (payload.find(p => p.dataKey === 'newCustomers')?.value ?? 0) as number;
                  const ghost = (payload.find(p => p.dataKey === 'ghostAccounts')?.value ?? 0) as number;
                  const total = activeCust + ghost;
                  const dataPoint = acquisitionData.find(d => d.period === label);
                  const momPct = dataPoint?._momPct;
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
                      <p className="font-semibold text-gray-800 mb-1.5">{label}</p>
                      <p className="flex justify-between gap-4 text-emerald-700">
                        <span>Active Customers</span>
                        <span className="font-medium">{activeCust.toLocaleString()}</span>
                      </p>
                      <p className="flex justify-between gap-4 text-gray-400">
                        <span>Ghost Accounts</span>
                        <span className="font-medium">{ghost.toLocaleString()}</span>
                      </p>
                      <p className="flex justify-between gap-4 font-bold text-gray-900 border-t border-gray-100 pt-1.5 mt-1.5">
                        <span>Total Signups</span>
                        <span>{total.toLocaleString()}</span>
                      </p>
                      {momPct !== null && momPct !== undefined && (
                        <p className={`text-xs mt-1 ${momPct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          MoM: {momPct >= 0 ? '+' : ''}{momPct.toFixed(1)}%
                        </p>
                      )}
                    </div>
                  );
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="newCustomers" name="Active Customers" stackId="acq" fill="#2D5A3D" radius={[0, 0, 0, 0]} />
              <Bar dataKey="ghostAccounts" name="Ghost Accounts" stackId="acq" fill="#d1d5db" radius={[4, 4, 0, 0]}>
                <LabelList
                  dataKey="_momPct"
                  position="top"
                  content={({ x, y, width, value }: { x?: number; y?: number; width?: number; value?: unknown }) => {
                    if (value === null || value === undefined) return null;
                    const n = Number(value);
                    const color = n >= 0 ? '#059669' : '#dc2626';
                    const label = `${n >= 0 ? '+' : ''}${n.toFixed(0)}%`;
                    return (
                      <text x={(x || 0) + (width || 0) / 2} y={(y || 0) - 6} textAnchor="middle" fill={color} fontSize={10} fontWeight={700}>
                        {label}
                      </text>
                    );
                  }}
                />
              </Bar>
              <Line type="monotone" dataKey="newCustomers" stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="4 4" dot={false} legendType="none" />
            </ComposedChart>
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
        <p className="text-xs text-gray-400 mb-1">
          Estimated LTV = Avg Basket &times; Purchases/Mo &times; Retention Months (by stage) &middot; Weighted avg across {customers.filter(c => c.lifetimeVisits > 0).length.toLocaleString()} active accounts
        </p>
        <p className="text-[10px] text-gray-400 mb-4">
          Retention: {['ROOKIE','REGULAR','LOYALIST','WHALE'].map(s => {
            const r = observedRetention[s];
            if (!r) return null;
            return `${s}: ${r.months.toFixed(1)}mo ${r.source === 'observed' ? `(observed, n=${r.n})` : '(fallback)'}`;
          }).filter(Boolean).join(' · ')}
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

      {/* ─── Discount Attribution ─── */}
      {discountSummary.length > 0 && (
        <>
          <div className="border-t border-gray-200 pt-6 mt-2">
            <div className="flex items-center gap-2 mb-4">
              <Tag size={18} className="text-purple-600" />
              <h2 className="text-lg font-semibold text-gray-900">Discount Attribution</h2>
            </div>
          </div>

          {/* Section A: Category Breakdown */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Discount Usage by Category</h3>
              <div className="flex items-center gap-3">
                {/* Count / Amount toggle */}
                <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                  {(['count', 'amount'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setDiscountMetric(m)}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                        discountMetric === m
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {m === 'count' ? 'Count' : 'Dollar Amount'}
                    </button>
                  ))}
                </div>
                {/* Period selector */}
                <select
                  value={selectedDiscountPeriod}
                  onChange={e => setDiscountPeriod(e.target.value)}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700"
                >
                  {discountPeriods.map(p => (
                    <option key={p} value={p}>{formatDiscountPeriod(p)}</option>
                  ))}
                </select>
              </div>
            </div>

            {discountCategoryData.length > 0 ? (
              <>
                {/* Horizontal stacked bar */}
                {(() => {
                  const total = discountCategoryData.reduce((s, d) => s + (discountMetric === 'count' ? d.count : d.amount), 0);
                  return (
                    <div className="mb-4">
                      <div className="w-full h-8 rounded-lg overflow-hidden flex bg-gray-100">
                        {discountCategoryData.map(d => {
                          const val = discountMetric === 'count' ? d.count : d.amount;
                          const pct = total > 0 ? (val / total) * 100 : 0;
                          if (pct < 0.5) return null;
                          return (
                            <div
                              key={d.category}
                              className="h-full transition-all relative group"
                              style={{ width: `${pct}%`, backgroundColor: d.color }}
                              title={`${d.label}: ${discountMetric === 'count' ? val.toLocaleString() : formatCurrency(val)} (${pct.toFixed(1)}%)`}
                            >
                              {pct > 8 && (
                                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white truncate px-1">
                                  {pct.toFixed(0)}%
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Category legend with values */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {discountCategoryData.map(d => {
                    const cat = DISCOUNT_CATEGORIES[d.category];
                    return (
                      <div key={d.category} className="flex items-center gap-2 text-xs text-gray-600">
                        <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: d.color }} />
                        <span className="truncate">{d.label}</span>
                        {cat && (
                          <span className="relative group inline-flex shrink-0">
                            <Info size={11} className="text-gray-400 cursor-help" />
                            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-3 py-2 bg-gray-800 text-white text-[10px] leading-snug rounded shadow-lg max-w-[280px] w-max opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 text-left">
                              <span className="font-semibold block mb-0.5">{cat.label}</span>
                              <span className="block mb-1">{cat.description}</span>
                              {cat.examples.length > 0 && (
                                <span className="block mb-1">
                                  {cat.examples.map((ex, i) => (
                                    <span key={i} className="block">• {ex}</span>
                                  ))}
                                </span>
                              )}
                              {cat.tracking && <span className="block italic text-gray-300">{cat.tracking}</span>}
                            </span>
                          </span>
                        )}
                        <span className="ml-auto font-medium text-gray-800">
                          {discountMetric === 'count' ? d.count.toLocaleString() : formatCurrency(d.amount)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">No discount data for this period</p>
            )}
          </div>

          {/* Section B: Discount-to-Gross-Sales % Trend */}
          {discountTrendData.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-1">Discount-to-Gross-Sales % Trend</h3>
              <p className="text-xs text-gray-400 mb-4">Total discount as a percentage of gross sales (discount + profitability) per period</p>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={discountTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} domain={[0, 'auto']} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v)} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const pct = payload.find(p => p.dataKey === 'discountPct');
                      const amt = payload.find(p => p.dataKey === 'totalDiscount');
                      return (
                        <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
                          <p className="font-semibold text-gray-800 mb-1.5">{label}</p>
                          {pct && (
                            <p className="flex justify-between gap-4" style={{ color: '#8b5cf6' }}>
                              <span>Discount % of Gross</span>
                              <span className="font-medium">{(pct.value as number).toFixed(2)}%</span>
                            </p>
                          )}
                          {amt && (
                            <p className="flex justify-between gap-4" style={{ color: '#f59e0b' }}>
                              <span>Total Discounts</span>
                              <span className="font-medium">{formatCurrency(amt.value as number)}</span>
                            </p>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Legend />
                  <ReferenceLine yAxisId="left" y={discountTrendData.reduce((s, d) => s + d.discountPct, 0) / discountTrendData.length} stroke="#a78bfa" strokeDasharray="5 5" label={{ value: 'Avg', fill: '#a78bfa', fontSize: 10 }} />
                  <Bar yAxisId="right" dataKey="totalDiscount" name="Total Discounts ($)" fill="#f59e0b" radius={[4, 4, 0, 0]} opacity={0.6} />
                  <Line yAxisId="left" type="monotone" dataKey="discountPct" name="Discount % of Gross Sales" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4, fill: '#8b5cf6' }}>
                    <LabelList dataKey="discountPct" position="top" formatter={(v: number) => `${v.toFixed(1)}%`} style={{ fontSize: 10, fill: '#8b5cf6', fontWeight: 600 }} />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Section C: Top Discounts Table */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">
                Top 10 Discounts
                <span className="ml-2 text-xs font-normal text-gray-400">({formatDiscountPeriod(selectedDiscountPeriod)})</span>
              </h3>
              <select
                value={selectedDiscountPeriod}
                onChange={e => setDiscountPeriod(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700"
              >
                {discountPeriods.map(p => (
                  <option key={p} value={p}>{formatDiscountPeriod(p)}</option>
                ))}
              </select>
            </div>
            {topDiscounts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-100">
                      <th className="pb-2 pr-4">Discount Name</th>
                      <th className="pb-2 pr-4">Category</th>
                      <th className="pb-2 text-right pr-4 cursor-pointer select-none" onClick={() => handleDiscountSort('usageCount')}>
                        <span className="inline-flex items-center gap-1">Count <ArrowUpDown size={12} className={discountSortKey === 'usageCount' ? 'text-gray-800' : 'text-gray-300'} /></span>
                      </th>
                      <th className="pb-2 text-right pr-4 cursor-pointer select-none" onClick={() => handleDiscountSort('discountAmount')}>
                        <span className="inline-flex items-center gap-1">Amount <ArrowUpDown size={12} className={discountSortKey === 'discountAmount' ? 'text-gray-800' : 'text-gray-300'} /></span>
                      </th>
                      <th className="pb-2 text-right pr-4 cursor-pointer select-none" onClick={() => handleDiscountSort('profitability')}>
                        <span className="inline-flex items-center gap-1">Profitability <ArrowUpDown size={12} className={discountSortKey === 'profitability' ? 'text-gray-800' : 'text-gray-300'} /></span>
                      </th>
                      <th className="pb-2 text-right cursor-pointer select-none" onClick={() => handleDiscountSort('pctOfTotalSales')}>
                        <span className="inline-flex items-center gap-1">% of Sales <ArrowUpDown size={12} className={discountSortKey === 'pctOfTotalSales' ? 'text-gray-800' : 'text-gray-300'} /></span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {topDiscounts.map((d, i) => {
                      const catConfig = DISCOUNT_CATEGORIES[d.discountCategory];
                      return (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="py-2 pr-4 text-gray-800 font-medium max-w-[200px] truncate" title={d.discountName}>
                            {d.discountName}
                          </td>
                          <td className="py-2 pr-4">
                            <span
                              className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium text-white"
                              style={{ backgroundColor: catConfig?.color ?? '#d1d5db' }}
                            >
                              {catConfig?.label ?? d.discountCategory}
                            </span>
                          </td>
                          <td className="py-2 text-right pr-4 tabular-nums">{d.usageCount.toLocaleString()}</td>
                          <td className="py-2 text-right pr-4 tabular-nums">{formatCurrency(d.discountAmount)}</td>
                          <td className="py-2 text-right pr-4 tabular-nums">{formatCurrency(d.profitability)}</td>
                          <td className="py-2 text-right tabular-nums">{d.pctOfTotalSales.toFixed(2)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">No discount data for this period</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
