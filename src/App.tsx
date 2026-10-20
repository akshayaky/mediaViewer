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
import { seedDatabaseIfEmpty } from './services/seedData';
import { Media } from './types/media';

interface CardTransitionState {
  mediaId: string;
  color: string;
  centerX: number;
  centerY: number;
  radius: number;
  phase: 'preview' | 'reverse' | 'commit' | 'reveal';
  entered: boolean;
}

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [selectedMedia, setSelectedMedia] = useState<Media | null>(null);
  const [selectedAccentColor, setSelectedAccentColor] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [cardTransition, setCardTransition] = useState<CardTransitionState | null>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const handlePreviewStart = (media: Media, rect: DOMRect) => {
    clearTransitionTimer();
    clearPreviewStartTimer();
    if (transitionFrame.current !== null) cancelAnimationFrame(transitionFrame.current);

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = Math.min(99060, Math.hypot(
      Math.max(centerX, window.innerWidth - centerX),
      Math.max(centerY, window.innerHeight - centerY)
    ) * 0.99);

    setCardTransition({
      mediaId: media.id,
      color: media.accent_color || '#e11d48',
      centerX,
      centerY,
      radius,
      phase: 'preview',
      entered: false
    });
    previewStartTimer.current = setTimeout(() => {
      setCardTransition(current => current?.mediaId === media.id && current.phase === 'preview'
        ? { ...current, entered: true }
        : current);
      previewStartTimer.current = null;
    }, 34);
  };

  const handlePreviewEnd = () => {
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
    clearPreviewStartTimer();
    if (transitionFrame.current !== null) cancelAnimationFrame(transitionFrame.current);
  }, []);

  useEffect(() => {
    async function initApp() {
      try {
        await dbService.init();
        await seedDatabaseIfEmpty();
      } catch (err) {
        console.error('Failed to initialize database:', err);
      } finally {
        setIsLoading(false);
      }
    }
    initApp();
  }, []);

  const handleSelectTab = (tab: NavTab) => {
    setActiveTab(tab);
    setSelectedMedia(null);
    setSelectedAccentColor(undefined);
  };

  const handleSelectMedia = (media: Media) => {
    setSelectedMedia(media);
    setSelectedAccentColor(media.accent_color || (
      cardTransition?.mediaId === media.id ? cardTransition.color : undefined
    ));
    if (cardTransition?.mediaId !== media.id || cardTransition.phase === 'reverse') return;

    clearTransitionTimer();
    clearPreviewStartTimer();
    if (transitionFrame.current !== null) {
      cancelAnimationFrame(transitionFrame.current);
      transitionFrame.current = null;
    }
    setCardTransition(current => current?.mediaId === media.id
      ? { ...current, phase: 'commit', entered: true }
      : current);
    transitionTimer.current = setTimeout(() => {
      setCardTransition(current => current?.mediaId === media.id
        ? { ...current, phase: 'reveal' }
        : current);
      transitionTimer.current = setTimeout(() => {
        setCardTransition(current => current?.mediaId === media.id ? null : current);
        transitionTimer.current = null;
      }, 70);
    }, 170);
  };

  const handleBackToTab = () => {
    setSelectedMedia(null);
    setSelectedAccentColor(undefined);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0c0d10] flex items-center justify-center text-white font-sans">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-12 h-12 border-4 border-rose-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-semibold tracking-wider text-rose-400 uppercase">
            Initializing Media Library...
          </p>
        </div>
      </div>
    );
  }

  const renderActiveView = () => {
    if (selectedMedia) {
      return (
        <MediaDetailView
          media={selectedMedia}
          onBack={handleBackToTab}
          isSidebarCollapsed={isCollapsed}
          onAccentColorChange={setSelectedAccentColor}
        />
      );
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
        return (
          <MediaGridView
            typeFilter="Film"
            title="Movies & Films"
            subtitle="Explore your personal feature film library"
            onSelectMedia={handleSelectMedia}
            onPreviewStart={handlePreviewStart}
            onPreviewEnd={handlePreviewEnd}
            isCollapsed={isCollapsed}
          />
        );
      case 'tv':
        return (
          <MediaGridView
            typeFilter="TV Series"
            title="TV Shows & Series"
            subtitle="Track your watched seasons, episodes, and series history"
            onSelectMedia={handleSelectMedia}
            onPreviewStart={handlePreviewStart}
            onPreviewEnd={handlePreviewEnd}
            isCollapsed={isCollapsed}
          />
        );
      case 'games':
        return (
          <MediaGridView
            typeFilter="VideoGame"
            title="Video Games"
            subtitle="Catalog and history of PC, console, and handheld games"
            onSelectMedia={handleSelectMedia}
            onPreviewStart={handlePreviewStart}
            onPreviewEnd={handlePreviewEnd}
            isCollapsed={isCollapsed}
          />
        );
      case 'wishlist':
        return <WishlistView />;
      case 'history':
        return <HistoryView onSelectMedia={handleSelectMedia} />;
      case 'inbox':
        return <UnmatchedInboxView onMediaMatched={() => {}} />;
      case 'settings':
        return <SettingsView />;
      default:
        return (
          <HomeView
            onSelectMedia={handleSelectMedia}
            onAccentColorChange={setSelectedAccentColor}
          />
        );
    }
  };

  const pageAccentColor = selectedMedia
    ? selectedAccentColor || selectedMedia.accent_color
    : activeTab === 'home'
      ? selectedAccentColor
      : undefined;

  return (
    <div className="flex h-screen bg-[#0c0d10] text-gray-100 font-sans overflow-hidden">
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
        className="relative isolate flex-1 overflow-y-auto transition-colors duration-350"
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
                : cardTransition.phase === 'reverse' ? 0.46 : cardTransition.phase === 'reveal' ? 0 : 0.46,
              clipPath: `circle(${cardTransition.phase === 'reverse' || (cardTransition.phase === 'preview' && !cardTransition.entered) ? 0 : cardTransition.radius}px at ${cardTransition.centerX}px ${cardTransition.centerY}px)`,
              transition: cardTransition.phase === 'preview'
                ? 'clip-path 1150ms cubic-bezier(0.42, 0, 0.58, 1), opacity 450ms cubic-bezier(0.42, 0, 0.58, 1)'
                : cardTransition.phase === 'reverse'
                ? 'clip-path 160ms cubic-bezier(0.42, 0, 0.58, 1), opacity 160ms ease-in-out'
                  : cardTransition.phase === 'commit'
                    ? 'clip-path 170ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 170ms ease-in-out'
                    : 'opacity 70ms ease-out'
            }}
          />
        )}
        <div className="relative z-10">
          {renderActiveView()}
        </div>
      </main>
    </div>
  );
}

export default App;
