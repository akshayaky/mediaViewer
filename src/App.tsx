import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Sidebar, NavTab } from './components/Sidebar';
import { HomeView } from './views/HomeView';
import { MediaGridView } from './views/MediaGridView';
import { MediaDetailView } from './views/MediaDetailView';
import { HistoryView } from './views/HistoryView';
import { SettingsView } from './views/SettingsView';
import { UnmatchedInboxView } from './views/UnmatchedInboxView';
import { UniversalSearchOverlay } from './components/UniversalSearchOverlay';
import { TitleBarDragRegion } from './components/TitleBarDragRegion';
import { dbService } from './services/DatabaseService';
import { syncEngine } from './sync/syncEngine';
import { Media, MediaHistory, SelectMediaOptions } from './types/media';
import { animateAccentTransition, getAccentRgb } from './helper/mediaDetailTheme';

const NOOP_PREVIEW_START = () => {};
const NOOP_PREVIEW_END = () => {};

interface CardContainerOrigin {
  type: 'container' | 'circle';
  left: number;
  top: number;
  width: number;
  height: number;
  cardRadius: number;
  dx: number;
  dy: number;
  s0: number;
  unscaledW: number;
  unscaledH: number;
  insetRight0: number;
  insetBottom0: number;
  radius0: number;
  circleOriginX?: number;
  circleOriginY?: number;
  maxRadius?: number;
  heroTitleRect?: DOMRect;
  titleDx?: number;
  titleDy?: number;
}

interface ItemSnapshot {
  title: string;
  activeImageUrl?: string;
  poster?: string;
  backdrop?: string;
  logo?: string;
  accentColor?: string;
  landscape?: boolean;
}

export function App() {
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [selectedMedia, setSelectedMedia] = useState<Media | null>(null);
  const [isDetailTransitioning, setIsDetailTransitioning] = useState(false);
  const [selectedAccentColor, setSelectedAccentColor] = useState<string>();
  const [homeAccentColor, setHomeAccentColor] = useState<string>();
  const [isUniversalSearchOpen, setIsUniversalSearchOpen] = useState(false);
  const [universalSearchQuery, setUniversalSearchQuery] = useState('');
  const [autoPlayFileId, setAutoPlayFileId] = useState<string | null>(null);
  const [autoPlayOnOpen, setAutoPlayOnOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const selectedMediaRef = useRef(selectedMedia);
  selectedMediaRef.current = selectedMedia;
  const homeAccentColorRef = useRef(homeAccentColor);
  homeAccentColorRef.current = homeAccentColor;
  const homeHeroAccentColorRef = useRef<string>('#E27D12');
  const accentAnimationCancelRef = useRef<(() => void) | null>(null);
  const selectedInitialBackdropRef = useRef<string | undefined>(undefined);
  const selectedInitialHistoryRef = useRef<MediaHistory[] | undefined>(undefined);
  const mainViewRef = useRef<HTMLElement>(null);
  const detailContainerRef = useRef<HTMLDivElement>(null);
  const itemLayerRef = useRef<HTMLDivElement>(null);
  const appScreenLayerRef = useRef<HTMLDivElement>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const homeScrollRef = useRef<HTMLDivElement>(null);
  const homeScrollTop = useRef(0);
  const cardOriginRef = useRef<CardContainerOrigin | null>(null);
  const hiddenCardElRef = useRef<HTMLElement | null>(null);
  const [itemSnapshot, setItemSnapshot] = useState<ItemSnapshot | null>(null);
  const activeAnimationsRef = useRef<Animation[]>([]);
  const isClosingRef = useRef(false);

  const cleanupHiddenCard = () => {
    if (hiddenCardElRef.current) {
      hiddenCardElRef.current.style.opacity = '';
      hiddenCardElRef.current.style.visibility = '';
      hiddenCardElRef.current.removeAttribute('data-card-hidden');
      hiddenCardElRef.current = null;
    }
    const allHidden = document.querySelectorAll<HTMLElement>('[data-card-hidden="true"]');
    allHidden.forEach(el => {
      el.style.opacity = '';
      el.style.visibility = '';
      el.removeAttribute('data-card-hidden');
    });
  };

  const handleHomeAccentChange = useCallback((color: string | undefined) => {
    if (color) {
      homeHeroAccentColorRef.current = color;
    }
    setHomeAccentColor(color);
  }, []);

  const pageAccentColor = isClosingRef.current && activeTab === 'home'
    ? homeAccentColor
    : selectedMedia
      ? selectedAccentColor || selectedMedia.accent_color
      : activeTab === 'home'
        ? homeAccentColor
        : undefined;

  const handlePreviewStart = NOOP_PREVIEW_START;
  const handlePreviewEnd = NOOP_PREVIEW_END;

  useEffect(() => () => {
    activeAnimationsRef.current.forEach(a => {
      try { a.cancel(); } catch { /* ignore */ }
    });
    activeAnimationsRef.current = [];
    if (accentAnimationCancelRef.current) {
      accentAnimationCancelRef.current();
      accentAnimationCancelRef.current = null;
    }
    document.body.classList.remove('mdv-detail-closing');
    cleanupHiddenCard();
  }, []);

  useLayoutEffect(() => {
    if (!selectedMedia) {
      document.body.classList.remove('mdv-detail-closing');
    }
  }, [selectedMedia]);

  useEffect(() => {
    async function initApp() {
      try {
        await dbService.init();
        await dbService.removeLegacySeedData();
        const settings = await dbService.getSettings();
        document.body.classList.toggle('sidebar-hide-enabled', settings.sidebar_hide_enabled !== false);
        void syncEngine.startAutoSync();
      } catch (err) {
        console.error('Failed to initialize database:', err);
      } finally {
        setIsLoading(false);
      }
    }
    initApp();
    return () => {
      syncEngine.stopAutoSync();
    };
  }, []);

  useEffect(() => {
    const handleGlobalSearchShortcut = (event: KeyboardEvent) => {
      if (!isAndroid && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsUniversalSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleGlobalSearchShortcut);
    return () => window.removeEventListener('keydown', handleGlobalSearchShortcut);
  }, [isAndroid]);

  const handleSelectTab = (tab: NavTab) => {
    setAutoPlayFileId(null);
    setAutoPlayOnOpen(false);
    activeAnimationsRef.current.forEach(a => {
      try { a.cancel(); } catch { /* ignore */ }
    });
    activeAnimationsRef.current = [];
    if (accentAnimationCancelRef.current) {
      accentAnimationCancelRef.current();
      accentAnimationCancelRef.current = null;
    }
    cleanupHiddenCard();
    setIsDetailTransitioning(false);
    cardOriginRef.current = null;
    setItemSnapshot(null);
    isClosingRef.current = false;
    document.body.classList.remove('mdv-detail-closing');

    if (activeTab === tab && !selectedMedia) {
      return;
    }

    if (tab === 'home' && selectedMedia) {
      const targetHeroColor = homeHeroAccentColorRef.current || homeAccentColorRef.current || '#E27D12';
      accentAnimationCancelRef.current = animateAccentTransition(targetHeroColor, (color) => {
        setHomeAccentColor(color);
        homeAccentColorRef.current = color;
      });
    }

    setActiveTab(tab);
    setSelectedMedia(null);
    setSelectedAccentColor(undefined);
    selectedInitialBackdropRef.current = undefined;
    selectedInitialHistoryRef.current = undefined;
  };

  const handleSelectMedia = useCallback((
    media: Media,
    clickedCardRect?: DOMRect,
    options?: SelectMediaOptions
  ) => {
    activeAnimationsRef.current.forEach(a => {
      try { a.cancel(); } catch { /* ignore */ }
    });
    activeAnimationsRef.current = [];
    if (accentAnimationCancelRef.current) {
      accentAnimationCancelRef.current();
      accentAnimationCancelRef.current = null;
    }
    isClosingRef.current = false;
    document.body.classList.remove('mdv-detail-closing');
    cleanupHiddenCard();

    if (options?.autoPlay) {
      setAutoPlayOnOpen(true);
    }

    selectedInitialBackdropRef.current = options?.initialBackdrop;
    selectedInitialHistoryRef.current = options?.initialHistory;

    if (clickedCardRect && mainViewRef.current) {
      const mainRect = mainViewRef.current.getBoundingClientRect();
      const W = Math.max(1, mainRect.width);
      const H = Math.max(1, mainRect.height);
      const dx = clickedCardRect.left - mainRect.left;
      const dy = clickedCardRect.top - mainRect.top;
      const isLandscape = clickedCardRect.width > clickedCardRect.height;
      const cardRadius = isLandscape ? 10 : 2;
      const s0 = Math.max(0.001, Math.max(clickedCardRect.width / W, clickedCardRect.height / H));
      const unscaledW = clickedCardRect.width / s0;
      const unscaledH = clickedCardRect.height / s0;
      const insetRight0 = Math.max(0, W - unscaledW);
      const insetBottom0 = Math.max(0, H - unscaledH);
      const radius0 = cardRadius / s0;

      const type = options?.type || 'container';
      let circleOriginX: number | undefined;
      let circleOriginY: number | undefined;
      let maxRadius: number | undefined;

      if (type === 'circle') {
        if (options?.clickPoint) {
          circleOriginX = options.clickPoint.x - mainRect.left;
          circleOriginY = options.clickPoint.y - mainRect.top;
        } else {
          circleOriginX = (clickedCardRect.left + clickedCardRect.width / 2) - mainRect.left;
          circleOriginY = (clickedCardRect.top + clickedCardRect.height / 2) - mainRect.top;
        }
        const maxDistX = Math.max(circleOriginX, W - circleOriginX);
        const maxDistY = Math.max(circleOriginY, H - circleOriginY);
        maxRadius = Math.ceil(Math.hypot(maxDistX, maxDistY));
      }

      cardOriginRef.current = {
        type,
        left: clickedCardRect.left,
        top: clickedCardRect.top,
        width: clickedCardRect.width,
        height: clickedCardRect.height,
        cardRadius,
        dx,
        dy,
        s0,
        unscaledW,
        unscaledH,
        insetRight0,
        insetBottom0,
        radius0,
        circleOriginX,
        circleOriginY,
        maxRadius,
        heroTitleRect: options?.titleRect
      };

      if (type === 'container') {
        setIsDetailTransitioning(true);
        const clickedCardEl = options?.cardElement || document.querySelector<HTMLElement>(`[data-card-media-id="${media.id}"]`);
        if (clickedCardEl) {
          clickedCardEl.style.opacity = '0';
          clickedCardEl.setAttribute('data-card-hidden', 'true');
          hiddenCardElRef.current = clickedCardEl;
        }

        const existingImg = clickedCardEl?.querySelector<HTMLImageElement>('img');
        const activeImageUrl = isLandscape
          ? (options?.initialBackdrop || existingImg?.currentSrc || existingImg?.src)
          : (existingImg?.currentSrc || existingImg?.src || media.poster);

        setItemSnapshot({
          title: media.title,
          activeImageUrl,
          poster: media.poster,
          backdrop: media.backdrop,
          logo: media.logo,
          accentColor: media.accent_color,
          landscape: isLandscape
        });
      } else {
        setIsDetailTransitioning(false);
        setItemSnapshot(null);
      }
    } else {
      setIsDetailTransitioning(false);
      cardOriginRef.current = null;
      setItemSnapshot(null);
    }

    if (activeTabRef.current === 'home' && !selectedMediaRef.current && homeScrollRef.current) {
      homeScrollTop.current = homeScrollRef.current.scrollTop;
    }

    setSelectedMedia(media);
    setSelectedAccentColor(media.accent_color);
  }, []);

  useLayoutEffect(() => {
    const container = detailContainerRef.current;
    const origin = cardOriginRef.current;
    const main = mainViewRef.current;
    const itemLayer = itemLayerRef.current;
    const appScreenLayer = appScreenLayerRef.current;

    if (!container || !origin || !selectedMedia || !main) return;

    const mainRect = main.getBoundingClientRect();
    if (mainRect.width <= 0 || mainRect.height <= 0) return;

    activeAnimationsRef.current.forEach(a => {
      try { a.cancel(); } catch { /* ignore */ }
    });
    activeAnimationsRef.current = [];

    const openDuration = 450;
    const openEasing = 'cubic-bezier(0.05, 0.7, 0.1, 1.0)'; // Material Emphasized Decelerate

    if (origin.type === 'circle') {
      const circleOriginX = origin.circleOriginX ?? (origin.dx + origin.width / 2);
      const circleOriginY = origin.circleOriginY ?? (origin.dy + origin.height / 2);
      const maxRadius = origin.maxRadius ?? Math.ceil(Math.hypot(
        Math.max(circleOriginX, mainRect.width - circleOriginX),
        Math.max(circleOriginY, mainRect.height - circleOriginY)
      ));

      container.style.transform = '';
      container.style.borderRadius = '';
      container.style.pointerEvents = 'none';

      if (itemLayer) {
        itemLayer.style.display = 'none';
      }
      if (appScreenLayer) {
        appScreenLayer.style.opacity = '1';
      }

      if (typeof container.animate === 'function') {
        container.style.willChange = 'transform, clip-path';
        container.style.contain = 'paint';
        const circleAnim = container.animate(
          [
            {
              clipPath: `circle(0px at ${circleOriginX}px ${circleOriginY}px)`
            },
            {
              clipPath: `circle(${maxRadius}px at ${circleOriginX}px ${circleOriginY}px)`
            }
          ],
          {
            duration: openDuration,
            easing: openEasing,
            fill: 'forwards'
          }
        );
        activeAnimationsRef.current.push(circleAnim);

        // Smoothly transition backdrop image from zoomed-in hero (1.05) to detail view (1.0)
        const backdropImg = container.querySelector<HTMLElement>('.mdv-backdrop-img');
        if (backdropImg && typeof backdropImg.animate === 'function') {
          const backdropAnim = backdropImg.animate(
            [
              { transform: 'scale(1.05)', transformOrigin: 'top center' },
              { transform: 'scale(1)', transformOrigin: 'top center' }
            ],
            {
              duration: openDuration,
              easing: openEasing,
              fill: 'forwards'
            }
          );
          activeAnimationsRef.current.push(backdropAnim);
        }

        // Smoothly move the hero title/logo element to its detail view position
        const detailTitleEl = origin.heroTitleRect
          ? container.querySelector<HTMLElement>('.mdv-title-lockup:not(.hidden)')
          : null;
        if (origin.heroTitleRect && detailTitleEl) {
          const detailTitleRect = detailTitleEl.getBoundingClientRect();
          const titleDx = origin.heroTitleRect.left - detailTitleRect.left;
          const titleDy = origin.heroTitleRect.top - detailTitleRect.top;
          origin.titleDx = titleDx;
          origin.titleDy = titleDy;

          if (typeof detailTitleEl.animate === 'function') {
            detailTitleEl.style.willChange = 'transform';
            const titleAnim = detailTitleEl.animate(
              [
                { transform: `translate3d(${titleDx}px, ${titleDy}px, 0)` },
                { transform: 'translate3d(0px, 0px, 0)' }
              ],
              {
                duration: openDuration,
                easing: openEasing,
                fill: 'forwards'
              }
            );
            activeAnimationsRef.current.push(titleAnim);
          }

          const heroTitleEl = homeScrollRef.current?.querySelector<HTMLElement>('.hero-title-lockup:not(.hidden)');
          if (heroTitleEl && typeof heroTitleEl.animate === 'function') {
            const heroTitleAnim = heroTitleEl.animate(
              [
                { transform: 'translate3d(0px, 0px, 0)' },
                { transform: `translate3d(${-titleDx}px, ${-titleDy}px, 0)` }
              ],
              {
                duration: openDuration,
                easing: openEasing,
                fill: 'forwards'
              }
            );
            activeAnimationsRef.current.push(heroTitleAnim);
          }
        }

        const clearCircleAnimationStyles = () => {
          if (container) {
            container.style.pointerEvents = '';
            container.style.clipPath = '';
            container.style.willChange = '';
            container.style.contain = '';
          }
          if (detailTitleEl) {
            detailTitleEl.style.willChange = '';
          }
        };

        circleAnim.onfinish = () => {
          const anims = activeAnimationsRef.current;
          activeAnimationsRef.current = [];
          anims.forEach(a => {
            try { a.cancel(); } catch { /* ignore */ }
          });
          clearCircleAnimationStyles();
        };

        circleAnim.oncancel = () => {
          activeAnimationsRef.current = [];
          clearCircleAnimationStyles();
        };
      }
      return;
    }

    container.style.transformOrigin = '0 0';
    container.style.pointerEvents = 'none';
    if (appScreenLayer) {
      appScreenLayer.style.pointerEvents = 'none';
    }

    if (typeof container.animate === 'function') {
      container.style.willChange = 'transform, clip-path';
      container.style.contain = 'paint';
      if (appScreenLayer) {
        appScreenLayer.style.willChange = 'opacity';
      }
      // 1. Container Transform (translate, uniform scale, clip-path: inset with corner radius)
      const containerAnim = container.animate(
        [
          {
            transform: `translate3d(${origin.dx}px, ${origin.dy}px, 0) scale(${origin.s0})`,
            clipPath: `inset(0px ${origin.insetRight0}px ${origin.insetBottom0}px 0px round ${origin.radius0}px)`
          },
          {
            transform: 'translate3d(0px, 0px, 0) scale(1)',
            clipPath: 'inset(0px 0px 0px 0px round 0px)'
          }
        ],
        {
          duration: openDuration,
          easing: openEasing,
          fill: 'forwards'
        }
      );
      activeAnimationsRef.current.push(containerAnim);

      // 2. Crossfade item layer out over first 25% of progress
      if (itemLayer) {
        itemLayer.style.display = 'block';
        const itemAnim = itemLayer.animate(
          [
            { opacity: 1, offset: 0 },
            { opacity: 0, offset: 0.25 },
            { opacity: 0, offset: 1 }
          ],
          {
            duration: openDuration,
            easing: openEasing,
            fill: 'forwards'
          }
        );
        activeAnimationsRef.current.push(itemAnim);
      }

      // 3. Fade app screen layer in over remaining 75% of progress
      if (appScreenLayer) {
        const appAnim = appScreenLayer.animate(
          [
            { opacity: 0, offset: 0 },
            { opacity: 0, offset: 0.25 },
            { opacity: 1, offset: 1 }
          ],
          {
            duration: openDuration,
            easing: openEasing,
            fill: 'forwards'
          }
        );
        activeAnimationsRef.current.push(appAnim);
      }

      containerAnim.onfinish = () => {
        setIsDetailTransitioning(false);
        const anims = activeAnimationsRef.current;
        activeAnimationsRef.current = [];
        anims.forEach(a => {
          try { a.cancel(); } catch { /* ignore */ }
        });
        if (container) {
          container.style.pointerEvents = '';
          container.style.transform = '';
          container.style.clipPath = '';
          container.style.borderRadius = '';
          container.style.willChange = '';
          container.style.contain = '';
        }
        if (itemLayer) {
          itemLayer.style.display = 'none';
        }
        if (appScreenLayer) {
          appScreenLayer.style.pointerEvents = '';
          appScreenLayer.style.opacity = '1';
          appScreenLayer.style.willChange = '';
        }
      };

      containerAnim.oncancel = () => {
        setIsDetailTransitioning(false);
        activeAnimationsRef.current = [];
        if (container) {
          container.style.pointerEvents = '';
          container.style.willChange = '';
          container.style.contain = '';
        }
        if (appScreenLayer) {
          appScreenLayer.style.pointerEvents = '';
          appScreenLayer.style.willChange = '';
        }
      };
    }
  }, [selectedMedia?.id]);

  const handlePlayMedia = useCallback((
    media: Media,
    clickedCardRect?: DOMRect,
    options?: {
      type?: 'container' | 'circle';
      clickPoint?: { x: number; y: number };
      titleRect?: DOMRect;
    }
  ) => {
    setAutoPlayFileId(null);
    setAutoPlayOnOpen(true);
    handleSelectMedia(media, clickedCardRect, {
      ...options,
      autoPlay: true
    });
  }, [handleSelectMedia]);

  const handleSelectGridMedia = useCallback((media: Media, rect?: DOMRect, options?: SelectMediaOptions) => {
    handleSelectMedia(media, rect, options);
  }, [handleSelectMedia]);

  const handleBackToTab = () => {
    setAutoPlayFileId(null);
    setAutoPlayOnOpen(false);

    if (isClosingRef.current) return;

    // Smoothly transition accent color back to home hero accent color using same logic as hero changes
    if (activeTab === 'home' && selectedMedia) {
      const targetHeroColor = homeHeroAccentColorRef.current || homeAccentColorRef.current || '#E27D12';
      if (accentAnimationCancelRef.current) {
        accentAnimationCancelRef.current();
        accentAnimationCancelRef.current = null;
      }
      accentAnimationCancelRef.current = animateAccentTransition(targetHeroColor, (color) => {
        setHomeAccentColor(color);
        homeAccentColorRef.current = color;
      });
    }

    const container = detailContainerRef.current;
    const origin = cardOriginRef.current;
    const main = mainViewRef.current;
    const itemLayer = itemLayerRef.current;
    const appScreenLayer = appScreenLayerRef.current;
    const isEligibleTab = ['home', 'movies', 'tv', 'games'].includes(activeTab);

    if (container && origin && main && isEligibleTab && typeof container.animate === 'function') {
      const mainRect = main.getBoundingClientRect();
      const W = Math.max(1, mainRect.width);
      const H = Math.max(1, mainRect.height);

      isClosingRef.current = true;
      document.body.classList.add('mdv-detail-closing');
      setIsDetailTransitioning(true);
      if (appScreenLayer) {
        appScreenLayer.style.pointerEvents = 'none';
      }
      activeAnimationsRef.current.forEach(a => {
        try { a.cancel(); } catch { /* ignore */ }
      });
      activeAnimationsRef.current = [];

      const closeDuration = 320;
      const closeEasing = 'cubic-bezier(0.2, 0.0, 0.0, 1.0)';

      const finishClose = () => {
        activeAnimationsRef.current = [];
        isClosingRef.current = false;
        cleanupHiddenCard();

        requestAnimationFrame(() => {
          if (container) {
            container.style.display = 'none';
            container.style.willChange = '';
            container.style.contain = '';
          }
          if (appScreenLayer) {
            appScreenLayer.style.pointerEvents = '';
            appScreenLayer.style.willChange = '';
          }
          const heroTitleEl = homeScrollRef.current?.querySelector<HTMLElement>('.hero-title-lockup');
          if (heroTitleEl) {
            heroTitleEl.style.transform = '';
          }
          if (activeTab === 'home' && homeScrollRef.current) {
            homeScrollRef.current.scrollTop = homeScrollTop.current;
          }
          setIsDetailTransitioning(false);
          setSelectedMedia(null);
          setSelectedAccentColor(undefined);
          selectedInitialBackdropRef.current = undefined;
          selectedInitialHistoryRef.current = undefined;
          setItemSnapshot(null);
          cardOriginRef.current = null;
          if (window.history.state?.isMediaDetail) {
            window.history.back();
          }
        });
      };

      if (origin.type === 'circle') {
        const circleOriginX = origin.circleOriginX ?? (origin.dx + origin.width / 2);
        const circleOriginY = origin.circleOriginY ?? (origin.dy + origin.height / 2);
        const maxRadius = origin.maxRadius ?? Math.ceil(Math.hypot(
          Math.max(circleOriginX, W - circleOriginX),
          Math.max(circleOriginY, H - circleOriginY)
        ));

        container.style.pointerEvents = 'none';
        container.style.willChange = 'transform, clip-path';
        container.style.contain = 'paint';

        const exitCircleAnim = container.animate(
          [
            {
              clipPath: `circle(${maxRadius}px at ${circleOriginX}px ${circleOriginY}px)`
            },
            {
              clipPath: `circle(0px at ${circleOriginX}px ${circleOriginY}px)`
            }
          ],
          {
            duration: closeDuration,
            easing: closeEasing,
            fill: 'forwards'
          }
        );
        activeAnimationsRef.current.push(exitCircleAnim);

        // Smoothly scale backdrop image back from 1.0 to 1.05 matching hero zoom
        const backdropImg = container.querySelector<HTMLElement>('.mdv-backdrop-img');
        if (backdropImg && typeof backdropImg.animate === 'function') {
          const backdropAnim = backdropImg.animate(
            [
              { transform: 'scale(1)', transformOrigin: 'top center' },
              { transform: 'scale(1.05)', transformOrigin: 'top center' }
            ],
            {
              duration: closeDuration,
              easing: closeEasing,
              fill: 'forwards'
            }
          );
          activeAnimationsRef.current.push(backdropAnim);
        }

        // Smoothly move the detail title/logo element back to the hero position
        if (origin.titleDx !== undefined && origin.titleDy !== undefined) {
          const detailTitleEl = container.querySelector<HTMLElement>('.mdv-title-lockup:not(.hidden)');
          if (detailTitleEl && typeof detailTitleEl.animate === 'function') {
            const titleExitAnim = detailTitleEl.animate(
              [
                { transform: 'translate3d(0px, 0px, 0)' },
                { transform: `translate3d(${origin.titleDx}px, ${origin.titleDy}px, 0)` }
              ],
              {
                duration: closeDuration,
                easing: closeEasing,
                fill: 'forwards'
              }
            );
            activeAnimationsRef.current.push(titleExitAnim);
          }

          const heroTitleEl = homeScrollRef.current?.querySelector<HTMLElement>('.hero-title-lockup:not(.hidden)');
          if (heroTitleEl && typeof heroTitleEl.animate === 'function') {
            const heroTitleExitAnim = heroTitleEl.animate(
              [
                { transform: `translate3d(${-origin.titleDx}px, ${-origin.titleDy}px, 0)` },
                { transform: 'translate3d(0px, 0px, 0)' }
              ],
              {
                duration: closeDuration,
                easing: closeEasing,
                fill: 'forwards'
              }
            );
            activeAnimationsRef.current.push(heroTitleExitAnim);
          }
        }

        exitCircleAnim.onfinish = finishClose;
        exitCircleAnim.oncancel = finishClose;
        return;
      }

      let dx = origin.left - mainRect.left;
      let dy = origin.top - mainRect.top;
      let cardWidth = origin.width;
      let cardHeight = origin.height;

      const targetCardEl = (hiddenCardElRef.current && hiddenCardElRef.current.isConnected)
        ? hiddenCardElRef.current
        : selectedMedia
          ? document.querySelector<HTMLElement>(`[data-card-media-id="${selectedMedia.id}"]`)
          : null;

      if (targetCardEl) {
        const r = targetCardEl.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          dx = r.left - mainRect.left;
          dy = r.top - mainRect.top;
          cardWidth = r.width;
          cardHeight = r.height;
        }
      }

      const isLandscape = cardWidth > cardHeight;
      const cardRadius = isLandscape ? 10 : 2;
      const s0 = Math.max(0.001, Math.max(cardWidth / W, cardHeight / H));
      const unscaledW = cardWidth / s0;
      const unscaledH = cardHeight / s0;
      const insetRight0 = Math.max(0, W - unscaledW);
      const insetBottom0 = Math.max(0, H - unscaledH);
      const radius0 = cardRadius / s0;

      container.style.transformOrigin = '0 0';
      container.style.pointerEvents = 'none';
      container.style.willChange = 'transform, clip-path';
      container.style.contain = 'paint';
      if (appScreenLayer) {
        appScreenLayer.style.willChange = 'opacity';
      }

      // 1. Container Transform in Reverse (translate, uniform scale, clip-path: inset with corner radius)
      const exitAnim = container.animate(
        [
          {
            transform: 'translate3d(0px, 0px, 0) scale(1)',
            clipPath: 'inset(0px 0px 0px 0px round 0px)'
          },
          {
            transform: `translate3d(${dx}px, ${dy}px, 0) scale(${s0})`,
            clipPath: `inset(0px ${insetRight0}px ${insetBottom0}px 0px round ${radius0}px)`
          }
        ],
        {
          duration: closeDuration,
          easing: closeEasing,
          fill: 'forwards'
        }
      );
      activeAnimationsRef.current.push(exitAnim);

      // 2. Fade app screen layer out (smooth fadeout for portrait items, first 75% for landscape)
      if (appScreenLayer) {
        const appAnim = appScreenLayer.animate(
          isLandscape
            ? [
                { opacity: 1, offset: 0 },
                { opacity: 0, offset: 0.75 },
                { opacity: 0, offset: 1 }
              ]
            : [
                { opacity: 1, offset: 0 },
                { opacity: 0, offset: 0.85 },
                { opacity: 0, offset: 1 }
              ],
          {
            duration: closeDuration,
            easing: closeEasing,
            fill: 'forwards'
          }
        );
        activeAnimationsRef.current.push(appAnim);
      }

      // 3. Fade item layer back in: for portrait media items, smoothly fade the poster image throughout closing so it doesn't switch back at the last second
      if (itemLayer) {
        itemLayer.style.display = 'block';
        itemLayer.style.width = `${unscaledW}px`;
        itemLayer.style.height = `${unscaledH}px`;
        itemLayer.style.borderRadius = `${radius0}px`;

        const itemAnim = itemLayer.animate(
          isLandscape
            ? [
                { opacity: 0, offset: 0 },
                { opacity: 0, offset: 0.75 },
                { opacity: 1, offset: 1 }
              ]
            : [
                { opacity: 0, offset: 0 },
                { opacity: 1, offset: 0.85 },
                { opacity: 1, offset: 1 }
              ],
          {
            duration: closeDuration,
            easing: closeEasing,
            fill: 'forwards'
          }
        );
        activeAnimationsRef.current.push(itemAnim);
      }

      exitAnim.onfinish = finishClose;
      exitAnim.oncancel = finishClose;
      return;
    }

    cleanupHiddenCard();
    setIsDetailTransitioning(false);
    if (activeTab === 'home' && homeScrollRef.current) {
      homeScrollRef.current.scrollTop = homeScrollTop.current;
    }
    setSelectedMedia(null);
    setSelectedAccentColor(undefined);
    selectedInitialBackdropRef.current = undefined;
    selectedInitialHistoryRef.current = undefined;
    setItemSnapshot(null);
    cardOriginRef.current = null;
    isClosingRef.current = false;
    if (window.history.state?.isMediaDetail) {
      window.history.back();
    }
  };

  // Android / Browser Back Button & Popstate Handling
  useEffect(() => {
    if (activeTab === 'home' && !selectedMedia) {
      if (accentAnimationCancelRef.current) return;
      const accentColor = homeHeroAccentColorRef.current || homeAccentColorRef.current || '#E27D12';
      document.documentElement.style.setProperty('--hero-accent', accentColor);
      document.documentElement.style.setProperty('--hero-accent-rgb', getAccentRgb(accentColor));
      document.documentElement.style.setProperty('--hero-accent-light', `color-mix(in srgb, ${accentColor}, white 20%)`);
      return;
    }

    const accentColor = selectedMedia
      ? selectedAccentColor || selectedMedia.accent_color
      : undefined;
    if (accentColor) {
      document.documentElement.style.setProperty('--hero-accent', accentColor);
      document.documentElement.style.setProperty('--hero-accent-rgb', getAccentRgb(accentColor));
      // Use color-mix to create a lighter shade for hover
      document.documentElement.style.setProperty('--hero-accent-light', `color-mix(in srgb, ${accentColor}, white 20%)`);
    } else {
      document.documentElement.style.removeProperty('--hero-accent');
      document.documentElement.style.removeProperty('--hero-accent-rgb');
      document.documentElement.style.removeProperty('--hero-accent-light');
    }
  }, [activeTab, selectedAccentColor, selectedMedia?.accent_color, selectedMedia?.id]);

  useEffect(() => {
    // Push dummy history entry when opening detail or sheet/modal view
    if (selectedMedia) {
      window.history.pushState({ isMediaDetail: true }, '');
    }
  }, [selectedMedia]);

  useEffect(() => {
    const handlePopState = (_event: PopStateEvent) => {
      // First, check if any mobile sheet or modal is open
      const closeSheetEvent = new CustomEvent('close-mobile-sheets', { cancelable: true });
      const wasSheetClosed = !window.dispatchEvent(closeSheetEvent);

      if (wasSheetClosed) {
        // A sheet was open and closed by its event handler
        return;
      }

      // If selectedMedia is open and not already closing, close detail page
      if (selectedMedia && !isClosingRef.current) {
        handleBackToTab();
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [selectedMedia, activeTab]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0c0d10] flex items-center justify-center text-white font-sans">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 border-4 border-[#E27D12] border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-semibold tracking-wider text-[#E27D12] uppercase">
            Initializing Media Library...
          </p>
        </div>
      </div>
    );
  }

  const renderGridView = (enableHoverPreview = true) => {

    switch (activeTab) {
      case 'movies':
        return (
          <MediaGridView
            typeFilter="Film"
            title="Movies & Films"
            subtitle="Explore your personal feature film library"
            onSelectMedia={handleSelectGridMedia}
            onPreviewStart={enableHoverPreview ? handlePreviewStart : undefined}
            onPreviewEnd={enableHoverPreview ? handlePreviewEnd : undefined}
            isCollapsed={isCollapsed}
            isDetailsOpen={selectedMedia!=null}
            scrollContainerRef={gridScrollRef}
          />
        );
      case 'tv':
        return (
          <MediaGridView
            typeFilter="TV Series"
            title="TV Shows & Series"
            subtitle="Track your watched seasons, episodes, and series history"
            onSelectMedia={handleSelectGridMedia}
            onPreviewStart={enableHoverPreview ? handlePreviewStart : undefined}
            onPreviewEnd={enableHoverPreview ? handlePreviewEnd : undefined}
            isCollapsed={isCollapsed}
            isDetailsOpen={selectedMedia!=null}
            scrollContainerRef={gridScrollRef}
          />
        );
      case 'games':
        return (
          <MediaGridView
            typeFilter="VideoGame"
            title="Video Games"
            subtitle="Catalog and history of PC, console, and handheld games"
            onSelectMedia={handleSelectGridMedia}
            onPreviewStart={enableHoverPreview ? handlePreviewStart : undefined}
            onPreviewEnd={enableHoverPreview ? handlePreviewEnd : undefined}
            isCollapsed={isCollapsed}
            isDetailsOpen={selectedMedia!=null}
            scrollContainerRef={gridScrollRef}
          />
        );
      default:
        return null;
    }
  };

  const renderHomeView = () => (
    <HomeView
      onSelectMedia={handleSelectMedia}
      onPlayMedia={handlePlayMedia}
      onAccentColorChange={handleHomeAccentChange}
      isCollapsed={isCollapsed}
      isDetailsOpen={selectedMedia !== null}
    />
  );

  const renderActiveView = () => {
    if (selectedMedia) {
      return renderDetailView();
    }

    switch (activeTab) {
      case 'home':
        return renderHomeView();
      case 'movies':
      case 'tv':
      case 'games':
        return renderGridView();
      case 'history':
        return <HistoryView onSelectMedia={handleSelectMedia} isCollapsed={isCollapsed} />;
      case 'inbox':
        return <UnmatchedInboxView onMediaMatched={() => {}} isCollapsed={isCollapsed} />;
      case 'settings':
        return <SettingsView isCollapsed={isCollapsed} />;
      default:
        return (
          <HomeView
            onSelectMedia={handleSelectMedia}
            onPlayMedia={handlePlayMedia}
            onAccentColorChange={handleHomeAccentChange}
            isDetailsOpen={selectedMedia !== null}
          />
        );
    }
  };

  const renderDetailView = () => {
    if (!selectedMedia) return null;
    return (
      <MediaDetailView
        key={selectedMedia.id}
        media={selectedMedia}
        onBack={handleBackToTab}
        isCollapsed={isCollapsed}
        isTransitioning={isDetailTransitioning}
        initialBackdrop={selectedInitialBackdropRef.current || (itemSnapshot?.landscape ? itemSnapshot?.activeImageUrl : undefined) || itemSnapshot?.backdrop}
        initialHistory={selectedInitialHistoryRef.current}
        onSearchCast={castName => {
          setUniversalSearchQuery(`cast:${castName.trim().replace(/\s+/g, '-')} `);
          setIsUniversalSearchOpen(true);
        }}
        onSearchFilter={filterQuery => {
          setUniversalSearchQuery(filterQuery.endsWith(' ') ? filterQuery : `${filterQuery} `);
          setIsUniversalSearchOpen(true);
        }}
        onAccentColorChange={setSelectedAccentColor}
        accentColorOverride={selectedAccentColor}
        autoPlayFileId={autoPlayFileId || undefined}
        autoPlayOnOpen={autoPlayOnOpen}
        onAutoPlayHandled={() => {
          setAutoPlayFileId(null);
          setAutoPlayOnOpen(false);
        }}
      />
    );
  };

  const handleUniversalSearchOpenMedia = (media: Media, options?: { autoPlayFileId?: string; play?: boolean }) => {
    setAutoPlayFileId(options?.autoPlayFileId || null);
    setAutoPlayOnOpen(Boolean(options?.play));
    handleSelectMedia(media);
  };

  const hasUnderlyingGrid = Boolean(
    selectedMedia && ['movies', 'tv', 'games'].includes(activeTab)
  );
  const hasUnderlyingHome = Boolean(selectedMedia && activeTab === 'home');
  const isGridTab = ['movies', 'tv', 'games'].includes(activeTab);

  return (
    <div className="flex h-screen bg-[#0c0d10] text-gray-100 font-sans overflow-hidden">
      {/* Custom Desktop Window Controls & Drag Region */}
      <TitleBarDragRegion />

      {/* Sidebar trigger zone for Detail View */}
      <div className="mdv-sidebar-trigger-zone" />
      {/* Navigation Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        isCollapsed={isCollapsed}
        setIsCollapsed={setIsCollapsed}
        accentColor={pageAccentColor}
        onOpenUniversalSearch={() => setIsUniversalSearchOpen(true)}
      />

      {/* Main View Area */}
      <main
        ref={mainViewRef}
        className={`relative isolate flex-1 ${
          activeTab === 'home' ? 'transition-none' : 'transition-colors duration-350'
        } ${
          isGridTab || activeTab === 'home' ? 'overflow-hidden' : 'overflow-y-auto'
        }`}
        style={{
          backgroundColor: activeTab === 'home'
            ? pageAccentColor || '#0c0d10'
            : '#0c0d10'
        }}
      >
        {isGridTab ? (
          <div
            ref={gridScrollRef}
            className="absolute inset-0 z-0 overflow-y-auto"
            style={{
              scrollbarGutter: 'stable',
              pointerEvents: isDetailTransitioning ? 'none' : undefined
            }}
          >
            {hasUnderlyingGrid ? renderGridView() : renderActiveView()}
          </div>
        ) : activeTab === 'home' ? (
          <div
            ref={homeScrollRef}
            className="absolute inset-0 z-0 overflow-y-auto"
            style={{
              scrollbarGutter: 'stable',
              pointerEvents: isDetailTransitioning ? 'none' : undefined
            }}
          >
            {renderHomeView()}
          </div>
        ) : (
          <div className="relative z-0">{renderActiveView()}</div>
        )}
        {(hasUnderlyingGrid || hasUnderlyingHome) && (
          <div
            ref={detailContainerRef}
            className="absolute inset-0 z-10 overflow-hidden"
            style={{
              backgroundColor: selectedAccentColor || selectedMedia?.accent_color || '#423e3f'
            }}
          >
            {/* Item Layer: crossfades out over first 25% of open, fades back in over last 25% of close */}
            {itemSnapshot && (
              <div
                ref={itemLayerRef}
                className="absolute top-0 left-0 z-20 pointer-events-none overflow-hidden"
                style={{
                  width: `${cardOriginRef.current?.unscaledW || 0}px`,
                  height: `${cardOriginRef.current?.unscaledH || 0}px`,
                  backgroundColor: itemSnapshot.accentColor || '#151720',
                  borderRadius: `${cardOriginRef.current?.radius0 || 10}px`,
                  willChange: 'opacity'
                }}
              >
                {(itemSnapshot.activeImageUrl || itemSnapshot.poster || itemSnapshot.backdrop) ? (
                  <img
                    src={
                      itemSnapshot.landscape
                        ? (itemSnapshot.activeImageUrl || itemSnapshot.backdrop || itemSnapshot.poster)
                        : (itemSnapshot.poster || itemSnapshot.activeImageUrl || itemSnapshot.backdrop)
                    }
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center p-4">
                    <span className="text-sm font-semibold text-white/80">{itemSnapshot.title}</span>
                  </div>
                )}
                {itemSnapshot.landscape ? (
                  <div
                    className="absolute inset-0 z-10 flex items-end px-3 pb-3 pt-10"
                    style={{
                      background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 50%, transparent 100%)'
                    }}
                  >
                    {itemSnapshot.logo ? (
                      <img
                        src={itemSnapshot.logo}
                        alt=""
                        className="max-w-[75%] object-contain object-left drop-shadow-lg"
                        style={{ height: 'clamp(24px, 2.4vw, 40px)' }}
                      />
                    ) : (
                      <p
                        className="font-extrabold uppercase text-white drop-shadow"
                        style={{ fontSize: 'clamp(16px, 1.2vw, 24px)' }}
                      >
                        {itemSnapshot.title}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0c0d10] via-transparent to-black/20 opacity-80" />
                )}
              </div>
            )}

            {/* App Screen Layer: fades in over remaining 75% of open, fades out over first 75% of close */}
            <div
              ref={appScreenLayerRef}
              className="mdv-detail-scroll-container w-full h-full"
            >
              {renderDetailView()}
            </div>
          </div>
        )}
      </main>
      <UniversalSearchOverlay
        isOpen={isUniversalSearchOpen}
        initialQuery={universalSearchQuery}
        onClose={() => {
          setIsUniversalSearchOpen(false);
          setUniversalSearchQuery('');
        }}
        onOpenMedia={handleUniversalSearchOpenMedia}
      />
    </div>
  );
}

export default App;
