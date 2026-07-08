import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { fetchYearStatus } from '../api/dataApi';
import type { MonthStatus } from '../types';

interface DataHealthViewProps {
  /** Called when the user clicks a missing cell — App switches to Upload. */
  onGoToUpload?: (sourceKey: string) => void;
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function DataHealthView({ onGoToUpload }: DataHealthViewProps) {
  const currentYear = new Date().getFullYear();
  const years = useMemo(() => {
    const list: string[] = [];
    for (let y = 2025; y <= currentYear; y++) list.push(String(y));
    return list;
  }, [currentYear]);

  const [year, setYear] = useState(String(currentYear));
  const [statuses, setStatuses] = useState<MonthStatus[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatuses(null);
    fetchYearStatus(year)
      .then(s => { if (!cancelled) { setStatuses(s); setError(false); } })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [year]);

  // Rows = sources. Use the LAST month's checks for row labels: `since`-gated
  // sources report required=false before they existed, and December is the
  // most representative of a source's steady-state required flag.
  const sources = statuses?.[statuses.length - 1]?.checks ?? [];

  // A month is "relevant" if it's in the past (data could exist) — future
  // months of the current year render dimmed instead of red.
  const nowMonth = `${currentYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const isFuture = (m: string) => m >= nowMonth;

  const closedCount = statuses
    ? statuses.filter(s => !isFuture(s.month) && s.gaps === 0 && s.checks.some(c => c.present)).length
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Data Health</h2>
          <p className="text-sm text-gray-500">
            Source-by-source close status for every month — {closedCount} month{closedCount === 1 ? '' : 's'} fully closed in {year}
          </p>
        </div>
        <select
          value={year}
          onChange={e => setYear(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700"
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {error && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-sm text-red-500">
          Could not load year status.
        </div>
      )}

      {!statuses && !error && (
        <div className="bg-white rounded-xl border border-gray-100 p-10 flex justify-center">
          <div className="animate-spin h-6 w-6 border-2 border-gray-300 border-t-[#2D5A3D] rounded-full" />
        </div>
      )}

      {statuses && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm overflow-x-auto">
          <table className="w-full text-xs min-w-[760px]">
            <thead>
              <tr className="text-gray-400 uppercase tracking-wider border-b border-gray-100">
                <th className="text-left py-2 pr-3 font-medium">Source</th>
                {MONTH_LABELS.map(m => (
                  <th key={m} className="text-center py-2 px-1 font-medium">{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sources.map((src, rowIdx) => (
                <tr key={src.key} className="border-b border-gray-50">
                  <td className="py-2 pr-3 text-gray-700 font-medium whitespace-nowrap">
                    {src.label}
                    {!src.required && <span className="text-gray-300 ml-1">(optional)</span>}
                  </td>
                  {statuses.map(s => {
                    const check = s.checks[rowIdx];
                    const future = isFuture(s.month);
                    const clickable = !future && !check.present && check.required && onGoToUpload;
                    return (
                      <td key={s.month} className="text-center py-2 px-1">
                        {check.present ? (
                          <span title={`${check.rows} rows${check.total != null ? ` · $${check.total.toLocaleString()}` : ''}`}>
                            <CheckCircle2 size={15} className="inline text-emerald-500" />
                          </span>
                        ) : future ? (
                          <span className="text-gray-200">·</span>
                        ) : check.required ? (
                          <button
                            onClick={clickable ? () => onGoToUpload!(check.key) : undefined}
                            title={`${check.label} missing for ${s.month} — click to upload`}
                            className="align-middle"
                          >
                            <XCircle size={15} className="inline text-red-400 hover:text-red-600" />
                          </button>
                        ) : (
                          <MinusCircle size={15} className="inline text-gray-200" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* Month status summary row */}
              <tr>
                <td className="py-2.5 pr-3 text-gray-500 font-semibold">Month closed</td>
                {statuses.map(s => {
                  const future = isFuture(s.month);
                  const hasAny = s.checks.some(c => c.present);
                  return (
                    <td key={s.month} className="text-center py-2.5 px-1">
                      {future || !hasAny ? (
                        <span className="text-gray-200">·</span>
                      ) : s.gaps === 0 ? (
                        <span className="text-[10px] font-bold text-emerald-600">✓</span>
                      ) : (
                        <span className="text-[10px] font-bold text-red-500">{s.gaps}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-400">
        Same checklist as <code className="bg-gray-100 px-1 rounded">scripts/verify-month.cjs</code> —
        required/optional flags live in <code className="bg-gray-100 px-1 rounded">server/lib/month-checks.cjs</code>.
        Click a red ✗ to jump to upload. Numbers in the "Month closed" row = missing required sources.
      </p>
    </div>
  );
}
