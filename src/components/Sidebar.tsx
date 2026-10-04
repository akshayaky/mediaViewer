import React from 'react';
import {
  Home,
  Film,
  Tv,
  Gamepad2,
  Heart,
  History,
  Settings,
  Tv2
} from 'lucide-react';

export type NavTab = 'home' | 'movies' | 'tv' | 'games' | 'wishlist' | 'history' | 'settings';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onSelectTab }) => {
  const navItems = [
    { id: 'home' as NavTab, label: 'Home', icon: Home },
    { id: 'movies' as NavTab, label: 'Movies', icon: Film },
    { id: 'tv' as NavTab, label: 'TV Shows', icon: Tv },
    { id: 'games' as NavTab, label: 'Games', icon: Gamepad2 },
    { id: 'wishlist' as NavTab, label: 'Wishlist', icon: Heart },
    { id: 'history' as NavTab, label: 'History', icon: History },
    { id: 'settings' as NavTab, label: 'Settings', icon: Settings }
  ];

  return (
    <aside className="w-64 bg-[#111319] border-r border-[#1f222e] flex flex-col justify-between select-none z-20">
      <div>
        {/* App Title Header */}
        <div className="p-6 flex items-center space-x-3 border-b border-[#1f222e]">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-rose-700 to-rose-500 flex items-center justify-center shadow-lg shadow-rose-900/30">
            <Tv2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-white tracking-wide leading-tight">My Media</h1>
            <p className="text-xs text-rose-500 font-medium tracking-wider uppercase">Library</p>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="p-4 space-y-1">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center space-x-3.5 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-rose-600/15 text-rose-400 border-l-4 border-rose-500 font-semibold shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-[#181a24]'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-rose-500' : 'text-gray-400'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer System Status */}
      <div className="p-4 border-t border-[#1f222e] text-xs text-gray-500 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>SQLite Engine Ready</span>
        </div>
        <span className="font-mono text-[10px] text-gray-600">v1.0.0</span>
      </div>
    </aside>
  );
};
