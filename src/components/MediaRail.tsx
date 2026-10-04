import React from 'react';
import { MediaCard } from './MediaCard';
import { Media } from '../types/media';
import { dbService } from '../services/DatabaseService';

interface MediaRailProps {
  title: string;
  subtitle?: string;
  items: Media[];
  onSelectMedia: (media: Media) => void;
}

export const MediaRail: React.FC<MediaRailProps> = ({ title, subtitle, items, onSelectMedia }) => {
  if (items.length === 0) return null;

  return (
    <section className="space-y-3 my-6">
      <div className="flex items-baseline space-x-3 px-1">
        <h2 className="text-xl font-bold tracking-tight text-white">{title}</h2>
        {subtitle && <span className="text-xs text-rose-400/80 font-medium">{subtitle}</span>}
      </div>

      <div className="flex space-x-4 overflow-x-auto pb-4 pt-1 px-1 scrollbar-none">
        {items.map(media => {
          const state = dbService.getMediaState(media.id);
          const history = dbService.getHistoryForMedia(media.id);
          const score = history[0]?.score;

          return (
            <div key={media.id} className="w-48 shrink-0">
              <MediaCard
                media={media}
                state={state}
                score={score}
                onClick={onSelectMedia}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
};
