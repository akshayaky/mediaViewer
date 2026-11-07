import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { HeroShowcase } from '../components/HeroShowcase';
import { MediaRail } from '../components/MediaRail';
import { Media, MediaHistory, MediaState, UiPreferences } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { getAccentRgb, parseColor } from '../helper/mediaDetailTheme';
import { useDominantColor } from '../helper/useDominantColour';
import { useSidebarPadding } from '../hooks/useSidebarPadding';

interface HeroCandidate {
  media: Media;
  priority: number;
  activityTime: number;
}

function getFranchiseKey(title: string): string {
  const primaryTitle = title.split(/[:|–—]/, 1)[0];
  return primaryTitle
    .toLowerCase()
    .replace(/\b(part|volume|vol|season|episode)\s+(i{1,3}|iv|v|\d+)\b/g, '')
    .replace(/\s+\d+$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getHeroCandidates(
  mediaList: Media[],
  history: MediaHistory[],
  states: MediaState[]
): Media[] {
  const now = Date.now();
  const recentAddWindow = 90 * 24 * 60 * 60 * 1000;
  const recentActivityWindow = 30 * 24 * 60 * 60 * 1000;
  const historyByMediaId = new Map<string, MediaHistory[]>();
  history.forEach(entry => {
    const entries = historyByMediaId.get(entry.media_id) || [];
    entries.push(entry);
    historyByMediaId.set(entry.media_id, entries);
  });
  const stateByMediaId = new Map(states.map(state => [state.media_id, state]));
  const candidates: HeroCandidate[] = [];

  for (const media of mediaList) {
    const backdrop = media.backdrop?.trim();
    if (!backdrop || backdrop.length < 8 || backdrop === media.poster?.trim()) continue;

    const entries = historyByMediaId.get(media.id) || [];
    const latestEntry = entries.reduce<MediaHistory | undefined>((latest, entry) => {
      if (!latest) return entry;
      const entryTime = new Date(entry.completed_at || entry.started_at || entry.created_at).getTime();
      const latestTime = new Date(latest.completed_at || latest.started_at || latest.created_at).getTime();
      return entryTime > latestTime ? entry : latest;
    }, undefined);
    const ratedHighly = entries.some(entry => (entry.score || 0) >= 4);

    const latestActivityTime = latestEntry
      ? new Date(latestEntry.completed_at || latestEntry.started_at || latestEntry.created_at).getTime()
      : 0;
    const isRecentlyAdded = now - new Date(media.created_at).getTime() <= recentAddWindow;
    const isRecentlyPlayed = now - latestActivityTime <= recentActivityWindow;
    let priority = 5;
    if (stateByMediaId.get(media.id)?.currently_watching_playing) {
      priority = 0;
    } else if (latestEntry && isRecentlyPlayed &&
      ['Currently', 'Watched Episode', 'Finished'].includes(latestEntry.status)) {
      priority = 1;
    } else if (isRecentlyAdded) {
      priority = 2;
    }

    if (latestEntry?.status === 'Finished') priority = Math.min(priority, 3);
    if (ratedHighly) priority = Math.min(priority, 4);

    candidates.push({
      media,
      priority,
      activityTime: latestActivityTime || new Date(media.created_at).getTime() || 0
    });
  }

  candidates.sort((a, b) =>
    a.priority - b.priority ||
    b.activityTime - a.activityTime ||
    a.media.id.localeCompare(b.media.id)
  );

  const selected: HeroCandidate[] = [];
  const franchises = new Set<string>();
  const typeCounts = new Map<Media['type'], number>();
  for (const candidate of candidates) {
    const franchise = getFranchiseKey(candidate.media.title);
    const typeCount = typeCounts.get(candidate.media.type) || 0;
    if (franchises.has(franchise) || typeCount >= 2) continue;

    selected.push(candidate);
    franchises.add(franchise);
    typeCounts.set(candidate.media.type, typeCount + 1);
    if (selected.length === 6) break;
  }

  return selected.map(candidate => candidate.media);
}

interface HomeViewProps {
  onSelectMedia: (media: Media, clickedCardRect?: DOMRect) => void;
  onAccentColorChange: (color?: string) => void;
  isCollapsed?: boolean;
}

export const HomeView: React.FC<HomeViewProps> = ({
   onSelectMedia,
   onAccentColorChange,
   isCollapsed
  }) => {
  const { pagePadding } = useSidebarPadding(isCollapsed);
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>({
    card_orientation_by_type: {}
  });

  const [homeData, setHomeData] = useState<{
    allMedia: Media[];
    allHistory: MediaHistory[];
    mediaStates: MediaState[];
    continueWatching: Media[];
    recentlyWatched: Media[];
    rewatchCandidates: Media[];
    abandonedList: Media[];
    localLibraryList: Media[];
  }>({ allMedia: [], allHistory: [], mediaStates: [], continueWatching: [], recentlyWatched: [], rewatchCandidates: [], abandonedList: [], localLibraryList: [] });

  useEffect(() => {
    let isMounted = true;
    dbService.getSettings()
      .then(settings => {
        if (isMounted) setUiPreferences(settings.ui_preferences || { card_orientation_by_type: {} });
      })
      .catch(error => console.error('Failed to load home UI preferences:', error));

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
        allHistory,
        mediaStates: states,
        continueWatching: allMedia.filter(media => stateById.get(media.id)?.currently_watching_playing),
        recentlyWatched: allMedia.filter(media => historyByMediaId.get(media.id)?.some(history =>
          history.status === 'Finished' || history.status === 'Watched Episode'
        )),
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

  const { allMedia, allHistory, mediaStates, continueWatching, recentlyWatched, rewatchCandidates, abandonedList, localLibraryList } = homeData;
  const heroItems = useMemo(
    () => getHeroCandidates(allMedia, allHistory, mediaStates),
    [allMedia, allHistory, mediaStates]
  );
  const [activeHeroId, setActiveHeroId] = useState<string>();
  const activeHero = heroItems.find(media => media.id === activeHeroId) || heroItems[0];
  const dominantColor = useDominantColor(activeHero?.backdrop);
  const heroAccentColor = activeHero?.accent_color || (
    dominantColor ? `rgb(${dominantColor.join(', ')})` : '#e11d48'
  );
  const handleActiveHeroChange = useCallback((media: Media) => {
    setActiveHeroId(current => current === media.id ? current : media.id);
  }, []);

  useEffect(() => {
    if (!activeHero) {
      onAccentColorChange(undefined);
      return;
    }

    const root = document.documentElement;
    const currentAccent = getComputedStyle(root).getPropertyValue('--hero-accent').trim() || '#e11d48';
    const from = parseColor(currentAccent);
    const to = parseColor(heroAccentColor);
    if (!from || !to) {
      root.style.setProperty('--hero-accent', heroAccentColor);
      root.style.setProperty('--hero-accent-rgb', getAccentRgb(heroAccentColor));
      root.style.setProperty('--hero-accent-light', `color-mix(in srgb, ${heroAccentColor}, white 20%)`);
      onAccentColorChange(heroAccentColor);
      return;
    }

    const startTime = performance.now();
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 850;
    let frame = 0;
    const animate = (now: number) => {
      const progress = duration ? Math.min((now - startTime) / duration, 1) : 1;
      const eased = 1 - (1 - progress) ** 3;
      const color = `rgb(${from.map((channel, index) =>
        Math.round(channel + (to[index] - channel) * eased)
      ).join(', ')})`;
      root.style.setProperty('--hero-accent', color);
      root.style.setProperty('--hero-accent-rgb', getAccentRgb(color));
      root.style.setProperty('--hero-accent-light', `color-mix(in srgb, ${color}, white 20%)`);
      if (progress < 1) {
        frame = requestAnimationFrame(animate);
      } else {
        onAccentColorChange(heroAccentColor);
      }
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [activeHero?.id, heroAccentColor, onAccentColorChange]);

  if (allMedia.length === 0) {
    return (
      <div className="p-8 text-center text-gray-400">
        <p>No media found in library.</p>
      </div>
    );
  }

  return (
    <div
      className="min-h-full space-y-6 mx-auto"
    style={{
      backgroundImage: 'radial-gradient(ellipse 85% 48% at 50% 0%, rgba(var(--hero-accent-rgb), 0.11), transparent 78%)'
    }}>
      <div className="relative z-10 space-y-6">
      {/* Featured Hero Banner */}
      {activeHero && (
        <HeroShowcase
          media={activeHero}
          mediaItems={heroItems}
          onActiveMediaChange={handleActiveHeroChange}
          onSelectMedia={onSelectMedia}
          contentPaddingLeft={pagePadding}
        />
      )}

      {/* Media Rails */}
      <div
        className="space-y-6 px-4 sm:px-8 pb-24 md:pb-8 transition-all duration-300"
        style={{
          paddingLeft: pagePadding
        }}
      >
        <MediaRail
          title="Continue Watching / Playing"
          subtitle="Pick up where you left off"
          items={continueWatching}
          onSelectMedia={onSelectMedia}
          cardOrientation={uiPreferences.home_card_orientation || 'landscape'}
        />

        <MediaRail
          title="Recently Completed"
          subtitle="Your latest logged watches and plays"
          items={recentlyWatched}
          onSelectMedia={onSelectMedia}
          cardOrientation={uiPreferences.home_card_orientation || 'landscape'}
        />

        <MediaRail
          title="Rewatch Candidates"
          subtitle="Personal favorites revisited multiple times"
          items={rewatchCandidates}
          onSelectMedia={onSelectMedia}
          cardOrientation={uiPreferences.home_card_orientation || 'landscape'}
        />

        <MediaRail
          title="Local Library Files"
          subtitle="Detected media files on local system"
          items={localLibraryList}
          onSelectMedia={onSelectMedia}
          cardOrientation={uiPreferences.home_card_orientation || 'landscape'}
        />

        <MediaRail
          title="Paused & Abandoned"
          subtitle="Sessions currently on hold"
          items={abandonedList}
          onSelectMedia={onSelectMedia}
          cardOrientation={uiPreferences.home_card_orientation || 'landscape'}
        />
      </div>
      </div>
    </div>
  );
};
