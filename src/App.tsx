import { useState, useEffect, useRef } from 'react';
import { Sidebar, NavTab } from './components/Sidebar';
import { HomeView } from './views/HomeView';
import { MediaGridView } from './views/MediaGridView';
import { MediaDetailView } from './views/MediaDetailView';
import { WishlistView } from './views/WishlistView';
import { HistoryView } from './views/HistoryView';
import { SettingsView } from './views/SettingsView';
import { UnmatchedInboxView } from './views/UnmatchedInboxView';
import { UniversalSearchOverlay } from './components/UniversalSearchOverlay';
import { dbService } from './services/DatabaseService';
import { Media } from './types/media';
import { getAccentRgb } from './helper/mediaDetailTheme';

interface CardTransitionState {
  mediaId: string;
  color: string;
  centerX: number;
  centerY: number;
  detailCenterX: number;
  detailCenterY: number;
  radius: number;
  phase: 'preview' | 'reverse' | 'commit' | 'reveal';
  entered: boolean;
}

interface DetailReturnTransition {
  centerX: number;
  centerY: number;
  radius: number;
  closing: boolean;
}

function getCardTransitionRadius(centerX: number, centerY: number): number {
  return Math.min(9060, Math.hypot(
    Math.max(centerX, window.innerWidth - centerX),
    Math.max(centerY, window.innerHeight - centerY)
  ) * 1);
}

function getDetailTransitionCenter(centerX: number, centerY: number, container: HTMLElement | null) {
  const rect = container?.getBoundingClientRect();
  return {
    detailCenterX: centerX - (rect?.left || 0),
    detailCenterY: centerY - (rect?.top || 0)
  };
}

export function App() {
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [selectedMedia, setSelectedMedia] = useState<Media | null>(null);
  const [selectedAccentColor, setSelectedAccentColor] = useState<string>();
  const [homeAccentColor, setHomeAccentColor] = useState<string>();
  const [isUniversalSearchOpen, setIsUniversalSearchOpen] = useState(false);
  const [universalSearchQuery, setUniversalSearchQuery] = useState('');
  const [autoPlayFileId, setAutoPlayFileId] = useState<string | null>(null);
  const [autoPlayOnOpen, setAutoPlayOnOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const homeAccentColorRef = useRef(homeAccentColor);
  homeAccentColorRef.current = homeAccentColor;
  const [cardTransition, setCardTransition] = useState<CardTransitionState | null>(null);
  const [detailReturnTransition, setDetailReturnTransition] = useState<DetailReturnTransition | null>(null);
  const mainViewRef = useRef<HTMLElement>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const homeScrollRef = useRef<HTMLDivElement>(null);
  const homeScrollTop = useRef(0);
  const detailOrigin = useRef<{ centerX: number; centerY: number; radius: number } | null>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const returnTransitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionFrame = useRef<number | null>(null);
  const pageAccentColor = selectedMedia
    ? selectedAccentColor || selectedMedia.accent_color
    : activeTab === 'home'
      ? homeAccentColor
      : undefined;

  const clearTransitionTimer = () => {
    if (transitionTimer.current) {
      clearTimeout(transitionTimer.current);
      transitionTimer.current = null;
    }
  };

  const clearPreviewStartTimer = () => {
    if (previewStartTimer.current) {
      clearTimeout(previewStartTimer.current);
      previewStartTimer.current = null;
    }
  };

  const handlePreviewStart = () => {
    if (detailReturnTransition) return;

    clearTransitionTimer();
    clearPreviewStartTimer();
    if (transitionFrame.current !== null) cancelAnimationFrame(transitionFrame.current);

    // Preview start is now disabled to remove the expanding circle effect
    // but we still keep the logic for potential future use.
    // setCardTransition(null); 
  };

  const handlePreviewEnd = () => {
    if (detailReturnTransition) return;
    if (!cardTransition || cardTransition.phase !== 'preview') return;

    clearPreviewStartTimer();
    if (transitionFrame.current !== null) {
      cancelAnimationFrame(transitionFrame.current);
      transitionFrame.current = null;
    }
    setCardTransition(current => current?.phase === 'preview'
      ? { ...current, phase: 'reverse' }
      : current);
    clearTransitionTimer();
    transitionTimer.current = setTimeout(() => {
      setCardTransition(current => current?.phase === 'reverse' ? null : current);
      transitionTimer.current = null;
    }, 160);
  };

  useEffect(() => () => {
    clearTransitionTimer();
    if (returnTransitionTimer.current) clearTimeout(returnTransitionTimer.current);
    clearPreviewStartTimer();
    if (transitionFrame.current !== null) cancelAnimationFrame(transitionFrame.current);
  }, []);

  useEffect(() => {
    async function initApp() {
      try {
        await dbService.init();
        await dbService.removeLegacySeedData();
      } catch (err) {
        console.error('Failed to initialize database:', err);
      } finally {
        setIsLoading(false);
      }
    }
    initApp();
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
    clearTransitionTimer();
    if (returnTransitionTimer.current) {
      clearTimeout(returnTransitionTimer.current);
      returnTransitionTimer.current = null;
    }
    detailOrigin.current = null;
    setDetailReturnTransition(null);
    setCardTransition(null);

    if (activeTab === tab && !selectedMedia) {
      return;
    }

    setActiveTab(tab);
    setSelectedMedia(null);
    setSelectedAccentColor(undefined);
  };

  const handleSelectMedia = (media: Media, clickedCardRect?: DOMRect) => {
    const hasTransitionArtwork = Boolean(media.poster || media.backdrop || media.logo || media.accent_color);
    const startsFromClickedCard = Boolean(clickedCardRect && hasTransitionArtwork);
    const transitionColor = media.accent_color
      || (cardTransition?.mediaId === media.id ? cardTransition.color : undefined);
    const continuesCardTransition = Boolean(
      hasTransitionArtwork && (
        startsFromClickedCard
        || (cardTransition?.mediaId === media.id && cardTransition.phase !== 'reverse')
      )
    );
    clearTransitionTimer();
    if (returnTransitionTimer.current) {
      clearTimeout(returnTransitionTimer.current);
      returnTransitionTimer.current = null;
    }
    setDetailReturnTransition(null);

    if (startsFromClickedCard && clickedCardRect) {
      const centerX = clickedCardRect.left + clickedCardRect.width / 2;
      const centerY = clickedCardRect.top + clickedCardRect.height / 2;
      const radius = getCardTransitionRadius(centerX, centerY);
      const detailCenter = getDetailTransitionCenter(centerX, centerY, mainViewRef.current);
      detailOrigin.current = { centerX, centerY, radius };
      setCardTransition({
        mediaId: media.id,
        color: transitionColor || '#e11d48',
        centerX,
        centerY,
        ...detailCenter,
        radius,
        phase: 'commit',
        entered: false
      });
    } else if (continuesCardTransition && cardTransition?.mediaId === media.id) {
      detailOrigin.current = {
        centerX: cardTransition.centerX,
        centerY: cardTransition.centerY,
        radius: cardTransition.radius
      };
    } else {
      detailOrigin.current = null;
    }

    if (activeTab === 'home' && !selectedMedia && homeScrollRef.current) {
      homeScrollTop.current = homeScrollRef.current.scrollTop;
    }

    setSelectedMedia(media);
    setSelectedAccentColor(media.accent_color);
    if (!continuesCardTransition) {
      clearPreviewStartTimer();
      if (transitionFrame.current !== null) {
        cancelAnimationFrame(transitionFrame.current);
        transitionFrame.current = null;
      }
      setCardTransition(null);
      return;
    }

    clearPreviewStartTimer();
    if (transitionFrame.current !== null) {
      cancelAnimationFrame(transitionFrame.current);
      transitionFrame.current = null;
    }
    if (!startsFromClickedCard) {
      setCardTransition(current => current?.mediaId === media.id
        ? { ...current, phase: 'commit', entered: false }
        : current);
    }
    transitionFrame.current = requestAnimationFrame(() => {
      setCardTransition(current => current?.mediaId === media.id && current.phase === 'commit'
        ? { ...current, entered: true }
        : current);
      transitionFrame.current = null;
    });
    transitionTimer.current = setTimeout(() => {
      setCardTransition(current => current?.mediaId === media.id
        ? { ...current, phase: 'reveal' }
        : current);
      transitionTimer.current = setTimeout(() => {
        setCardTransition(current => current?.mediaId === media.id ? null : current);
        transitionTimer.current = null;
      }, 70);
    }, 710);
  };

  const handlePlayMedia = (media: Media) => {
    setAutoPlayFileId(null);
    setAutoPlayOnOpen(true);
    handleSelectMedia(media);
  };

  const handleBackToTab = () => {
    setAutoPlayFileId(null);
    setAutoPlayOnOpen(false);
    const origin = detailOrigin.current;
    if (origin && ['home', 'movies', 'tv', 'games'].includes(activeTab)) {
      clearTransitionTimer();
      if (returnTransitionTimer.current) {
        clearTimeout(returnTransitionTimer.current);
        returnTransitionTimer.current = null;
      }

      const mainRect = mainViewRef.current?.getBoundingClientRect();
      setCardTransition(null);
      setDetailReturnTransition({
        ...origin,
        centerX: origin.centerX - (mainRect?.left || 0),
        centerY: origin.centerY - (mainRect?.top || 0),
        closing: false
      });
      requestAnimationFrame(() => {
        setDetailReturnTransition(current => current ? { ...current, closing: true } : current);
      });
      returnTransitionTimer.current = setTimeout(() => {
        if (activeTab === 'home' && homeScrollRef.current) {
          homeScrollRef.current.scrollTop = homeScrollTop.current;
        }
        setSelectedMedia(null);
        setCardTransition(null);
        setDetailReturnTransition(null);
        detailOrigin.current = null;
        if (activeTab !== 'home') {
          window.dispatchEvent(new CustomEvent('library-scanned'));
        }
        returnTransitionTimer.current = null;
      }, 400);
      return;
    }

    if (activeTab === 'home' && homeScrollRef.current) {
      homeScrollRef.current.scrollTop = homeScrollTop.current;
    }
    setSelectedMedia(null);
    setSelectedAccentColor(undefined);
  };

  // Android / Browser Back Button & Popstate Handling
  useEffect(() => {
    if (activeTab === 'home' && !selectedMedia) {
      const accentColor = homeAccentColorRef.current || '#E27D12';
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

      // If selectedMedia is open, close detail page
      if (selectedMedia) {
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
    const handleSelectGridMedia = async (media: Media, rect?: DOMRect) => {
      try {
        const latestMedia = await dbService.getMediaById(media.id);
        if (!latestMedia) {
          console.error(`Cannot open media ${media.id}: it no longer exists in the library.`);
          return;
        }
        handleSelectMedia(latestMedia, rect);
      } catch (error) {
        console.error(`Failed to load the latest data for media ${media.id}:`, error);
      }
    };

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
      onAccentColorChange={setHomeAccentColor}
      isCollapsed={isCollapsed}
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
      case 'wishlist':
        return <WishlistView isCollapsed={isCollapsed} />;
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
            onAccentColorChange={setHomeAccentColor}
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
        onSearchCast={castName => {
          setUniversalSearchQuery(`cast:${castName.trim().replace(/\s+/g, '-')}`);
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

  const completeDetailOpening = () => {
    if (cardTransition?.phase !== 'commit') return;

    clearTransitionTimer();
    if (transitionFrame.current !== null) {
      cancelAnimationFrame(transitionFrame.current);
      transitionFrame.current = null;
    }
    setCardTransition(current => current?.phase === 'commit' ? null : current);
  };

  const hasUnderlyingGrid = Boolean(
    selectedMedia && ['movies', 'tv', 'games'].includes(activeTab)
  );
  const hasUnderlyingHome = Boolean(selectedMedia && activeTab === 'home');
  const isGridTab = ['movies', 'tv', 'games'].includes(activeTab);

  return (
    <div className="flex h-screen bg-[#0c0d10] text-gray-100 font-sans overflow-hidden">
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
          !selectedMedia && activeTab === 'home' ? 'transition-none' : 'transition-colors duration-350'
        } ${
          isGridTab || activeTab === 'home' ? 'overflow-hidden' : 'overflow-y-auto'
        }`}
        style={{
          backgroundColor: !selectedMedia && activeTab === 'home'
            ? pageAccentColor || '#0c0d10'
            : '#0c0d10'
        }}
      >
        {isGridTab ? (
          <div ref={gridScrollRef} className="absolute inset-0 z-0 overflow-y-auto">
            {hasUnderlyingGrid ? renderGridView() : renderActiveView()}
          </div>
        ) : activeTab === 'home' ? (
          <div ref={homeScrollRef} className="absolute inset-0 z-0 overflow-y-auto">
            {renderHomeView()}
          </div>
        ) : (
          <div className="relative z-0">{renderActiveView()}</div>
        )}
        {(hasUnderlyingGrid || hasUnderlyingHome) && (
          <div
            className="mdv-detail-scroll-container absolute inset-0 z-10 overflow-y-auto"
            onScroll={completeDetailOpening}
            onPointerDown={event => {
              const container = event.currentTarget;
              const rect = container.getBoundingClientRect();
              const gutterWidth = Math.max(container.offsetWidth - container.clientWidth, 12);
              const isRtl = getComputedStyle(container).direction === 'rtl';
              const onScrollbar = isRtl
                ? event.clientX <= rect.left + gutterWidth
                : event.clientX >= rect.right - gutterWidth;

              if (onScrollbar) completeDetailOpening();
            }}
            style={{
              backgroundColor: pageAccentColor || selectedMedia?.accent_color || '#423e3f',
              ...(detailReturnTransition ? {
                clipPath: `circle(${detailReturnTransition.closing ? 0 : detailReturnTransition.radius}px at ${detailReturnTransition.centerX}px ${detailReturnTransition.centerY}px)`,
                transition: 'clip-path 600ms cubic-bezier(0.2, 0.8, 0.2, 1)',
                pointerEvents: 'none' as const
              } : cardTransition?.phase === 'commit' ? {
                clipPath: `circle(${cardTransition.entered ? cardTransition.radius : 0}px at ${cardTransition.detailCenterX}px ${cardTransition.detailCenterY}px)`,
                transition: 'clip-path 710ms cubic-bezier(0.2, 0.8, 0.2, 1)'
              } : {}),
            }}
          >
            {renderDetailView()}
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
