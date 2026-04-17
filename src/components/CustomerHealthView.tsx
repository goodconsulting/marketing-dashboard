import { useMemo, useState, useCallback } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList, ReferenceLine,
} from 'recharts';
import { KPICard } from './KPICard';
import { ExportButton } from './ExportButton';
import { exportData, todayString } from '../utils/export';
import type { ExportFormat } from '../utils/export';
import { AlertTriangle, Users, TrendingDown, Shield, Smartphone } from 'lucide-react';
import type { CRMCustomerRecord, JourneyStage, MonthlySnapshot, StageTransition } from '../types';
import { SEGMENT_COLORS } from '../utils/theme';

interface CustomerHealthViewProps {
  customers: CRMCustomerRecord[];
  snapshots: MonthlySnapshot[];
  stageTransitions: StageTransition[];
}

const STAGE_ORDER = ['UNKNOWN', 'SLIDER', 'ROOKIE', 'REGULAR', 'LOYALIST', 'WHALE', 'CHURNED'];

function JourneyAnalytics({ transitions }: { transitions: StageTransition[] }) {
  const dwellByStage = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const t of transitions) {
      if (t.direction === 'first_seen' || t.daysInFromStage === null) continue;
      if (!map.has(t.fromStage)) map.set(t.fromStage, []);
      map.get(t.fromStage)!.push(t.daysInFromStage);
    }
    return Array.from(map.entries()).map(([stage, days]) => {
      const sorted = [...days].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
      return { stage, median, n: days.length };
    }).sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
  }, [transitions]);

  const economicsByStage = useMemo(() => {
    const map = new Map<string, { spendSum: number; visitsSum: number; n: number }>();
    for (const t of transitions) {
      if (t.direction === 'first_seen' || t.spendInFromStage === null) continue;
      const agg = map.get(t.fromStage) ?? { spendSum: 0, visitsSum: 0, n: 0 };
      agg.spendSum += t.spendInFromStage;
      agg.visitsSum += t.visitsInFromStage || 0;
      agg.n++;
      map.set(t.fromStage, agg);
    }
    return Array.from(map.entries()).map(([stage, a]) => ({
      stage, avgSpend: a.n > 0 ? a.spendSum / a.n : 0, avgVisits: a.n > 0 ? a.visitsSum / a.n : 0, n: a.n,
    })).sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
  }, [transitions]);

  const matrix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of transitions) {
      if (t.direction === 'first_seen') continue;
      const k = `${t.fromStage}\u2192${t.toStage}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [transitions]);

  const recent = useMemo(() =>
    transitions.filter(t => t.direction !== 'first_seen').slice(0, 20),
  [transitions]);

  if (transitions.length === 0) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-900">
        <div className="font-semibold mb-1">Journey Analytics: no data yet</div>
        Run <code className="bg-amber-100 px-1 rounded">node scripts/backfill-stage-transitions.cjs</code> to populate.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Journey Analytics</h3>
        <span className="text-xs text-gray-400">
          Based on {new Set(transitions.map(t => t.toSnapshot)).size} snapshots · confidence improves over time
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Stage Dwell Time (median days)</div>
          {dwellByStage.map(d => (
            <div key={d.stage} className="flex items-center gap-3 py-1.5">
              <div className="w-20 text-sm text-gray-700">{d.stage}</div>
              <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                <div className="bg-[#2D5A3D] h-full" style={{ width: `${Math.min(d.median, 180) / 180 * 100}%` }} />
              </div>
              <div className="w-20 text-sm text-gray-700 text-right">
                {d.median}d <span className="text-gray-400">(n={d.n})</span>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Stage Economics (avg per customer)</div>
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 uppercase">
              <th className="text-left">Stage</th><th className="text-right">Avg Spend</th><th className="text-right">Avg Visits</th><th className="text-right">n</th>
            </tr></thead>
            <tbody>
              {economicsByStage.map(e => (
                <tr key={e.stage} className="border-t border-gray-50">
                  <td className="py-1.5 text-gray-700">{e.stage}</td>
                  <td className="py-1.5 text-right">${e.avgSpend.toFixed(2)}</td>
                  <td className="py-1.5 text-right">{e.avgVisits.toFixed(1)}</td>
                  <td className="py-1.5 text-right text-gray-400">{e.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Transition Matrix (top flows)</div>
          <table className="w-full text-sm">
            <tbody>
              {matrix.slice(0, 10).map(([k, n]) => (
                <tr key={k} className="border-t border-gray-50">
                  <td className="py-1.5 text-gray-700">{k}</td>
                  <td className="py-1.5 text-right font-mono text-gray-900">{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm overflow-x-auto">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Recent Transitions</div>
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500">
              <th className="text-left">Customer</th><th className="text-left">Change</th><th className="text-right">Spend</th><th className="text-right">Est. Date</th>
            </tr></thead>
            <tbody>
              {recent.map((t, i) => (
                <tr key={i} className="border-t border-gray-50">
                  <td className="py-1 font-mono text-gray-500">{t.customerId.slice(0, 8)}</td>
                  <td className="py-1 text-gray-700">{t.fromStage} &rarr; {t.toStage}</td>
                  <td className="py-1 text-right">${(t.spendInFromStage ?? 0).toFixed(0)}</td>
                  <td className="py-1 text-right text-gray-500">{t.estimatedTransitionDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const SEGMENT_LABELS: Record<JourneyStage, string> = {
  WHALE: 'Whale',
  LOYALIST: 'Loyalist',
  REGULAR: 'Regular',
  ROOKIE: 'Rookie',
  CHURNED: 'Churned',
  SLIDER: 'Slider',
  UNKNOWN: 'Unknown',
};

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

export function CustomerHealthView({ customers, snapshots, stageTransitions }: CustomerHealthViewProps) {
  // ─── Segment Distribution ───
  const segmentData = useMemo(() => {
    const counts: Record<JourneyStage, number> = {
      WHALE: 0, LOYALIST: 0, REGULAR: 0, ROOKIE: 0, CHURNED: 0, SLIDER: 0, UNKNOWN: 0,
    };
    customers.forEach(c => counts[c.journeyStage]++);

    return (Object.keys(counts) as JourneyStage[])
      .filter(stage => counts[stage] > 0)
      .map(stage => ({
        name: SEGMENT_LABELS[stage],
        value: counts[stage],
        stage,
        pct: customers.length > 0 ? ((counts[stage] / customers.length) * 100).toFixed(1) : '0',
      }));
  }, [customers]);

  // ─── KPIs ───
  const kpis = useMemo(() => {
    if (customers.length === 0) return null;

    const highRiskCount = customers.filter(c => c.attritionRisk === 'high').length;
    const medRiskCount = customers.filter(c => c.attritionRisk === 'medium').length;
    const avgLTV = customers.reduce((s, c) => s + c.lifetimeSpend, 0) / customers.length;
    const avgBasket = customers.filter(c => c.avgBasketValue > 0).reduce((s, c) => s + c.avgBasketValue, 0) /
      (customers.filter(c => c.avgBasketValue > 0).length || 1);
    const activeCustomers = customers.filter(c => c.lifetimeVisits > 0).length;
    const avgFrequency = customers.filter(c => c.daysSinceSignup > 30)
      .reduce((s, c) => s + (c.lifetimeVisits / Math.max(c.daysSinceSignup / 30, 1)), 0) /
      (customers.filter(c => c.daysSinceSignup > 30).length || 1);

    return {
      totalAccounts: customers.length,
      activeCustomers,
      highRiskCount,
      medRiskCount,
      avgLTV,
      avgBasket,
      avgFrequency,
      churnRate: (highRiskCount / customers.length) * 100,
    };
  }, [customers]);

  // ─── Attrition Risk Distribution ───
  const attritionData = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    customers.forEach(c => counts[c.attritionRisk]++);
    return [
      { name: 'High (Churned)', risk: 'high' as const, value: counts.high, color: '#ef4444' },
      { name: 'Medium (Sliders)', risk: 'medium' as const, value: counts.medium, color: '#f59e0b' },
      { name: 'Low (Stable)', risk: 'low' as const, value: counts.low, color: '#10b981' },
    ].filter(d => d.value > 0);
  }, [customers]);

  // ─── Location × Segment Heatmap Data ───
  // Only track stages that actually appear from Guest Journey Stage column
  type ActiveStage = 'WHALE' | 'LOYALIST' | 'REGULAR' | 'ROOKIE' | 'UNKNOWN';
  const ACTIVE_STAGES: ActiveStage[] = ['WHALE', 'LOYALIST', 'REGULAR', 'ROOKIE', 'UNKNOWN'];

  const locationData = useMemo(() => {
    const locations = new Map<string, Record<ActiveStage, number>>();
    customers.forEach(c => {
      const loc = c.reachLocation || 'Unknown';
      if (!locations.has(loc)) {
        locations.set(loc, { WHALE: 0, LOYALIST: 0, REGULAR: 0, ROOKIE: 0, UNKNOWN: 0 });
      }
      const stage = ACTIVE_STAGES.includes(c.journeyStage as ActiveStage)
        ? (c.journeyStage as ActiveStage)
        : 'UNKNOWN';
      locations.get(loc)![stage]++;
    });

    return Array.from(locations.entries())
      .map(([name, counts]) => ({
        location: name,
        ...counts,
        total: Object.values(counts).reduce((s, v) => s + v, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [customers]);

  // ─── Attrition Risk Table (top 20 at-risk customers) ───
  const atRiskCustomers = useMemo(() =>
    customers
      .filter(c => c.attritionRisk === 'high' && c.lifetimeSpend > 0)
      .sort((a, b) => b.lifetimeSpend - a.lifetimeSpend)
      .slice(0, 20),
  [customers]);

  // ─── LTV by Journey Stage: actual + projected ───
  const RETENTION_MONTHS: Record<JourneyStage, number> = {
    WHALE: 36, LOYALIST: 24, REGULAR: 12, ROOKIE: 6,
    CHURNED: 0, SLIDER: 3, UNKNOWN: 6,
  };

  const ltvByStage = useMemo(() => {
    const map = new Map<JourneyStage, { avgLTV: number; projectedLTV: number; monthlyValue: number }>();
    segmentData.forEach(seg => {
      const segCusts = customers.filter(c => c.journeyStage === seg.stage
        && c.lifetimeSpend > 0 && c.lifetimeVisits > 0);
      if (segCusts.length === 0) {
        map.set(seg.stage, { avgLTV: 0, projectedLTV: 0, monthlyValue: 0 });
        return;
      }
      const avgLTV = segCusts.reduce((s, c) => s + c.lifetimeSpend, 0) / segCusts.length;
      const avgBasket = segCusts.reduce((s, c) => s + c.avgBasketValue, 0) / segCusts.length;
      const avgFreq = segCusts.reduce((s, c) => s + c.purchasesPerMonth, 0) / segCusts.length;
      const monthlyValue = avgBasket * avgFreq;
      const projectedLTV = monthlyValue * RETENTION_MONTHS[seg.stage];
      map.set(seg.stage, { avgLTV, projectedLTV, monthlyValue });
    });
    return map;
  }, [customers, segmentData]);

  // ─── Overall Projected LTV (weighted avg across all active customers) ───
  const overallProjectedLTV = useMemo(() => {
    const active = customers.filter(c => c.lifetimeSpend > 0 && c.lifetimeVisits > 0);
    if (active.length === 0) return 0;
    const total = active.reduce((sum, c) => {
      const retention = RETENTION_MONTHS[c.journeyStage] || 6;
      return sum + c.avgBasketValue * c.purchasesPerMonth * retention;
    }, 0);
    return total / active.length;
  }, [customers]);

  // ─── Avg Basket YoY (2026 signups vs 2025 signups) ───
  const basketYoY = useMemo(() => {
    const basket26 = customers.filter(c => c.accountCreatedDate?.startsWith('2026') && c.avgBasketValue > 0);
    const basket25 = customers.filter(c => c.accountCreatedDate?.startsWith('2025') && c.avgBasketValue > 0);
    const avg26 = basket26.length > 0 ? basket26.reduce((s, c) => s + c.avgBasketValue, 0) / basket26.length : 0;
    const avg25 = basket25.length > 0 ? basket25.reduce((s, c) => s + c.avgBasketValue, 0) / basket25.length : 0;
    const change = avg25 > 0 ? ((avg26 - avg25) / avg25) * 100 : null;
    return { avg26, avg25, change };
  }, [customers]);

  // ─── Signup Source Distribution (active accounts only) ───
  const SIGNUP_SOURCE_COLORS: Record<string, string> = {
    iPhone: '#3b82f6', Android: '#10b981', Web: '#8b5cf6', Other: '#9ca3af', Unknown: '#d1d5db',
  };

  // Map raw Incentivio signupSource values to friendly labels
  function normalizeSource(raw: string): string {
    const lower = raw.toLowerCase();
    if (lower.includes('iphone') || lower.includes('ios')) return 'iPhone';
    if (lower.includes('android')) return 'Android';
    if (lower.includes('web')) return 'Web';
    if (lower.includes('csv') || lower.includes('batch') || lower.includes('import')) return 'Other';
    return raw; // keep as-is if unrecognized
  }

  const signupSourceData = useMemo(() => {
    const activeCustomers = customers.filter(c => c.lifetimeSpend > 0 || c.lifetimeVisits > 0);
    const sourceMap = new Map<string, number>();
    activeCustomers.forEach(c => {
      const raw = c.signupSource?.trim() || '';
      if (raw === '-' || raw === '') return;
      const label = normalizeSource(raw);
      sourceMap.set(label, (sourceMap.get(label) ?? 0) + 1);
    });
    const total = Array.from(sourceMap.values()).reduce((s, v) => s + v, 0);
    return Array.from(sourceMap.entries())
      .map(([name, count]) => ({
        name,
        count,
        pct: total > 0 ? (count / total) * 100 : 0,
        fill: SIGNUP_SOURCE_COLORS[name] || SIGNUP_SOURCE_COLORS.Unknown,
      }))
      .sort((a, b) => b.count - a.count);
  }, [customers]);

  // ─── Signup Source MoM by Location ───
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const availableSources = useMemo(() => {
    const s = new Set<string>();
    customers.forEach(c => {
      const raw = c.signupSource?.trim() || '';
      if (raw && raw !== '-') s.add(normalizeSource(raw));
    });
    return Array.from(s).sort();
  }, [customers]);

  const LOCATION_COLORS: Record<string, string> = {
    Waukee: '#2D5A3D', Coralville: '#3b82f6', Edgewood: '#f59e0b',
    Fountains: '#8b5cf6', Downtown: '#ec4899',
  };

  const signupSourceMoM = useMemo(() => {
    const active = customers.filter(c => c.lifetimeSpend > 0 || c.lifetimeVisits > 0);
    const monthMap = new Map<string, Record<string, number>>();
    const locations = new Set<string>();

    active.forEach(c => {
      if (!c.accountCreatedDate || c.accountCreatedDate === '-') return;
      const month = c.accountCreatedDate.slice(0, 7);
      if (!month.match(/^\d{4}-\d{2}$/) || month < '2025-06') return;

      const raw = c.signupSource?.trim() || '';
      if (raw === '-' || raw === '') return;
      const source = normalizeSource(raw);
      if (sourceFilter !== 'all' && source !== sourceFilter) return;

      const loc = c.reachLocation || 'Unknown';
      if (loc === 'Unknown') return;
      locations.add(loc);

      if (!monthMap.has(month)) monthMap.set(month, {});
      const entry = monthMap.get(month)!;
      entry[loc] = (entry[loc] || 0) + 1;
    });

    // Sort by raw month, compute totals and MoM %
    const sorted = Array.from(monthMap.entries()).sort(([a], [b]) => a.localeCompare(b));
    const allLocs = Array.from(locations).sort();
    let prevTotal = 0;
    const dataWithMoM = sorted.map(([month, locs], idx) => {
      const total = allLocs.reduce((s, loc) => s + (locs[loc] || 0), 0);
      const momPct = idx > 0 && prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;
      prevTotal = total;
      return { month: formatMonth(month), ...locs, _total: total, _momPct: momPct };
    });

    // Compute historical MoM average (excluding first month which has no prior)
    const momValues = dataWithMoM.filter(d => d._momPct !== null).map(d => d._momPct as number);
    const momAvg = momValues.length > 0 ? momValues.reduce((s, v) => s + v, 0) / momValues.length : 0;

    return {
      data: dataWithMoM,
      locations: allLocs,
      momAvg: Math.round(momAvg * 10) / 10,
    };
  }, [customers, sourceFilter]);

  // ─── Segment Trend (from snapshots) ───
  const segmentTrend = useMemo(() =>
    snapshots
      .filter(s => s.segmentCounts && Object.values(s.segmentCounts).some(v => v > 0))
      .map(s => ({
        month: formatMonth(s.month),
        ...s.segmentCounts,
      })),
  [snapshots]);

  const handleExport = useCallback((format: ExportFormat) => {
    exportData(customers as unknown as Record<string, unknown>[], {
      filename: `stack-customers-${todayString()}`,
      format,
    });
  }, [customers]);

  if (customers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <Users size={48} className="mb-4" />
        <p className="text-lg font-medium mb-2">No CRM data yet</p>
        <p className="text-sm">Upload an Incentivio Customer Export CSV to see customer health metrics</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Customer Health</h2>
        <ExportButton onExport={handleExport} />
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          label="Active Accounts"
          value={kpis?.activeCustomers.toLocaleString() || '0'}
          subtitle={`${([...snapshots].reverse().find(s => s.loyaltyAccounts > 0)?.loyaltyAccounts ?? kpis?.totalAccounts ?? 0).toLocaleString()} total (incl. ghost)`}
        />
        <KPICard
          label="Avg Spend"
          value={formatCurrency(kpis?.avgLTV || 0)}
          subtitle={`Projected LTV: ${formatCurrency(overallProjectedLTV)}`}
          tooltip="Projected LTV = Avg Basket × Purchases/Mo × Retention Months (by stage)"
          color="#10b981"
        />
        <KPICard
          label="Avg Basket"
          value={formatCurrency(basketYoY.avg26 > 0 ? basketYoY.avg26 : kpis?.avgBasket || 0)}
          subtitle={basketYoY.avg25 > 0 ? `2025: ${formatCurrency(basketYoY.avg25)}` : undefined}
          change={basketYoY.change ?? undefined}
          changeLabel="vs 2025"
          color="#8b5cf6"
        />
        <KPICard
          label="Churn Rate"
          value={`${kpis?.churnRate.toFixed(1)}%`}
          subtitle={`${kpis?.highRiskCount.toLocaleString()} churned (90+ days)`}
          color={kpis && kpis.churnRate > 25 ? '#ef4444' : '#f59e0b'}
        />
        <KPICard
          label="At Risk (Sliders)"
          value={kpis?.medRiskCount.toLocaleString() || '0'}
          subtitle="trending toward churn"
          color="#f59e0b"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Segment Distribution Donut */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Customer Segments</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={segmentData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={110}
                paddingAngle={2}
                dataKey="value"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                label={((props: any) => `${props.name} (${props.pct}%)`) as any}
                labelLine={true}
              >
                {segmentData.map((entry) => (
                  <Cell key={entry.stage} fill={SEGMENT_COLORS[entry.stage]} />
                ))}
              </Pie>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Tooltip formatter={((value: number, name: string) => [`${value.toLocaleString()} customers`, name]) as any} />
            </PieChart>
          </ResponsiveContainer>

          {/* Segment legend with counts */}
          <div className="grid grid-cols-3 gap-2 mt-2">
            {segmentData.map(seg => (
              <div key={seg.stage} className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: SEGMENT_COLORS[seg.stage] }} />
                <span className="text-gray-600">{seg.name}:</span>
                <span className="font-semibold text-gray-800">{seg.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Location × Segment Stacked Bar */}
        {locationData.length > 0 && locationData[0].location !== 'Unknown' && (
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Segments by Location</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={locationData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="location" width={100} tick={{ fontSize: 11 }} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const segments = payload.filter(p => (p.value as number) > 0);
                    const total = segments.reduce((s, p) => s + (p.value as number), 0);
                    return (
                      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
                        <p className="font-semibold text-gray-800 mb-1">{label}</p>
                        <p className="font-bold text-gray-900 border-b border-gray-100 pb-1.5 mb-1.5">
                          Total: {total.toLocaleString()}
                        </p>
                        {segments.map((entry, i) => (
                          <p key={i} className="flex justify-between gap-4 text-xs" style={{ color: entry.color }}>
                            <span>{entry.name}</span>
                            <span className="font-medium">{(entry.value as number).toLocaleString()} ({Math.round(((entry.value as number) / total) * 100)}%)</span>
                          </p>
                        ))}
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="WHALE" stackId="a" name="Whale" fill={SEGMENT_COLORS.WHALE} />
                <Bar dataKey="LOYALIST" stackId="a" name="Loyalist" fill={SEGMENT_COLORS.LOYALIST} />
                <Bar dataKey="REGULAR" stackId="a" name="Regular" fill={SEGMENT_COLORS.REGULAR} />
                <Bar dataKey="ROOKIE" stackId="a" name="Rookie" fill={SEGMENT_COLORS.ROOKIE} />
                <Bar dataKey="UNKNOWN" stackId="a" name="Unknown" fill={SEGMENT_COLORS.UNKNOWN} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Fallback: if no location data, show segment trend over time */}
        {(locationData.length === 0 || locationData[0].location === 'Unknown') && segmentTrend.length > 1 && (
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Segment Trend Over Time</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={segmentTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="WHALE" stackId="a" name="Whale" fill={SEGMENT_COLORS.WHALE} />
                <Bar dataKey="LOYALIST" stackId="a" name="Loyalist" fill={SEGMENT_COLORS.LOYALIST} />
                <Bar dataKey="REGULAR" stackId="a" name="Regular" fill={SEGMENT_COLORS.REGULAR} />
                <Bar dataKey="ROOKIE" stackId="a" name="Rookie" fill={SEGMENT_COLORS.ROOKIE} />
                <Bar dataKey="SLIDER" stackId="a" name="Slider" fill={SEGMENT_COLORS.SLIDER} />
                <Bar dataKey="CHURNED" stackId="a" name="Churned" fill={SEGMENT_COLORS.CHURNED} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Attrition Risk Distribution */}
      {attritionData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Shield size={18} className="text-amber-500" />
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Attrition Risk Distribution</h3>
              <p className="text-[10px] text-gray-400 mt-0.5">Based on Incentivio's attrition risk scoring (Churned / Slider / No Risk)</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {attritionData.map(d => (
              <div key={d.risk} className="rounded-lg p-4 text-center" style={{ backgroundColor: `${d.color}10` }}>
                <p className="text-xs text-gray-500 mb-1">{d.name}</p>
                <p className="text-2xl font-bold" style={{ color: d.color }}>{d.value.toLocaleString()}</p>
                <p className="text-xs mt-1" style={{ color: d.color }}>
                  {customers.length > 0 ? ((d.value / customers.length) * 100).toFixed(1) : '0'}%
                </p>
              </div>
            ))}
          </div>
          {/* Risk bar */}
          <div className="w-full h-5 rounded-full overflow-hidden flex bg-gray-100">
            {attritionData.map(d => {
              const pct = customers.length > 0 ? (d.value / customers.length) * 100 : 0;
              return (
                <div
                  key={d.risk}
                  className="h-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: d.color }}
                  title={`${d.name}: ${d.value.toLocaleString()} (${pct.toFixed(1)}%)`}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-gray-400 mt-1.5">
            {attritionData.map(d => (
              <span key={d.risk} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: d.color }} />
                {d.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Segment Health Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {segmentData.map(seg => {
          const segCustomers = customers.filter(c => c.journeyStage === seg.stage);
          const avgVisits = segCustomers.length > 0
            ? segCustomers.reduce((s, c) => s + c.lifetimeVisits, 0) / segCustomers.length
            : 0;
          const highRisk = segCustomers.filter(c => c.attritionRisk === 'high').length;
          const stageLTV = ltvByStage.get(seg.stage);

          return (
            <div key={seg.stage} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: SEGMENT_COLORS[seg.stage] }} />
                  <h4 className="text-sm font-semibold text-gray-800">{seg.name}</h4>
                </div>
                <span className="text-lg font-bold" style={{ color: SEGMENT_COLORS[seg.stage] }}>
                  {seg.value.toLocaleString()}
                </span>
              </div>
              <div className="space-y-1 text-xs text-gray-500">
                <div className="flex justify-between">
                  <span>Avg LTV (Actual)</span>
                  <span className="font-medium text-gray-700">{formatCurrency(stageLTV?.avgLTV ?? 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Projected LTV</span>
                  <span className="font-medium text-emerald-600">{formatCurrency(stageLTV?.projectedLTV ?? 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Monthly Value</span>
                  <span className="font-medium text-blue-600">{formatCurrency(stageLTV?.monthlyValue ?? 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Avg Visits</span>
                  <span className="font-medium text-gray-700">{avgVisits.toFixed(1)}</span>
                </div>
                {highRisk > 0 && (
                  <div className="flex justify-between text-red-500">
                    <span className="flex items-center gap-1"><TrendingDown size={10} /> High Risk</span>
                    <span className="font-medium">{highRisk}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Journey Analytics — dwell time, stage economics, transition matrix, recent transitions */}
      <JourneyAnalytics transitions={stageTransitions} />

      {/* Signup Source */}
      {signupSourceData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Smartphone size={18} className="text-blue-500" />
            <div>
              <h3 className="text-sm font-semibold text-gray-700">Signup Source</h3>
              <p className="text-[10px] text-gray-400 mt-0.5">Active accounts only (excludes ghost signups)</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(120, signupSourceData.length * 50)}>
            <BarChart data={signupSourceData} layout="vertical" margin={{ left: 10, right: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 12 }} />
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Tooltip
                formatter={((value: number, _name: string, props: { payload: { pct: number } }) =>
                  [`${value.toLocaleString()} (${props.payload.pct.toFixed(1)}%)`, 'Accounts']
                ) as any}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {signupSourceData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {/* Summary row */}
          <div className="grid grid-cols-3 gap-4 mt-4 pt-3 border-t border-gray-100">
            {signupSourceData.slice(0, 3).map(src => (
              <div key={src.name} className="text-center">
                <p className="text-xs text-gray-500">{src.name}</p>
                <p className="text-lg font-bold" style={{ color: src.fill }}>{src.pct.toFixed(1)}%</p>
                <p className="text-[10px] text-gray-400">{src.count.toLocaleString()} accounts</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Signup Source MoM by Location */}
      {signupSourceMoM.data.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Smartphone size={18} className="text-blue-500" />
              <div>
                <h3 className="text-sm font-semibold text-gray-700">Signups by Location (Monthly)</h3>
                <p className="text-[10px] text-gray-400 mt-0.5">Active accounts by signup month and location</p>
              </div>
            </div>
            <select
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}
              className="text-xs border border-gray-200 rounded-md px-2 py-1 text-gray-600"
            >
              <option value="all">All Sources</option>
              {availableSources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={signupSourceMoM.data} margin={{ top: 28, right: 10, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const items = payload.filter(p => (p.value as number) > 0 && p.dataKey !== '_total');
                  const dataPoint = signupSourceMoM.data.find(d => d.month === label);
                  const total = dataPoint?._total ?? 0;
                  const momPct = dataPoint?._momPct;
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
                      <p className="font-semibold text-gray-800 mb-1">{label}</p>
                      {items.map((entry, i) => (
                        <p key={i} className="flex justify-between gap-4 text-xs" style={{ color: entry.color }}>
                          <span>{entry.name}</span>
                          <span className="font-medium">{(entry.value as number).toLocaleString()}</span>
                        </p>
                      ))}
                      <p className="font-bold text-gray-900 border-t border-gray-100 pt-1.5 mt-1.5 flex justify-between">
                        <span>Total</span>
                        <span>{total.toLocaleString()}</span>
                      </p>
                      {momPct !== null && momPct !== undefined && (
                        <p className={`text-xs mt-1 ${momPct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          MoM: {momPct >= 0 ? '+' : ''}{momPct.toFixed(1)}%
                          <span className="text-gray-400 ml-1">(vs prev month total)</span>
                        </p>
                      )}
                      <p className="text-[10px] text-gray-400 mt-1">
                        Avg MoM: {signupSourceMoM.momAvg >= 0 ? '+' : ''}{signupSourceMoM.momAvg}%
                      </p>
                    </div>
                  );
                }}
              />
              <ReferenceLine y={0} stroke="transparent" />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {signupSourceMoM.locations.map((loc, idx) => {
                const isLast = idx === signupSourceMoM.locations.length - 1;
                return (
                  <Bar key={loc} dataKey={loc} stackId="loc" name={loc} fill={LOCATION_COLORS[loc] || '#6b7280'}>
                    {isLast && (
                      <LabelList
                        dataKey="_momPct"
                        position="top"
                        formatter={(v: unknown) => {
                          if (v === null || v === undefined) return '';
                          const n = Number(v);
                          return `${n >= 0 ? '+' : ''}${n.toFixed(0)}%`;
                        }}
                        style={{ fontSize: 10, fontWeight: 700 }}
                        fill="currentColor"
                        content={({ x, y, width, value }: { x?: string | number; y?: string | number; width?: string | number; value?: unknown }) => {
                          if (value === null || value === undefined) return null;
                          const n = Number(value);
                          const color = n >= 0 ? '#059669' : '#dc2626';
                          const label = `${n >= 0 ? '+' : ''}${n.toFixed(0)}%`;
                          const xn = typeof x === 'number' ? x : Number(x) || 0;
                          const yn = typeof y === 'number' ? y : Number(y) || 0;
                          const wn = typeof width === 'number' ? width : Number(width) || 0;
                          return (
                            <text x={xn + wn / 2} y={yn - 6} textAnchor="middle" fill={color} fontSize={10} fontWeight={700}>
                              {label}
                            </text>
                          );
                        }}
                      />
                    )}
                  </Bar>
                );
              })}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Attrition Risk Table */}
      {atRiskCustomers.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={18} className="text-red-500" />
            <h3 className="text-sm font-semibold text-gray-700">
              High-Value Customers at Risk ({atRiskCustomers.length} high-risk w/ spend)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                  <th className="pb-2 pr-4">Customer</th>
                  <th className="pb-2 pr-4">Stage</th>
                  <th className="pb-2 pr-4">Location</th>
                  <th className="pb-2 pr-4 text-right">Lifetime Spend</th>
                  <th className="pb-2 pr-4 text-right">Days Since Purchase</th>
                  <th className="pb-2 pr-4 text-right">Last 90d Spend</th>
                  <th className="pb-2 text-right">Visits</th>
                </tr>
              </thead>
              <tbody>
                {atRiskCustomers.map(c => (
                  <tr key={c.customerId} className="border-b border-gray-50 hover:bg-red-50/30">
                    <td className="py-2 pr-4">
                      <span className="font-medium text-gray-800">
                        {c.firstName} {c.lastName?.[0]}.
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: SEGMENT_COLORS[c.journeyStage] }}
                      >
                        {SEGMENT_LABELS[c.journeyStage]}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{c.reachLocation || '—'}</td>
                    <td className="py-2 pr-4 text-right font-medium text-gray-800">
                      {formatCurrency(c.lifetimeSpend)}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <span className={c.daysSinceLastVisit > 60 ? 'text-red-600 font-medium' : 'text-gray-600'}>
                        {c.daysSinceLastVisit === 999 ? '—' : `${c.daysSinceLastVisit}d`}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-600">{formatCurrency(c.last90DaysSpend)}</td>
                    <td className="py-2 text-right text-gray-600">{c.lifetimeVisits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
