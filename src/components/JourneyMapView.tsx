import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { KPICard } from './KPICard';
import type {
  MonthlySnapshot, CRMCustomerRecord, StageTransition, DiscountSummary,
  MetaCampaign, GoogleCampaign, JourneyStage, IncentivioMetrics,
  StoreSales, BillboardMonthly,
} from '../types';

interface JourneyMapViewProps {
  snapshots: MonthlySnapshot[];
  allCustomers: CRMCustomerRecord[];     // latest CRM snapshot month
  stageTransitions: StageTransition[];
  discountSummary: DiscountSummary[];
  metaCampaigns: MetaCampaign[];
  googleCampaigns: GoogleCampaign[];
  incentivioMetrics: IncentivioMetrics[];
  toastSales: StoreSales[];
  billboardData: BillboardMonthly[];
}

// Model assumptions (shown in-UI so they're adjustable mentally)
const VISITS_PER_YEAR = 4;            // assumed annual visits for an (re)activated customer
const ACTIVATION_SCENARIOS = [0.10, 0.15, 0.20];  // win-back / first-purchase rates
const RETENTION_SCENARIOS = [0.20, 0.30, 0.40];   // share of at-risk run-rate saved
const reachableFn = (c: CRMCustomerRecord) => (c.emailOptIn && c.validEmail) || c.smsOptIn;
const crmLoc = (storeLoc: string) => storeLoc === 'Downtown Cedar Rapids' ? 'Downtown' : storeLoc;

const STAGE_RANK: Record<string, number> = { UNKNOWN: 0, SLIDER: 1, ROOKIE: 2, REGULAR: 3, LOYALIST: 4, WHALE: 5, CHURNED: -1 };
const STAGE_COLORS: Record<string, string> = {
  WHALE: '#7c3aed', LOYALIST: '#2D5A3D', REGULAR: '#4A7C5C', ROOKIE: '#7CB342',
  SLIDER: '#f59e0b', UNKNOWN: '#9ca3af', CHURNED: '#ef4444',
};
const VALUE_STAGES: JourneyStage[] = ['WHALE', 'LOYALIST', 'REGULAR', 'ROOKIE', 'UNKNOWN'];

const fmt$ = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toFixed(0)}`;
const fmt$exact = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtN = (n: number) => n.toLocaleString();
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[parseInt(mo) - 1]} ${y.slice(2)}`;
};

export function JourneyMapView({
  snapshots, allCustomers, stageTransitions, discountSummary, metaCampaigns, googleCampaigns, incentivioMetrics,
  toastSales, billboardData,
}: JourneyMapViewProps) {
  const ltvByMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of incentivioMetrics) m.set(r.month, r.ltv);
    return m;
  }, [incentivioMetrics]);
  const crmMonth = useMemo(
    () => allCustomers.reduce((max, c) => (c.snapshotMonth > max ? c.snapshotMonth : max), ''),
    [allCustomers],
  );
  const customers = useMemo(
    () => allCustomers.filter(c => c.snapshotMonth === crmMonth),
    [allCustomers, crmMonth],
  );

  // ── 1. Value concentration by stage ───────────────────────────────
  const valueByStage = useMemo(() => {
    const total = customers.reduce((s, c) => s + (c.lifetimeSpend || 0), 0) || 1;
    const map = new Map<string, { n: number; ltv: number }>();
    for (const c of customers) {
      const e = map.get(c.journeyStage) || { n: 0, ltv: 0 };
      e.n += 1; e.ltv += c.lifetimeSpend || 0;
      map.set(c.journeyStage, e);
    }
    return [...map.entries()]
      .map(([stage, e]) => ({ stage, n: e.n, totalLtv: e.ltv, avgLtv: e.n ? e.ltv / e.n : 0, pct: (e.ltv / total) * 100 }))
      .sort((a, b) => (STAGE_RANK[b.stage] ?? 0) - (STAGE_RANK[a.stage] ?? 0));
  }, [customers]);

  // ── 2. Stage flow + ROOKIE→value conversion (latest transition window) ──
  const flow = useMemo(() => {
    const latestTo = stageTransitions.reduce((max, t) => (t.toSnapshot > max ? t.toSnapshot : max), '');
    const win = stageTransitions.filter(t => t.toSnapshot === latestTo);
    const fromMonth = win.reduce((max, t) => (t.fromSnapshot > max ? t.fromSnapshot : max), '');
    const up = win.filter(t => t.direction === 'up').length;
    const down = win.filter(t => t.direction === 'down').length;
    const firstSeen = win.filter(t => t.direction === 'first_seen').length;
    const rookieFrom = win.filter(t => t.fromStage === 'ROOKIE');
    const rookieAdvanced = rookieFrom.filter(t => (STAGE_RANK[t.toStage] ?? 0) > STAGE_RANK.ROOKIE).length;
    const convRate = rookieFrom.length ? (rookieAdvanced / rookieFrom.length) * 100 : 0;
    const paths = new Map<string, number>();
    for (const t of win) {
      if (t.direction === 'first_seen') continue;
      const k = `${t.fromStage} → ${t.toStage}`;
      paths.set(k, (paths.get(k) || 0) + 1);
    }
    const topPaths = [...paths.entries()].map(([path, n]) => ({ path, n })).sort((a, b) => b.n - a.n).slice(0, 6);
    return { latestTo, fromMonth, up, down, firstSeen, rookieFrom: rookieFrom.length, rookieAdvanced, convRate, topPaths };
  }, [stageTransitions]);

  // ── 3. LTV : CAC trend (months with spend + new customers) ─────────
  const ltvCac = useMemo(() =>
    snapshots
      .filter(s => s.totalSpend > 0 && s.newCustomers > 0)
      .map(s => {
        const ltv = ltvByMonth.get(s.month) ?? 0;   // maintained per-month LTV (Incentivio)
        const netCac = s.newCustomers > 0 ? (s.netMarketingInvestment || s.totalSpend) / s.newCustomers : 0;
        return {
          month: monthLabel(s.month),
          ltv: Math.round(ltv),
          cac: Math.round(s.estimatedCAC),
          netCac: Math.round(netCac),
          ratio: s.estimatedCAC > 0 ? +(ltv / s.estimatedCAC).toFixed(2) : 0,
        };
      }),
    [snapshots, ltvByMonth],
  );
  const latestLtvCac = ltvCac[ltvCac.length - 1];

  // ── 4. Acquisition efficiency — channel cost per conversion ────────
  const acquisition = useMemo(() => {
    const adMonth = metaCampaigns.reduce((max, c) => (c.month > max ? c.month : max), '');
    const meta = metaCampaigns.filter(c => c.month === adMonth);
    const google = googleCampaigns.filter(c => c.month === adMonth);
    const metaSpend = meta.reduce((s, c) => s + c.spend, 0);
    const metaPurch = meta.reduce((s, c) => s + (c.purchases || 0), 0);
    const metaVal = meta.reduce((s, c) => s + (c.conversionValue || 0), 0);
    const gSpend = google.reduce((s, c) => s + c.cost, 0);
    const gConv = google.reduce((s, c) => s + (c.conversions || 0), 0);
    const snap = snapshots.find(s => s.month === adMonth);
    const blendedCac = snap && snap.newCustomers > 0 ? snap.totalSpend / snap.newCustomers : 0;
    const netCac = snap && snap.newCustomers > 0 ? (snap.netMarketingInvestment || snap.totalSpend) / snap.newCustomers : 0;
    return {
      adMonth,
      rows: [
        { channel: 'Meta (website purchases)', spend: metaSpend, conv: metaPurch, unit: 'purchases', cpc: metaPurch ? metaSpend / metaPurch : 0, extra: metaSpend ? `${(metaVal / metaSpend).toFixed(2)}x ROAS · ${fmt$exact(metaVal)} value` : '' },
        { channel: 'Google (store visits/promos)', spend: gSpend, conv: Math.round(gConv), unit: 'conversions', cpc: gConv ? gSpend / gConv : 0, extra: '' },
      ],
      blendedCac, netCac, newCustomers: snap?.newCustomers || 0,
    };
  }, [metaCampaigns, googleCampaigns, snapshots]);

  // ── 5. Zero-value funnel leak ──────────────────────────────────────
  const leak = useMemo(() => {
    const total = customers.length || 1;
    const purchasers = customers.filter(c => (c.lifetimeSpend || 0) > 0).length;
    const repeat = customers.filter(c => (c.lifetimeVisits || 0) > 1).length;
    const loyal = customers.filter(c => c.journeyStage === 'LOYALIST' || c.journeyStage === 'WHALE').length;
    return {
      total, purchasers, repeat, loyal,
      pctPurchased: (purchasers / total) * 100,
      pctZero: ((total - purchasers) / total) * 100,
      pctRepeat: (repeat / total) * 100,
      pctLoyal: (loyal / total) * 100,
    };
  }, [customers]);

  // ── 6. Retention: at-risk loyalists vs loyalty discount spend ──────
  const retention = useMemo(() => {
    const atRisk = customers.filter(
      c => (c.journeyStage === 'LOYALIST' || c.journeyStage === 'WHALE') &&
        (c.attritionRisk === 'high' || c.attritionRisk === 'medium'),
    );
    const valueAtRisk = atRisk.reduce((s, c) => s + (c.lifetimeSpend || 0), 0);
    const highCount = atRisk.filter(c => c.attritionRisk === 'high').length;
    // Retention-oriented discounts (loyalty + new_customer) in recent periods
    const recent = new Set([crmMonth, prevMonth(crmMonth)]);
    const retentionDiscounts = discountSummary.filter(
      d => recent.has(d.period) && (d.discountCategory === 'loyalty' || d.discountCategory === 'new_customer'),
    );
    const discountSpend = retentionDiscounts.reduce((s, d) => s + d.discountAmount, 0);
    const discountProfit = retentionDiscounts.reduce((s, d) => s + d.profitability, 0);
    return { atRisk: atRisk.length, highCount, valueAtRisk, discountSpend, discountProfit };
  }, [customers, discountSummary, crmMonth]);

  // ── 7. Value Rescue — addressable lifecycle cohorts + sized model ──
  const rescue = useMemo(() => {
    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const oneAndDone = customers.filter(c => c.lifetimeVisits === 1);
    const oadReach = oneAndDone.filter(reachableFn);
    const oadBasket = avg(oneAndDone.map(c => c.avgBasketValue > 0 ? c.avgBasketValue : c.lifetimeSpend).filter(n => n > 0)) || 9;

    const freshNonPurch = customers.filter(c => (c.lifetimeSpend || 0) <= 0 && c.daysSinceSignup <= 90);
    const fnpReach = freshNonPurch.filter(reachableFn);

    const atRisk = customers.filter(
      c => (c.journeyStage === 'LOYALIST' || c.journeyStage === 'WHALE') && (c.attritionRisk === 'high' || c.attritionRisk === 'medium'),
    );
    const arReach = atRisk.filter(reachableFn);
    const arForwardAnnual = arReach.reduce((s, c) => s + (c.last90DaysSpend || 0) * 4, 0);

    const rows = [
      {
        cohort: 'Reactivate one-and-done', reach: oadReach.length,
        assumption: `${(ACTIVATION_SCENARIOS[0] * 100)}–${(ACTIVATION_SCENARIOS[2] * 100)}% win back · ~${VISITS_PER_YEAR} visits/yr @ ${fmt$(oadBasket)}`,
        scenarios: ACTIVATION_SCENARIOS.map(p => oadReach.length * p * oadBasket * VISITS_PER_YEAR),
      },
      {
        cohort: 'Activate fresh non-purchasers', reach: fnpReach.length,
        assumption: `${(ACTIVATION_SCENARIOS[0] * 100)}–${(ACTIVATION_SCENARIOS[2] * 100)}% first purchase · ~${VISITS_PER_YEAR} visits/yr @ ${fmt$(oadBasket)}`,
        scenarios: ACTIVATION_SCENARIOS.map(p => fnpReach.length * p * oadBasket * VISITS_PER_YEAR),
      },
      {
        cohort: 'Retain at-risk loyalists', reach: arReach.length,
        assumption: `save ${(RETENTION_SCENARIOS[0] * 100)}–${(RETENTION_SCENARIOS[2] * 100)}% of ${fmt$(arForwardAnnual)} forward run-rate`,
        scenarios: RETENTION_SCENARIOS.map(p => arForwardAnnual * p),
      },
    ];
    const baseTotal = rows.reduce((s, r) => s + r.scenarios[1], 0);
    return { rows, baseTotal, oneAndDone: oneAndDone.length, freshNonPurch: freshNonPurch.length, atRisk: atRisk.length };
  }, [customers]);

  // ── 8. Location economics — revenue × value × discount drag ────────
  const locationEcon = useMemo(() => {
    const salesMonth = toastSales.reduce((max, s) => (s.month > max ? s.month : max), '');
    const ltvByLoc = new Map<string, { n: number; ltv: number }>();
    for (const c of customers) {
      const e = ltvByLoc.get(c.reachLocation) || { n: 0, ltv: 0 };
      e.n += 1; e.ltv += c.lifetimeSpend || 0;
      ltvByLoc.set(c.reachLocation, e);
    }
    const rows = toastSales.filter(s => s.month === salesMonth).map(s => {
      const crm = ltvByLoc.get(crmLoc(s.location));
      return {
        location: s.location,
        gross: s.grossSales,
        discPct: s.grossSales > 0 ? (s.discountTotal / s.grossSales) * 100 : 0,
        customers: crm?.n ?? 0,
        avgLtv: crm && crm.n ? crm.ltv / crm.n : 0,
        revPerCust: crm && crm.n ? s.grossSales / crm.n : 0,
      };
    }).sort((a, b) => b.avgLtv - a.avgLtv);
    const ooh = billboardData.filter(b => b.month === salesMonth);
    const oohImpr = ooh.reduce((s, b) => s + b.impressionsDelivered, 0);
    return { salesMonth, rows, oohImpr, oohMarket: ooh.map(b => b.location).join(', ') };
  }, [toastSales, customers, billboardData]);

  if (customers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <p className="text-lg font-medium mb-2">No CRM data</p>
        <p className="text-sm">Ingest an Incentivio customer export to build the value map</p>
      </div>
    );
  }

  const loyalistShare = valueByStage.find(v => v.stage === 'LOYALIST')?.pct ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Value Map</h2>
          <p className="text-sm text-gray-500">Marketing → acquisition → customer value → ROI · CRM snapshot {crmMonth && monthLabel(crmMonth)}</p>
        </div>
      </div>

      {/* ── Headline KPIs ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Loyalist Value Share" value={fmtPct(loyalistShare)} subtitle="of all lifetime spend" color="#2D5A3D" />
        <KPICard label="Rookie → Value Conversion" value={fmtPct(flow.convRate)} subtitle={`${flow.rookieAdvanced} of ${fmtN(flow.rookieFrom)} tracked rookies advanced`} color="#7CB342" />
        <KPICard
          label="LTV : CAC"
          value={latestLtvCac ? `${latestLtvCac.ratio.toFixed(2)}x` : '—'}
          subtitle={latestLtvCac ? `LTV ${fmt$(latestLtvCac.ltv)} · CAC ${fmt$(latestLtvCac.cac)} (net ${fmt$(latestLtvCac.netCac)})` : 'no spend month'}
          color="#f59e0b"
        />
        <KPICard label="Loyalist Value at Risk" value={fmt$(retention.valueAtRisk)} subtitle={`${retention.atRisk} at-risk loyalists (${retention.highCount} high)`} color="#ef4444" />
      </div>

      {/* ── 1. Value concentration by stage ───────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Where the value lives — lifetime spend by stage</h3>
        <p className="text-xs text-gray-400 mb-4">The funnel's job is to move customers up this ladder. A few loyalists carry the base.</p>
        <div className="space-y-3">
          {valueByStage.filter(v => VALUE_STAGES.includes(v.stage as JourneyStage)).map(v => (
            <div key={v.stage} className="flex items-center gap-3">
              <div className="w-20 text-sm font-medium text-gray-700">{v.stage}</div>
              <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden relative">
                <div className="h-full rounded-full flex items-center px-2" style={{ width: `${Math.max(v.pct, 2)}%`, backgroundColor: STAGE_COLORS[v.stage] || '#9ca3af' }}>
                  <span className="text-xs font-semibold text-white whitespace-nowrap">{fmtPct(v.pct)}</span>
                </div>
              </div>
              <div className="w-44 text-right text-xs text-gray-500">{fmtN(v.n)} cust · avg LTV {fmt$(v.avgLtv)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 2. Stage flow + LTV:CAC trend (side by side) ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Stage flow · {flow.fromMonth && monthLabel(flow.fromMonth)} → {flow.latestTo && monthLabel(flow.latestTo)}</h3>
          <p className="text-xs text-gray-400 mb-4">Movement between snapshots (excludes new signups from path list).</p>
          <div className="flex gap-3 mb-4">
            <div className="flex-1 rounded-lg bg-emerald-50 p-3 text-center">
              <p className="text-2xl font-bold text-emerald-600">{flow.up}</p><p className="text-xs text-gray-500">moved up</p>
            </div>
            <div className="flex-1 rounded-lg bg-red-50 p-3 text-center">
              <p className="text-2xl font-bold text-red-500">{flow.down}</p><p className="text-xs text-gray-500">moved down</p>
            </div>
            <div className="flex-1 rounded-lg bg-gray-50 p-3 text-center">
              <p className="text-2xl font-bold text-gray-600">{fmtN(flow.firstSeen)}</p><p className="text-xs text-gray-500">new</p>
            </div>
          </div>
          <div className="space-y-1.5">
            {flow.topPaths.map(p => (
              <div key={p.path} className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{p.path}</span>
                <span className="font-medium text-gray-800">{fmtN(p.n)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">LTV : CAC trend</h3>
          {ltvCac.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={ltvCac} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => `$${v}`} />
                <Legend />
                <Line type="monotone" dataKey="ltv" name="LTV" stroke="#2D5A3D" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="cac" name="CAC" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="netCac" name="CAC (net co-op)" stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-gray-400">No spend+acquisition months yet.</p>}
        </div>
      </div>

      {/* ── 3. Acquisition efficiency: channel cost per conversion ── */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm overflow-x-auto">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Acquisition efficiency · {acquisition.adMonth && monthLabel(acquisition.adMonth)}</h3>
        <p className="text-xs text-gray-400 mb-4">CRM signup source is device-based, so channel attribution comes from each platform's own conversions. Units differ (Meta = purchases, Google = store visits) — don't blend them directly.</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100">
              <th className="pb-2 pr-4">Channel</th>
              <th className="pb-2 pr-4 text-right">Spend</th>
              <th className="pb-2 pr-4 text-right">Conversions</th>
              <th className="pb-2 pr-4 text-right">Cost / conv.</th>
              <th className="pb-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {acquisition.rows.map(r => (
              <tr key={r.channel} className="border-b border-gray-50">
                <td className="py-2 pr-4 font-medium text-gray-800">{r.channel}</td>
                <td className="py-2 pr-4 text-right">{fmt$exact(r.spend)}</td>
                <td className="py-2 pr-4 text-right">{fmtN(r.conv)} <span className="text-gray-400">{r.unit}</span></td>
                <td className="py-2 pr-4 text-right font-semibold">{r.conv ? `$${r.cpc.toFixed(2)}` : '—'}</td>
                <td className="py-2 text-gray-500 text-xs">{r.extra}</td>
              </tr>
            ))}
            <tr className="bg-gray-50">
              <td className="py-2 pr-4 font-semibold text-gray-800">Blended (all spend ÷ new CRM accounts)</td>
              <td className="py-2 pr-4 text-right" colSpan={2}>{fmtN(acquisition.newCustomers)} new accounts</td>
              <td className="py-2 pr-4 text-right font-semibold">${acquisition.blendedCac.toFixed(2)}</td>
              <td className="py-2 text-gray-500 text-xs">net of co-op: ${acquisition.netCac.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── 4. Funnel leak + Retention (side by side) ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Signup → value leak</h3>
          <p className="text-xs text-gray-400 mb-4">Most accounts never purchase. The gap from signup to first purchase is the biggest acquisition-efficiency lever.</p>
          {[
            { label: 'Signups (accounts)', n: leak.total, pct: 100, color: '#9ca3af' },
            { label: 'Ever purchased', n: leak.purchasers, pct: leak.pctPurchased, color: '#7CB342' },
            { label: 'Repeat (2+ visits)', n: leak.repeat, pct: leak.pctRepeat, color: '#4A7C5C' },
            { label: 'Loyalist / Whale', n: leak.loyal, pct: leak.pctLoyal, color: '#2D5A3D' },
          ].map(step => (
            <div key={step.label} className="mb-3">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-700">{step.label}</span>
                <span className="font-medium text-gray-800">{fmtN(step.n)} <span className="text-gray-400">({fmtPct(step.pct)})</span></span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${step.pct}%`, backgroundColor: step.color }} />
              </div>
            </div>
          ))}
          <p className="text-xs text-gray-400 mt-2">{fmtPct(leak.pctZero)} of accounts have never spent — closing this is worth more than raw signup volume.</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Retention play — protect the value core</h3>
          <p className="text-xs text-gray-400 mb-4">At-risk loyalists hold most of the value. Loyalty/referral discounts are the retention lever to defend them.</p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="rounded-lg bg-red-50 p-4">
              <p className="text-2xl font-bold text-red-500">{fmt$(retention.valueAtRisk)}</p>
              <p className="text-xs text-gray-500">lifetime value at risk</p>
              <p className="text-xs text-gray-400 mt-1">{retention.atRisk} at-risk loyalists ({retention.highCount} high)</p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-4">
              <p className="text-2xl font-bold text-emerald-600">{fmt$(retention.discountSpend)}</p>
              <p className="text-xs text-gray-500">loyalty/referral discount spend</p>
              <p className="text-xs text-gray-400 mt-1">profitability {fmt$(retention.discountProfit)} (recent months)</p>
            </div>
          </div>
          <p className="text-xs text-gray-400">
            Framing: ~{fmt$(retention.discountSpend)} of loyalty/referral incentive defends ~{fmt$(retention.valueAtRisk)} of at-risk loyalist value — the retention-ROI case to size next.
          </p>
        </div>
      </div>

      {/* ── 5. Value Rescue — sized lifecycle opportunity ─────────── */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm overflow-x-auto">
        <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-gray-700">Value Rescue — the second-visit opportunity</h3>
          <span className="text-sm font-semibold" style={{ color: '#2D5A3D' }}>~{fmt$(rescue.baseTotal)}/yr addressable (base case)</span>
        </div>
        <p className="text-xs text-gray-400 mb-4">All three cohorts are reachable via owned email/SMS at ~$0 media cost. Stack acquires fine — the gap is the second visit.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          {[
            { label: 'One-and-done', total: rescue.oneAndDone, reach: rescue.rows[0].reach, note: 'purchased once, never returned' },
            { label: 'Fresh non-purchasers', total: rescue.freshNonPurch, reach: rescue.rows[1].reach, note: 'signed up ≤90d, $0 spend' },
            { label: 'At-risk loyalists', total: rescue.atRisk, reach: rescue.rows[2].reach, note: 'high/medium attrition risk' },
          ].map(c => (
            <div key={c.label} className="rounded-lg bg-gray-50 p-4">
              <p className="text-xs text-gray-500">{c.label}</p>
              <p className="text-2xl font-bold text-gray-800">{fmtN(c.total)}</p>
              <p className="text-xs text-gray-400 mt-1">{fmtN(c.reach)} reachable · {c.note}</p>
            </div>
          ))}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100">
              <th className="pb-2 pr-4">Play</th>
              <th className="pb-2 pr-4 text-right">Reachable</th>
              <th className="pb-2 pr-4 text-right">Conservative</th>
              <th className="pb-2 pr-4 text-right">Base</th>
              <th className="pb-2 pr-4 text-right">Stretch</th>
            </tr>
          </thead>
          <tbody>
            {rescue.rows.map(r => (
              <tr key={r.cohort} className="border-b border-gray-50">
                <td className="py-2 pr-4">
                  <div className="font-medium text-gray-800">{r.cohort}</div>
                  <div className="text-xs text-gray-400">{r.assumption}</div>
                </td>
                <td className="py-2 pr-4 text-right">{fmtN(r.reach)}</td>
                {r.scenarios.map((v, i) => <td key={i} className="py-2 pr-4 text-right font-medium">{fmt$(v)}</td>)}
              </tr>
            ))}
            <tr className="bg-gray-50 font-semibold">
              <td className="py-2 pr-4">Total addressable / yr</td>
              <td className="py-2 pr-4" />
              <td className="py-2 pr-4 text-right">{fmt$(rescue.rows.reduce((s, r) => s + r.scenarios[0], 0))}</td>
              <td className="py-2 pr-4 text-right" style={{ color: '#2D5A3D' }}>{fmt$(rescue.baseTotal)}</td>
              <td className="py-2 pr-4 text-right">{fmt$(rescue.rows.reduce((s, r) => s + r.scenarios[2], 0))}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-gray-400 mt-2">Assumes ~{VISITS_PER_YEAR} visits/yr per (re)activated customer; retention saves a share of at-risk forward run-rate. Directional sizing, not a forecast.</p>
      </div>

      {/* ── 6. Location economics — volume vs value ───────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm overflow-x-auto">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Location economics · {locationEcon.salesMonth && monthLabel(locationEcon.salesMonth)}</h3>
        <p className="text-xs text-gray-400 mb-4">Volume isn't value. High discount load + low LTV = buying traffic rather than building it.</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100">
              <th className="pb-2 pr-4">Location</th>
              <th className="pb-2 pr-4 text-right">Revenue</th>
              <th className="pb-2 pr-4 text-right">Customers</th>
              <th className="pb-2 pr-4 text-right">Avg LTV</th>
              <th className="pb-2 pr-4 text-right">Rev / customer</th>
              <th className="pb-2 pr-4 text-right">Discount load</th>
            </tr>
          </thead>
          <tbody>
            {locationEcon.rows.map(r => (
              <tr key={r.location} className="border-b border-gray-50">
                <td className="py-2 pr-4 font-medium text-gray-800">{r.location}</td>
                <td className="py-2 pr-4 text-right">{fmt$(r.gross)}</td>
                <td className="py-2 pr-4 text-right">{r.customers ? fmtN(r.customers) : '—'}</td>
                <td className="py-2 pr-4 text-right">{r.avgLtv ? fmt$(r.avgLtv) : '—'}</td>
                <td className="py-2 pr-4 text-right">{r.revPerCust ? fmt$(r.revPerCust) : '—'}</td>
                <td className="py-2 pr-4 text-right" style={{ color: r.discPct >= 14 ? '#ef4444' : '#6b7280' }}>{fmtPct(r.discPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-400 mt-2">OOH (Lamar billboard) runs {locationEcon.oohMarket || 'Cedar Rapids'} only — {fmtN(Math.round(locationEcon.oohImpr))} impressions, covering the Edgewood &amp; Downtown stores. Waukee &amp; Coralville get no OOH.</p>
      </div>
    </div>
  );
}

function prevMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  if (!y || !mo) return '';
  const d = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
  return d;
}
