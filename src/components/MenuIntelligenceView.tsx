import { useMemo, useState, useCallback } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, BarChart, Bar, Legend,
} from 'recharts';
import { KPICard } from './KPICard';
import { ExportButton } from './ExportButton';
import { exportData, todayString } from '../utils/export';
import type { ExportFormat } from '../utils/export';
import { UtensilsCrossed, Star, AlertTriangle, TrendingUp } from 'lucide-react';
import type { MenuIntelligenceItem } from '../types';
import { QUADRANT_COLORS } from '../utils/theme';

interface MenuIntelligenceViewProps {
  items: MenuIntelligenceItem[];
}

const QUADRANT_LABELS: Record<MenuIntelligenceItem['menuQuadrant'], string> = {
  star: 'Star',
  plow_horse: 'Plow Horse',
  puzzle: 'Puzzle',
  dog: 'Dog',
};

const QUADRANT_DESCRIPTIONS: Record<MenuIntelligenceItem['menuQuadrant'], string> = {
  star: 'High volume + high revenue — protect & promote',
  plow_horse: 'High volume + low revenue — raise prices or reformulate',
  puzzle: 'Low volume + high revenue — hidden gems, market more',
  dog: 'Low volume + low revenue — consider removing',
};

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

type SortKey = 'revenueLastYear' | 'totalSoldLastYear' | 'score' | 'freqRevenueRatio' | 'repeatPurchaseProxy';

export function MenuIntelligenceView({ items }: MenuIntelligenceViewProps) {
  const [selectedQuadrant, setSelectedQuadrant] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('revenueLastYear');

  // ─── KPIs ───
  const kpis = useMemo(() => {
    if (items.length === 0) return null;

    const totalRevenue = items.reduce((s, i) => s + i.revenueLastYear, 0);
    const totalSold = items.reduce((s, i) => s + i.totalSoldLastYear, 0);
    const avgScore = items.reduce((s, i) => s + i.score, 0) / items.length;
    const quadrantCounts = { star: 0, plow_horse: 0, puzzle: 0, dog: 0 };
    items.forEach(i => quadrantCounts[i.menuQuadrant]++);

    // Revenue concentration: top 20% of items by revenue
    const sortedByRev = [...items].sort((a, b) => b.revenueLastYear - a.revenueLastYear);
    const top20Count = Math.max(1, Math.ceil(items.length * 0.2));
    const top20Revenue = sortedByRev.slice(0, top20Count).reduce((s, i) => s + i.revenueLastYear, 0);
    const paretoRatio = totalRevenue > 0 ? (top20Revenue / totalRevenue) * 100 : 0;

    // Frequent customer dependency
    const avgFreqRatio = items.filter(i => i.freqRevenueRatio > 0)
      .reduce((s, i) => s + i.freqRevenueRatio, 0) /
      (items.filter(i => i.freqRevenueRatio > 0).length || 1);

    return {
      totalRevenue,
      totalSold,
      avgScore,
      itemCount: items.length,
      quadrantCounts,
      paretoRatio,
      avgFreqRatio,
    };
  }, [items]);

  // ─── Scatter Plot Data ───
  const scatterData = useMemo(() =>
    items.map(item => ({
      ...item,
      x: item.totalSoldLastYear,
      y: item.revenueLastYear,
    })),
  [items]);

  // ─── Category Revenue Breakdown ───
  const categoryData = useMemo(() => {
    const groups = new Map<string, { revenue: number; items: number; sold: number }>();
    items.forEach(item => {
      const group = item.parentGroup || 'Other';
      const existing = groups.get(group) || { revenue: 0, items: 0, sold: 0 };
      existing.revenue += item.revenueLastYear;
      existing.items += 1;
      existing.sold += item.totalSoldLastYear;
      groups.set(group, existing);
    });

    return Array.from(groups.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10); // Top 10 categories
  }, [items]);

  // ─── Filtered & Sorted Table ───
  const tableItems = useMemo(() => {
    let filtered = selectedQuadrant
      ? items.filter(i => i.menuQuadrant === selectedQuadrant)
      : items;

    return [...filtered].sort((a, b) => b[sortBy] - a[sortBy]);
  }, [items, selectedQuadrant, sortBy]);

  const handleExport = useCallback((format: ExportFormat) => {
    exportData(tableItems as unknown as Record<string, unknown>[], {
      filename: `stack-menu-intel-${todayString()}`,
      format,
    });
  }, [tableItems]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <UtensilsCrossed size={48} className="mb-4" />
        <p className="text-lg font-medium mb-2">No menu data yet</p>
        <p className="text-sm">Upload an Incentivio Menu Intelligence CSV to see menu analytics</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Menu Intelligence</h2>
        <ExportButton onExport={handleExport} />
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          label="Menu Items"
          value={kpis?.itemCount.toString() || '0'}
          subtitle={`Avg score: ${kpis?.avgScore.toFixed(1)}`}
        />
        <KPICard
          label="Total Revenue (Year)"
          value={formatCurrency(kpis?.totalRevenue || 0)}
          color="#10b981"
        />
        <KPICard
          label="Revenue Pareto"
          value={`${kpis?.paretoRatio.toFixed(0)}%`}
          subtitle="from top 20% of items"
          color="#8b5cf6"
        />
        <KPICard
          label="Stars"
          value={kpis?.quadrantCounts.star.toString() || '0'}
          subtitle={`${kpis?.quadrantCounts.dog} dogs`}
          color="#2D5A3D"
        />
        <KPICard
          label="Loyal Customer Share"
          value={`${((kpis?.avgFreqRatio || 0) * 100).toFixed(0)}%`}
          subtitle="avg freq. customer revenue"
          color="#f59e0b"
        />
      </div>

      {/* Quadrant Filter Chips */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setSelectedQuadrant(null)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            !selectedQuadrant ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          All ({items.length})
        </button>
        {(Object.keys(QUADRANT_LABELS) as MenuIntelligenceItem['menuQuadrant'][]).map(q => (
          <button
            key={q}
            onClick={() => setSelectedQuadrant(selectedQuadrant === q ? null : q)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              selectedQuadrant === q
                ? 'text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            style={selectedQuadrant === q ? { backgroundColor: QUADRANT_COLORS[q] } : {}}
          >
            {QUADRANT_LABELS[q]} ({kpis?.quadrantCounts[q] || 0})
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Menu Health Quadrant (Scatter) */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Menu Health Quadrant</h3>
          <ResponsiveContainer width="100%" height={340}>
            <ScatterChart margin={{ bottom: 20, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                type="number"
                dataKey="x"
                name="Units Sold"
                tick={{ fontSize: 11 }}
                label={{ value: 'Units Sold (Year)', position: 'insideBottom', offset: -10, fontSize: 11 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="Revenue"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => formatCurrency(v)}
                label={{ value: 'Revenue', angle: -90, position: 'insideLeft', fontSize: 11 }}
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const item = payload[0].payload as MenuIntelligenceItem;
                  return (
                    <div className="bg-white border border-gray-200 rounded-lg p-3 shadow-lg text-xs">
                      <p className="font-semibold text-gray-800 mb-1">{item.name}</p>
                      <p className="text-gray-500">{item.parentGroup}</p>
                      <div className="mt-1 space-y-0.5">
                        <p>Revenue: <strong>{formatCurrency(item.revenueLastYear)}</strong></p>
                        <p>Sold: <strong>{item.totalSoldLastYear.toLocaleString()}</strong></p>
                        <p>Score: <strong>{item.score}</strong></p>
                        <p>Freq Revenue: <strong>{(item.freqRevenueRatio * 100).toFixed(0)}%</strong></p>
                      </div>
                      <p className="mt-1 font-medium" style={{ color: QUADRANT_COLORS[item.menuQuadrant] }}>
                        {QUADRANT_LABELS[item.menuQuadrant]}
                      </p>
                    </div>
                  );
                }}
              />
              <Scatter data={scatterData}>
                {scatterData.map((entry, idx) => (
                  <Cell
                    key={idx}
                    fill={QUADRANT_COLORS[entry.menuQuadrant]}
                    opacity={selectedQuadrant ? (entry.menuQuadrant === selectedQuadrant ? 1 : 0.15) : 0.7}
                    r={Math.max(4, Math.min(12, entry.score / 10))}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>

          {/* Quadrant Legend */}
          <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
            {(Object.keys(QUADRANT_LABELS) as MenuIntelligenceItem['menuQuadrant'][]).map(q => (
              <div key={q} className="flex items-start gap-2">
                <div className="w-3 h-3 rounded-full mt-0.5 shrink-0" style={{ backgroundColor: QUADRANT_COLORS[q] }} />
                <div>
                  <span className="font-medium text-gray-700">{QUADRANT_LABELS[q]}</span>
                  <p className="text-gray-400">{QUADRANT_DESCRIPTIONS[q]}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Category Revenue Breakdown */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Revenue by Category</h3>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={categoryData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v)} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="revenue" name="Revenue" fill="#2D5A3D" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Item Table */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">
            Menu Items {selectedQuadrant && `— ${QUADRANT_LABELS[selectedQuadrant as MenuIntelligenceItem['menuQuadrant']]}`}
            <span className="font-normal text-gray-400 ml-2">({tableItems.length} items)</span>
          </h3>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortKey)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-600"
          >
            <option value="revenueLastYear">Sort: Revenue</option>
            <option value="totalSoldLastYear">Sort: Volume</option>
            <option value="score">Sort: Score</option>
            <option value="freqRevenueRatio">Sort: Loyalty Share</option>
            <option value="repeatPurchaseProxy">Sort: Repeat Rate</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                <th className="pb-2 pr-3">Item</th>
                <th className="pb-2 pr-3">Category</th>
                <th className="pb-2 pr-3">Quadrant</th>
                <th className="pb-2 pr-3 text-right">Score</th>
                <th className="pb-2 pr-3 text-right">Revenue</th>
                <th className="pb-2 pr-3 text-right">Sold/Year</th>
                <th className="pb-2 pr-3 text-right">$/Unit</th>
                <th className="pb-2 pr-3 text-right">Loyal %</th>
                <th className="pb-2 text-right">Repeat</th>
              </tr>
            </thead>
            <tbody>
              {tableItems.slice(0, 50).map((item, idx) => (
                <tr key={idx} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="py-2 pr-3 font-medium text-gray-800 max-w-[180px] truncate">
                    {item.name}
                  </td>
                  <td className="py-2 pr-3 text-gray-500 text-xs">{item.parentGroup}</td>
                  <td className="py-2 pr-3">
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                      style={{ backgroundColor: QUADRANT_COLORS[item.menuQuadrant] }}
                    >
                      {QUADRANT_LABELS[item.menuQuadrant]}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right text-gray-700">{item.score.toFixed(0)}</td>
                  <td className="py-2 pr-3 text-right font-medium text-gray-800">
                    {formatCurrency(item.revenueLastYear)}
                  </td>
                  <td className="py-2 pr-3 text-right text-gray-600">
                    {item.totalSoldLastYear.toLocaleString()}
                  </td>
                  <td className="py-2 pr-3 text-right text-gray-600">
                    {formatCurrency(item.revenuePerUnit)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <span className={item.freqRevenueRatio > 0.6 ? 'text-green-600 font-medium' : 'text-gray-600'}>
                      {item.freqRevenueRatio > 0 ? `${(item.freqRevenueRatio * 100).toFixed(0)}%` : '—'}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <span className={item.repeatPurchaseProxy > 1 ? 'text-green-600' : item.repeatPurchaseProxy < 0.8 ? 'text-red-500' : 'text-gray-600'}>
                      {item.repeatPurchaseProxy > 0 ? `${item.repeatPurchaseProxy.toFixed(2)}x` : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tableItems.length > 50 && (
            <p className="text-xs text-gray-400 mt-2 text-center">
              Showing top 50 of {tableItems.length} items
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
