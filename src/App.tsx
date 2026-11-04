import { useState, useEffect, useRef } from 'react';
import { Sidebar, NavTab } from './components/Sidebar';
import { HomeView } from './views/HomeView';
import { MediaGridView } from './views/MediaGridView';
import { MediaDetailView } from './views/MediaDetailView';
import { WishlistView } from './views/WishlistView';
import { HistoryView } from './views/HistoryView';
import { SettingsView } from './views/SettingsView';
import { UnmatchedInboxView } from './views/UnmatchedInboxView';
import { dbService } from './services/DatabaseService';
import { Media } from './types/media';

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
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [selectedMedia, setSelectedMedia] = useState<Media | null>(null);
  const [selectedAccentColor, setSelectedAccentColor] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [cardTransition, setCardTransition] = useState<CardTransitionState | null>(null);
  const [detailReturnTransition, setDetailReturnTransition] = useState<DetailReturnTransition | null>(null);
  const mainViewRef = useRef<HTMLElement>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const homeScrollTop = useRef(0);
  const detailOrigin = useRef<{ centerX: number; centerY: number; radius: number } | null>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const returnTransitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewStartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionFrame = useRef<number | null>(null);

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

  const handleSelectTab = (tab: NavTab) => {
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

    if (activeTab === 'home' && !selectedMedia && mainViewRef.current) {
      homeScrollTop.current = mainViewRef.current.scrollTop;
      mainViewRef.current.scrollTop = 0;
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
    }, 2100);
  };

  const handleBackToTab = () => {
    const origin = detailOrigin.current;
    if (origin && ['movies', 'tv', 'games'].includes(activeTab)) {
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
        setSelectedMedia(null);
        setCardTransition(null);
        setDetailReturnTransition(null);
        detailOrigin.current = null;
        window.dispatchEvent(new CustomEvent('library-scanned'));
        returnTransitionTimer.current = null;
      }, 400);
      return;
    }

    if (activeTab === 'home' && mainViewRef.current) {
      mainViewRef.current.scrollTop = homeScrollTop.current;
    }
    setSelectedMedia(null);
    setSelectedAccentColor(undefined);
  };

  // Android / Browser Back Button & Popstate Handling
  useEffect(() => {
    if (selectedAccentColor) {
      document.documentElement.style.setProperty('--hero-accent', selectedAccentColor);
      // Use color-mix to create a lighter shade for hover
      document.documentElement.style.setProperty('--hero-accent-light', `color-mix(in srgb, ${selectedAccentColor}, white 20%)`);
    } else {
      document.documentElement.style.removeProperty('--hero-accent');
      document.documentElement.style.removeProperty('--hero-accent-light');
    }
  }, [selectedAccentColor]);

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
          />
        );
      default:
        return null;
    }
  };

  const renderActiveView = () => {
    if (selectedMedia) {
      return renderDetailView();
    }

    switch (activeTab) {
      case 'home':
        return (
          <HomeView
            onSelectMedia={handleSelectMedia}
            onAccentColorChange={setSelectedAccentColor}
            isCollapsed={isCollapsed}
          />
        );
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
            onAccentColorChange={setSelectedAccentColor}
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
        onAccentColorChange={setSelectedAccentColor}
        cardTransition={cardTransition?.mediaId === selectedMedia.id ? cardTransition : undefined}
        accentColorOverride={selectedAccentColor}
      />
    );
  };

  const hasUnderlyingGrid = Boolean(
    selectedMedia && ['movies', 'tv', 'games'].includes(activeTab)
  );
  const isGridTab = ['movies', 'tv', 'games'].includes(activeTab);

  const pageAccentColor = selectedMedia
    ? selectedAccentColor || selectedMedia.accent_color
    : activeTab === 'home'
      ? selectedAccentColor
      : undefined;

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
      />

      {/* Main View Area */}
      <main
        ref={mainViewRef}
        className={`relative isolate flex-1 transition-colors duration-350 ${
          isGridTab ? 'overflow-hidden' : 'overflow-y-auto'
        }`}
        style={{
          backgroundColor: !selectedMedia && activeTab === 'home'
            ? pageAccentColor || '#0c0d10'
            : '#0c0d10'
        }}
      >
        {cardTransition && (selectedMedia || activeTab !== 'home') && (
          <div
            key={cardTransition.mediaId}
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-0 will-change-[clip-path,opacity]"
            style={{
              backgroundColor: cardTransition.color,
              opacity: cardTransition.phase === 'preview'
                ? cardTransition.entered ? 0.46 : 0
                : cardTransition.phase === 'reveal' ? 0 : cardTransition.phase === 'commit' ? 1 : 0.46,
              clipPath: `circle(${cardTransition.phase === 'reverse' || !cardTransition.entered ? 0 : cardTransition.radius}px at ${cardTransition.centerX}px ${cardTransition.centerY}px)`,
              transition: cardTransition.phase === 'preview'
                ? 'clip-path 1150ms cubic-bezier(0.42, 0, 0.58, 1), opacity 450ms cubic-bezier(0.42, 0, 0.58, 1)'
                : cardTransition.phase === 'reverse'
                ? 'clip-path 16000ms cubic-bezier(0.42, 0, 0.58, 1), opacity 1600000ms ease-in-out'
                  : cardTransition.phase === 'commit'
                    ? 'clip-path 2100ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 2100ms ease-in-out'
                    : 'opacity 70ms ease-out'
            }}
          />
        )}
        {isGridTab ? (
          <div ref={gridScrollRef} className="absolute inset-0 z-0 overflow-y-auto">
            {hasUnderlyingGrid ? renderGridView() : renderActiveView()}
          </div>
        ) : (
          <div className="relative z-0">{renderActiveView()}</div>
        )}
        {hasUnderlyingGrid && (
          <div
            className="mdv-detail-scroll-container absolute inset-0 z-10 overflow-y-auto"
            onScroll={() => {
              if (cardTransition?.phase !== 'commit') return;

              clearTransitionTimer();
              if (transitionFrame.current !== null) {
                cancelAnimationFrame(transitionFrame.current);
                transitionFrame.current = null;
              }
              setCardTransition(current => current?.phase === 'commit' ? null : current);
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
    </div>
  );
}

export default App;
