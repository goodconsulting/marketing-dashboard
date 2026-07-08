import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, XCircle, MinusCircle, Upload } from 'lucide-react';
import { fetchMonthStatus } from '../api/dataApi';
import type { MonthStatus } from '../types';

interface MonthCloseCardProps {
  /** Called when the user clicks a missing source — App switches to the
   *  Upload tab with the source and month preselected. */
  onGoToUpload?: (sourceKey: string, month: string) => void;
  /** Bump to re-fetch (e.g. after an upload is confirmed). */
  refreshToken?: number;
}

function formatMonth(m: string): string {
  const [year, month] = m.split('-');
  const names = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${names[parseInt(month) - 1]} ${year}`;
}

/** Last 12 months ending with the previous calendar month (the close month). */
function recentMonths(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 12; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export function MonthCloseCard({ onGoToUpload, refreshToken = 0 }: MonthCloseCardProps) {
  const months = useMemo(recentMonths, []);
  const [month, setMonth] = useState(months[months.length - 1]);
  const [status, setStatus] = useState<MonthStatus | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMonthStatus(month)
      .then(s => { if (!cancelled) { setStatus(s); setError(false); } })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [month, refreshToken]);

  const required = status?.checks.filter(c => c.required) ?? [];
  const optional = status?.checks.filter(c => !c.required) ?? [];
  const loaded = required.filter(c => c.present).length;
  const complete = status !== null && status.gaps === 0;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-700">Month Close</h3>
          <select
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700"
          >
            {months.map(m => <option key={m} value={m}>{formatMonth(m)}</option>)}
          </select>
        </div>
        {status && (
          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              complete ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
            }`}>
              {complete ? 'CLOSED' : `${status.gaps} source${status.gaps === 1 ? '' : 's'} missing`}
            </span>
            <span className="text-xs text-gray-400">{loaded}/{required.length} required loaded</span>
            <span className={`text-xs font-medium px-2 py-1 rounded ${
              status.roiComputable ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}>
              ROI {status.roiComputable ? 'computable' : 'blocked'}
            </span>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-500">Could not load month status.</p>}

      {status && (
        <div className="flex flex-wrap gap-2">
          {required.map(c => {
            const clickable = !c.present && onGoToUpload;
            return (
              <button
                key={c.key}
                onClick={clickable ? () => onGoToUpload!(c.key, month) : undefined}
                disabled={!clickable}
                title={c.present
                  ? `${c.label}: ${c.rows} row${c.rows === 1 ? '' : 's'}${c.total != null ? ` · $${c.total.toLocaleString()}` : ''}`
                  : `${c.label}: missing — click to upload`}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                  c.present
                    ? 'bg-emerald-50 border-emerald-100 text-emerald-700 cursor-default'
                    : 'bg-red-50 border-red-100 text-red-600 hover:bg-red-100 cursor-pointer'
                }`}
              >
                {c.present
                  ? <CheckCircle2 size={13} className="shrink-0" />
                  : <XCircle size={13} className="shrink-0" />}
                {c.label}
                {!c.present && <Upload size={11} className="opacity-60" />}
              </button>
            );
          })}
          {optional.map(c => (
            <span
              key={c.key}
              title={`${c.label} (optional)${c.present ? ` — loaded` : ' — not loaded'}`}
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border ${
                c.present
                  ? 'bg-emerald-50/60 border-emerald-100 text-emerald-600'
                  : 'bg-gray-50 border-gray-100 text-gray-400'
              }`}
            >
              {c.present ? <CheckCircle2 size={13} /> : <MinusCircle size={13} />}
              {c.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
