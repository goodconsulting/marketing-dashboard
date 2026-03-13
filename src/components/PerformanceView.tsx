import { useState, useMemo, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend,
} from 'recharts';
import { KPICard } from './KPICard';
import { ExportButton } from './ExportButton';
import { exportData, todayString } from '../utils/export';
import type { ExportFormat } from '../utils/export';
import type { MetaCampaign, GoogleCampaign } from '../types';

// ── Helpers ────────────────────────────────────────────────────────────

interface PerformanceViewProps {
  metaCampaigns: MetaCampaign[];
  googleCampaigns: GoogleCampaign[];
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

export function PerformanceView({ metaCampaigns, googleCampaigns }: PerformanceViewProps) {
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

  const hasData = metaCampaigns.length > 0 || googleCampaigns.length > 0;

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
      {combinedRows.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm overflow-x-auto">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Campaign Details</h3>
          <table className="w-full text-sm">
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
              {combinedRows.map((row, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 pr-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      row.source === 'Meta'
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}>
                      {row.source}
                    </span>
                  </td>
                  {isMultiMonth && (
                    <td className="py-2 pr-4 text-gray-600">{monthLabel(row.month)}</td>
                  )}
                  <td className="py-2 pr-4 text-gray-800 max-w-[250px] truncate" title={row.campaignName}>
                    {row.campaignName}
                  </td>
                  <td className="py-2 pr-4 text-right">${row.spend.toFixed(2)}</td>
                  <td className="py-2 pr-4 text-right">{formatNumber(row.impressions)}</td>
                  <td className="py-2 pr-4 text-right">{formatNumber(row.clicks)}</td>
                  <td className="py-2 pr-4 text-right">{row.results}</td>
                  <td className="py-2 text-right">{row.cpr > 0 ? `$${row.cpr.toFixed(2)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
