import { BarChart3, Upload, Settings } from 'lucide-react';

interface HeaderProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'spend', label: 'Spend & Budget' },
  { id: 'performance', label: 'Performance' },
  { id: 'attribution', label: 'CAC & ROI' },
  { id: 'customers', label: 'Customer Health' },
  { id: 'menu', label: 'Menu Intel' },
  { id: 'locations', label: 'Locations' },
  { id: 'report', label: 'Report' },
  { id: 'upload', label: 'Upload Data' },
  { id: 'settings', label: 'Settings' },
];

export function Header({ activeTab, onTabChange }: HeaderProps) {
  return (
    <header className="bg-[#2D5A3D] text-white shadow-lg">
      <div className="max-w-[1600px] mx-auto px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <BarChart3 size={28} />
            <div>
              <h1 className="text-xl font-bold tracking-tight">Stack Wellness</h1>
              <p className="text-sm text-green-200 opacity-80">Marketing Performance Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-green-200">
            <Upload size={16} />
            <span>CIO View</span>
          </div>
        </div>
        <nav className="flex gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-white text-[#2D5A3D]'
                  : 'text-green-100 hover:bg-white/10'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
