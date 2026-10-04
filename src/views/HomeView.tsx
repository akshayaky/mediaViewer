import React from 'react';
import { HeroShowcase } from '../components/HeroShowcase';
import { MediaRail } from '../components/MediaRail';
import { Media } from '../types/media';
import { dbService } from '../services/DatabaseService';

interface HomeViewProps {
  onSelectMedia: (media: Media) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onSelectMedia }) => {
  const allMedia = dbService.getAllMedia();
  if (allMedia.length === 0) {
    return (
      <div className="p-8 text-center text-gray-400">
        <p>No media found in library.</p>
      </div>
    );
  }

  // Hero feature (Assassin's Creed IV or first item)
  const heroMedia = allMedia.find(m => m.title.includes("Assassin's Creed")) || allMedia[0];

  // Continue Watching/Playing (status === 'Currently')
  const continueWatching = allMedia.filter(m => {
    const state = dbService.getMediaState(m.id);
    return state.currently_watching_playing;
  });

  // Recently Watched / Played (Finished or history available)
  const recentlyWatched = allMedia.filter(m => {
    const history = dbService.getHistoryForMedia(m.id);
    return history.some(h => h.status === 'Finished');
  });

  // Rewatch candidates (rewatch_count > 0 or context includes rewatch)
  const rewatchCandidates = allMedia.filter(m => {
    const state = dbService.getMediaState(m.id);
    const history = dbService.getHistoryForMedia(m.id);
    return state.rewatch_count > 0 || history.some(h => h.context?.toLowerCase().includes('rewatch'));
  });

  // Paused / Abandoned
  const abandonedList = allMedia.filter(m => {
    const state = dbService.getMediaState(m.id);
    return state.current_status === 'Abandoned';
  });

  // Local Library Files
  const localFiles = dbService.getAllLocalFiles();
  const localMediaIds = new Set(localFiles.map(lf => lf.media_id));
  const localLibraryList = allMedia.filter(m => localMediaIds.has(m.id));

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
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
