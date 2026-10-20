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
import { getSidebarAccentColors } from '../helper/mediaDetailTheme';

export type NavTab = 'home' | 'movies' | 'tv' | 'games' | 'wishlist' | 'history' | 'inbox' | 'settings';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  accentColor?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onSelectTab, isCollapsed, setIsCollapsed, accentColor }) => {
  const [unmatchedCount, setUnmatchedCount] = useState(0);
  const accentColors = accentColor ? getSidebarAccentColors(accentColor) : null;

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
      className={`fixed inset-y-0 left-0 bg-[#111319] border-r border-[#1f222e] flex flex-col justify-between select-none z-40 transition-all duration-400 ease-in-out ${
        isCollapsed ? 'w-20' : 'w-64'
      } ${accentColors ? 'backdrop-blur-xl' : ''}`}
      style={accentColors ? {
        backgroundColor: accentColors.background,
        borderColor: 'rgba(255, 255, 255, 0.12)',
        backdropFilter: 'blur(18px) saturate(1.2)',
        WebkitBackdropFilter: 'blur(18px) saturate(1.2)'
      } : undefined}
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
        <div className={`p-4 flex items-center border-b border-[#1f222e] ${isCollapsed ? 'justify-center' : 'space-x-3 p-6'}`} style={accentColors ? { borderColor: 'rgba(255, 255, 255, 0.18)' } : undefined}>
          <div
            className={`w-10 h-10 min-w-10 rounded-xl flex items-center justify-center shadow-lg ${accentColors ? '' : 'bg-gradient-to-tr from-rose-700 to-rose-500 shadow-rose-900/30'}`}
            style={accentColors ? { backgroundColor: accentColors.activeBackground } : undefined}
          >
            <Tv2 className="w-5 h-5 text-white" />
          </div>
          
          {!isCollapsed && (
            <div className="animate-fade-in">
              <h1 className="font-bold text-lg text-white tracking-wide leading-tight whitespace-nowrap">My Media</h1>
              <p className="text-xs text-rose-500 font-medium tracking-wider uppercase" style={accentColors ? { color: '#FFFFFF' } : undefined}>Library</p>
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
                className={`w-full flex items-center rounded-lg text-sm font-medium transition-all duration-400 cursor-pointer ${
                  isCollapsed ? 'justify-center p-3' : 'justify-between px-4 py-3'
                } ${
                  isActive
                    ? `${accentColors ? '' : 'bg-rose-600/15 text-rose-400 border-rose-500'} font-semibold shadow-sm`
                    : accentColors ? 'hover:opacity-80' : 'text-gray-400 hover:text-gray-200 hover:bg-[#181a24]'
                }`}
                style={accentColors ? isActive ? {
                  backgroundColor: accentColors.activeBackground,
                  color: '#FFFFFF',
                  borderColor: accentColors.activeBackground
                } : {
                  color: accentColors.inactiveForeground
                } : undefined}
              >
                <div className="flex items-center space-x-3.5">
                  <Icon className={`w-5 h-5 min-w-5 ${isActive ? accentColors ? '' : 'text-rose-500' : 'text-gray-400'}`} style={accentColors ? { color: isActive ? '#FFFFFF' : accentColors.inactiveForeground } : undefined} />
                  {!isCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
                </div>

                {!isCollapsed && item.badge !== undefined && item.badge > 0 && (
                  <span className={`text-white text-[11px] font-bold px-2 py-0.5 rounded-full shadow-sm ${accentColors ? '' : 'bg-rose-600'}`} style={accentColors ? { backgroundColor: accentColors.activeBackground } : undefined}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer System Status */}
      <div className={`p-4 border-t border-[#1f222e] text-xs text-gray-500 flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'}`} style={accentColors ? { color: 'rgba(255, 255, 255, 0.72)', borderColor: 'rgba(255, 255, 255, 0.18)' } : undefined}>
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 min-w-2 rounded-full bg-emerald-500 animate-pulse"></span>
          {!isCollapsed && <span className="whitespace-nowrap">SQLite Engine Ready</span>}
        </div>
        {!isCollapsed && <span className={`font-mono text-[10px] ${accentColors ? 'text-white/55' : 'text-gray-600'}`}>v1.0.0</span>}
      </div>
    </aside>
  );
};
