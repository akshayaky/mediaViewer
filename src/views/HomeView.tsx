import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HeroShowcase } from '../components/HeroShowcase';
import { MediaRail } from '../components/MediaRail';
import { Media, MediaCardOrientation, MediaHistory, MediaState } from '../types/media';
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
  onPlayMedia: (media: Media) => void;
  onAccentColorChange: (color?: string) => void;
  isCollapsed?: boolean;
}

export const HomeView: React.FC<HomeViewProps> = ({
   onSelectMedia,
   onPlayMedia,
   onAccentColorChange,
   isCollapsed
  }) => {
  const { pagePadding } = useSidebarPadding(isCollapsed);
  const [heroData, setHeroData] = useState<{
    media: Media[];
    history: MediaHistory[];
    states: MediaState[];
    hasMedia: boolean;
    loaded: boolean;
    loadError: boolean;
  }>({ media: [], history: [], states: [], hasMedia: false, loaded: false, loadError: false });
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [cardOrientationByType, setCardOrientationByType] = useState<Partial<Record<Media['type'], MediaCardOrientation>>>({});

  useEffect(() => {
    const handleLibraryUpdate = () => setLibraryRevision(revision => revision + 1);
    window.addEventListener('library-scanned', handleLibraryUpdate);
    return () => {
      window.removeEventListener('library-scanned', handleLibraryUpdate);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    dbService.getSettings().then(settings => {
      if (!isMounted) return;
      setCardOrientationByType(settings.ui_preferences?.card_orientation_by_type || {});
    }).catch(error => console.error('Failed to load home card preferences:', error));
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    let isMounted = true;
    setHeroData(current => ({ ...current, loaded: false, loadError: false }));
    dbService.getHomeHeroData()
      .then(data => {
        if (!isMounted) return;
        setHeroData({
          media: data.entries.map(entry => entry.media),
          history: data.entries.flatMap(entry => entry.history),
          states: data.entries.map(entry => entry.state),
          hasMedia: data.hasMedia,
          loaded: true,
          loadError: false
        });
      })
      .catch(error => {
        console.error('Failed to load home hero data:', error);
        if (isMounted) setHeroData(current => ({ ...current, loaded: true, loadError: true }));
      });
    return () => { isMounted = false; };
  }, [libraryRevision]);

  const heroItems = useMemo(
    () => getHeroCandidates(heroData.media, heroData.history, heroData.states),
    [heroData.media, heroData.history, heroData.states]
  );
  const loadContinue = useCallback((offset: number, limit: number) =>
    dbService.getHomeRailPage('continue', limit, offset), []);
  const loadRecent = useCallback((offset: number, limit: number) =>
    dbService.getHomeRailPage('recent', limit, offset), []);
  const loadRewatch = useCallback((offset: number, limit: number) =>
    dbService.getHomeRailPage('rewatch', limit, offset), []);
  const loadLocal = useCallback((offset: number, limit: number) =>
    dbService.getHomeRailPage('local', limit, offset), []);
  const loadAbandoned = useCallback((offset: number, limit: number) =>
    dbService.getHomeRailPage('abandoned', limit, offset), []);
  const [activeHeroId, setActiveHeroId] = useState<string>();
  const hasInitializedHeroAccent = useRef(false);
  const activeHero = heroItems.find(media => media.id === activeHeroId) || heroItems[0];
  const activeHeroIndex = Math.max(0, heroItems.findIndex(media => media.id === activeHero?.id));
  const previousHero = heroItems.length > 1
    ? heroItems[(activeHeroIndex - 1 + heroItems.length) % heroItems.length]
    : undefined;
  const nextHero = heroItems.length > 1
    ? heroItems[(activeHeroIndex + 1) % heroItems.length]
    : undefined;
  const dominantColor = useDominantColor(activeHero?.backdrop);
  const previousDominantColor = useDominantColor(previousHero?.backdrop);
  const nextDominantColor = useDominantColor(nextHero?.backdrop);
  const heroAccentColor = activeHero?.accent_color || (
    dominantColor ? `rgb(${dominantColor.join(', ')})` : '#E27D12'
  );
  const handleActiveHeroChange = useCallback((media: Media) => {
    setActiveHeroId(current => current === media.id ? current : media.id);
  }, []);
  const handleHeroSwipeAccentChange = useCallback((target: Media | null, progress: number) => {
    const root = document.documentElement;
    if (!target) {
      root.style.setProperty('--hero-accent', heroAccentColor);
      root.style.setProperty('--hero-accent-rgb', getAccentRgb(heroAccentColor));
      root.style.setProperty('--hero-accent-light', `color-mix(in srgb, ${heroAccentColor}, white 20%)`);
      onAccentColorChange(heroAccentColor);
      return;
    }

    const targetRgb = target.id === previousHero?.id
      ? previousDominantColor
      : target.id === nextHero?.id
        ? nextDominantColor
        : null;
    const targetColor = target.accent_color || (
      targetRgb ? `rgb(${targetRgb.join(', ')})` : heroAccentColor
    );
    const from = parseColor(heroAccentColor);
    const to = parseColor(targetColor);
    if (!from || !to) return;

    const color = `rgb(${from.map((channel, index) =>
      Math.round(channel + (to[index] - channel) * progress)
    ).join(', ')})`;
    root.style.setProperty('--hero-accent', color);
    root.style.setProperty('--hero-accent-rgb', getAccentRgb(color));
    root.style.setProperty('--hero-accent-light', `color-mix(in srgb, ${color}, white 20%)`);
    onAccentColorChange(color);
  }, [heroAccentColor, nextDominantColor, nextHero?.id, onAccentColorChange, previousDominantColor, previousHero?.id]);

  useEffect(() => {
    if (!activeHero) {
      onAccentColorChange(undefined);
      return;
    }
    if (!activeHero.accent_color && !dominantColor) return;

    const root = document.documentElement;
    if (!hasInitializedHeroAccent.current) {
      hasInitializedHeroAccent.current = true;
      root.style.setProperty('--hero-accent', heroAccentColor);
      root.style.setProperty('--hero-accent-rgb', getAccentRgb(heroAccentColor));
      root.style.setProperty('--hero-accent-light', `color-mix(in srgb, ${heroAccentColor}, white 20%)`);
      onAccentColorChange(heroAccentColor);
      return;
    }

    const currentAccent = getComputedStyle(root).getPropertyValue('--hero-accent').trim() || '#E27D12';
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
      onAccentColorChange(color);
      if (progress < 1) {
        frame = requestAnimationFrame(animate);
      } else {
        onAccentColorChange(heroAccentColor);
      }
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [activeHero, dominantColor, heroAccentColor, onAccentColorChange]);

  if (heroData.loaded && !heroData.hasMedia && !heroData.loadError) {
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
      {heroData.loadError && (
        <p role="alert" className="px-4 pt-4 text-sm text-gray-400">
          Featured media could not be loaded.
        </p>
      )}
      {/* Featured Hero Banner */}
      {activeHero && (
        <HeroShowcase
          media={activeHero}
          mediaItems={heroItems}
          onActiveMediaChange={handleActiveHeroChange}
          onSwipeAccentChange={handleHeroSwipeAccentChange}
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
          key={`continue-${libraryRevision}`}
          title="Continue Watching / Playing"
          subtitle="Pick up where you left off"
          loadPage={loadContinue}
          onSelectMedia={onSelectMedia}
          onPlayMedia={onPlayMedia}
          forceLandscape
        />

        <MediaRail
          key={`recent-${libraryRevision}`}
          title="Recently Completed"
          subtitle="Your latest logged watches and plays"
          loadPage={loadRecent}
          onSelectMedia={onSelectMedia}
          onPlayMedia={onPlayMedia}
          cardOrientationByType={cardOrientationByType}
        />

        <MediaRail
          key={`rewatch-${libraryRevision}`}
          title="Rewatch Candidates"
          subtitle="Personal favorites revisited multiple times"
          loadPage={loadRewatch}
          onSelectMedia={onSelectMedia}
          onPlayMedia={onPlayMedia}
          cardOrientationByType={cardOrientationByType}
        />

        <MediaRail
          key={`local-${libraryRevision}`}
          title="Local Library Files"
          subtitle="Detected media files on local system"
          loadPage={loadLocal}
          onSelectMedia={onSelectMedia}
          onPlayMedia={onPlayMedia}
          cardOrientationByType={cardOrientationByType}
        />

        <MediaRail
          key={`abandoned-${libraryRevision}`}
          title="Paused & Abandoned"
          subtitle="Sessions currently on hold"
          loadPage={loadAbandoned}
          onSelectMedia={onSelectMedia}
          onPlayMedia={onPlayMedia}
          cardOrientationByType={cardOrientationByType}
        />
      </div>
      </div>
    </div>
  );
};
