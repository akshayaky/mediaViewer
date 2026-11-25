import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Media, MediaCardOrientation, MediaType, SelectMediaOptions } from '../types/media';
import type { HomeRailPage } from '../services/DatabaseService';
import { getLastWatchedEpisodeArtwork } from '../helper/episodeProgress';
import { getMediaCardWidth } from '../helper/mediaCardSizing';
import { HorizontalDragScroll } from './HorizontalDragScroll';
import { MediaCard } from './MediaCard';

const PAGE_SIZE = 12;

interface MediaRailProps {
  title: string;
  subtitle?: string;
  loadPage: (offset: number, limit: number) => Promise<HomeRailPage>;
  onSelectMedia: (media: Media, clickedCardRect?: DOMRect, options?: SelectMediaOptions) => void;
  onPlayMedia: (media: Media) => void;
  cardOrientation?: MediaCardOrientation;
  forceLandscape?: boolean;
  cardOrientationByType?: Partial<Record<MediaType, MediaCardOrientation>>;
  onPreviewStart?: (media: Media, rect: DOMRect) => void;
  onPreviewEnd?: () => void;
  revision?: number;
}

export const MediaRail: React.FC<MediaRailProps> = ({
  title,
  subtitle,
  loadPage,
  onSelectMedia,
  onPlayMedia,
  cardOrientation,
  forceLandscape = false,
  cardOrientationByType = {},
  onPreviewStart,
  onPreviewEnd,
  revision = 0
}) => {
  const sectionRef = useRef<HTMLElement>(null);
  const entriesRef = useRef<HomeRailPage['entries']>([]);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const prevRevisionRef = useRef(revision);
  const requestIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentScrollLeftRef = useRef(0);
  const savedScrollLeft = useRef(0);
  const needsScrollRestore = useRef(false);
  const [entries, setEntries] = useState<HomeRailPage['entries']>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadNextPage = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setLoadError(false);
    const requestId = ++requestIdRef.current;
    try {
      const page = await loadPage(entriesRef.current.length, PAGE_SIZE);
      if (requestId !== requestIdRef.current) return;
      const nextEntries = [...entriesRef.current, ...page.entries];
      entriesRef.current = nextEntries;
      hasMoreRef.current = page.hasMore;
      setEntries(nextEntries);
      setHasMore(page.hasMore);
      setHasLoaded(true);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      console.error(`Failed to load ${title} media rail:`, error);
      setLoadError(true);
      setHasLoaded(true);
      hasMoreRef.current = false;
      setHasMore(false);
    } finally {
      if (requestId === requestIdRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [loadPage, title]);

  // Soft-reload when library revision bumps: re-fetch all currently loaded items
  // in one query to prevent the container from collapsing and clamping scrollLeft.
  useEffect(() => {
    if (prevRevisionRef.current === revision) return;
    prevRevisionRef.current = revision;

    // Save scroll position before reload
    const currentScroll = scrollRef.current?.scrollLeft ?? currentScrollLeftRef.current;
    savedScrollLeft.current = currentScroll;
    needsScrollRestore.current = true;

    // Fetch at least the number of items currently loaded so scroll width is preserved
    const countToLoad = Math.max(PAGE_SIZE, entriesRef.current.length);
    const requestId = ++requestIdRef.current;
    loadingRef.current = true;
    setLoading(true);
    setLoadError(false);

    loadPage(0, countToLoad)
      .then(page => {
        if (requestId !== requestIdRef.current) return;
        entriesRef.current = page.entries;
        hasMoreRef.current = page.hasMore;
        setEntries(page.entries);
        setHasMore(page.hasMore);
        setHasLoaded(true);
      })
      .catch(error => {
        if (requestId !== requestIdRef.current) return;
        console.error(`Failed to reload ${title} media rail:`, error);
        setLoadError(true);
        needsScrollRestore.current = false;
      })
      .finally(() => {
        if (requestId === requestIdRef.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      });
  }, [revision, loadPage, title]);

  // After fresh entries render, restore the saved scroll position before paint
  useLayoutEffect(() => {
    if (!needsScrollRestore.current || !scrollRef.current) return;
    needsScrollRestore.current = false;
    const el = scrollRef.current;
    const max = el.scrollWidth - el.clientWidth;
    el.scrollLeft = Math.min(savedScrollLeft.current, max);
    currentScrollLeftRef.current = el.scrollLeft;
  }, [entries]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if (!('IntersectionObserver' in window)) {
      void loadNextPage();
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      void loadNextPage();
    }, { rootMargin: '500px 0px' });
    observer.observe(section);
    return () => observer.disconnect();
  }, [loadNextPage]);

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    currentScrollLeftRef.current = target.scrollLeft;
    if (target.scrollWidth - target.scrollLeft - target.clientWidth < 350) {
      void loadNextPage();
    }
  }, [loadNextPage]);

  if (hasLoaded && entries.length === 0 && !loading) return null;

  const isLandscapeRail = forceLandscape || cardOrientation === 'landscape';

  return (
    <section
      ref={sectionRef}
      className={`space-y-3 ${entries.length === 0 ? (isLandscapeRail ? 'min-h-[140px]' : 'min-h-[240px]') : ''}`}
    >
      <div className="flex items-baseline space-x-3 px-1">
        <h2 className="text-xl font-bold tracking-tight text-white">{title}</h2>
        {subtitle && <span className="text-xs text-[#E27D12]/80 font-medium">{subtitle}</span>}
      </div>

      {entries.length > 0 && (
        <HorizontalDragScroll
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex space-x-4 overflow-x-auto pb-4 pt-1 px-1 scrollbar-none"
        >
          {entries.map(({ media, state, history }) => {
            const orientation = cardOrientation || cardOrientationByType[media.type] || 'portrait';
            const landscape = forceLandscape || orientation === 'landscape';
            const lastEpisodeStill = getLastWatchedEpisodeArtwork(media, history).still;
            const image = media.type === 'TV Series'
              ? lastEpisodeStill || media.backdrop
              : media.backdrop;
            return (
              <div
                key={media.id}
                className="shrink-0"
                style={{ width: getMediaCardWidth(landscape ? 'landscape' : 'portrait') }}
              >
                <MediaCard
                  media={media}
                  state={state}
                  score={history[0]?.score}
                  landscape={landscape}
                  landscapeImage={image}
                  onClick={(clickedMedia, rect, opts) => {
                    onSelectMedia(clickedMedia, rect, {
                      ...opts,
                      initialBackdrop: lastEpisodeStill || opts?.initialBackdrop,
                      initialHistory: history
                    });
                  }}
                  onPlayMedia={onPlayMedia}
                  onPreviewStart={onPreviewStart}
                  onPreviewEnd={onPreviewEnd}
                />
              </div>
            );
          })}
        </HorizontalDragScroll>
      )}
      {loadError && <p className="px-1 text-sm text-gray-400">Unable to load this section.</p>}
      {loading && entries.length > 0 && <span className="sr-only">Loading more {title.toLowerCase()} items</span>}
      {!hasMore && entries.length > 0 && <span className="sr-only">End of {title.toLowerCase()} items</span>}
    </section>
  );
};
