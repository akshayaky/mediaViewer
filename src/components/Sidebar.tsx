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
          className={`fixed inset-y-0 left-0 flex flex-col justify-between select-none z-40 transition-all duration-500
            ease-[cubic-bezier(0.16,1,0.3,1)] border-r border-white/10 shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.05)] ${
            isCollapsed ? 'w-20' : 'w-64'
          } ${accentColors ? '' : 'bg-[#111319]/80 backdrop-blur-xl'}`}
          style={
            accentColors
              ? {
                  // If accentColors.background is already rgba/hsla, use it directly. 
                  // Otherwise, we ensure a safe fallback color layer with solid contrast.
                  backgroundColor: accentColors.background.startsWith('#')
                    ? `${accentColors.background.slice(0, 7)}cc` // Strips existing alpha if present, appends 80%
                    : accentColors.background,
                  
                  // Unified heavy blur to squash background text-checkerboarding completely
                  backdropFilter: 'blur(40px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(40px) saturate(180%)',
                }
              : undefined
          }
        >
         {/* Collapse Toggle Button */}
         <button
           onClick={() => setIsCollapsed(!isCollapsed)}
           className="absolute -right-3 top-7 w-6 h-6 bg-[#1f222e]/80 backdrop-blur-md border border-white/10 rounded-full flex items-center
 justify-center text-white/50 hover:text-white cursor-pointer transition-all duration-200 z-50 shadow-xl hover:scale-110 active:scale-95"
           title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
         >
           {isCollapsed ? (
             <ChevronRight className="w-3 h-3" />
           ) : (
             <ChevronLeft className="w-3 h-3" />
           )}
         </button>

         <div className="flex flex-col h-full">
           {/* App Title Header */}
           <div className={`p-4 flex items-center border-b border-white/5 transition-all duration-300 ${isCollapsed ? 'justify-center' :
 'space-x-3 p-6'}`}>
             <div
               className={`w-10 h-10 min-w-10 rounded-xl flex items-center justify-center shadow-lg ring-1 ring-white/20 transition-transform
 duration-300 ${accentColors ? '' : 'bg-gradient-to-tr from-rose-600 to-rose-400 shadow-rose-900/20'}`}
               style={accentColors ? { backgroundColor: accentColors.activeBackground } : undefined}
             >
               <Tv2 className="w-5 h-5 text-white" />
             </div>

             {!isCollapsed && (
               <div className="animate-in fade-in slide-in-from-left-2 duration-500 fill-mode-forwards">
                 <h1
                   className="font-semibold text-lg text-white tracking-tight leading-tight whitespace-nowrap"
                   style={accentColors ? { color: accentColors.inactiveForeground } : undefined}
                 >
                   My Media
                 </h1>
                 <p
                   className="text-[10px] text-white/40 font-bold tracking-[0.15em] uppercase"
                   style={accentColors ? { color: accentColors.inactiveForeground, opacity: 0.65 } : undefined}
                 >
                   Library
                 </p>
               </div>
             )}
           </div>

           {/* Navigation Items */}
           <nav className="p-3 space-y-1.5 flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide">
             {navItems.map(item => {
               const Icon = item.icon;
               const isActive = activeTab === item.id;
               return (
                 <button
                   key={item.id}
                   onClick={() => onSelectTab(item.id)}
                   title={isCollapsed ? item.label : undefined}
                   className={`group relative w-full flex items-center rounded-xl text-sm font-medium transition-all duration-300 cursor-pointer
 ${
                     isCollapsed ? 'justify-center p-3' : 'justify-between px-4 py-2.5'
                   } ${
                     isActive
                       ? 'text-white ring-1 ring-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.2),inset_0_0_0_1px_rgba(255,255,255,0.1)]'
                       : 'text-white/70 hover:text-white hover:translate-x-1 active:scale-[0.98]'
                   }`}
                   style={isActive ? {
                     backgroundColor: accentColors ? accentColors.activeBackground : 'rgba(255, 255, 255, 0.08)',
                   } : {
                     backgroundColor: 'transparent',
                     color: accentColors?.inactiveForeground,
                   }}
                 >
                   <div className="flex items-center space-x-3.5">
                     <Icon
                       className={`w-5 h-5 min-w-5 transition-colors duration-300 ${
                         isActive
                           ? (accentColors ? 'text-white' : 'text-rose-400')
                           : 'text-white/40 group-hover:text-white'
                       }`}
                       style={accentColors
                         ? { color: isActive ? '#FFFFFF' : accentColors.inactiveForeground }
                         : undefined}
                     />
                     {!isCollapsed && <span className="whitespace-nowrap transition-colors duration-300">{item.label}</span>}
                   </div>

                   {!isCollapsed && item.badge !== undefined && item.badge > 0 && (
                     <span className={`text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm ring-1 ring-white/20 ${accentColors ?
 '' : 'bg-rose-500'}`}
                           style={accentColors ? { backgroundColor: accentColors.activeBackground } : undefined}>
                       {item.badge}
                     </span>
                   )}
                 </button>
               );
             })}
           </nav>
         </div>

         {/* Footer System Status */}
         <div className={`p-4 border-t border-white/5 text-xs flex items-center transition-all duration-300 ${isCollapsed ? 'justify-center' :
 'justify-between'}`}>
           <div
             className="flex items-center space-x-2 text-white/40"
             style={accentColors ? { color: accentColors.inactiveForeground, opacity: 0.65 } : undefined}
           >
             <span className="relative flex h-2 w-2">
               <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
               <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
             </span>
             {!isCollapsed && <span className="whitespace-nowrap font-medium transition-colors group-hover:text-white/60">SQLite Engine
 Ready</span>}
           </div>
           {!isCollapsed && (
             <span
               className="font-mono text-[10px] text-white/30 tracking-tighter"
               style={accentColors ? { color: accentColors.inactiveForeground, opacity: 0.5 } : undefined}
             >
               v1.0.0
             </span>
           )}
         </div>
       </aside>
     );
   };