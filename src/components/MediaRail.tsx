import React, { useEffect, useState } from 'react';
import { MediaCard } from './MediaCard';
import { Media, MediaHistory, MediaState } from '../types/media';
import { dbService } from '../services/DatabaseService';

interface MediaRailProps {
  title: string;
  subtitle?: string;
  items: Media[];
  onSelectMedia: (media: Media) => void;
  onPreviewStart?: (media: Media, rect: DOMRect) => void;
  onPreviewEnd?: () => void;
}

export const MediaRail: React.FC<MediaRailProps> = ({ title, subtitle, items, onSelectMedia, onPreviewStart, onPreviewEnd }) => {
  const [states, setStates] = useState<Record<string, MediaState>>({});
  const [scores, setScores] = useState<Record<string, number | undefined>>({});

  useEffect(() => {
    let isMounted = true;
    Promise.all(items.map(async media => {
      const [state, history] = await Promise.all([
        dbService.getMediaState(media.id),
        dbService.getHistoryForMedia(media.id)
      ]);
      return [media.id, state, (history[0] as MediaHistory | undefined)?.score] as const;
    })).then(results => {
      if (!isMounted) return;
      setStates(Object.fromEntries(results.map(([id, state]) => [id, state])));
      setScores(Object.fromEntries(results.map(([id, , score]) => [id, score])));
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
        {subtitle && <span className="text-xs text-rose-400/80 font-medium">{subtitle}</span>}
      </div>

      <div className="flex space-x-4 overflow-x-auto pb-4 pt-1 px-1 scrollbar-none">
        {items.map(media => {
          return (
            <div key={media.id} 
              className="w-[calc(40%-12px)] sm:w-[calc(28%-12px)] md:w-[calc(15%-12px)] shrink-0">
              <MediaCard
                media={media}
                state={states[media.id]}
                score={scores[media.id]}
                onClick={onSelectMedia}
                onPreviewStart={onPreviewStart}
                onPreviewEnd={onPreviewEnd}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
};
