import React, { useEffect, useState } from 'react';
import { MediaCard } from './MediaCard';
import { Media, MediaCardOrientation, MediaHistory, MediaState, MediaType } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { getLastWatchedEpisodeArtwork } from '../helper/episodeProgress';
import { useSidebarPadding } from '../hooks/useSidebarPadding';
import { HorizontalDragScroll } from './HorizontalDragScroll';

interface MediaRailProps {
  title: string;
  subtitle?: string;
  items: Media[];
  onSelectMedia: (media: Media) => void;
  cardOrientation?: MediaCardOrientation;
  cardOrientationByType?: Partial<Record<MediaType, MediaCardOrientation>>;
  onPreviewStart?: (media: Media, rect: DOMRect) => void;
  onPreviewEnd?: () => void;
}

export const MediaRail: React.FC<MediaRailProps> = ({
  title,
  subtitle,
  items,
  onSelectMedia,
  cardOrientation,
  cardOrientationByType = {},
  onPreviewStart,
  onPreviewEnd
}) => {
  const { isDesktop } = useSidebarPadding();
  const [states, setStates] = useState<Record<string, MediaState>>({});
  const [scores, setScores] = useState<Record<string, number | undefined>>({});
  const [images, setImages] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    let isMounted = true;
    Promise.all(items.map(async media => {
      const [state, history] = await Promise.all([
        dbService.getMediaState(media.id),
        dbService.getHistoryForMedia(media.id)
      ]);
      const lastEpisodeStill = getLastWatchedEpisodeArtwork(media, history).still;
      const image = media.type === 'TV Series'
        ? lastEpisodeStill || media.backdrop
        : media.backdrop;
      return [media.id, state, (history[0] as MediaHistory | undefined)?.score, image] as const;
    })).then(results => {
      if (!isMounted) return;
      setStates(Object.fromEntries(results.map(([id, state]) => [id, state])));
      setScores(Object.fromEntries(results.map(([id, , score]) => [id, score])));
      setImages(Object.fromEntries(results.map(([id, , , image]) => [id, image])));
    }).catch(err => console.error('Failed to load media rail data:', err));
    return () => {
      isMounted = false;
    };
  }, [items]);

  if (items.length === 0) return null;

  return (
    <section className="space-y-3 my-6">
      <div className="flex items-baseline space-x-3 px-1">
        <h2 className="text-xl font-bold tracking-tight text-white">{title}</h2>
        {subtitle && <span className="text-xs text-[#E27D12]/80 font-medium">{subtitle}</span>}
      </div>

      <HorizontalDragScroll className="flex space-x-4 overflow-x-auto pb-4 pt-1 px-1 scrollbar-none">
        {items.map(media => {
          const orientation = cardOrientation || cardOrientationByType[media.type] || 'portrait';
          const landscape = isDesktop && orientation === 'landscape';
          return (
            <div key={media.id} 
              className={`shrink-0 ${
                landscape
                  ? 'w-[calc(40%-12px)] sm:w-[calc(28%-12px)] md:w-[calc(30%-12px)] lg:w-[calc(25%-12px)] xl:w-[calc(22%-12px)]'
                  : 'w-[calc(40%-12px)] sm:w-[calc(28%-12px)] md:w-[calc(15%-12px)]'
              }`}>
              <MediaCard
                media={media}
                state={states[media.id]}
                score={scores[media.id]}
                landscape={landscape}
                landscapeImage={images[media.id]}
                onClick={onSelectMedia}
                onPreviewStart={onPreviewStart}
                onPreviewEnd={onPreviewEnd}
              />
            </div>
          );
        })}
      </HorizontalDragScroll>
    </section>
  );
};
