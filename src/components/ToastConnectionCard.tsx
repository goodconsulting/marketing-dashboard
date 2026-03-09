import { useState, useEffect } from 'react';
import { Plug, RefreshCw, CheckCircle, XCircle, AlertTriangle, Loader2, Store } from 'lucide-react';
import type { ToastSyncState, ToastConnectionStatus } from '../hooks/useToastSync';
import type { ToastDiscrepancy } from '../types';

interface ToastConnectionCardProps {
  syncState: ToastSyncState;
  onCheckConnection: () => Promise<boolean>;
  onSync: (months: string[]) => Promise<unknown>;
  discrepancies: ToastDiscrepancy[];
}

/** Generate month options for the sync range selectors */
function getMonthOptions(): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    options.push({ value, label });
  }
  return options;
}

const STATUS_CONFIG: Record<ToastConnectionStatus, { color: string; pulse: boolean; label: string }> = {
  unknown: { color: 'bg-gray-400', pulse: false, label: 'Not checked' },
  checking: { color: 'bg-yellow-400', pulse: true, label: 'Checking...' },
  connected: { color: 'bg-green-500', pulse: true, label: 'Live' },
  disconnected: { color: 'bg-red-500', pulse: false, label: 'Disconnected' },
  error: { color: 'bg-red-500', pulse: false, label: 'Error' },
};

export function ToastConnectionCard({
  syncState,
  onCheckConnection,
  onSync,
  discrepancies,
}: ToastConnectionCardProps) {
  const monthOptions = getMonthOptions();
  const [startMonth, setStartMonth] = useState(monthOptions[monthOptions.length - 2]?.value || '');
  const [endMonth, setEndMonth] = useState(monthOptions[monthOptions.length - 1]?.value || '');

  // Check connection on mount
  useEffect(() => {
    if (syncState.connectionStatus === 'unknown') {
      onCheckConnection();
    }
  }, [syncState.connectionStatus, onCheckConnection]);

  const handleSync = async () => {
    // Build month range
    const months: string[] = [];
    const start = monthOptions.findIndex(m => m.value === startMonth);
    const end = monthOptions.findIndex(m => m.value === endMonth);
    if (start >= 0 && end >= 0) {
      for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
        months.push(monthOptions[i].value);
      }
    }
    if (months.length > 0) {
      await onSync(months);
    }
  };

  const status = STATUS_CONFIG[syncState.connectionStatus];

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm space-y-5">
      {/* Header with status dot */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Plug size={18} className="text-[#2D5A3D]" />
          <h3 className="text-sm font-semibold text-gray-700">Toast POS Integration</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            {status.pulse && (
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${status.color} opacity-75`} />
            )}
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${status.color}`} />
          </span>
          <span className="text-xs font-medium text-gray-500">{status.label}</span>
        </div>
      </div>

      {/* Connection info */}
      {syncState.connectionStatus === 'connected' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Connected to <strong>{syncState.locations.length}</strong> location(s)
            {syncState.lastSyncedAt && (
              <> &middot; Last synced {new Date(syncState.lastSyncedAt).toLocaleString()}</>
            )}
          </p>

          {/* Location chips */}
          <div className="flex flex-wrap gap-2">
            {syncState.locations.map(loc => (
              <span key={loc} className="inline-flex items-center gap-1 px-2.5 py-1 bg-green-50 text-green-700 text-xs rounded-full">
                <Store size={12} />
                {loc}
              </span>
            ))}
          </div>

          {/* Sync range selectors */}
          <div className="flex items-center gap-3 pt-1">
            <label className="text-xs text-gray-500">Sync:</label>
            <select
              value={startMonth}
              onChange={e => setStartMonth(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#2D5A3D]"
            >
              {monthOptions.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <span className="text-xs text-gray-400">&rarr;</span>
            <select
              value={endMonth}
              onChange={e => setEndMonth(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-[#2D5A3D]"
            >
              {monthOptions.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSync}
              disabled={syncState.isSyncing}
              className="flex items-center gap-2 px-4 py-2 bg-[#2D5A3D] text-white rounded-lg text-sm hover:bg-[#4A7C5C] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncState.isSyncing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {syncState.isSyncing ? 'Syncing...' : 'Sync Now'}
            </button>
            <button
              onClick={onCheckConnection}
              disabled={syncState.isSyncing}
              className="text-xs text-gray-500 hover:text-gray-700 underline-offset-2 hover:underline"
            >
              Re-check Connection
            </button>
          </div>

          {/* Sync progress */}
          {syncState.isSyncing && syncState.syncProgress && (
            <p className="text-xs text-gray-500 italic">{syncState.syncProgress}</p>
          )}

          {/* Last sync result summary */}
          {syncState.lastSyncResult && !syncState.isSyncing && (
            <div className="flex items-center gap-2 p-2.5 bg-green-50 text-green-700 rounded-lg text-xs">
              <CheckCircle size={14} />
              Synced {syncState.lastSyncResult.sales.length} location-month record(s)
              {syncState.lastSyncResult.errors.length > 0 && (
                <span className="text-amber-600">
                  ({syncState.lastSyncResult.errors.length} error(s))
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Disconnected / Error states */}
      {(syncState.connectionStatus === 'disconnected' || syncState.connectionStatus === 'error') && (
        <div className="space-y-3">
          {/* Scope-specific diagnostic: auth works but wrong permissions */}
          {syncState.missingScopes.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-amber-50 text-amber-800 rounded-lg text-xs">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div className="space-y-2">
                  <p className="font-medium">Authentication works, but API scopes need updating</p>
                  <p>
                    Current scope: <code className="bg-amber-100 px-1 rounded text-[11px]">{syncState.scope}</code>
                  </p>
                  <p>
                    Missing: {syncState.missingScopes.map(s => (
                      <code key={s} className="bg-red-100 text-red-700 px-1 rounded text-[11px] mr-1">{s}</code>
                    ))}
                  </p>
                </div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg text-xs text-gray-700 space-y-1.5">
                <p className="font-semibold text-gray-800">How to fix:</p>
                <ol className="list-decimal list-inside space-y-1 text-gray-600">
                  <li>Go to <strong>Toast Developer Portal</strong> → Standard API Access</li>
                  <li>Edit your <strong>"Stack - CIO"</strong> credential set</li>
                  <li>Add scopes: {syncState.missingScopes.map(s => <code key={s} className="bg-white border px-1 rounded text-[11px]">{s}</code>)}</li>
                  <li>Save, regenerate client secret, and update <code className="bg-white border px-1 rounded text-[11px]">.env</code></li>
                </ol>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-xs">
              <XCircle size={14} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Unable to connect to Toast API</p>
                {syncState.error && <p className="mt-1 text-red-600">{syncState.error}</p>}
                <p className="mt-1 text-red-500">Check that TOAST_CLIENT_ID and TOAST_CLIENT_SECRET are set in .env</p>
              </div>
            </div>
          )}
          <button
            onClick={onCheckConnection}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors"
          >
            <RefreshCw size={14} />
            Retry Connection
          </button>
        </div>
      )}

      {/* Unknown / Checking state */}
      {syncState.connectionStatus === 'checking' && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 size={14} className="animate-spin" />
          Checking Toast API connection...
        </div>
      )}

      {/* Error from sync (not connection) */}
      {syncState.error && syncState.connectionStatus === 'connected' && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 text-amber-800 rounded-lg text-xs">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{syncState.error}</span>
        </div>
      )}

      {/* Discrepancy alerts */}
      {discrepancies.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-gray-600 flex items-center gap-1">
            <AlertTriangle size={12} className="text-amber-500" />
            API vs CSV Discrepancies ({discrepancies.length})
          </h4>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {discrepancies.map((d, i) => (
              <div key={i} className="flex items-center justify-between p-2 bg-amber-50 rounded text-xs">
                <span className="text-amber-800">
                  {d.month} &middot; {d.location} &middot; <strong>{d.field}</strong>
                </span>
                <span className="text-amber-600 font-mono">
                  API: {d.field === 'orders' ? d.apiValue : `$${d.apiValue.toLocaleString()}`}
                  {' vs '}
                  CSV: {d.field === 'orders' ? d.csvValue : `$${d.csvValue.toLocaleString()}`}
                  {' '}({d.percentDiff}%)
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400">
            Toast API is the source of truth. CSV values are shown for reference only.
          </p>
        </div>
      )}
    </div>
  );
}
