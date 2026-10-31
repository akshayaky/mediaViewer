import { useState, useEffect } from 'react';
import { SIDEBAR_BREAKPOINT } from '../constants/appConstants';

export interface UseSidebarPaddingResult {
  isDesktop: boolean;
  pagePadding: string;
  windowWidth: number;
}

export function useSidebarPadding(isCollapsed: boolean = false, sidebarHideEnabled: boolean = false): UseSidebarPaddingResult {
  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 0
  );

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isDesktop = windowWidth >= SIDEBAR_BREAKPOINT;
  const pagePadding = isDesktop
    ? (sidebarHideEnabled ? '1rem' : (isCollapsed ? '6rem' : '18rem'))
    : '1rem';

  return { isDesktop, pagePadding, windowWidth };
}
