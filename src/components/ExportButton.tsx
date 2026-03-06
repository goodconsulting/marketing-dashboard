import { useState, useCallback, useEffect, useRef } from 'react';
import { Download, ChevronDown } from 'lucide-react';
import type { ExportFormat } from '../utils/export';

interface ExportButtonProps {
  onExport: (format: ExportFormat) => void;
  label?: string;
  disabled?: boolean;
}

export function ExportButton({ onExport, label = 'Export', disabled = false }: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleSelect = useCallback((format: ExportFormat) => {
    setOpen(false);
    onExport(format);
  }, [onExport]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen(prev => !prev)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg
                   hover:bg-gray-50 text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed
                   transition-colors"
      >
        <Download size={14} />
        {label}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-32 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
          <button
            onClick={() => handleSelect('csv')}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            CSV (.csv)
          </button>
          <button
            onClick={() => handleSelect('json')}
            className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            JSON (.json)
          </button>
        </div>
      )}
    </div>
  );
}
