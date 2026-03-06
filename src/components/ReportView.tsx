import { useMemo, useState, useRef, useCallback } from 'react';
import { KPICard } from './KPICard';
import { ExportButton } from './ExportButton';
import { exportData, todayString } from '../utils/export';
import type { ExportFormat } from '../utils/export';
import { FileText, Printer, TrendingUp, TrendingDown, Minus, ChevronDown } from 'lucide-react';
import type { MonthlySnapshot } from '../types';
import {
  getMoMComparison, getQoQComparison, getYoYComparison,
  getAvailableMonths, getLatestMonth,
  type PeriodComparison, type PeriodDelta,
} from '../utils/periodComparison';

interface ReportViewProps {
  snapshots: MonthlySnapshot[];
}

type ComparisonType = 'mom' | 'qoq' | 'yoy';

function formatCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatMetricValue(metric: string, value: number): string {
  if (metric.includes('CAC') || metric.includes('Revenue') || metric.includes('Spend') ||
      metric.includes('LTV') || metric.includes('Order Value')) {
    return formatCurrency(value);
  }
  if (metric.includes('ROI')) return `${value.toFixed(1)}%`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function DeltaIndicator({ delta }: { delta: PeriodDelta }) {
  // Determine if positive change is "good" or "bad" for this metric
  const invertedMetrics = ['Est. CAC', 'High Attrition Count'];
  const isInverted = invertedMetrics.includes(delta.metric);
  const isPositive = delta.absoluteChange > 0;
  const isGood = isInverted ? !isPositive : isPositive;
  const isNeutral = delta.absoluteChange === 0;

  if (isNeutral) {
    return (
      <span className="inline-flex items-center gap-1 text-gray-400 text-sm">
        <Minus size={14} />
        <span>No change</span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${
      isGood ? 'text-green-600' : 'text-red-600'
    }`}>
      {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
      <span>
        {isPositive ? '+' : ''}
        {delta.percentChange !== null
          ? `${delta.percentChange}%`
          : formatMetricValue(delta.metric, delta.absoluteChange)
        }
      </span>
    </span>
  );
}

// Group metrics into sections for the report
const METRIC_SECTIONS: Array<{ title: string; metrics: string[] }> = [
  {
    title: 'Revenue & Sales',
    metrics: ['Total Revenue', 'Total Orders', 'Avg Order Value'],
  },
  {
    title: 'Marketing Spend',
    metrics: ['Total Spend', 'Meta Spend', 'Google Spend', 'Est. CAC', 'Est. ROI'],
  },
  {
    title: 'Digital Performance',
    metrics: ['Meta Impressions', 'Meta Clicks', 'Google Impressions', 'Google Clicks'],
  },
  {
    title: 'Customer Health',
    metrics: ['New Customers', 'Loyalty Accounts', 'Avg LTV', 'High Attrition Count'],
  },
];

export function ReportView({ snapshots }: ReportViewProps) {
  const [compType, setCompType] = useState<ComparisonType>('mom');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  const months = useMemo(() => getAvailableMonths(snapshots), [snapshots]);
  const activeMonth = selectedMonth || getLatestMonth(snapshots);

  const comparison = useMemo((): PeriodComparison | null => {
    if (!activeMonth) return null;
    switch (compType) {
      case 'mom': return getMoMComparison(snapshots, activeMonth);
      case 'qoq': return getQoQComparison(snapshots, activeMonth);
      case 'yoy': return getYoYComparison(snapshots, activeMonth);
    }
  }, [snapshots, activeMonth, compType]);

  // Index deltas by metric name for easy lookup
  const deltaMap = useMemo(() => {
    if (!comparison) return new Map<string, PeriodDelta>();
    return new Map(comparison.deltas.map(d => [d.metric, d]));
  }, [comparison]);

  // Summary stats for the KPI row
  const summaryKPIs = useMemo(() => {
    if (!comparison) return null;
    const rev = deltaMap.get('Total Revenue');
    const spend = deltaMap.get('Total Spend');
    const cac = deltaMap.get('Est. CAC');
    const roi = deltaMap.get('Est. ROI');
    return { rev, spend, cac, roi };
  }, [comparison, deltaMap]);

  const handleExport = useCallback((format: ExportFormat) => {
    if (!comparison) return;
    const exportRows = comparison.deltas.map(d => ({
      metric: d.metric,
      previous: d.previous,
      current: d.current,
      absoluteChange: d.absoluteChange,
      percentChange: d.percentChange,
      period: `${comparison.currentPeriod} vs ${comparison.previousPeriod}`,
    }));
    exportData(exportRows as unknown as Record<string, unknown>[], {
      filename: `stack-report-${compType}-${activeMonth || todayString()}`,
      format,
    });
  }, [comparison, compType, activeMonth]);

  const handlePrint = () => {
    window.print();
  };

  // ─── Empty State ───
  if (snapshots.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <FileText size={48} className="mb-4" />
        <p className="text-lg font-medium mb-2">Not enough data for comparison</p>
        <p className="text-sm">Upload at least two months of data to generate period-over-period reports</p>
      </div>
    );
  }

  const compLabels: Record<ComparisonType, string> = {
    mom: 'Month-over-Month',
    qoq: 'Quarter-over-Quarter',
    yoy: 'Year-over-Year',
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
        <h2 className="text-lg font-semibold text-gray-900">Performance Report</h2>
        <div className="flex items-center gap-3">
          {/* Comparison Type */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {(['mom', 'qoq', 'yoy'] as ComparisonType[]).map(type => (
              <button
                key={type}
                onClick={() => setCompType(type)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  compType === type
                    ? 'bg-white text-[#2D5A3D] shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {type.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Month Selector */}
          <div className="relative">
            <select
              value={activeMonth || ''}
              onChange={e => setSelectedMonth(e.target.value || null)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 pr-8 text-gray-600 appearance-none"
            >
              {months.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>

          {/* Export + Print */}
          <ExportButton onExport={handleExport} />
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-1.5 bg-[#2D5A3D] text-white rounded-lg text-sm hover:bg-[#4A7C5C] transition-colors"
          >
            <Printer size={14} />
            Print PDF
          </button>
        </div>
      </div>

      {/* Report Content */}
      <div ref={reportRef} className="print:p-0">
        {/* Print Header (hidden on screen) */}
        <div className="hidden print:block print:mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Stack Wellness Cafe</h1>
          <p className="text-sm text-gray-500">
            {compLabels[compType]} Report — {comparison?.currentPeriod} vs {comparison?.previousPeriod}
          </p>
          <p className="text-xs text-gray-400 mt-1">Generated {new Date().toLocaleDateString()}</p>
        </div>

        {!comparison ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-amber-800 text-sm">
            <p className="font-medium">No comparison available</p>
            <p className="mt-1">
              {compType === 'yoy' && 'Year-over-year requires data from the same month last year.'}
              {compType === 'qoq' && 'Quarter comparison requires data from both the current and previous quarter.'}
              {compType === 'mom' && 'Month-over-month requires data from the previous month.'}
            </p>
          </div>
        ) : (
          <>
            {/* Period Label */}
            <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm mb-6 print:shadow-none print:border-gray-300">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-700">{compLabels[compType]} Comparison</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {comparison.currentPeriod} vs {comparison.previousPeriod}
                  </p>
                </div>
                <div className="text-xs text-gray-400">
                  {comparison.deltas.filter(d => d.absoluteChange > 0).length} improving ·{' '}
                  {comparison.deltas.filter(d => d.absoluteChange < 0).length} declining
                </div>
              </div>
            </div>

            {/* KPI Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <KPICard
                label="Revenue"
                value={summaryKPIs?.rev ? formatMetricValue('Total Revenue', summaryKPIs.rev.current) : '—'}
                subtitle={summaryKPIs?.rev?.percentChange !== null
                  ? `${(summaryKPIs.rev.percentChange ?? 0) >= 0 ? '+' : ''}${summaryKPIs.rev.percentChange}% ${compType}`
                  : undefined}
                color={(summaryKPIs?.rev?.absoluteChange ?? 0) >= 0 ? '#10b981' : '#ef4444'}
              />
              <KPICard
                label="Total Spend"
                value={summaryKPIs?.spend ? formatMetricValue('Total Spend', summaryKPIs.spend.current) : '—'}
                subtitle={summaryKPIs?.spend?.percentChange !== null
                  ? `${(summaryKPIs.spend.percentChange ?? 0) >= 0 ? '+' : ''}${summaryKPIs.spend.percentChange}% ${compType}`
                  : undefined}
              />
              <KPICard
                label="Est. CAC"
                value={summaryKPIs?.cac ? formatMetricValue('Est. CAC', summaryKPIs.cac.current) : '—'}
                subtitle={summaryKPIs?.cac?.percentChange !== null
                  ? `${(summaryKPIs.cac.percentChange ?? 0) >= 0 ? '+' : ''}${summaryKPIs.cac.percentChange}% ${compType}`
                  : undefined}
                color={(summaryKPIs?.cac?.absoluteChange ?? 0) <= 0 ? '#10b981' : '#ef4444'}
              />
              <KPICard
                label="Est. ROI"
                value={summaryKPIs?.roi ? `${summaryKPIs.roi.current.toFixed(1)}%` : '—'}
                subtitle={summaryKPIs?.roi?.percentChange !== null
                  ? `${(summaryKPIs.roi.absoluteChange ?? 0) >= 0 ? '+' : ''}${summaryKPIs.roi.absoluteChange.toFixed(1)}pp`
                  : undefined}
                color={(summaryKPIs?.roi?.absoluteChange ?? 0) >= 0 ? '#10b981' : '#ef4444'}
              />
            </div>

            {/* Metric Sections */}
            <div className="space-y-4">
              {METRIC_SECTIONS.map(section => {
                const sectionDeltas = section.metrics
                  .map(m => deltaMap.get(m))
                  .filter((d): d is PeriodDelta => d !== undefined);

                if (sectionDeltas.length === 0) return null;

                return (
                  <div key={section.title} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm print:shadow-none print:border-gray-300 print:break-inside-avoid">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">{section.title}</h3>
                    <div className="divide-y divide-gray-50">
                      {sectionDeltas.map(delta => (
                        <div key={delta.metric} className="flex items-center justify-between py-2.5">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-700">{delta.metric}</p>
                          </div>
                          <div className="flex items-center gap-6 text-right">
                            <div className="w-24">
                              <p className="text-xs text-gray-400">Previous</p>
                              <p className="text-sm text-gray-500">
                                {formatMetricValue(delta.metric, delta.previous)}
                              </p>
                            </div>
                            <div className="w-24">
                              <p className="text-xs text-gray-400">Current</p>
                              <p className="text-sm font-semibold text-gray-800">
                                {formatMetricValue(delta.metric, delta.current)}
                              </p>
                            </div>
                            <div className="w-28">
                              <DeltaIndicator delta={delta} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="mt-6 text-center text-xs text-gray-400 print:mt-10">
              <p>Stack Wellness Cafe — Marketing Performance Dashboard</p>
              <p>Report generated {new Date().toLocaleString()}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
