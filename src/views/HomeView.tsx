import React, { useEffect, useState } from 'react';
import { HeroShowcase } from '../components/HeroShowcase';
import { MediaRail } from '../components/MediaRail';
import { Media } from '../types/media';
import { dbService } from '../services/DatabaseService';

interface HomeViewProps {
  onSelectMedia: (media: Media) => void,
  isCollapsed?: boolean;
}

export const HomeView: React.FC<HomeViewProps> = ({
   onSelectMedia,
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
  if (allMedia.length === 0) {
    return (
      <div className="p-8 text-center text-gray-400">
        <p>No media found in library.</p>
      </div>
    );
  }

  // Hero feature (Assassin's Creed IV or first item)
  const heroMedia = allMedia.find(m => m.title.includes("Assassin's Creed")) || allMedia[0];

  return (
    <div className="p-8 space-y-6 mx-auto"
    style={{ paddingLeft: isCollapsed ? '6rem' : '18rem' }}>
      {/* Featured Hero Banner */}
      <HeroShowcase media={heroMedia} onSelectMedia={onSelectMedia} />

      {/* Media Rails */}
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
  );
};
