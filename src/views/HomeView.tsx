import React, { useEffect, useState } from 'react';
import { HeroShowcase } from '../components/HeroShowcase';
import { MediaRail } from '../components/MediaRail';
import { Media } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { getAccentRgb } from '../helper/mediaDetailTheme';
import { useDominantColor } from '../helper/useDominantColour';

interface HomeViewProps {
  onSelectMedia: (media: Media) => void,
  onAccentColorChange: (color?: string) => void,
  isCollapsed?: boolean;
}

export const HomeView: React.FC<HomeViewProps> = ({
   onSelectMedia,
   onAccentColorChange,
   isCollapsed
  }) => {
  const [homeData, setHomeData] = useState<{
    allMedia: Media[];
    continueWatching: Media[];
    recentlyWatched: Media[];
    rewatchCandidates: Media[];
    abandonedList: Media[];
    localLibraryList: Media[];
  }>({ allMedia: [], continueWatching: [], recentlyWatched: [], rewatchCandidates: [], abandonedList: [], localLibraryList: [] });

  useEffect(() => {
    let isMounted = true;
    const loadHomeData = async () => {
      const [allMedia, allHistory, localFiles] = await Promise.all([
        dbService.getAllMedia(),
        dbService.getAllHistory(),
        dbService.getAllLocalFiles()
      ]);
      const states = await Promise.all(allMedia.map(media => dbService.getMediaState(media.id)));
      const stateById = new Map(states.map(mediaState => [mediaState.media_id, mediaState]));
      const historyByMediaId = new Map<string, typeof allHistory>();
      for (const history of allHistory) {
        const histories = historyByMediaId.get(history.media_id) || [];
        histories.push(history);
        historyByMediaId.set(history.media_id, histories);
      }
      const localMediaIds = new Set(localFiles.map(file => file.media_id));
      if (!isMounted) return;
      setHomeData({
        allMedia,
        continueWatching: allMedia.filter(media => stateById.get(media.id)?.currently_watching_playing),
        recentlyWatched: allMedia.filter(media => historyByMediaId.get(media.id)?.some(history => history.status === 'Finished')),
        rewatchCandidates: allMedia.filter(media =>
          (stateById.get(media.id)?.rewatch_count || 0) > 0 ||
          historyByMediaId.get(media.id)?.some(history => history.context?.toLowerCase().includes('rewatch'))
        ),
        abandonedList: allMedia.filter(media => stateById.get(media.id)?.current_status === 'Abandoned'),
        localLibraryList: allMedia.filter(media => localMediaIds.has(media.id))
      });
    };
    const handleLibraryUpdate = () => { void loadHomeData(); };
    void loadHomeData().catch(err => console.error('Failed to load home view:', err));
    window.addEventListener('library-scanned', handleLibraryUpdate);
    return () => {
      isMounted = false;
      window.removeEventListener('library-scanned', handleLibraryUpdate);
    };
  }, []);

  const { allMedia, continueWatching, recentlyWatched, rewatchCandidates, abandonedList, localLibraryList } = homeData;
  const heroMedia = allMedia.find(m => m.title.includes("Ted Lasso")) || allMedia[0];
  const dominantColor = useDominantColor(heroMedia?.backdrop || heroMedia?.poster);
  const heroAccentColor = heroMedia?.accent_color || (
    dominantColor ? `rgb(${dominantColor.join(', ')})` : '#e11d48'
  );
  useEffect(() => {
    onAccentColorChange(heroMedia ? heroAccentColor : undefined);
  }, [heroAccentColor, heroMedia, onAccentColorChange]);

  if (allMedia.length === 0) {
    return (
      <div className="p-8 text-center text-gray-400">
        <p>No media found in library.</p>
      </div>
    );
  }

  const homeStyle = {
    '--hero-accent': heroAccentColor,
    '--hero-accent-rgb': getAccentRgb(heroAccentColor),
    backgroundColor: heroAccentColor
  } as React.CSSProperties;

  return (
    <div className="min-h-full space-y-6 mx-auto"
    style={{
      ...homeStyle,
      backgroundImage: 'radial-gradient(ellipse 85% 48% at 50% 0%, rgba(var(--hero-accent-rgb), 0.11), transparent 78%)'
    }}>
      {/* Featured Hero Banner */}
      <HeroShowcase
        media={heroMedia}
        onSelectMedia={onSelectMedia}
        accentColor={heroAccentColor}
        contentPaddingLeft={isCollapsed ? '6rem' : '18rem'}
      />

      {/* Media Rails */}
      <div className="space-y-6 px-8 pb-8" style={{ paddingLeft: isCollapsed ? '6rem' : '18rem' }}>
        <MediaRail
          title="Continue Watching / Playing"
          subtitle="Pick up where you left off"
          items={continueWatching}
          onSelectMedia={onSelectMedia}
        />

        <MediaRail
          title="Recently Completed"
          subtitle="Your latest logged watches and plays"
          items={recentlyWatched}
          onSelectMedia={onSelectMedia}
        />

        <MediaRail
          title="Rewatch Candidates"
          subtitle="Personal favorites revisited multiple times"
          items={rewatchCandidates}
          onSelectMedia={onSelectMedia}
        />

        <MediaRail
          title="Local Library Files"
          subtitle="Detected media files on local system"
          items={localLibraryList}
          onSelectMedia={onSelectMedia}
        />

        <MediaRail
          title="Paused & Abandoned"
          subtitle="Sessions currently on hold"
          items={abandonedList}
          onSelectMedia={onSelectMedia}
        />
      </div>
    </div>
  );
};
