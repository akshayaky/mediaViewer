import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Media, MediaCardOrientation, MediaType } from '../types/media';
import type { HomeRailPage } from '../services/DatabaseService';
import { getLastWatchedEpisodeArtwork } from '../helper/episodeProgress';
import { useSidebarPadding } from '../hooks/useSidebarPadding';
import { HorizontalDragScroll } from './HorizontalDragScroll';
import { MediaCard } from './MediaCard';

const PAGE_SIZE = 12;

interface MediaRailProps {
  title: string;
  subtitle?: string;
  loadPage: (offset: number, limit: number) => Promise<HomeRailPage>;
  onSelectMedia: (media: Media, clickedCardRect?: DOMRect) => void;
  cardOrientation?: MediaCardOrientation;
  cardOrientationByType?: Partial<Record<MediaType, MediaCardOrientation>>;
  onPreviewStart?: (media: Media, rect: DOMRect) => void;
  onPreviewEnd?: () => void;
}

export const MediaRail: React.FC<MediaRailProps> = ({
  title,
  subtitle,
  loadPage,
  onSelectMedia,
  cardOrientation,
  cardOrientationByType = {},
  onPreviewStart,
  onPreviewEnd
}) => {
  const { isDesktop } = useSidebarPadding();
  const sectionRef = useRef<HTMLElement>(null);
  const entriesRef = useRef<HomeRailPage['entries']>([]);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);
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
    try {
      const page = await loadPage(entriesRef.current.length, PAGE_SIZE);
      const nextEntries = [...entriesRef.current, ...page.entries];
      entriesRef.current = nextEntries;
      hasMoreRef.current = page.hasMore;
      setEntries(nextEntries);
      setHasMore(page.hasMore);
      setHasLoaded(true);
    } catch (error) {
      console.error(`Failed to load ${title} media rail:`, error);
      setLoadError(true);
      setHasLoaded(true);
      hasMoreRef.current = false;
      setHasMore(false);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [loadPage, title]);

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
    if (target.scrollWidth - target.scrollLeft - target.clientWidth < 350) {
      void loadNextPage();
    }
  }, [loadNextPage]);

  if (hasLoaded && entries.length === 0 && !loading) return null;

  return (
    <section ref={sectionRef} className="space-y-3 my-6 min-h-[280px]">
      <div className="flex items-baseline space-x-3 px-1">
        <h2 className="text-xl font-bold tracking-tight text-white">{title}</h2>
        {subtitle && <span className="text-xs text-[#E27D12]/80 font-medium">{subtitle}</span>}
      </div>

      {entries.length > 0 && (
        <HorizontalDragScroll
          onScroll={handleScroll}
          className="flex space-x-4 overflow-x-auto pb-4 pt-1 px-1 scrollbar-none"
        >
          {entries.map(({ media, state, history }) => {
            const orientation = cardOrientation || cardOrientationByType[media.type] || 'portrait';
            const landscape = isDesktop && orientation === 'landscape';
            const lastEpisodeStill = getLastWatchedEpisodeArtwork(media, history).still;
            const image = media.type === 'TV Series'
              ? lastEpisodeStill || media.backdrop
              : media.backdrop;
            return (
              <div
                key={media.id}
                className={`shrink-0 ${
                  landscape
                    ? 'w-[calc(40%-12px)] sm:w-[calc(28%-12px)] md:w-[calc(30%-12px)] lg:w-[calc(25%-12px)] xl:w-[calc(22%-12px)]'
                    : 'w-[calc(40%-12px)] sm:w-[calc(28%-12px)] md:w-[calc(15%-12px)]'
                }`}
              >
                <MediaCard
                  media={media}
                  state={state}
                  score={history[0]?.score}
                  landscape={landscape}
                  landscapeImage={image}
                  onClick={onSelectMedia}
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
