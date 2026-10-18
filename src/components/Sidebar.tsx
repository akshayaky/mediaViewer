import React, { useState, useEffect } from 'react';
import {
  Home,
  Film,
  Tv,
  Gamepad2,
  Heart,
  History,
  Settings,
  Tv2,
  Inbox,
  ChevronLeft, 
  ChevronRight
} from 'lucide-react';
import { dbService } from '../services/DatabaseService';

export type NavTab = 'home' | 'movies' | 'tv' | 'games' | 'wishlist' | 'history' | 'inbox' | 'settings';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onSelectTab, isCollapsed, setIsCollapsed }) => {
  const [unmatchedCount, setUnmatchedCount] = useState(0);

  useEffect(() => {
    let isMounted = true;
    const refreshUnmatchedCount = async () => {
      const files = await dbService.getUnmatchedLocalFiles();
      if (isMounted) setUnmatchedCount(files.length);
    };
    const handleLibraryUpdate = () => { void refreshUnmatchedCount(); };

    void refreshUnmatchedCount();
    window.addEventListener('library-scanned', handleLibraryUpdate);
    return () => {
      isMounted = false;
      window.removeEventListener('library-scanned', handleLibraryUpdate);
    };
  }, []);

  const navItems = [
    { id: 'home' as NavTab, label: 'Home', icon: Home },
    { id: 'movies' as NavTab, label: 'Movies', icon: Film },
    { id: 'tv' as NavTab, label: 'TV Shows', icon: Tv },
    { id: 'games' as NavTab, label: 'Games', icon: Gamepad2 },
    { id: 'wishlist' as NavTab, label: 'Wishlist', icon: Heart },
    { id: 'history' as NavTab, label: 'History', icon: History },
    { id: 'inbox' as NavTab, label: 'Unmatched Inbox', icon: Inbox, badge: unmatchedCount },
    { id: 'settings' as NavTab, label: 'Settings', icon: Settings }
  ];

  return (
    <aside 
      className={`relative bg-[#111319] border-r border-[#1f222e] flex flex-col justify-between select-none z-20 transition-all duration-300 ease-in-out ${
        isCollapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Collapse Toggle Button */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute -right-3 top-7 w-6 h-6 bg-[#1f222e] hover:bg-rose-600 border border-[#2d3142] rounded-full flex items-center justify-center text-gray-400 hover:text-white cursor-pointer transition-colors duration-200 z-50 shadow-md"
        title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {isCollapsed ? (
          <ChevronRight className="w-3.5 h-3.5" />
        ) : (
          <ChevronLeft className="w-3.5 h-3.5" />
        )}
      </button>

      <div>
        {/* App Title Header */}
        <div className={`p-4 flex items-center border-b border-[#1f222e] ${isCollapsed ? 'justify-center' : 'space-x-3 p-6'}`}>
          <div className="w-10 h-10 min-w-10 rounded-xl bg-gradient-to-tr from-rose-700 to-rose-500 flex items-center justify-center shadow-lg shadow-rose-900/30">
            <Tv2 className="w-5 h-5 text-white" />
          </div>
          
          {!isCollapsed && (
            <div className="animate-fade-in">
              <h1 className="font-bold text-lg text-white tracking-wide leading-tight whitespace-nowrap">My Media</h1>
              <p className="text-xs text-rose-500 font-medium tracking-wider uppercase">Library</p>
            </div>
          )}
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
                title={isCollapsed ? item.label : undefined}
                className={`w-full flex items-center rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
                  isCollapsed ? 'justify-center p-3' : 'justify-between px-4 py-3'
                } ${
                  isActive
                    ? 'bg-rose-600/15 text-rose-400 border-l-4 border-rose-500 font-semibold shadow-sm'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-[#181a24]'
                }`}
              >
                <div className="flex items-center space-x-3.5">
                  <Icon className={`w-5 h-5 min-w-5 ${isActive ? 'text-rose-500' : 'text-gray-400'}`} />
                  {!isCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
                </div>

                {!isCollapsed && item.badge !== undefined && item.badge > 0 && (
                  <span className="bg-rose-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full shadow-sm">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer System Status */}
      <div className={`p-4 border-t border-[#1f222e] text-xs text-gray-500 flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 min-w-2 rounded-full bg-emerald-500 animate-pulse"></span>
          {!isCollapsed && <span className="whitespace-nowrap">SQLite Engine Ready</span>}
        </div>
        {!isCollapsed && <span className="font-mono text-[10px] text-gray-600">v1.0.0</span>}
      </div>
    </aside>
  );
};
