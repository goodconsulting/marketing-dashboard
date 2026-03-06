import { useMemo, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts';
import { KPICard } from './KPICard';
import { ExportButton } from './ExportButton';
import { exportData, todayString } from '../utils/export';
import type { ExportFormat } from '../utils/export';
import type { MetaCampaign, GoogleCampaign, GoogleDaily } from '../types';

interface PerformanceViewProps {
  metaCampaigns: MetaCampaign[];
  googleCampaigns: GoogleCampaign[];
  googleDaily: GoogleDaily[];
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

export function PerformanceView({ metaCampaigns, googleCampaigns, googleDaily }: PerformanceViewProps) {
  // Meta summary
  const metaSummary = useMemo(() => {
    const totalSpend = metaCampaigns.reduce((s, c) => s + c.spend, 0);
    const totalImpressions = metaCampaigns.reduce((s, c) => s + c.impressions, 0);
    const totalReach = metaCampaigns.reduce((s, c) => s + c.reach, 0);
    const totalResults = metaCampaigns.reduce((s, c) => s + c.results, 0);
    const avgCPR = totalResults > 0 ? totalSpend / totalResults : 0;
    return { totalSpend, totalImpressions, totalReach, totalResults, avgCPR };
  }, [metaCampaigns]);

  // Google summary
  const googleSummary = useMemo(() => {
    const totalSpend = googleCampaigns.reduce((s, c) => s + c.cost, 0);
    const totalClicks = googleCampaigns.reduce((s, c) => s + c.clicks, 0);
    const totalImpressions = googleCampaigns.reduce((s, c) => s + c.impressions, 0);
    const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
    const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    return { totalSpend, totalClicks, totalImpressions, avgCpc, ctr };
  }, [googleCampaigns]);

  // Meta campaign breakdown
  const metaCampaignData = useMemo(() =>
    metaCampaigns
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 15)
      .map(c => ({
        name: c.campaignName.length > 25 ? c.campaignName.slice(0, 25) + '...' : c.campaignName,
        spend: Math.round(c.spend * 100) / 100,
        results: c.results,
        impressions: c.impressions,
      }))
  , [metaCampaigns]);

  // Google campaign breakdown
  const googleCampaignData = useMemo(() =>
    googleCampaigns
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 15)
      .map(c => ({
        name: c.campaignName.length > 25 ? c.campaignName.slice(0, 25) + '...' : c.campaignName,
        spend: Math.round(c.cost * 100) / 100,
        clicks: c.clicks,
        ctr: c.ctr,
      }))
  , [googleCampaigns]);

  // Google daily trend
  const dailyTrend = useMemo(() =>
    googleDaily
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({
        date: d.date.slice(5), // MM-DD
        clicks: d.clicks,
        cost: Math.round(d.cost * 100) / 100,
        impressions: d.impressions,
      }))
  , [googleDaily]);

  const hasData = metaCampaigns.length > 0 || googleCampaigns.length > 0;

  const handleExport = useCallback((format: ExportFormat) => {
    const combined = [
      ...metaCampaigns.map(c => ({ ...c, channel: 'Meta' })),
      ...googleCampaigns.map(c => ({ ...c, channel: 'Google' })),
    ];
    exportData(combined as unknown as Record<string, unknown>[], {
      filename: `stack-performance-${todayString()}`,
      format,
    });
  }, [metaCampaigns, googleCampaigns]);

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <p className="text-lg font-medium mb-2">No performance data</p>
        <p className="text-sm">Upload Meta or Google Ads CSV exports</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Ad Performance</h2>
        <ExportButton onExport={handleExport} />
      </div>

      {/* Channel KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Meta Spend" value={formatCurrency(metaSummary.totalSpend)} subtitle={`${formatNumber(metaSummary.totalImpressions)} impressions`} color="#3b82f6" />
        <KPICard label="Meta Results" value={formatNumber(metaSummary.totalResults)} subtitle={`CPR: ${formatCurrency(metaSummary.avgCPR)}`} color="#3b82f6" />
        <KPICard label="Google Spend" value={formatCurrency(googleSummary.totalSpend)} subtitle={`${formatNumber(googleSummary.totalClicks)} clicks`} color="#f59e0b" />
        <KPICard label="Google CTR" value={`${googleSummary.ctr.toFixed(2)}%`} subtitle={`Avg CPC: ${formatCurrency(googleSummary.avgCpc)}`} color="#f59e0b" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Meta Campaigns */}
        {metaCampaignData.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Meta Campaigns (by Spend)</h3>
            <ResponsiveContainer width="100%" height={Math.max(300, metaCampaignData.length * 30)}>
              <BarChart data={metaCampaignData} layout="vertical" margin={{ left: 120 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                <Tooltip formatter={(v: number, name: string) => name === 'spend' ? `$${v}` : v} />
                <Bar dataKey="spend" name="Spend" fill="#3b82f6" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Google Campaigns */}
        {googleCampaignData.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Google Campaigns (by Spend)</h3>
            <ResponsiveContainer width="100%" height={Math.max(300, googleCampaignData.length * 30)}>
              <BarChart data={googleCampaignData} layout="vertical" margin={{ left: 120 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                <Tooltip formatter={(v: number, name: string) => name === 'spend' ? `$${v}` : v} />
                <Bar dataKey="spend" name="Spend" fill="#f59e0b" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Google Daily Trend */}
      {dailyTrend.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Google Ads Daily Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={dailyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="clicks" name="Clicks" stroke="#f59e0b" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="cost" name="Cost ($)" stroke="#ef4444" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Campaign Table */}
      {metaCampaigns.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm overflow-x-auto">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Meta Campaign Details</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="pb-2 pr-4">Campaign</th>
                <th className="pb-2 pr-4 text-right">Spend</th>
                <th className="pb-2 pr-4 text-right">Impressions</th>
                <th className="pb-2 pr-4 text-right">Reach</th>
                <th className="pb-2 pr-4 text-right">Results</th>
                <th className="pb-2 text-right">CPR</th>
              </tr>
            </thead>
            <tbody>
              {metaCampaigns.sort((a, b) => b.spend - a.spend).map((c, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 pr-4 text-gray-800 max-w-[200px] truncate">{c.campaignName}</td>
                  <td className="py-2 pr-4 text-right">${c.spend.toFixed(2)}</td>
                  <td className="py-2 pr-4 text-right">{formatNumber(c.impressions)}</td>
                  <td className="py-2 pr-4 text-right">{formatNumber(c.reach)}</td>
                  <td className="py-2 pr-4 text-right">{c.results}</td>
                  <td className="py-2 text-right">${c.costPerResult.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
