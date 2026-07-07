import {
  LayoutDashboard,
  Wallet,
  BarChart3,
  Target,
  Heart,
  Waypoints,
  UtensilsCrossed,
  MapPin,
  FileText,
  Upload,
  Settings,
} from 'lucide-react';

interface HeaderProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const MAIN_TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'spend', label: 'Spend & Budget', icon: Wallet },
  { id: 'performance', label: 'Performance', icon: BarChart3 },
  { id: 'attribution', label: 'CAC & ROI', icon: Target },
  { id: 'customers', label: 'Customer Health', icon: Heart },
  { id: 'valuemap', label: 'Value Map', icon: Waypoints },
  { id: 'menu', label: 'Menu Intel', icon: UtensilsCrossed },
  { id: 'locations', label: 'Locations', icon: MapPin },
  { id: 'report', label: 'Report', icon: FileText },
];

const UTILITY_TABS = [
  { id: 'upload', label: 'Upload Data', icon: Upload },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Header({ activeTab, onTabChange }: HeaderProps) {
  return (
    <aside className="fixed top-0 left-0 h-screen w-[220px] bg-white border-r border-gray-200 flex flex-col z-40">
      {/* Logo area */}
      <div className="px-5 py-5 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <img src="/stack-logo.svg" alt="Stack Wellness" className="w-9 h-9 flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-sm font-bold text-[#2D5A3D] tracking-tight leading-tight">
              Stack Wellness
            </h1>
            <p className="text-[10px] text-gray-400 leading-tight truncate">
              Marketing Dashboard
            </p>
          </div>
        </div>
      </div>

      {/* Main navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <ul className="space-y-0.5">
          {MAIN_TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <li key={tab.id}>
                <button
                  onClick={() => onTabChange(tab.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[#2D5A3D]/10 text-[#2D5A3D] border-l-[3px] border-[#2D5A3D] pl-[9px]'
                      : 'text-gray-600 hover:bg-gray-50 border-l-[3px] border-transparent pl-[9px]'
                  }`}
                >
                  <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
                  <span>{tab.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Separator */}
        <div className="my-3 mx-1 border-t border-gray-200" />

        {/* Utility navigation */}
        <ul className="space-y-0.5">
          {UTILITY_TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <li key={tab.id}>
                <button
                  onClick={() => onTabChange(tab.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[#2D5A3D]/10 text-[#2D5A3D] border-l-[3px] border-[#2D5A3D] pl-[9px]'
                      : 'text-gray-600 hover:bg-gray-50 border-l-[3px] border-transparent pl-[9px]'
                  }`}
                >
                  <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
                  <span>{tab.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* CIO View toggle at bottom */}
      <div className="px-4 py-3 border-t border-gray-200">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <div className="w-2 h-2 rounded-full bg-[#7CB342]" />
          <span>CIO View</span>
        </div>
      </div>
    </aside>
  );
}
