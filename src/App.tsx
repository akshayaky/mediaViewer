import { useState, useEffect } from 'react';
import { Sidebar, NavTab } from './components/Sidebar';
import { HomeView } from './views/HomeView';
import { MediaGridView } from './views/MediaGridView';
import { MediaDetailView } from './views/MediaDetailView';
import { WishlistView } from './views/WishlistView';
import { HistoryView } from './views/HistoryView';
import { SettingsView } from './views/SettingsView';
import { UnmatchedInboxView } from './views/UnmatchedInboxView';
import { dbService } from './services/DatabaseService';
// import { seedDatabaseIfEmpty } from './services/seedData';
import { Media } from './types/media';

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [selectedMedia, setSelectedMedia] = useState<Media | null>(null);
  const [selectedAccentColor, setSelectedAccentColor] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    async function initApp() {
      try {
        await dbService.init();
        //await seedDatabaseIfEmpty();
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
    setSelectedAccentColor(media.accent_color);
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
        return <HomeView 
        onSelectMedia={handleSelectMedia}
        isCollapsed={isCollapsed}
         />;
      case 'movies':
        return (
          <MediaGridView
            typeFilter="Film"
            title="Movies & Films"
            subtitle="Explore your personal feature film library"
            onSelectMedia={handleSelectMedia}
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
        return <HomeView onSelectMedia={handleSelectMedia} />;
    }
  };

  return (
    <div className="flex h-screen bg-[#0c0d10] text-gray-100 font-sans overflow-hidden">
      {/* Navigation Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        isCollapsed={isCollapsed}
        setIsCollapsed={setIsCollapsed}
        accentColor={selectedMedia ? selectedAccentColor || selectedMedia.accent_color : undefined}
      />

      {/* Main View Area */}
      <main className="flex-1 overflow-y-auto bg-[#0c0d10]">
        {renderActiveView()}
      </main>
    </div>
  );
}

export default App;
