import { useMemo, useCallback } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { KPICard } from './KPICard';
import { ExportButton } from './ExportButton';
import { exportData, todayString } from '../utils/export';
import type { ExportFormat } from '../utils/export';
import { AlertTriangle, Users, TrendingDown, Shield } from 'lucide-react';
import type { CRMCustomerRecord, JourneyStage, MonthlySnapshot } from '../types';
import { SEGMENT_COLORS } from '../utils/theme';

interface CustomerHealthViewProps {
  customers: CRMCustomerRecord[];
  snapshots: MonthlySnapshot[];
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

export function CustomerHealthView({ customers, snapshots }: CustomerHealthViewProps) {
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
          label="Total Accounts"
          value={kpis?.totalAccounts.toLocaleString() || '0'}
          subtitle={`${kpis?.activeCustomers.toLocaleString()} active`}
        />
        <KPICard
          label="Avg LTV"
          value={formatCurrency(kpis?.avgLTV || 0)}
          color="#10b981"
        />
        <KPICard
          label="Avg Basket"
          value={formatCurrency(kpis?.avgBasket || 0)}
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
                <Tooltip />
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
          const avgSpend = segCustomers.length > 0
            ? segCustomers.reduce((s, c) => s + c.lifetimeSpend, 0) / segCustomers.length
            : 0;
          const avgVisits = segCustomers.length > 0
            ? segCustomers.reduce((s, c) => s + c.lifetimeVisits, 0) / segCustomers.length
            : 0;
          const highRisk = segCustomers.filter(c => c.attritionRisk === 'high').length;

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
                  <span>Avg Lifetime Spend</span>
                  <span className="font-medium text-gray-700">{formatCurrency(avgSpend)}</span>
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
