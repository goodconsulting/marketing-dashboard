import { useState, useCallback } from 'react';
import { Upload, FileText, Check, AlertCircle, Trash2, FileWarning, X, Eye } from 'lucide-react';
import { uploadFile, confirmUpload, cancelUpload } from '../api/dataApi';
import type { DataSourceType, UploadPreview, UploadedFile } from '../types';

interface FileUploadProps {
  uploadedFiles: UploadedFile[];
  onClearData: () => void;
  onUploadConfirmed: () => void;  // triggers store.refresh()
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
};

const DEDUP_ACTION_LABELS: Record<string, string> = {
  insert_new: 'New records will be added',
  replace_all: 'Existing data for this month will be replaced',
  skip_duplicates: 'Duplicates will be skipped',
  snapshot_replace: 'Previous snapshot for this month will be replaced',
};

export function FileUpload({ uploadedFiles, onClearData, onUploadConfirmed }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [lastResult, setLastResult] = useState<{ filename: string; count: number; type: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

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

      // PDF guard
      if (file.name.toLowerCase().endsWith('.pdf')) {
        setWarning(
          `PDF files can't be auto-parsed. "${file.name}" was skipped. ` +
          `To import this data, export it as CSV from the source platform.`
        );
        setProcessing(false);
        return;
      }

      // Upload to server for preview
      const result = await uploadFile(file);

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
  }, []);

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
          <p className="text-gray-600 mb-2">Drag & drop a CSV or XLSX file here</p>
          <p className="text-xs text-gray-400 mb-4">
            Auto-detects: Meta Campaigns, Google Ads, QuickBooks Expenses, Incentivio CRM, Menu Intelligence, Operating Budget, Toast POS
          </p>
          <label className="inline-flex items-center gap-2 px-4 py-2 bg-[#2D5A3D] text-white rounded-lg cursor-pointer hover:bg-[#4A7C5C] text-sm">
            <FileText size={16} /> Choose File
            <input type="file" className="hidden" accept=".csv,.xlsx,.xls" onChange={handleFileSelect} />
          </label>
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

          {/* Dedup analysis */}
          {preview.dedup && (
            <div className={`rounded-lg p-3 text-sm ${
              preview.dedup.duplicateCount > 0
                ? 'bg-amber-50 border border-amber-200'
                : 'bg-green-50 border border-green-200'
            }`}>
              <div className="flex items-start gap-2">
                {preview.dedup.duplicateCount > 0 ? (
                  <FileWarning size={16} className="text-amber-600 mt-0.5 shrink-0" />
                ) : (
                  <Check size={16} className="text-green-600 mt-0.5 shrink-0" />
                )}
                <div>
                  <p className={preview.dedup.duplicateCount > 0 ? 'text-amber-800' : 'text-green-800'}>
                    {preview.dedup.details}
                  </p>
                  <p className="text-xs mt-1 opacity-75">
                    {DEDUP_ACTION_LABELS[preview.dedup.action] || preview.dedup.action}
                  </p>
                </div>
              </div>
            </div>
          )}

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
