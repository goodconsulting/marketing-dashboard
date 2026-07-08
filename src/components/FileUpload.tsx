import { useState, useCallback, useEffect } from 'react';
import { Upload, FileText, Check, AlertCircle, Trash2, FileWarning, X, Eye, Info } from 'lucide-react';
import { uploadFile, confirmUpload, cancelUpload } from '../api/dataApi';
import type { DataSourceType, UploadPreview, UploadedFile } from '../types';

interface FileUploadProps {
  uploadedFiles: UploadedFile[];
  onClearData: () => void;
  onUploadConfirmed: () => void;  // triggers store.refresh()
  /** Month-close scorecard check key (e.g. 'social_facebook') — preselects
   *  the source dropdown and shows a which-file hint. */
  preselectSource?: string | null;
  /** Month the scorecard was showing when clicked — preselects the month picker. */
  preselectMonth?: string | null;
}

const SOURCE_LABELS: Record<string, string> = {
  meta: 'Meta / Facebook',
  google: 'Google Ads',
  toast: 'Toast POS',
  incentivio: 'Incentivio CRM',
  incentivio_crm: 'Incentivio CRM',
  incentivio_menu: 'Menu Intelligence',
  organic: 'Organic Social',
  '3po': '3rd Party Delivery',
  expenses: 'Marketing Expenses',
  budget: 'Budget',
  social_pdf: 'Social Report (Hello Digital PDF)',
  toast_location_overview: 'Toast Location Overview',
  discount_summary: 'Discount Summary',
};

/** Source values offered in the manual-override dropdown. */
const OVERRIDE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Auto-detect source' },
  { value: 'expenses', label: 'Marketing Expenses (QuickBooks)' },
  { value: 'meta', label: 'Meta Ads campaigns' },
  { value: 'google', label: 'Google Ads campaigns' },
  { value: 'toast', label: 'Toast POS sales' },
  { value: 'toast_location_overview', label: 'Toast Location Overview (needs month)' },
  { value: 'discount_summary', label: 'Discount Summary XLSX' },
  { value: 'incentivio_crm', label: 'Incentivio CRM export' },
  { value: 'incentivio_menu', label: 'Menu Intelligence' },
  { value: 'budget', label: 'Operating Budget' },
  { value: 'social_pdf', label: 'Social Report PDF (Hello Digital)' },
];

/** Scorecard check key → dropdown preselection + which-file guidance. */
const CHECK_KEY_GUIDE: Record<string, { source: string; hint: string }> = {
  expenses: { source: 'expenses', hint: 'QuickBooks "Advertising & marketing" transaction report (XLSX or CSV).' },
  google: { source: 'google', hint: 'Google Ads campaign export (CSV).' },
  meta: { source: 'meta', hint: 'Meta ad-level report (CSV).' },
  sales: { source: 'toast_location_overview', hint: 'Toast "Location overview" export (CSV). The file has no dates — the month selector below tells the import which month it covers.' },
  discounts: { source: 'discount_summary', hint: 'Toast Discount Summary (XLSX). Sheets are month names without a year — the month selector anchors the year. All period sheets in the workbook are imported.' },
  crm: { source: 'incentivio_crm', hint: 'Incentivio Customer Export (CSV). This is a point-in-time snapshot — set the month picker to the month being CLOSED (an export pulled early July = the June snapshot). New signups per month are derived from each customer\'s account-created date, so they land in the right month automatically.' },
  incentivio: { source: 'incentivio_crm', hint: 'Derived automatically when a CRM export is ingested.' },
  social_facebook: { source: 'social_pdf', hint: 'Hello Digital "Stack Wellness - Facebook" monthly PDF. The latest report restates the whole year.' },
  social_instagram: { source: 'social_pdf', hint: 'Hello Digital "Stack Wellness - Instagram" monthly PDF. The latest report restates the whole year.' },
  billboard: { source: 'auto', hint: 'Lamar proof-of-play PDFs are hand-keyed via scripts/ingest-billboard.cjs.' },
  coop: { source: 'auto', hint: 'Co-op / in-kind funding is recorded manually in fact_marketing_funding.' },
};

const DEDUP_STRATEGY_LABELS: Record<string, string> = {
  insert_or_ignore: 'Duplicates will be skipped',
  insert_or_replace: 'Existing data for this period will be replaced',
  snapshot_replace: 'Previous snapshot for this month will be replaced',
};

/** Last 14 months, newest first, for the manual month picker. */
function recentMonthOptions(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export function FileUpload({ uploadedFiles, onClearData, onUploadConfirmed, preselectSource, preselectMonth }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [lastResult, setLastResult] = useState<{ filename: string; count: number; type: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [sourceOverride, setSourceOverride] = useState('auto');
  const [monthOverride, setMonthOverride] = useState('');

  // Scorecard navigation: preselect source + month and surface guidance
  const guide = preselectSource ? CHECK_KEY_GUIDE[preselectSource] : undefined;
  useEffect(() => {
    if (guide) setSourceOverride(guide.source);
  }, [guide]);
  useEffect(() => {
    if (preselectMonth) setMonthOverride(preselectMonth);
  }, [preselectMonth]);

  // ─── Stage a file for preview ──────────────────────────────────
  const processFile = useCallback(async (file: File) => {
    setProcessing(true);
    setError(null);
    setWarning(null);
    setLastResult(null);
    setPreview(null);

    try {
      // File size guard (50 MB)
      const MAX_SIZE_MB = 50;
      if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        setError(
          `"${file.name}" is ${sizeMB} MB, which exceeds the ${MAX_SIZE_MB} MB limit. ` +
          `Try splitting the file or narrowing the date range before uploading.`
        );
        setProcessing(false);
        return;
      }

      // PDF guard — only Hello Digital social reports are parseable as PDF
      const isPdf = file.name.toLowerCase().endsWith('.pdf');
      const lower = file.name.toLowerCase();
      const looksSocial = lower.includes('facebook') || lower.includes('instagram');
      if (isPdf && sourceOverride !== 'social_pdf' && !looksSocial) {
        setWarning(
          `Only Hello Digital social report PDFs can be auto-parsed. ` +
          `For other PDFs (e.g. Lamar proof-of-play), use the CLI ingest scripts, ` +
          `or select "Social Report PDF" if this is a misnamed Hello Digital file.`
        );
        setProcessing(false);
        return;
      }

      // Upload to server for preview
      const result = await uploadFile(
        file,
        monthOverride || undefined,
        sourceOverride === 'auto' ? undefined : sourceOverride,
      );

      if (result.recordCount === 0) {
        setWarning(`No parseable records found in "${file.name}". Check the file format.`);
        setProcessing(false);
        return;
      }

      setPreview(result);
    } catch (err) {
      setError(`Failed to process ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setProcessing(false);
    }
  }, [sourceOverride, monthOverride]);

  // ─── Confirm the staged upload ─────────────────────────────────
  const handleConfirm = useCallback(async () => {
    if (!preview) return;
    setConfirming(true);
    setError(null);

    try {
      const result = await confirmUpload(preview.uploadId);
      setLastResult({
        filename: preview.filename,
        count: result.insertedCount,
        type: SOURCE_LABELS[preview.detectedSource] || preview.detectedSource,
      });
      setPreview(null);
      onUploadConfirmed(); // trigger store refresh
    } catch (err) {
      setError(`Failed to confirm upload: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setConfirming(false);
    }
  }, [preview, onUploadConfirmed]);

  // ─── Cancel the staged upload ──────────────────────────────────
  const handleCancel = useCallback(async () => {
    if (!preview) return;
    try {
      await cancelUpload(preview.uploadId);
    } catch {
      // Ignore cancel errors — staging auto-expires anyway
    }
    setPreview(null);
  }, [preview]);

  // ─── Drag & drop / file select handlers ────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) processFile(files[0]);
  }, [processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) processFile(files[0]);
    e.target.value = '';
  }, [processFile]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Upload Marketing Data</h2>
        {uploadedFiles.length > 0 && (
          <button onClick={onClearData} className="flex items-center gap-1 text-sm text-red-500 hover:text-red-700">
            <Trash2 size={14} /> Clear All Data
          </button>
        )}
      </div>

      {/* Scorecard guidance banner */}
      {guide && !preview && (
        <div className="flex items-start gap-2 p-3 bg-blue-50 text-blue-800 rounded-lg text-sm">
          <Info size={16} className="mt-0.5 shrink-0" />
          <span>{guide.hint}</span>
        </div>
      )}

      {/* Drop zone (hidden during preview) */}
      {!preview && (
        <div
          className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
            isDragging ? 'border-[#2D5A3D] bg-green-50' : 'border-gray-300 hover:border-gray-400'
          }`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <Upload size={40} className="mx-auto text-gray-400 mb-3" />
          <p className="text-gray-600 mb-2">Drag & drop a CSV, XLSX, or social report PDF here</p>
          <p className="text-xs text-gray-400 mb-4">
            Auto-detects: Meta Campaigns, Google Ads, QuickBooks Expenses, Incentivio CRM, Menu Intelligence, Operating Budget, Toast POS, Hello Digital Social PDFs
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <select
              value={sourceOverride}
              onChange={e => setSourceOverride(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700"
              title="Force a source type when auto-detection guesses wrong"
            >
              {OVERRIDE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={monthOverride}
              onChange={e => setMonthOverride(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700"
              title="Required for undated exports (Toast location overview); anchors the year for discount workbooks and social PDFs"
            >
              <option value="">Month: from file</option>
              {recentMonthOptions().map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <label className="inline-flex items-center gap-2 px-4 py-2 bg-[#2D5A3D] text-white rounded-lg cursor-pointer hover:bg-[#4A7C5C] text-sm">
              <FileText size={16} /> Choose File
              <input type="file" className="hidden" accept=".csv,.xlsx,.xls,.pdf" onChange={handleFileSelect} />
            </label>
          </div>
        </div>
      )}

      {processing && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="animate-spin h-4 w-4 border-2 border-gray-300 border-t-[#2D5A3D] rounded-full" />
          Analyzing file...
        </div>
      )}

      {/* ─── Upload Preview Card ─────────────────────────────────── */}
      {preview && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Eye size={18} className="text-[#2D5A3D]" />
                <h3 className="font-semibold text-gray-900">Upload Preview</h3>
              </div>
              <p className="text-sm text-gray-500 mt-1">{preview.filename}</p>
            </div>
            <button onClick={handleCancel} className="text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>

          {/* Detection summary */}
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500 text-xs mb-1">Detected Source</p>
              <p className="font-medium text-gray-800">
                {SOURCE_LABELS[preview.detectedSource] || preview.detectedSource}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500 text-xs mb-1">Month</p>
              <p className="font-medium text-gray-800">
                {preview.detectedMonth || 'Not detected'}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-gray-500 text-xs mb-1">Records</p>
              <p className="font-medium text-gray-800">
                {preview.recordCount.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Dedup / cross-check analysis */}
          {preview.dedup && (() => {
            const flagged = preview.dedup.duplicates > 0 || preview.dedup.message.includes('⚠️');
            return (
              <div className={`rounded-lg p-3 text-sm ${
                flagged
                  ? 'bg-amber-50 border border-amber-200'
                  : 'bg-green-50 border border-green-200'
              }`}>
                <div className="flex items-start gap-2">
                  {flagged ? (
                    <FileWarning size={16} className="text-amber-600 mt-0.5 shrink-0" />
                  ) : (
                    <Check size={16} className="text-green-600 mt-0.5 shrink-0" />
                  )}
                  <div>
                    <p className={flagged ? 'text-amber-800' : 'text-green-800'}>
                      {preview.dedup.message}
                    </p>
                    <p className="text-xs mt-1 opacity-75">
                      {DEDUP_STRATEGY_LABELS[preview.dedup.strategy] || preview.dedup.strategy}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Sample rows */}
          {preview.sampleRows.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                Preview first {Math.min(preview.sampleRows.length, 5)} rows
              </summary>
              <div className="mt-2 overflow-x-auto">
                <pre className="bg-gray-50 rounded p-3 text-xs text-gray-600 whitespace-pre-wrap">
                  {JSON.stringify(preview.sampleRows.slice(0, 5), null, 2)}
                </pre>
              </div>
            </details>
          )}

          {/* Confirm / Cancel buttons */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleConfirm}
              disabled={confirming}
              className="flex items-center gap-2 px-5 py-2 bg-[#2D5A3D] text-white rounded-lg hover:bg-[#4A7C5C] disabled:opacity-50 text-sm font-medium"
            >
              {confirming ? (
                <>
                  <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full" />
                  Importing...
                </>
              ) : (
                <>
                  <Check size={16} />
                  Confirm Import
                </>
              )}
            </button>
            <button
              onClick={handleCancel}
              disabled={confirming}
              className="px-5 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Success message */}
      {lastResult && lastResult.count > 0 && (
        <div className="flex items-center gap-2 p-3 bg-green-50 text-green-800 rounded-lg text-sm">
          <Check size={16} />
          Imported <strong>{lastResult.count.toLocaleString()}</strong> records from <strong>{lastResult.filename}</strong> ({lastResult.type})
        </div>
      )}

      {warning && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 text-amber-800 rounded-lg text-sm">
          <FileWarning size={16} className="mt-0.5 shrink-0" />
          <span>{warning}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 text-red-800 rounded-lg text-sm">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Source type guide */}
      {!preview && (
        <div className="bg-gray-50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Supported Data Sources</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {Object.entries(SOURCE_LABELS)
              .filter(([key]) => !['incentivio_crm', 'incentivio_menu'].includes(key))
              .map(([key, label]) => (
              <div key={key} className="bg-white rounded-lg p-3 border border-gray-100">
                <p className="font-medium text-gray-800">{label}</p>
                <p className="text-gray-400 mt-1">
                  {key === 'expenses' && 'QuickBooks XLSX/CSV'}
                  {key === 'meta' && 'Meta Ads CSV (incl. Brightn)'}
                  {key === 'google' && 'Google Ads CSV (campaigns + daily)'}
                  {key === 'toast' && 'Toast sales CSV or live API sync'}
                  {key === 'incentivio' && 'CRM exports (per-customer), menu intelligence'}
                  {key === 'organic' && 'Social media data (coming soon)'}
                  {key === '3po' && 'UberEats, DoorDash (coming soon)'}
                  {key === 'budget' && 'Operating budget XLSX'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload history */}
      {uploadedFiles.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Upload History</h3>
          <div className="bg-white rounded-lg border border-gray-100 divide-y divide-gray-50">
            {uploadedFiles.map((f) => (
              <div key={f.id} className="flex items-center justify-between p-3 text-sm">
                <div>
                  <p className="font-medium text-gray-800">{f.filename}</p>
                  <p className="text-xs text-gray-400">
                    {f.recordCount > 0 ? `${f.recordCount.toLocaleString()} records` : 'No parseable records'} | {f.monthCovered || 'N/A'}
                  </p>
                </div>
                <span className={`px-2 py-1 text-xs rounded-full ${
                  f.recordCount > 0 ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {SOURCE_LABELS[f.sourceType as DataSourceType] || f.sourceType}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
