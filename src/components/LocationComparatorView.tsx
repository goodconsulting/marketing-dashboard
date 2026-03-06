import { useMemo, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Cell,
} from 'recharts';
import { KPICard } from './KPICard';
import { ExportButton } from './ExportButton';
import { exportData, todayString } from '../utils/export';
import type { ExportFormat } from '../utils/export';
import { MapPin, TrendingUp, TrendingDown, Users } from 'lucide-react';
import type { MonthlySnapshot, CRMCustomerRecord, ToastSales, JourneyStage } from '../types';
import { LOCATION_COLORS, DEFAULT_LOCATION_COLOR } from '../utils/theme';

interface LocationComparatorViewProps {
  snapshots: MonthlySnapshot[];
  crmCustomers: CRMCustomerRecord[];
  toastSales: ToastSales[];
}

interface LocationKPI {
  location: string;
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  customerCount: number;
  whaleCount: number;
  loyalistCount: number;
  churnedCount: number;
  avgLTV: number;
  highAttritionCount: number;
  monthsOfData: number;
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function LocationComparatorView({ snapshots, crmCustomers, toastSales }: LocationComparatorViewProps) {
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  // ─── Available Months ───
  const months = useMemo(() => {
    const set = new Set<string>();
    toastSales.forEach(s => set.add(s.month));
    return Array.from(set).sort();
  }, [toastSales]);

  // ─── All Locations (from Toast sales data) ───
  const allLocations = useMemo(() => {
    const set = new Set<string>();
    toastSales.forEach(s => set.add(s.location));
    return Array.from(set).sort();
  }, [toastSales]);

  // ─── Location KPIs (aggregated or filtered by month) ───
  const locationKPIs = useMemo((): LocationKPI[] => {
    const filteredSales = selectedMonth
      ? toastSales.filter(s => s.month === selectedMonth)
      : toastSales;

    // Latest CRM snapshot month
    const crmMonths = [...new Set(crmCustomers.map(c => c.snapshotMonth))].sort();
    const latestCRMMonth = selectedMonth || crmMonths[crmMonths.length - 1] || '';
    const filteredCRM = latestCRMMonth
      ? crmCustomers.filter(c => c.snapshotMonth === latestCRMMonth)
      : crmCustomers;

    return allLocations.map(location => {
      const locSales = filteredSales.filter(s => s.location === location);
      const locCRM = filteredCRM.filter(c => c.reachLocation === location);

      const totalRevenue = locSales.reduce((s, r) => s + r.grossSales, 0);
      const totalOrders = locSales.reduce((s, r) => s + r.orders, 0);
      const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      const segCounts: Record<JourneyStage, number> = {
        WHALE: 0, LOYALIST: 0, REGULAR: 0, ROOKIE: 0, CHURNED: 0, SLIDER: 0, UNKNOWN: 0,
      };
      let highAttrition = 0;
      let sumLTV = 0;
      for (const c of locCRM) {
        segCounts[c.journeyStage]++;
        if (c.attritionRisk === 'high') highAttrition++;
        sumLTV += c.lifetimeSpend;
      }

      return {
        location,
        totalRevenue,
        totalOrders,
        avgOrderValue,
        customerCount: locCRM.length,
        whaleCount: segCounts.WHALE,
        loyalistCount: segCounts.LOYALIST,
        churnedCount: segCounts.CHURNED,
        avgLTV: locCRM.length > 0 ? sumLTV / locCRM.length : 0,
        highAttritionCount: highAttrition,
        monthsOfData: [...new Set(locSales.map(s => s.month))].length,
      };
    });
  }, [allLocations, toastSales, crmCustomers, selectedMonth]);

  // ─── KPI Totals ───
  const totals = useMemo(() => {
    const totalRevenue = locationKPIs.reduce((s, l) => s + l.totalRevenue, 0);
    const totalOrders = locationKPIs.reduce((s, l) => s + l.totalOrders, 0);
    const totalCustomers = locationKPIs.reduce((s, l) => s + l.customerCount, 0);
    const topLocation = locationKPIs.length > 0
      ? [...locationKPIs].sort((a, b) => b.totalRevenue - a.totalRevenue)[0]
      : null;
    return { totalRevenue, totalOrders, totalCustomers, topLocation };
  }, [locationKPIs]);

  // ─── Revenue by Location (bar chart) ───
  const revenueChartData = useMemo(() =>
    locationKPIs.map(l => ({
      name: l.location,
      revenue: l.totalRevenue,
      orders: l.totalOrders,
    })),
  [locationKPIs]);

  // ─── Radar Chart: Normalized KPIs per location ───
  const radarData = useMemo(() => {
    if (locationKPIs.length === 0) return [];

    // Normalize each metric to 0-100 scale across locations
    const maxRev = Math.max(...locationKPIs.map(l => l.totalRevenue), 1);
    const maxOrders = Math.max(...locationKPIs.map(l => l.totalOrders), 1);
    const maxAOV = Math.max(...locationKPIs.map(l => l.avgOrderValue), 1);
    const maxLTV = Math.max(...locationKPIs.map(l => l.avgLTV), 1);
    const maxCustomers = Math.max(...locationKPIs.map(l => l.customerCount), 1);
    const maxWhales = Math.max(...locationKPIs.map(l => l.whaleCount), 1);

    const metrics = ['Revenue', 'Orders', 'AOV', 'Avg LTV', 'Customers', 'Whales'];
    return metrics.map((metric, idx) => {
      const entry: Record<string, string | number> = { metric };
      for (const l of locationKPIs) {
        const vals = [
          l.totalRevenue / maxRev,
          l.totalOrders / maxOrders,
          l.avgOrderValue / maxAOV,
          l.avgLTV / maxLTV,
          l.customerCount / maxCustomers,
          l.whaleCount / maxWhales,
        ];
        entry[l.location] = Math.round(vals[idx] * 100);
      }
      return entry;
    });
  }, [locationKPIs]);

  // ─── Monthly Trend by Location ───
  const monthlyTrendData = useMemo(() => {
    return months.map(month => {
      const entry: Record<string, string | number> = { month };
      for (const loc of allLocations) {
        const sales = toastSales.find(s => s.month === month && s.location === loc);
        entry[loc] = sales?.grossSales || 0;
      }
      return entry;
    });
  }, [months, allLocations, toastSales]);

  const handleExport = useCallback((format: ExportFormat) => {
    exportData(locationKPIs as unknown as Record<string, unknown>[], {
      filename: `stack-locations-${todayString()}`,
      format,
    });
  }, [locationKPIs]);

  // ─── Empty State ───
  if (toastSales.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <MapPin size={48} className="mb-4" />
        <p className="text-lg font-medium mb-2">No location data yet</p>
        <p className="text-sm">Upload Toast POS sales data or connect the Toast API to compare locations</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + Month Filter */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Location Comparator</h2>
        <div className="flex items-center gap-3">
          <ExportButton onExport={handleExport} />
          <select
          value={selectedMonth || ''}
          onChange={e => setSelectedMonth(e.target.value || null)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600"
        >
          <option value="">All Time</option>
          {months.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Locations"
          value={allLocations.length.toString()}
          subtitle={`${totals.totalCustomers.toLocaleString()} total customers`}
        />
        <KPICard
          label="Total Revenue"
          value={formatCurrency(totals.totalRevenue)}
          subtitle={selectedMonth || 'All time'}
          color="#10b981"
        />
        <KPICard
          label="Total Orders"
          value={formatNumber(totals.totalOrders)}
          color="#2D5A3D"
        />
        <KPICard
          label="Top Location"
          value={totals.topLocation?.location || '—'}
          subtitle={totals.topLocation ? formatCurrency(totals.topLocation.totalRevenue) : ''}
          color="#f59e0b"
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by Location */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Revenue by Location</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={revenueChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => formatCurrency(v)} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="revenue" name="Revenue" radius={[4, 4, 0, 0]}>
                {revenueChartData.map((entry, idx) => (
                  <Cell
                    key={idx}
                    fill={LOCATION_COLORS[entry.name] || DEFAULT_LOCATION_COLOR}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Radar Comparison */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Multi-Metric Comparison</h3>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#e5e7eb" />
              <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10 }} />
              <PolarRadiusAxis tick={{ fontSize: 9 }} domain={[0, 100]} />
              {allLocations.map(loc => (
                <Radar
                  key={loc}
                  name={loc}
                  dataKey={loc}
                  stroke={LOCATION_COLORS[loc] || DEFAULT_LOCATION_COLOR}
                  fill={LOCATION_COLORS[loc] || DEFAULT_LOCATION_COLOR}
                  fillOpacity={0.1}
                  strokeWidth={2}
                />
              ))}
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Tooltip />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Revenue Trend Over Time (stacked) */}
      {monthlyTrendData.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Monthly Revenue Trend by Location</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => formatCurrency(v)} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {allLocations.map(loc => (
                <Bar
                  key={loc}
                  dataKey={loc}
                  name={loc}
                  stackId="revenue"
                  fill={LOCATION_COLORS[loc] || DEFAULT_LOCATION_COLOR}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Location KPI Table */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Location Performance Matrix</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                <th className="pb-2 pr-4">Location</th>
                <th className="pb-2 pr-4 text-right">Revenue</th>
                <th className="pb-2 pr-4 text-right">Orders</th>
                <th className="pb-2 pr-4 text-right">AOV</th>
                <th className="pb-2 pr-4 text-right">Customers</th>
                <th className="pb-2 pr-4 text-right">Whales</th>
                <th className="pb-2 pr-4 text-right">Loyalists</th>
                <th className="pb-2 pr-4 text-right">Churned</th>
                <th className="pb-2 pr-4 text-right">Avg LTV</th>
                <th className="pb-2 text-right">⚠ At Risk</th>
              </tr>
            </thead>
            <tbody>
              {locationKPIs.map(l => {
                const churnRate = l.customerCount > 0
                  ? (l.churnedCount / l.customerCount) * 100
                  : 0;
                const isTopRevenue = l.totalRevenue === Math.max(...locationKPIs.map(x => x.totalRevenue));
                const isHighChurn = churnRate > 20;

                return (
                  <tr key={l.location} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-2.5 pr-4 font-medium text-gray-800">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: LOCATION_COLORS[l.location] || DEFAULT_LOCATION_COLOR }}
                        />
                        {l.location}
                        {isTopRevenue && (
                          <TrendingUp size={14} className="text-green-500" />
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-right font-medium text-gray-800">
                      {formatCurrency(l.totalRevenue)}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-gray-600">
                      {l.totalOrders.toLocaleString()}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-gray-600">
                      {formatCurrency(l.avgOrderValue)}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-gray-600">
                      <div className="flex items-center justify-end gap-1">
                        <Users size={12} className="text-gray-400" />
                        {l.customerCount.toLocaleString()}
                      </div>
                    </td>
                    <td className="py-2.5 pr-4 text-right">
                      <span className="text-green-700 font-medium">{l.whaleCount}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-right text-blue-600">
                      {l.loyalistCount}
                    </td>
                    <td className="py-2.5 pr-4 text-right">
                      <span className={isHighChurn ? 'text-red-600 font-medium' : 'text-gray-600'}>
                        {l.churnedCount}
                        {l.customerCount > 0 && (
                          <span className="text-xs text-gray-400 ml-1">
                            ({churnRate.toFixed(0)}%)
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-right font-medium text-gray-800">
                      {l.avgLTV > 0 ? formatCurrency(l.avgLTV) : '—'}
                    </td>
                    <td className="py-2.5 text-right">
                      {l.highAttritionCount > 0 ? (
                        <span className="flex items-center justify-end gap-1 text-amber-600 font-medium">
                          <TrendingDown size={12} />
                          {l.highAttritionCount}
                        </span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* Totals Row */}
            <tfoot>
              <tr className="border-t-2 border-gray-200 font-semibold text-gray-800">
                <td className="py-2.5 pr-4">All Locations</td>
                <td className="py-2.5 pr-4 text-right">{formatCurrency(totals.totalRevenue)}</td>
                <td className="py-2.5 pr-4 text-right">{totals.totalOrders.toLocaleString()}</td>
                <td className="py-2.5 pr-4 text-right">
                  {totals.totalOrders > 0 ? formatCurrency(totals.totalRevenue / totals.totalOrders) : '—'}
                </td>
                <td className="py-2.5 pr-4 text-right">{totals.totalCustomers.toLocaleString()}</td>
                <td className="py-2.5 pr-4 text-right text-green-700">
                  {locationKPIs.reduce((s, l) => s + l.whaleCount, 0)}
                </td>
                <td className="py-2.5 pr-4 text-right text-blue-600">
                  {locationKPIs.reduce((s, l) => s + l.loyalistCount, 0)}
                </td>
                <td className="py-2.5 pr-4 text-right">
                  {locationKPIs.reduce((s, l) => s + l.churnedCount, 0)}
                </td>
                <td className="py-2.5 pr-4 text-right">—</td>
                <td className="py-2.5 text-right text-amber-600">
                  {locationKPIs.reduce((s, l) => s + l.highAttritionCount, 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
