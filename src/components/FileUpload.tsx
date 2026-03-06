import { useState, useCallback } from 'react';
import { Upload, FileText, Check, AlertCircle, Trash2, FileWarning } from 'lucide-react';
import {
  detectSourceType, detectSourceFromHeaders,
  parseExpensesXLSX, parseExpensesCSV,
  parseMetaCampaigns, parseGoogleCampaigns, parseGoogleDaily,
  parseIncentivioCustomers, parseMenuIntelligence,
  parseBudgetXLSX, parseToastCSV,
} from '../utils/parsers';
import type { DataSourceType, MonthlyBudget, IncentivioMetrics, ToastSales, CRMCustomerRecord, MenuIntelligenceItem } from '../types';

interface FileUploadProps {
  onExpensesParsed: (expenses: import('../types').MonthlyExpense[]) => void;
  onMetaParsed: (campaigns: import('../types').MetaCampaign[]) => void;
  onGoogleCampaignsParsed: (campaigns: import('../types').GoogleCampaign[]) => void;
  onGoogleDailyParsed: (daily: import('../types').GoogleDaily[]) => void;
  onToastSalesParsed: (sales: ToastSales[]) => void;
  onIncentivioData: (metrics: IncentivioMetrics) => void;
  onCRMCustomers: (customers: CRMCustomerRecord[]) => void;
  onMenuIntelligence: (items: MenuIntelligenceItem[]) => void;
  onBudgetsParsed: (budgets: MonthlyBudget[]) => void;
  onFileUploaded: (meta: { filename: string; sourceType: string; recordCount: number; monthCovered: string }) => void;
  uploadedFiles: import('../types').UploadedFile[];
  onClearData: () => void;
}

const SOURCE_LABELS: Record<string, string> = {
  meta: 'Meta / Facebook',
  google: 'Google Ads',
  toast: 'Toast POS',
  incentivio: 'Incentivio',
  organic: 'Organic Social',
  '3po': '3rd Party Delivery',
  expenses: 'Marketing Expenses',
  budget: 'Budget',
};

export function FileUpload({
  onExpensesParsed, onMetaParsed, onGoogleCampaignsParsed,
  onGoogleDailyParsed, onToastSalesParsed, onIncentivioData,
  onCRMCustomers, onMenuIntelligence, onBudgetsParsed,
  onFileUploaded, uploadedFiles, onClearData,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<{ filename: string; count: number; type: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const processFile = useCallback(async (file: File) => {
    setProcessing(true);
    setError(null);
    setWarning(null);
    setLastResult(null);

    try {
      // --- File Size Guard (50 MB) ---
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

      // --- PDF Guard ---
      if (file.name.toLowerCase().endsWith('.pdf')) {
        setWarning(
          `PDF files can't be auto-parsed in the browser. "${file.name}" was skipped. ` +
          `To import this data, export it as CSV from the source platform, or manually enter key metrics.`
        );
        onFileUploaded({ filename: file.name, sourceType: 'expenses', recordCount: 0, monthCovered: 'N/A (PDF)' });
        setProcessing(false);
        return;
      }

      // --- Source Detection: filename first, then header fallback ---
      let sourceType = detectSourceType(file.name);

      if ((sourceType as string) === 'unknown' && file.name.toLowerCase().endsWith('.csv')) {
        sourceType = await detectSourceFromHeaders(file);
      }

      let recordCount = 0;
      let monthCovered = '';

      // ─── EXPENSES (QuickBooks) ───
      if (sourceType === 'expenses') {
        if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
          const expenses = await parseExpensesXLSX(file);
          onExpensesParsed(expenses);
          recordCount = expenses.length;
          monthCovered = [...new Set(expenses.map(e => e.month))].sort().join(', ');
        } else {
          const expenses = await parseExpensesCSV(file);
          onExpensesParsed(expenses);
          recordCount = expenses.length;
          monthCovered = [...new Set(expenses.map(e => e.month))].sort().join(', ');
        }
      }

      // ─── META / FACEBOOK ───
      else if (sourceType === 'meta') {
        const campaigns = await parseMetaCampaigns(file);
        onMetaParsed(campaigns);
        recordCount = campaigns.length;
        monthCovered = [...new Set(campaigns.map(c => c.month))].sort().join(', ');
      }

      // ─── GOOGLE ADS ───
      else if (sourceType === 'google') {
        const lower = file.name.toLowerCase();
        if (lower.includes('time_series') || lower.includes('timeseries')) {
          const daily = await parseGoogleDaily(file);
          onGoogleDailyParsed(daily);
          recordCount = daily.length;
          monthCovered = [...new Set(daily.map(d => d.date.substring(0, 7)))].sort().join(', ');
        } else {
          const campaigns = await parseGoogleCampaigns(file);
          onGoogleCampaignsParsed(campaigns);
          recordCount = campaigns.length;
          monthCovered = campaigns.length > 0 ? '(set month in file name)' : '';
        }
      }

      // ─── INCENTIVIO ───
      else if (sourceType === 'incentivio') {
        const lower = file.name.toLowerCase();
        if (lower.includes('menu_intelligence')) {
          const items = await parseMenuIntelligence(file);
          onMenuIntelligence(items);
          recordCount = items.length;
          const quadrantCounts = { star: 0, plow_horse: 0, puzzle: 0, dog: 0 };
          items.forEach(i => quadrantCounts[i.menuQuadrant]++);
          monthCovered = `Menu analytics — ${quadrantCounts.star} stars, ${quadrantCounts.dog} dogs`;
        } else {
          const result = await parseIncentivioCustomers(file);
          onIncentivioData(result.metrics);
          onCRMCustomers(result.customers);
          recordCount = result.totalRecords;
          const segCounts: Record<string, number> = {};
          result.customers.forEach(c => { segCounts[c.journeyStage] = (segCounts[c.journeyStage] || 0) + 1; });
          const segSummary = Object.entries(segCounts).map(([k, v]) => `${v} ${k}`).join(', ');
          monthCovered = `${result.metrics.month} (${result.activeCustomers.toLocaleString()} active) — ${segSummary}`;
        }
      }

      // ─── BUDGET XLSX ───
      else if (sourceType === 'budget') {
        if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
          const budgets = await parseBudgetXLSX(file);
          onBudgetsParsed(budgets);
          recordCount = budgets.length;
          const months = budgets.map(b => b.month);
          monthCovered = months.length > 0 ? `${months[0]} → ${months[months.length - 1]}` : '';
        } else {
          setWarning('Budget files should be in XLSX format (the operating budget spreadsheet).');
        }
      }

      // ─── TOAST POS CSV ───
      else if (sourceType === 'toast') {
        const sales = await parseToastCSV(file);
        if (sales.length > 0) {
          onToastSalesParsed(sales);
          recordCount = sales.length;
          const locations = [...new Set(sales.map(s => s.location))];
          const months = [...new Set(sales.map(s => s.month))].sort();
          monthCovered = `${months.join(', ')} (${locations.length} location${locations.length !== 1 ? 's' : ''})`;
        } else {
          setWarning(`No parseable Toast sales rows found in "${file.name}". Ensure the CSV has Location, Date, and Gross Sales columns.`);
        }
      }

      // ─── ORGANIC, 3PO (placeholders) ───
      else if (sourceType === 'organic') {
        setWarning(`Organic social detected for "${file.name}". Organic parser coming soon.`);
      } else if (sourceType === '3po') {
        setWarning(`3rd party delivery detected for "${file.name}". 3PO parser coming soon.`);
      }

      onFileUploaded({ filename: file.name, sourceType, recordCount, monthCovered });
      setLastResult({ filename: file.name, count: recordCount, type: SOURCE_LABELS[sourceType] || sourceType });
    } catch (err) {
      setError(`Failed to parse ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setProcessing(false);
    }
  }, [onExpensesParsed, onMetaParsed, onGoogleCampaignsParsed, onGoogleDailyParsed, onToastSalesParsed, onIncentivioData, onCRMCustomers, onMenuIntelligence, onBudgetsParsed, onFileUploaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    files.reduce((p, f) => p.then(() => processFile(f)), Promise.resolve());
  }, [processFile]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.reduce((p, f) => p.then(() => processFile(f)), Promise.resolve());
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

      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
          isDragging ? 'border-[#2D5A3D] bg-green-50' : 'border-gray-300 hover:border-gray-400'
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <Upload size={40} className="mx-auto text-gray-400 mb-3" />
        <p className="text-gray-600 mb-2">Drag & drop CSV or XLSX files here</p>
        <p className="text-xs text-gray-400 mb-4">
          Auto-detects: Meta Campaigns, Google Ads, QuickBooks Expenses, Incentivio, Operating Budget
        </p>
        <label className="inline-flex items-center gap-2 px-4 py-2 bg-[#2D5A3D] text-white rounded-lg cursor-pointer hover:bg-[#4A7C5C] text-sm">
          <FileText size={16} /> Choose Files
          <input type="file" className="hidden" accept=".csv,.xlsx,.xls,.pdf" multiple onChange={handleFileSelect} />
        </label>
      </div>

      {processing && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <div className="animate-spin h-4 w-4 border-2 border-gray-300 border-t-[#2D5A3D] rounded-full" />
          Processing...
        </div>
      )}

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
      <div className="bg-gray-50 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Supported Data Sources</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {Object.entries(SOURCE_LABELS).map(([key, label]) => (
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
