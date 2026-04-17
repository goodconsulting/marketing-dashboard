import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend,
} from 'recharts';
import { ChevronRight, ChevronDown, QrCode, Mail, Tv, LayoutDashboard } from 'lucide-react';
import { KPICard } from './KPICard';
import { ExportButton } from './ExportButton';
import { exportData, todayString } from '../utils/export';
import type { ExportFormat } from '../utils/export';
import { fetchMetaAdSets } from '../api/dataApi';
import type { MetaCampaign, MetaAdSet, GoogleCampaign, OneLinkDaily, AmpCampaign, BillboardMonthly, OtherCampaign } from '../types';

// ── Helpers ────────────────────────────────────────────────────────────

interface PerformanceViewProps {
  metaCampaigns: MetaCampaign[];
  googleCampaigns: GoogleCampaign[];
  onelinkData: OneLinkDaily[];
  ampCampaigns: AmpCampaign[];
  billboardData: BillboardMonthly[];
  otherCampaigns: OtherCampaign[];
}

/** One row in the cross-channel summary table. */
interface ChannelSummaryRow {
  channel: string;
  color: string;
  spend: number | null;          // null = unavailable (linked to expense row, pending invoice, etc.)
  spendNote?: string;            // shown in place of a spend number when null
  impressions: number;
  clicks: number | null;         // null = not applicable (OOH, CTV)
  conversions: number | null;
  ctr: number | null;
  costPerConv: number | null;
  footnote?: string;             // small italic note below channel name
}

/** Color map for OneLink campaign sources. */
const ONELINK_COLORS: Record<string, string> = {
  direct_mail: '#f59e0b',
  valpak: '#ec4899',
  meta_ads: '#3b82f6',
  app_download: '#2D5A3D',
  original: '#6b7280',
};

/** Fallback color for unknown campaign sources. */
function onelinkColor(source: string): string {
  return ONELINK_COLORS[source] ?? '#8b5cf6';
}

/** Unified row for the combined campaign details table. */
interface CombinedCampaignRow {
  source: 'Meta' | 'Google';
  month: string;
  campaignName: string;
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
  cpr: number;
}

/** Filter option for the dropdown. */
interface FilterOption {
  label: string;
  value: string;
  group: 'Yearly' | 'Quarterly' | 'Monthly';
}

function formatCurrency(n: number): string {
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/** Human-readable month label — "Feb 2025", "Oct 2025", etc. */
function monthLabel(m: string): string {
  const [y, mo] = m.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(mo, 10) - 1]} ${y}`;
}

/** Returns current YYYY-MM. */
function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Returns quarter number (1–4) for a YYYY-MM string. */
function quarterOf(m: string): number {
  const mo = parseInt(m.split('-')[1], 10);
  return Math.ceil(mo / 3);
}

/**
 * Converts a compound filter value into a set of matching YYYY-MM strings,
 * or returns 'all' for the "All Time" option.
 *
 * Filter value formats:
 *   "all"          → 'all'
 *   "2025-08"      → Set(["2025-08"])
 *   "year:2025"    → Set of all months in allMonths with year 2025
 *   "ytd:2026"     → Set of months in 2026 up to currentYearMonth()
 *   "q:2025-Q2"    → Set of months in 2025 Q2 (04, 05, 06)
 */
function resolveFilterMonths(filterValue: string, allMonths: string[]): Set<string> | 'all' {
  if (filterValue === 'all') return 'all';

  // Single month — "2025-08"
  if (/^\d{4}-\d{2}$/.test(filterValue)) {
    return new Set([filterValue]);
  }

  // Full year — "year:2025"
  if (filterValue.startsWith('year:')) {
    const year = filterValue.slice(5);
    return new Set(allMonths.filter(m => m.startsWith(year)));
  }

  // Year-to-date — "ytd:2026"
  if (filterValue.startsWith('ytd:')) {
    const year = filterValue.slice(4);
    const ceiling = currentYearMonth();
    return new Set(allMonths.filter(m => m.startsWith(year) && m <= ceiling));
  }

  // Quarter — "q:2025-Q2"
  if (filterValue.startsWith('q:')) {
    const [year, qStr] = filterValue.slice(2).split('-Q');
    const q = parseInt(qStr, 10);
    return new Set(allMonths.filter(m => m.startsWith(year) && quarterOf(m) === q));
  }

  return 'all';
}

/**
 * Builds a structured list of filter options grouped by Yearly, Quarterly,
 * and Monthly from the set of all available months.
 */
function buildFilterOptions(allMonths: string[]): FilterOption[] {
  const options: FilterOption[] = [];
  const now = currentYearMonth();
  const currentYear = now.slice(0, 4);

  // Collect unique years (most recent first)
  const years = [...new Set(allMonths.map(m => m.slice(0, 4)))].sort().reverse();

  // ── Yearly options ──
  for (const year of years) {
    if (year === currentYear) {
      options.push({ label: `${year} YTD`, value: `ytd:${year}`, group: 'Yearly' });
    } else {
      options.push({ label: year, value: `year:${year}`, group: 'Yearly' });
    }
  }

  // ── Quarterly options (most recent first) ──
  const quarters: { year: string; q: number }[] = [];
  for (const m of allMonths) {
    const year = m.slice(0, 4);
    const q = quarterOf(m);
    if (!quarters.some(x => x.year === year && x.q === q)) {
      quarters.push({ year, q });
    }
  }
  quarters.sort((a, b) => {
    const yCmp = b.year.localeCompare(a.year);
    if (yCmp !== 0) return yCmp;
    return b.q - a.q;
  });
  for (const { year, q } of quarters) {
    options.push({ label: `${year} Q${q}`, value: `q:${year}-Q${q}`, group: 'Quarterly' });
  }

  // ── Monthly options (most recent first) ──
  for (const m of [...allMonths].reverse()) {
    options.push({ label: monthLabel(m), value: m, group: 'Monthly' });
  }

  return options;
}

// ── Component ──────────────────────────────────────────────────────────

export function PerformanceView({ metaCampaigns, googleCampaigns, onelinkData, ampCampaigns, billboardData, otherCampaigns }: PerformanceViewProps) {
  // ── Ad Set Drill-Down ──────────────────────────────────────────────
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [campaignDetailsOpen, setCampaignDetailsOpen] = useState(true);
  const [adSets, setAdSets] = useState<MetaAdSet[]>([]);
  const [adSetsLoading, setAdSetsLoading] = useState(false);

  useEffect(() => {
    if (!expandedCampaign) { setAdSets([]); return; }
    // Parse "month::campaignName" key
    const [month, campaign] = expandedCampaign.split('::');
    setAdSetsLoading(true);
    fetchMetaAdSets(month, campaign)
      .then(setAdSets)
      .catch(() => setAdSets([]))
      .finally(() => setAdSetsLoading(false));
  }, [expandedCampaign]);

  // ── Available months (union of Meta + Google) ──────────────────────
  const allMonths = useMemo(() => {
    const set = new Set<string>();
    metaCampaigns.forEach(c => set.add(c.month));
    googleCampaigns.forEach(c => set.add(c.month));
    return Array.from(set).sort();
  }, [metaCampaigns, googleCampaigns]);

  // ── Filter options ─────────────────────────────────────────────────
  const filterOptions = useMemo(() => buildFilterOptions(allMonths), [allMonths]);

  const [selectedFilter, setSelectedFilter] = useState<string>('all');

  // ── Resolved months for the active filter ──────────────────────────
  const activeMonths = useMemo(
    () => resolveFilterMonths(selectedFilter, allMonths),
    [selectedFilter, allMonths],
  );

  const isMultiMonth = activeMonths === 'all' || activeMonths.size > 1;

  // ── Filtered data based on active months ───────────────────────────
  const filteredMeta = useMemo(() =>
    activeMonths === 'all' ? metaCampaigns : metaCampaigns.filter(c => activeMonths.has(c.month)),
  [metaCampaigns, activeMonths]);

  const filteredGoogle = useMemo(() =>
    activeMonths === 'all' ? googleCampaigns : googleCampaigns.filter(c => activeMonths.has(c.month)),
  [googleCampaigns, activeMonths]);

  // ── KPI summaries ──────────────────────────────────────────────────
  const metaSummary = useMemo(() => {
    const totalSpend = filteredMeta.reduce((s, c) => s + c.spend, 0);
    const totalImpressions = filteredMeta.reduce((s, c) => s + c.impressions, 0);
    const totalResults = filteredMeta.reduce((s, c) => s + c.results, 0);
    const avgCPR = totalResults > 0 ? totalSpend / totalResults : 0;
    return { totalSpend, totalImpressions, totalResults, avgCPR };
  }, [filteredMeta]);

  const googleSummary = useMemo(() => {
    const totalSpend = filteredGoogle.reduce((s, c) => s + c.cost, 0);
    const totalClicks = filteredGoogle.reduce((s, c) => s + c.clicks, 0);
    const totalImpressions = filteredGoogle.reduce((s, c) => s + c.impressions, 0);
    const totalConversions = filteredGoogle.reduce((s, c) => s + c.conversions, 0);
    const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
    const costPerConv = totalConversions > 0 ? totalSpend / totalConversions : 0;
    return { totalSpend, totalClicks, totalImpressions, totalConversions, avgCpc, costPerConv };
  }, [filteredGoogle]);

  // ── Filtered data for long-tail channels (Yelp, AMP CTV, Lamar OOH) ──
  const filteredOther = useMemo(() =>
    activeMonths === 'all' ? otherCampaigns : otherCampaigns.filter(c => activeMonths.has(c.month)),
  [otherCampaigns, activeMonths]);

  const filteredAmpStreaming = useMemo(() =>
    (activeMonths === 'all' ? ampCampaigns : ampCampaigns.filter(c => activeMonths.has(c.month)))
      .filter(c => c.campaignType === 'streaming'),
  [ampCampaigns, activeMonths]);

  const filteredBillboard = useMemo(() =>
    activeMonths === 'all' ? billboardData : billboardData.filter(b => activeMonths.has(b.month)),
  [billboardData, activeMonths]);

  // ── Cross-channel summary: Meta + Google + Yelp + AMP CTV + Lamar OOH ──
  const channelSummary = useMemo((): ChannelSummaryRow[] => {
    const rows: ChannelSummaryRow[] = [];

    // Meta
    rows.push({
      channel: 'Meta Ads',
      color: '#3b82f6',
      spend: metaSummary.totalSpend,
      impressions: metaSummary.totalImpressions,
      clicks: filteredMeta.reduce((s, c) => s + c.clicks, 0),
      conversions: metaSummary.totalResults,
      ctr: metaSummary.totalImpressions > 0 ? filteredMeta.reduce((s, c) => s + c.clicks, 0) / metaSummary.totalImpressions : 0,
      costPerConv: metaSummary.avgCPR,
    });

    // Google
    rows.push({
      channel: 'Google Ads',
      color: '#f59e0b',
      spend: googleSummary.totalSpend,
      impressions: googleSummary.totalImpressions,
      clicks: googleSummary.totalClicks,
      conversions: googleSummary.totalConversions,
      ctr: googleSummary.totalImpressions > 0 ? googleSummary.totalClicks / googleSummary.totalImpressions : 0,
      costPerConv: googleSummary.costPerConv,
    });

    // Yelp (and any other long-tail channels in the 'other' table). Aggregate per source.
    const bySource = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number }>();
    for (const c of filteredOther) {
      const agg = bySource.get(c.source) ?? { spend: 0, impressions: 0, clicks: 0, conversions: 0 };
      agg.spend += c.spend;
      agg.impressions += c.impressions;
      agg.clicks += c.clicks;
      agg.conversions += c.conversions;
      bySource.set(c.source, agg);
    }
    for (const [source, agg] of bySource) {
      const label = source === 'yelp' ? 'Yelp Ads' : source.charAt(0).toUpperCase() + source.slice(1);
      rows.push({
        channel: label,
        color: '#d32323',  // Yelp red for Yelp; fine fallback for others too
        spend: agg.spend,
        impressions: agg.impressions,
        clicks: agg.clicks,
        conversions: agg.conversions,
        ctr: agg.impressions > 0 ? agg.clicks / agg.impressions : 0,
        costPerConv: agg.conversions > 0 ? agg.spend / agg.conversions : 0,
        footnote: source === 'yelp' ? 'Downtown only · rolling 30d window' : undefined,
      });
    }

    // AMP CTV (streaming only — skip email campaigns in this summary)
    if (filteredAmpStreaming.length > 0) {
      const ampImps = filteredAmpStreaming.reduce((s, c) => s + c.impressions, 0);
      rows.push({
        channel: 'AMP CTV',
        color: '#8b5cf6',
        spend: null,
        spendNote: '(pending invoice)',
        impressions: ampImps,
        clicks: null,
        conversions: null,
        ctr: null,
        costPerConv: null,
        footnote: 'Connected TV · brand lift (not attributable)',
      });
    }

    // Lamar OOH
    if (filteredBillboard.length > 0) {
      const lamarImps = filteredBillboard.reduce((s, b) => s + b.impressionsDelivered, 0);
      rows.push({
        channel: 'Lamar OOH',
        color: '#10b981',
        spend: null,
        spendNote: '(see expenses)',
        impressions: lamarImps,
        clicks: null,
        conversions: null,
        ctr: null,
        costPerConv: null,
        footnote: 'Billboard · impression-only channel',
      });
    }

    return rows;
  }, [metaSummary, googleSummary, filteredMeta, filteredOther, filteredAmpStreaming, filteredBillboard]);

  // ── Combined campaign rows for the details table ───────────────────
  const combinedRows = useMemo((): CombinedCampaignRow[] => {
    const metaRows: CombinedCampaignRow[] = filteredMeta.map(c => ({
      source: 'Meta' as const,
      month: c.month,
      campaignName: c.campaignName,
      spend: c.spend,
      impressions: c.impressions,
      clicks: c.clicks,
      results: c.results,
      cpr: c.costPerResult,
    }));
    const googleRows: CombinedCampaignRow[] = filteredGoogle.map(c => ({
      source: 'Google' as const,
      month: c.month,
      campaignName: c.campaignName,
      spend: c.cost,
      impressions: c.impressions,
      clicks: c.clicks,
      results: c.conversions,
      cpr: c.conversions > 0 ? c.cost / c.conversions : 0,
    }));
    return [...metaRows, ...googleRows].sort((a, b) => {
      const monthCmp = b.month.localeCompare(a.month);
      if (monthCmp !== 0) return monthCmp;
      return b.spend - a.spend;
    });
  }, [filteredMeta, filteredGoogle]);

  // ── Monthly trend data (scoped to active filter) ───────────────────
  const monthlyTrend = useMemo(() => {
    const map = new Map<string, { month: string; metaSpend: number; googleSpend: number }>();

    for (const c of filteredMeta) {
      const existing = map.get(c.month) || { month: c.month, metaSpend: 0, googleSpend: 0 };
      existing.metaSpend += c.spend;
      map.set(c.month, existing);
    }
    for (const c of filteredGoogle) {
      const existing = map.get(c.month) || { month: c.month, metaSpend: 0, googleSpend: 0 };
      existing.googleSpend += c.cost;
      map.set(c.month, existing);
    }

    return Array.from(map.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(d => ({
        month: monthLabel(d.month),
        'Meta Spend': Math.round(d.metaSpend * 100) / 100,
        'Google Spend': Math.round(d.googleSpend * 100) / 100,
      }));
  }, [filteredMeta, filteredGoogle]);

  // ── Export ──────────────────────────────────────────────────────────
  const handleExport = useCallback((format: ExportFormat) => {
    const rows = combinedRows.map(r => ({
      Source: r.source,
      Month: r.month,
      Campaign: r.campaignName,
      Spend: r.spend,
      Impressions: r.impressions,
      Clicks: r.clicks,
      Results: r.results,
      'Cost per Result': r.cpr,
    }));
    exportData(rows as unknown as Record<string, unknown>[], {
      filename: `stack-performance-${todayString()}`,
      format,
    });
  }, [combinedRows]);

  // ── OneLink / QR Performance ─────────────────────────────────────────
  const onelinkMonths = useMemo(() => {
    const set = new Set<string>();
    onelinkData.forEach(r => set.add(r.month));
    return Array.from(set).sort();
  }, [onelinkData]);

  const [selectedOnelinkMonth, setSelectedOnelinkMonth] = useState<string>('');
  const [onelinkGranularity, setOnelinkGranularity] = useState<'monthly' | 'quarterly' | 'yearly'>('monthly');

  // Default to most recent month with data (runs once when months become available)
  useEffect(() => {
    if (onelinkMonths.length > 0 && selectedOnelinkMonth === '') {
      setSelectedOnelinkMonth(onelinkMonths[onelinkMonths.length - 1]);
    }
  }, [onelinkMonths, selectedOnelinkMonth]);

  const onelinkCampaignSources = useMemo(() => {
    const set = new Set<string>();
    onelinkData.forEach(r => set.add(r.campaignSource));
    return Array.from(set).sort();
  }, [onelinkData]);

  /** Label lookup: campaignSource → campaignLabel (use first found). */
  const onelinkLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of onelinkData) {
      if (!map.has(r.campaignSource)) map.set(r.campaignSource, r.campaignLabel);
    }
    return map;
  }, [onelinkData]);

  /** Stacked area chart data: one row per date, one key per campaignSource. */
  const onelinkChartData = useMemo(() => {
    const filtered = selectedOnelinkMonth
      ? onelinkData.filter(r => r.month === selectedOnelinkMonth)
      : onelinkData;

    const dateMap = new Map<string, Record<string, number>>();
    for (const r of filtered) {
      const entry = dateMap.get(r.date) || {};
      entry[r.campaignSource] = (entry[r.campaignSource] || 0) + r.total;
      dateMap.set(r.date, entry);
    }

    return Array.from(dateMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({ date, ...vals }));
  }, [onelinkData, selectedOnelinkMonth]);

  /** Summary table rows: one per campaign source, filtered by selected month. */
  const onelinkSummary = useMemo(() => {
    const filtered = selectedOnelinkMonth
      ? onelinkData.filter(r => r.month === selectedOnelinkMonth)
      : onelinkData;

    const map = new Map<string, { total: number; iphone: number; android: number; days: Set<string> }>();
    for (const r of filtered) {
      const entry = map.get(r.campaignSource) || { total: 0, iphone: 0, android: 0, days: new Set<string>() };
      entry.total += r.total;
      entry.iphone += r.iphone;
      entry.android += r.android;
      entry.days.add(r.date);
      map.set(r.campaignSource, entry);
    }

    const rows = Array.from(map.entries()).map(([source, data]) => ({
      source,
      label: onelinkLabelMap.get(source) || source,
      total: data.total,
      iphonePct: data.total > 0 ? (data.iphone / data.total) * 100 : 0,
      androidPct: data.total > 0 ? (data.android / data.total) * 100 : 0,
      avgPerDay: data.days.size > 0 ? data.total / data.days.size : 0,
    }));

    rows.sort((a, b) => b.total - a.total);
    return rows;
  }, [onelinkData, selectedOnelinkMonth, onelinkLabelMap]);

  const onelinkGrandTotal = useMemo(() => {
    const t = { total: 0, iphone: 0, android: 0, days: new Set<string>() };
    const filtered = selectedOnelinkMonth
      ? onelinkData.filter(r => r.month === selectedOnelinkMonth)
      : onelinkData;
    for (const r of filtered) {
      t.total += r.total;
      t.iphone += r.iphone;
      t.android += r.android;
      t.days.add(r.date);
    }
    return {
      total: t.total,
      iphonePct: t.total > 0 ? (t.iphone / t.total) * 100 : 0,
      androidPct: t.total > 0 ? (t.android / t.total) * 100 : 0,
      avgPerDay: t.days.size > 0 ? t.total / t.days.size : 0,
    };
  }, [onelinkData, selectedOnelinkMonth]);

  // ── OneLink aggregated data for quarterly/yearly views ─────────────

  /** Quarter label for a date string like "2025-08-15" → "Q3 2025" */
  function dateToPeriod(date: string, granularity: 'quarterly' | 'yearly'): string {
    const [y, m] = date.split('-');
    if (granularity === 'yearly') return y;
    const q = Math.ceil(parseInt(m, 10) / 3);
    return `Q${q} ${y}`;
  }

  /** Aggregated bar chart data: one row per period, one key per campaignSource. */
  const onelinkAggregatedChartData = useMemo(() => {
    if (onelinkGranularity === 'monthly') return [];
    const periodMap = new Map<string, Record<string, number>>();
    for (const r of onelinkData) {
      const period = dateToPeriod(r.date, onelinkGranularity);
      const entry = periodMap.get(period) || {};
      entry[r.campaignSource] = (entry[r.campaignSource] || 0) + r.total;
      periodMap.set(period, entry);
    }
    return Array.from(periodMap.entries())
      .sort(([a], [b]) => {
        // Sort chronologically: parse period back to comparable value
        const parseKey = (k: string) => {
          if (onelinkGranularity === 'yearly') return k;
          // "Q3 2025" → "2025-3"
          const match = k.match(/Q(\d) (\d{4})/);
          return match ? `${match[2]}-${match[1]}` : k;
        };
        return parseKey(a).localeCompare(parseKey(b));
      })
      .map(([period, vals]) => ({ period, ...vals }));
  }, [onelinkData, onelinkGranularity]);

  /** Summary table rows aggregated by the current granularity. */
  const onelinkAggregatedSummary = useMemo(() => {
    if (onelinkGranularity === 'monthly') return [];
    const map = new Map<string, { total: number; iphone: number; android: number; days: Set<string> }>();
    for (const r of onelinkData) {
      const entry = map.get(r.campaignSource) || { total: 0, iphone: 0, android: 0, days: new Set<string>() };
      entry.total += r.total;
      entry.iphone += r.iphone;
      entry.android += r.android;
      entry.days.add(r.date);
      map.set(r.campaignSource, entry);
    }
    const rows = Array.from(map.entries()).map(([source, data]) => ({
      source,
      label: onelinkLabelMap.get(source) || source,
      total: data.total,
      iphonePct: data.total > 0 ? (data.iphone / data.total) * 100 : 0,
      androidPct: data.total > 0 ? (data.android / data.total) * 100 : 0,
      avgPerDay: data.days.size > 0 ? data.total / data.days.size : 0,
    }));
    rows.sort((a, b) => b.total - a.total);
    return rows;
  }, [onelinkData, onelinkGranularity, onelinkLabelMap]);

  const onelinkAggregatedGrandTotal = useMemo(() => {
    if (onelinkGranularity === 'monthly') return { total: 0, iphonePct: 0, androidPct: 0, avgPerDay: 0 };
    const t = { total: 0, iphone: 0, android: 0, days: new Set<string>() };
    for (const r of onelinkData) {
      t.total += r.total;
      t.iphone += r.iphone;
      t.android += r.android;
      t.days.add(r.date);
    }
    return {
      total: t.total,
      iphonePct: t.total > 0 ? (t.iphone / t.total) * 100 : 0,
      androidPct: t.total > 0 ? (t.android / t.total) * 100 : 0,
      avgPerDay: t.days.size > 0 ? t.total / t.days.size : 0,
    };
  }, [onelinkData, onelinkGranularity]);

  /** Which summary rows / grand total to show based on granularity. */
  const activeSummary = onelinkGranularity === 'monthly' ? onelinkSummary : onelinkAggregatedSummary;
  const activeGrandTotal = onelinkGranularity === 'monthly' ? onelinkGrandTotal : onelinkAggregatedGrandTotal;

  // ── AMP + Billboard derived data ───────────────────────────────────
  const emailCampaigns = useMemo(() => ampCampaigns.filter(c => c.campaignType === 'email'), [ampCampaigns]);
  const streamingCampaigns = useMemo(() => ampCampaigns.filter(c => c.campaignType === 'streaming'), [ampCampaigns]);

  const billboardChartData = useMemo(() =>
    billboardData.map(r => ({
      month: monthLabel(r.month),
      Guaranteed: r.impressionsGuaranteed,
      Delivered: r.impressionsDelivered,
    })),
  [billboardData]);

  const hasData = metaCampaigns.length > 0 || googleCampaigns.length > 0
    || ampCampaigns.length > 0 || billboardData.length > 0;

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <p className="text-lg font-medium mb-2">No performance data</p>
        <p className="text-sm">Upload Meta or Google Ads CSV exports</p>
      </div>
    );
  }

  // ── Group filter options for <optgroup> rendering ──────────────────
  const yearlyOpts = filterOptions.filter(o => o.group === 'Yearly');
  const quarterlyOpts = filterOptions.filter(o => o.group === 'Quarterly');
  const monthlyOpts = filterOptions.filter(o => o.group === 'Monthly');

  return (
    <div className="space-y-6">
      {/* ── Header with time filter + export ──────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-gray-900">Ad Performance</h2>
          <select
            value={selectedFilter}
            onChange={e => setSelectedFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/30"
          >
            <option value="all">All Time</option>
            {yearlyOpts.length > 0 && (
              <optgroup label="Yearly">
                {yearlyOpts.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            )}
            {quarterlyOpts.length > 0 && (
              <optgroup label="Quarterly">
                {quarterlyOpts.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            )}
            {monthlyOpts.length > 0 && (
              <optgroup label="Monthly">
                {monthlyOpts.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <ExportButton onExport={handleExport} />
      </div>

      {/* ── Channel KPIs ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Meta Spend"
          value={formatCurrency(metaSummary.totalSpend)}
          subtitle={`${formatNumber(metaSummary.totalImpressions)} impressions`}
          color="#3b82f6"
        />
        <KPICard
          label="Meta Results"
          value={formatNumber(metaSummary.totalResults)}
          subtitle={`CPR: ${formatCurrency(metaSummary.avgCPR)}`}
          color="#3b82f6"
        />
        <KPICard
          label="Google Spend"
          value={formatCurrency(googleSummary.totalSpend)}
          subtitle={`${formatNumber(googleSummary.totalClicks)} clicks`}
          color="#f59e0b"
        />
        <KPICard
          label="Google Conversions"
          value={formatNumber(googleSummary.totalConversions)}
          subtitle={`CPC: ${formatCurrency(googleSummary.avgCpc)}`}
          color="#f59e0b"
        />
      </div>

      {/* ── Channel Summary (all paid media channels, side-by-side) ──── */}
      {channelSummary.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm overflow-x-auto">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700">Channel Summary</h3>
            <span className="text-xs text-gray-400">All paid media side-by-side</span>
          </div>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-gray-500 border-b border-gray-100">
                <th className="py-2 pr-4">Channel</th>
                <th className="py-2 pr-4 text-right">Spend</th>
                <th className="py-2 pr-4 text-right">Impressions</th>
                <th className="py-2 pr-4 text-right">Clicks</th>
                <th className="py-2 pr-4 text-right">Conversions</th>
                <th className="py-2 pr-4 text-right">CTR</th>
                <th className="py-2 text-right">Cost / Conv</th>
              </tr>
            </thead>
            <tbody>
              {channelSummary.map((r) => (
                <tr key={r.channel} className="border-b border-gray-50 last:border-0">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: r.color }} />
                      <span className="font-medium text-gray-900">{r.channel}</span>
                    </div>
                    {r.footnote && <div className="text-xs text-gray-400 mt-0.5 ml-4">{r.footnote}</div>}
                  </td>
                  <td className="py-3 pr-4 text-right text-gray-900">
                    {r.spend !== null ? formatCurrency(r.spend) : <span className="text-gray-400 italic text-xs">{r.spendNote ?? '—'}</span>}
                  </td>
                  <td className="py-3 pr-4 text-right text-gray-700">{formatNumber(r.impressions)}</td>
                  <td className="py-3 pr-4 text-right text-gray-700">{r.clicks !== null ? formatNumber(r.clicks) : <span className="text-gray-300">—</span>}</td>
                  <td className="py-3 pr-4 text-right text-gray-700">{r.conversions !== null ? formatNumber(Math.round(r.conversions)) : <span className="text-gray-300">—</span>}</td>
                  <td className="py-3 pr-4 text-right text-gray-700">{r.ctr !== null ? `${(r.ctr * 100).toFixed(2)}%` : <span className="text-gray-300">—</span>}</td>
                  <td className="py-3 text-right text-gray-700">{r.costPerConv !== null && r.costPerConv > 0 ? formatCurrency(r.costPerConv) : <span className="text-gray-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Monthly Spend Trend (Meta vs Google) ─────────────────────── */}
      {monthlyTrend.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Monthly Ad Spend Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip formatter={(v: number | undefined) => `$${(v ?? 0).toFixed(2)}`} />
              <Legend />
              <Bar dataKey="Meta Spend" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Google Spend" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Combined Campaign Details Table ───────────────────────────── */}
      {combinedRows.length > 0 && (() => {
        const totals = combinedRows.reduce((t, r) => ({
          spend: t.spend + r.spend,
          impressions: t.impressions + r.impressions,
          clicks: t.clicks + r.clicks,
          results: t.results + r.results,
        }), { spend: 0, impressions: 0, clicks: 0, results: 0 });
        return (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm overflow-x-auto">
          <button
            onClick={() => setCampaignDetailsOpen(v => !v)}
            className="flex items-center justify-between w-full text-left mb-1"
          >
            <div className="flex items-center gap-2">
              {campaignDetailsOpen
                ? <ChevronDown size={16} className="text-gray-400" />
                : <ChevronRight size={16} className="text-gray-400" />}
              <h3 className="text-sm font-semibold text-gray-700">
                Campaign Details
                <span className="font-normal text-gray-400 ml-2">({combinedRows.length} campaigns)</span>
              </h3>
            </div>
            {!campaignDetailsOpen && (
              <div className="flex gap-4 text-xs text-gray-500">
                <span>Spend: <strong className="text-gray-800">${totals.spend.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</strong></span>
                <span>Impressions: <strong className="text-gray-800">{formatNumber(totals.impressions)}</strong></span>
                <span>Clicks: <strong className="text-gray-800">{formatNumber(totals.clicks)}</strong></span>
                <span>Results: <strong className="text-gray-800">{formatNumber(totals.results)}</strong></span>
              </div>
            )}
          </button>
          {campaignDetailsOpen && (
          <table className="w-full text-sm mt-2">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="pb-2 pr-4">Source</th>
                {isMultiMonth && <th className="pb-2 pr-4">Month</th>}
                <th className="pb-2 pr-4">Campaign</th>
                <th className="pb-2 pr-4 text-right">Spend</th>
                <th className="pb-2 pr-4 text-right">Impressions</th>
                <th className="pb-2 pr-4 text-right">Clicks</th>
                <th className="pb-2 pr-4 text-right">Results</th>
                <th className="pb-2 text-right">CPR</th>
              </tr>
            </thead>
            <tbody>
              {combinedRows.map((row, i) => {
                const rowKey = `${row.month}::${row.campaignName}`;
                const isExpanded = expandedCampaign === rowKey;
                const isMetaRow = row.source === 'Meta';
                return (
                  <React.Fragment key={i}>
                    <tr
                      className={`border-b border-gray-50 hover:bg-gray-50 ${isMetaRow ? 'cursor-pointer' : ''}`}
                      onClick={() => isMetaRow && setExpandedCampaign(isExpanded ? null : rowKey)}
                    >
                      <td className="py-2 pr-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          isMetaRow ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
                        }`}>
                          {row.source}
                        </span>
                      </td>
                      {isMultiMonth && (
                        <td className="py-2 pr-4 text-gray-600">{monthLabel(row.month)}</td>
                      )}
                      <td className="py-2 pr-4 text-gray-800 max-w-[250px] truncate flex items-center gap-1" title={row.campaignName}>
                        {isMetaRow && (
                          isExpanded
                            ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
                            : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />
                        )}
                        {row.campaignName}
                      </td>
                      <td className="py-2 pr-4 text-right">${row.spend.toFixed(2)}</td>
                      <td className="py-2 pr-4 text-right">{formatNumber(row.impressions)}</td>
                      <td className="py-2 pr-4 text-right">{formatNumber(row.clicks)}</td>
                      <td className="py-2 pr-4 text-right">{row.results}</td>
                      <td className="py-2 text-right">{row.cpr > 0 ? `$${row.cpr.toFixed(2)}` : '—'}</td>
                    </tr>
                    {isExpanded && (
                      adSetsLoading ? (
                        <tr><td colSpan={isMultiMonth ? 8 : 7} className="py-3 text-center text-gray-400 text-xs">Loading ad sets…</td></tr>
                      ) : adSets.length > 0 ? (
                        adSets.map((a, j) => (
                          <tr key={`as-${j}`} className="bg-blue-50/30 border-b border-blue-100/50">
                            <td className="py-1.5 pr-4"></td>
                            {isMultiMonth && <td className="py-1.5 pr-4"></td>}
                            <td className="py-1.5 pr-4 text-gray-600 text-xs pl-7">↳ {a.adSetName}</td>
                            <td className="py-1.5 pr-4 text-right text-xs">${a.spend.toFixed(2)}</td>
                            <td className="py-1.5 pr-4 text-right text-xs">{formatNumber(a.impressions)}</td>
                            <td className="py-1.5 pr-4 text-right text-xs">{formatNumber(a.clicks)}</td>
                            <td className="py-1.5 pr-4 text-right text-xs">{a.results}</td>
                            <td className="py-1.5 text-right text-xs">{a.costPerResult > 0 ? `$${a.costPerResult.toFixed(2)}` : '—'}</td>
                          </tr>
                        ))
                      ) : (
                        <tr><td colSpan={isMultiMonth ? 8 : 7} className="py-2 text-center text-gray-400 text-xs">No ad sets found for this campaign</td></tr>
                      )
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          )}
        </div>
        );
      })()}

      {/* ── Email Marketing (AMP) ───────────────────────────────────────── */}
      {emailCampaigns.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <Mail size={18} className="text-[#ec4899]" />
            <h2 className="text-lg font-semibold text-gray-900">Email Marketing (AMP)</h2>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="pb-2 pr-4">Month</th>
                  <th className="pb-2 pr-4">Location</th>
                  <th className="pb-2 pr-4">Campaign</th>
                  <th className="pb-2 pr-4 text-right">Sent</th>
                  <th className="pb-2 pr-4 text-right">Views</th>
                  <th className="pb-2 pr-4 text-right">Clicks</th>
                  <th className="pb-2 pr-4 text-right">View Rate</th>
                  <th className="pb-2 text-right">Click Rate</th>
                </tr>
              </thead>
              <tbody>
                {emailCampaigns.map((c, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 pr-4 text-gray-600">{monthLabel(c.month)}</td>
                    <td className="py-2 pr-4 text-gray-600">{c.location}</td>
                    <td className="py-2 pr-4 text-gray-800">{c.campaignName}</td>
                    <td className="py-2 pr-4 text-right">{formatNumber(c.sent)}</td>
                    <td className="py-2 pr-4 text-right">{formatNumber(c.views)}</td>
                    <td className="py-2 pr-4 text-right">{formatNumber(c.clicks)}</td>
                    <td className="py-2 pr-4 text-right">{c.viewRate.toFixed(2)}%</td>
                    <td className="py-2 text-right">{c.clickRate.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Streaming TV (CTV) ─────────────────────────────────────────── */}
      {streamingCampaigns.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <Tv size={18} className="text-[#8b5cf6]" />
            <h2 className="text-lg font-semibold text-gray-900">Streaming TV (CTV)</h2>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="pb-2 pr-4">Month</th>
                  <th className="pb-2 pr-4">Campaign</th>
                  <th className="pb-2 pr-4 text-right">Impressions</th>
                  <th className="pb-2 pr-4 text-right">Reach</th>
                  <th className="pb-2 pr-4 text-right">Frequency</th>
                  <th className="pb-2 pr-4 text-right">VCR</th>
                  <th className="pb-2 text-right">Viewing Hours</th>
                </tr>
              </thead>
              <tbody>
                {streamingCampaigns.map((c, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 pr-4 text-gray-600">{monthLabel(c.month)}</td>
                    <td className="py-2 pr-4 text-gray-800">{c.campaignName}</td>
                    <td className="py-2 pr-4 text-right">{formatNumber(c.impressions)}</td>
                    <td className="py-2 pr-4 text-right">{formatNumber(c.reach)}</td>
                    <td className="py-2 pr-4 text-right">{c.frequency.toFixed(2)}</td>
                    <td className="py-2 pr-4 text-right">{c.vcr.toFixed(2)}%</td>
                    <td className="py-2 text-right">{c.viewingHours.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Billboard Performance (Lamar) ──────────────────────────────── */}
      {billboardData.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <LayoutDashboard size={18} className="text-[#f59e0b]" />
            <h2 className="text-lg font-semibold text-gray-900">Billboard Performance (Lamar)</h2>
          </div>

          {/* Bar chart: impressions delivered vs guaranteed by month */}
          {billboardChartData.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Impressions: Delivered vs Guaranteed</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={billboardChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${(v / 1_000_000).toFixed(1)}M`} />
                  <Tooltip formatter={(v: number | undefined) => formatNumber(v ?? 0)} />
                  <Legend />
                  <Bar dataKey="Guaranteed" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Delivered" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Billboard details table */}
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm overflow-x-auto">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Monthly Billboard Details</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="pb-2 pr-4">Month</th>
                  <th className="pb-2 pr-4 text-right">Plays (Del/Guar)</th>
                  <th className="pb-2 pr-4 text-right">Impressions (Del/Guar)</th>
                  <th className="pb-2 pr-4 text-right">Variance</th>
                  <th className="pb-2 text-right">Creatives</th>
                </tr>
              </thead>
              <tbody>
                {billboardData.map((r, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 pr-4 text-gray-600">{monthLabel(r.month)}</td>
                    <td className="py-2 pr-4 text-right">
                      {formatNumber(r.playsDelivered)} / {formatNumber(r.playsGuaranteed)}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {formatNumber(r.impressionsDelivered)} / {formatNumber(r.impressionsGuaranteed)}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <span className={r.variancePct >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {r.variancePct > 0 ? '+' : ''}{r.variancePct}%
                      </span>
                    </td>
                    <td className="py-2 text-right">{r.numCreatives}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── QR / OneLink Performance ───────────────────────────────────── */}
      {onelinkData.length > 0 && (
        <>
          {/* Header + granularity toggle + month selector */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <QrCode size={18} className="text-[#2D5A3D]" />
              <h2 className="text-lg font-semibold text-gray-900">QR / OneLink Performance</h2>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                {(['monthly', 'quarterly', 'yearly'] as const).map(g => (
                  <button key={g} onClick={() => setOnelinkGranularity(g)}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                      onelinkGranularity === g ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}>
                    {g === 'monthly' ? 'Monthly' : g === 'quarterly' ? 'Quarterly' : 'Yearly'}
                  </button>
                ))}
              </div>
              {onelinkGranularity === 'monthly' && onelinkMonths.length > 0 && (
                <select
                  value={selectedOnelinkMonth}
                  onChange={e => setSelectedOnelinkMonth(e.target.value)}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#2D5A3D]/30"
                >
                  {onelinkMonths.map(m => (
                    <option key={m} value={m}>{monthLabel(m)}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Chart: Area (monthly) or Bar (quarterly/yearly) */}
          {onelinkGranularity === 'monthly' && onelinkChartData.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Daily Clicks by Campaign Source</h3>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={onelinkChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(d: string) => {
                      const parts = d.split('-');
                      return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
                    }}
                  />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    labelFormatter={(d: string) => {
                      const dt = new Date(d + 'T00:00:00');
                      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    }}
                    formatter={(value: number, name: string) => [
                      formatNumber(value),
                      onelinkLabelMap.get(name) || name,
                    ]}
                  />
                  <Legend formatter={(value: string) => onelinkLabelMap.get(value) || value} />
                  {onelinkCampaignSources.map(source => (
                    <Area
                      key={source}
                      type="monotone"
                      dataKey={source}
                      stackId="1"
                      fill={onelinkColor(source)}
                      stroke={onelinkColor(source)}
                      fillOpacity={0.6}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {onelinkGranularity !== 'monthly' && onelinkAggregatedChartData.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">
                {onelinkGranularity === 'quarterly' ? 'Quarterly' : 'Yearly'} Clicks by Campaign Source
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={onelinkAggregatedChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      formatNumber(value),
                      onelinkLabelMap.get(name) || name,
                    ]}
                  />
                  <Legend formatter={(value: string) => onelinkLabelMap.get(value) || value} />
                  {onelinkCampaignSources.map(source => (
                    <Bar
                      key={source}
                      dataKey={source}
                      stackId="1"
                      fill={onelinkColor(source)}
                      radius={[2, 2, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Summary Table */}
          {activeSummary.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm overflow-x-auto">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Campaign Source Summary</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="pb-2 pr-4">Campaign</th>
                    <th className="pb-2 pr-4 text-right">Total Clicks</th>
                    <th className="pb-2 pr-4 text-right">iPhone %</th>
                    <th className="pb-2 pr-4 text-right">Android %</th>
                    <th className="pb-2 text-right">Avg/Day</th>
                  </tr>
                </thead>
                <tbody>
                  {activeSummary.map(row => (
                    <tr key={row.source} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 pr-4 flex items-center gap-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: onelinkColor(row.source) }}
                        />
                        <span className="text-gray-800">{row.label}</span>
                      </td>
                      <td className="py-2 pr-4 text-right">{formatNumber(row.total)}</td>
                      <td className="py-2 pr-4 text-right">{row.iphonePct.toFixed(1)}%</td>
                      <td className="py-2 pr-4 text-right">{row.androidPct.toFixed(1)}%</td>
                      <td className="py-2 text-right">{row.avgPerDay.toFixed(1)}</td>
                    </tr>
                  ))}
                  {/* Total row */}
                  <tr className="border-t border-gray-200 font-semibold">
                    <td className="py-2 pr-4 text-gray-900">Total</td>
                    <td className="py-2 pr-4 text-right">{formatNumber(activeGrandTotal.total)}</td>
                    <td className="py-2 pr-4 text-right">{activeGrandTotal.iphonePct.toFixed(1)}%</td>
                    <td className="py-2 pr-4 text-right">{activeGrandTotal.androidPct.toFixed(1)}%</td>
                    <td className="py-2 text-right">{activeGrandTotal.avgPerDay.toFixed(1)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
