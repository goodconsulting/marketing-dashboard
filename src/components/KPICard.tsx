import { TrendingUp, TrendingDown, Minus, Info } from 'lucide-react';

interface KPICardProps {
  label: string;
  value: string;
  change?: number;     // percentage change
  changeLabel?: string;
  subtitle?: string;
  color?: string;
  tooltip?: string;    // optional Info icon with hover tooltip
}

export function KPICard({ label, value, change, changeLabel, subtitle, color = '#2D5A3D', tooltip }: KPICardProps) {
  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow min-h-[120px] flex flex-col justify-between h-full">
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-1">
          {label}
          {tooltip && (
            <span className="relative group inline-flex">
              <Info size={12} className="text-amber-500 cursor-help" />
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-3 py-1.5 bg-gray-800 text-white text-[10px] leading-tight rounded max-w-[220px] text-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                {tooltip}
              </span>
            </span>
          )}
        </p>
        <p className="text-3xl font-bold" style={{ color }}>{value}</p>
        {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
      </div>
      {change !== undefined && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${
          isPositive ? 'text-emerald-600' : isNegative ? 'text-red-500' : 'text-gray-400'
        }`}>
          {isPositive ? <TrendingUp size={14} /> : isNegative ? <TrendingDown size={14} /> : <Minus size={14} />}
          <span>{isPositive ? '+' : ''}{change.toFixed(1)}%</span>
          {changeLabel && <span className="text-gray-400 ml-1">{changeLabel}</span>}
        </div>
      )}
    </div>
  );
}
