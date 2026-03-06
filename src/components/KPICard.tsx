import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface KPICardProps {
  label: string;
  value: string;
  change?: number;     // percentage change
  changeLabel?: string;
  subtitle?: string;
  color?: string;
}

export function KPICard({ label, value, change, changeLabel, subtitle, color = '#2D5A3D' }: KPICardProps) {
  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
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
