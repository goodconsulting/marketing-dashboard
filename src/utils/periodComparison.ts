/**
 * Period comparison utilities for MoM, QoQ, and YoY delta calculations.
 *
 * Works with the MonthlySnapshot array produced by computeSnapshots().
 * All delta functions return both absolute and percentage changes.
 */
import type { MonthlySnapshot } from '../types';

// ─── Types ────────────────────────────────────────────────────────
export interface PeriodDelta {
  metric: string;
  current: number;
  previous: number;
  absoluteChange: number;
  percentChange: number | null;  // null when previous is 0
}

export interface PeriodComparison {
  currentPeriod: string;
  previousPeriod: string;
  deltas: PeriodDelta[];
}

// Key metrics to compare
const SNAPSHOT_METRICS: Array<{ key: keyof MonthlySnapshot; label: string }> = [
  { key: 'totalSpend', label: 'Total Spend' },
  { key: 'totalRevenue', label: 'Total Revenue' },
  { key: 'totalOrders', label: 'Total Orders' },
  { key: 'metaSpend', label: 'Meta Spend' },
  { key: 'metaImpressions', label: 'Meta Impressions' },
  { key: 'metaClicks', label: 'Meta Clicks' },
  { key: 'googleSpend', label: 'Google Spend' },
  { key: 'googleImpressions', label: 'Google Impressions' },
  { key: 'googleClicks', label: 'Google Clicks' },
  { key: 'newCustomers', label: 'New Customers' },
  { key: 'estimatedCAC', label: 'Est. CAC' },
  { key: 'estimatedROI', label: 'Est. ROI' },
  { key: 'loyaltyAccounts', label: 'Loyalty Accounts' },
  { key: 'avgOrderValue', label: 'Avg Order Value' },
  { key: 'avgLTV', label: 'Avg LTV' },
  { key: 'attritionHighCount', label: 'High Attrition Count' },
];

// ─── Month Arithmetic ─────────────────────────────────────────────
export function addMonths(month: string, offset: number): string {
  const [y, m] = month.split('-').map(Number);
  const date = new Date(y, m - 1 + offset, 1);
  const newY = date.getFullYear();
  const newM = date.getMonth() + 1;
  return `${newY}-${String(newM).padStart(2, '0')}`;
}

export function getQuarterLabel(month: string): string {
  const m = parseInt(month.split('-')[1], 10);
  const q = Math.ceil(m / 3);
  return `${month.split('-')[0]}-Q${q}`;
}

// ─── Aggregate Snapshots Over a Range ─────────────────────────────
function aggregateSnapshots(snapshots: MonthlySnapshot[]): MonthlySnapshot | null {
  if (snapshots.length === 0) return null;

  const agg: MonthlySnapshot = {
    month: `${snapshots[0].month} → ${snapshots[snapshots.length - 1].month}`,
    totalSpend: 0,
    spendByCategory: { paid_media: 0, direct_mail_print: 0, ooh: 0, software_fees: 0, labor: 0, other: 0 },
    budgetedSpend: 0,
    budgetVariance: 0,
    totalRevenue: 0,
    revenueByLocation: {},
    totalOrders: 0,
    metaImpressions: 0,
    metaClicks: 0,
    metaSpend: 0,
    googleImpressions: 0,
    googleClicks: 0,
    googleSpend: 0,
    newCustomers: 0,
    estimatedCAC: 0,
    estimatedROI: 0,
    loyaltyAccounts: 0,
    newLoyaltyAccounts: 0,
    avgOrderValue: 0,
    segmentCounts: { WHALE: 0, LOYALIST: 0, REGULAR: 0, ROOKIE: 0, CHURNED: 0, SLIDER: 0, UNKNOWN: 0 },
    attritionHighCount: 0,
    avgLTV: 0,
  };

  for (const s of snapshots) {
    agg.totalSpend += s.totalSpend;
    agg.totalRevenue += s.totalRevenue;
    agg.totalOrders += s.totalOrders;
    agg.budgetedSpend += s.budgetedSpend;
    agg.metaImpressions += s.metaImpressions;
    agg.metaClicks += s.metaClicks;
    agg.metaSpend += s.metaSpend;
    agg.googleImpressions += s.googleImpressions;
    agg.googleClicks += s.googleClicks;
    agg.googleSpend += s.googleSpend;
    agg.newCustomers += s.newCustomers;
    agg.newLoyaltyAccounts += s.newLoyaltyAccounts;

    for (const [cat, val] of Object.entries(s.spendByCategory)) {
      agg.spendByCategory[cat as keyof typeof agg.spendByCategory] += val;
    }
    for (const [loc, rev] of Object.entries(s.revenueByLocation)) {
      agg.revenueByLocation[loc] = (agg.revenueByLocation[loc] || 0) + rev;
    }
  }

  // Averages (use the last month's snapshot for point-in-time metrics)
  const last = snapshots[snapshots.length - 1];
  agg.loyaltyAccounts = last.loyaltyAccounts;
  agg.avgOrderValue = agg.totalOrders > 0 ? agg.totalRevenue / agg.totalOrders : 0;
  agg.estimatedCAC = agg.newCustomers > 0 ? agg.totalSpend / agg.newCustomers : 0;
  agg.avgLTV = last.avgLTV;
  agg.attritionHighCount = last.attritionHighCount;
  agg.segmentCounts = last.segmentCounts;
  agg.budgetVariance = agg.budgetedSpend - agg.totalSpend;

  // ROI based on aggregated figures
  const estimatedLTV = agg.avgLTV || agg.avgOrderValue * 2.5;
  agg.estimatedROI = agg.estimatedCAC > 0
    ? ((estimatedLTV - agg.estimatedCAC) / agg.estimatedCAC) * 100
    : 0;

  return agg;
}

// ─── Delta Calculation ────────────────────────────────────────────
function computeDeltas(current: MonthlySnapshot, previous: MonthlySnapshot): PeriodDelta[] {
  return SNAPSHOT_METRICS.map(({ key, label }) => {
    const curVal = current[key] as number;
    const prevVal = previous[key] as number;
    const abs = curVal - prevVal;
    const pct = prevVal !== 0 ? (abs / Math.abs(prevVal)) * 100 : null;

    return {
      metric: label,
      current: curVal,
      previous: prevVal,
      absoluteChange: abs,
      percentChange: pct !== null ? Math.round(pct * 10) / 10 : null,
    };
  });
}

// ─── Public API ───────────────────────────────────────────────────

/** Month-over-Month comparison */
export function getMoMComparison(
  snapshots: MonthlySnapshot[],
  month: string
): PeriodComparison | null {
  const prevMonth = addMonths(month, -1);
  const current = snapshots.find(s => s.month === month);
  const previous = snapshots.find(s => s.month === prevMonth);

  if (!current || !previous) return null;

  return {
    currentPeriod: month,
    previousPeriod: prevMonth,
    deltas: computeDeltas(current, previous),
  };
}

/** Quarter-over-Quarter comparison */
export function getQoQComparison(
  snapshots: MonthlySnapshot[],
  quarterEndMonth: string
): PeriodComparison | null {
  const qStart = addMonths(quarterEndMonth, -2);
  const prevQEnd = addMonths(qStart, -1);
  const prevQStart = addMonths(prevQEnd, -2);

  const currentMonths = [qStart, addMonths(qStart, 1), quarterEndMonth];
  const previousMonths = [prevQStart, addMonths(prevQStart, 1), prevQEnd];

  const currentSnaps = currentMonths
    .map(m => snapshots.find(s => s.month === m))
    .filter((s): s is MonthlySnapshot => s !== undefined);

  const previousSnaps = previousMonths
    .map(m => snapshots.find(s => s.month === m))
    .filter((s): s is MonthlySnapshot => s !== undefined);

  const currentAgg = aggregateSnapshots(currentSnaps);
  const previousAgg = aggregateSnapshots(previousSnaps);

  if (!currentAgg || !previousAgg) return null;

  return {
    currentPeriod: getQuarterLabel(quarterEndMonth),
    previousPeriod: getQuarterLabel(prevQEnd),
    deltas: computeDeltas(currentAgg, previousAgg),
  };
}

/** Year-over-Year comparison for a specific month */
export function getYoYComparison(
  snapshots: MonthlySnapshot[],
  month: string
): PeriodComparison | null {
  const prevYear = addMonths(month, -12);
  const current = snapshots.find(s => s.month === month);
  const previous = snapshots.find(s => s.month === prevYear);

  if (!current || !previous) return null;

  return {
    currentPeriod: month,
    previousPeriod: prevYear,
    deltas: computeDeltas(current, previous),
  };
}

/** Get all available months from snapshots */
export function getAvailableMonths(snapshots: MonthlySnapshot[]): string[] {
  return snapshots.map(s => s.month).sort();
}

/** Get the latest month with data */
export function getLatestMonth(snapshots: MonthlySnapshot[]): string | null {
  if (snapshots.length === 0) return null;
  return snapshots[snapshots.length - 1].month;
}
