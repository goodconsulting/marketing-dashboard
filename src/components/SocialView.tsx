import { useMemo } from 'react';
import { Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ComposedChart, Line, Legend } from 'recharts';
import { KPICard } from './KPICard';
import type { SocialMonthly } from '../types';

interface SocialViewProps {
  social: SocialMonthly[];
}

const PLATFORM_COLORS: Record<string, string> = {
  facebook: '#1877F2',
  instagram: '#C13584',
};

function formatMonth(m: string): string {
  const [year, month] = m.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${names[parseInt(month) - 1]} ${year.slice(2)}`;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function pctChange(curr: number, prev: number | undefined): number | undefined {
  if (prev === undefined || prev === 0) return undefined;
  return ((curr - prev) / prev) * 100;
}

export function SocialView({ social }: SocialViewProps) {
  const months = useMemo(
    () => [...new Set(social.map(s => s.month))].sort(),
    [social],
  );

  // month → { facebook?, instagram? }
  const byMonth = useMemo(() => {
    const map = new Map<string, Partial<Record<'facebook' | 'instagram', SocialMonthly>>>();
    for (const s of social) {
      if (!map.has(s.month)) map.set(s.month, {});
      map.get(s.month)![s.platform] = s;
    }
    return map;
  }, [social]);

  const latestMonth = months[months.length - 1];
  const prevMonth = months[months.length - 2];
  const latest = latestMonth ? byMonth.get(latestMonth) : undefined;
  const prev = prevMonth ? byMonth.get(prevMonth) : undefined;

  const combined = useMemo(() => {
    const sum = (slice: typeof latest, key: keyof SocialMonthly) =>
      slice ? (['facebook', 'instagram'] as const).reduce((a, p) => a + ((slice[p]?.[key] as number) || 0), 0) : 0;
    return {
      followers: sum(latest, 'followers'),
      prevFollowers: sum(prev, 'followers'),
      engagement: sum(latest, 'engagement'),
      prevEngagement: sum(prev, 'engagement'),
      reach: sum(latest, 'reach'),
      prevReach: sum(prev, 'reach'),
      websiteClicks: sum(latest, 'websiteClicks'),
      prevWebsiteClicks: sum(prev, 'websiteClicks'),
    };
  }, [latest, prev]);

  // Chart rows: one per month with per-platform values
  const chartData = useMemo(() => months.map(m => {
    const slice = byMonth.get(m)!;
    return {
      month: formatMonth(m),
      fbFollowers: slice.facebook?.followers ?? null,
      igFollowers: slice.instagram?.followers ?? null,
      fbReach: slice.facebook?.reach ?? 0,
      igReach: slice.instagram?.reach ?? 0,
      fbClicks: slice.facebook?.websiteClicks ?? 0,
      igClicks: slice.instagram?.websiteClicks ?? 0,
      fbEngagement: slice.facebook?.engagement ?? 0,
      igEngagement: slice.instagram?.engagement ?? 0,
    };
  }), [months, byMonth]);

  if (social.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-10 text-center text-gray-500">
        <p className="font-medium">No social data yet.</p>
        <p className="text-sm mt-1">Upload a Hello Digital monthly report (PDF) from the Upload Data tab, or run <code className="bg-gray-100 px-1 rounded">scripts/ingest-social.cjs</code>.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Organic Social</h2>
          <p className="text-sm text-gray-500">
            Hello Digital monthly reporting — Facebook & Instagram, latest: {latestMonth ? formatMonth(latestMonth) : '—'}
          </p>
        </div>
      </div>

      {/* Combined KPIs (latest month, MoM change) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Total Followers"
          value={formatNum(combined.followers)}
          change={pctChange(combined.followers, combined.prevFollowers)}
          changeLabel="MoM"
          subtitle="Facebook + Instagram"
        />
        <KPICard
          label="Engagement"
          value={formatNum(combined.engagement)}
          change={pctChange(combined.engagement, combined.prevEngagement)}
          changeLabel="MoM"
          subtitle={latestMonth ? formatMonth(latestMonth) : ''}
        />
        <KPICard
          label="Reach"
          value={formatNum(combined.reach)}
          change={pctChange(combined.reach, combined.prevReach)}
          changeLabel="MoM"
          subtitle="Unique users reached"
        />
        <KPICard
          label="Website Clicks"
          value={formatNum(combined.websiteClicks)}
          change={pctChange(combined.websiteClicks, combined.prevWebsiteClicks)}
          changeLabel="MoM"
          subtitle="Social → site traffic"
          tooltip="Direct link between social content and site visits — the KPI most connected to revenue."
        />
      </div>

      {/* Follower growth */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Follower Growth</h3>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={formatNum} />
            <Tooltip formatter={(v?: number) => (v ?? 0).toLocaleString()} />
            <Legend />
            <Line type="monotone" dataKey="fbFollowers" name="Facebook" stroke={PLATFORM_COLORS.facebook} strokeWidth={2} dot />
            <Line type="monotone" dataKey="igFollowers" name="Instagram" stroke={PLATFORM_COLORS.instagram} strokeWidth={2} dot />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Reach by platform */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Monthly Reach</h3>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={formatNum} />
              <Tooltip formatter={(v?: number) => (v ?? 0).toLocaleString()} />
              <Legend />
              <Bar dataKey="fbReach" name="Facebook" fill={PLATFORM_COLORS.facebook} radius={[4, 4, 0, 0]} />
              <Bar dataKey="igReach" name="Instagram" fill={PLATFORM_COLORS.instagram} radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Website clicks by platform */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Website Clicks</h3>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={formatNum} />
              <Tooltip formatter={(v?: number) => (v ?? 0).toLocaleString()} />
              <Legend />
              <Bar dataKey="fbClicks" name="Facebook" fill={PLATFORM_COLORS.facebook} radius={[4, 4, 0, 0]} />
              <Bar dataKey="igClicks" name="Instagram" fill={PLATFORM_COLORS.instagram} radius={[4, 4, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-platform monthly detail */}
      <div className="grid lg:grid-cols-2 gap-6">
        {(['facebook', 'instagram'] as const).map(platform => {
          const rows = social.filter(s => s.platform === platform);
          if (rows.length === 0) return null;
          return (
            <div key={platform} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <h3 className="text-sm font-semibold mb-3 capitalize" style={{ color: PLATFORM_COLORS[platform] }}>
                {platform} — monthly detail
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400 uppercase tracking-wider border-b border-gray-100">
                      <th className="text-left py-2 pr-2">Month</th>
                      <th className="text-right py-2 px-2">Followers</th>
                      <th className="text-right py-2 px-2">Engagement</th>
                      <th className="text-right py-2 px-2">Impressions</th>
                      <th className="text-right py-2 px-2">Reach</th>
                      <th className="text-right py-2 px-2">Profile Visits</th>
                      <th className="text-right py-2 pl-2">Site Clicks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.month} className="border-b border-gray-50 text-gray-700">
                        <td className="py-2 pr-2 font-medium">{formatMonth(r.month)}</td>
                        <td className="text-right py-2 px-2">{r.followers.toLocaleString()}</td>
                        <td className="text-right py-2 px-2">{r.engagement.toLocaleString()}</td>
                        <td className="text-right py-2 px-2">{r.impressions.toLocaleString()}</td>
                        <td className="text-right py-2 px-2">{r.reach.toLocaleString()}</td>
                        <td className="text-right py-2 px-2">{r.profileVisits.toLocaleString()}</td>
                        <td className="text-right py-2 pl-2">{r.websiteClicks.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-400">
        Source: Hello Digital Marketing monthly PDF reports. Each report restates the full year —
        the latest ingested report supersedes prior months (the vendor has revised earlier figures before).
      </p>
    </div>
  );
}
