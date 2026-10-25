import React, { useEffect, useState } from 'react';
import { Media, MediaHistory, MediaState } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { Play, Info, Star, Calendar, Clock, Sparkles } from 'lucide-react';
import { getAccentRgb } from '../helper/mediaDetailTheme';

interface HeroShowcaseProps {
  media: Media;
  onSelectMedia: (media: Media) => void;
  accentColor: string;
  contentPaddingLeft: string;
}

export const HeroShowcase: React.FC<HeroShowcaseProps> = ({
  media,
  onSelectMedia,
  accentColor,
  contentPaddingLeft
}) => {
  const [latestHistory, setLatestHistory] = useState<MediaHistory>();
  const [state, setState] = useState<MediaState>();

  useEffect(() => {
    let isMounted = true;
    Promise.all([dbService.getHistoryForMedia(media.id), dbService.getMediaState(media.id)])
      .then(([history, mediaState]) => {
        if (!isMounted) return;
        setLatestHistory(history[0]);
        setState(mediaState);
      })
      .catch(err => console.error('Failed to load featured media state:', err));
    return () => {
      isMounted = false;
    };
  }, [media.id]);

  return (
    <div
      className="hero-showcase relative w-full h-[80vh] min-h-[50vh] sm:min-h-[80px] overflow-hidden group"
      style={{
        '--hero-accent': accentColor,
        '--hero-accent-rgb': getAccentRgb(accentColor),
        backgroundColor: accentColor
      } as React.CSSProperties}
    >
      {/* Background Backdrop Image */}
      {media.backdrop ? (
        <>
          <img
            src={media.backdrop}
            alt=""
            aria-hidden="true"
            className="hero-backdrop-fill"
          />
          <img
            src={media.backdrop}
            alt={media.title}
            className="hero-backdrop-img absolute inset-0 z-[1] w-full h-full object-cover object-top group-hover:scale-[1.02] transition-transform duration-700 opacity-75"
          />
        </>
      ) : (
        <div className="absolute inset-0 z-0" style={{
          background: 'linear-gradient(135deg, rgba(var(--hero-accent-rgb), 0.18), rgba(var(--hero-accent-rgb), 0.05) 48%, var(--hero-accent) 100%)'
        }} />
      )}

      {/* Soft overlays keep the artwork readable while blending its accent into the page. */}
      <div className="absolute inset-0 z-10" style={{
        background: 'linear-gradient(to top, var(--hero-accent) 0%, var(--hero-accent) 0%, rgba(var(--hero-accent-rgb), 0) 36%, rgba(0, 0, 0, 0.4) 100%)'
      }} />

      {/* Content Container */}
      <div
        className="relative z-30 h-full flex flex-col justify-end p-4 sm:p-6 md:py-8 md:pr-8 max-w-4xl space-y-3 sm:space-y-4"
        style={{
          paddingLeft: typeof window !== 'undefined' && window.innerWidth >= 768
            ? contentPaddingLeft
            : undefined
        }}
      >
        {/* Featured Tag */}
        <div className="flex items-center space-x-2">
          <span
            className="text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider flex items-center space-x-1.5 shadow-md"
            style={{ backgroundColor: 'rgba(var(--hero-accent-rgb), 0.88)' }}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Featured Selection</span>
          </span>
          <span className="text-xs text-gray-400 font-medium">{media.type}</span>
        </div>

        {/* Title Logo or Text */}
        {media.logo ? (
          <div className="py-1">
            <img
              src={media.logo}
              alt={media.title}
              className="h-16 max-w-md object-contain drop-shadow-[0_10px_10px_rgba(0,0,0,0.8)]"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const titleEl = document.getElementById(`hero-title-text-${media.id}`);
                if (titleEl) titleEl.classList.remove('hidden');
              }}
            />
          </div>
        ) : null}

        <h1
          id={`hero-title-text-${media.id}`}
          className={`text-4xl font-extrabold text-white tracking-tight drop-shadow-md leading-none ${media.logo ? 'hidden' : ''}`}
        >
          {media.title}
        </h1>

        {/* Metadata Bar */}
        <div className="flex items-center space-x-4 text-xs font-semibold text-gray-300">
          {media.release_year && (
            <span className="flex items-center space-x-1">
              <Calendar className="w-3.5 h-3.5" style={{ color: 'var(--hero-accent)' }} />
              <span>{media.release_year}</span>
            </span>
          )}
          {media.runtime && (
            <span className="flex items-center space-x-1">
              <Clock className="w-3.5 h-3.5" style={{ color: 'var(--hero-accent)' }} />
              <span>{media.runtime} mins</span>
            </span>
          )}
          {latestHistory?.score && (
            <span className="flex items-center space-x-1 text-amber-400">
              <Star className="w-3.5 h-3.5 fill-amber-400" />
              <span>{latestHistory.score} / 5</span>
            </span>
          )}
          {latestHistory?.context && (
            <span
              className="px-2 py-0.5 rounded text-[11px]"
              style={{
                backgroundColor: 'rgba(var(--hero-accent-rgb), 0.16)',
                color: 'rgba(var(--hero-accent-rgb), 0.95)',
                border: '1px solid rgba(var(--hero-accent-rgb), 0.3)'
              }}
            >
              {latestHistory.context}
            </span>
          )}
        </div>

        {/* Description */}
        <p className="text-sm text-gray-300 line-clamp-2 leading-relaxed opacity-90">
          {media.description || 'No description available.'}
        </p>

        {/* Action Buttons */}
        <div className="flex items-center space-x-3 pt-2">
          <button
            onClick={() => onSelectMedia(media)}
            className="flex items-center space-x-2 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-all transform hover:-translate-y-0.5 cursor-pointer"
            style={{
              backgroundColor: 'var(--hero-accent)',
              boxShadow: '0 12px 28px rgba(var(--hero-accent-rgb), 0.24)'
            }}
          >
            <Play className="w-4 h-4 fill-current" />
            <span>View Details</span>
          </button>
          <button
            onClick={() => onSelectMedia(media)}
            className="flex items-center space-x-2 bg-gray-800/80 hover:bg-gray-700/80 text-gray-200 font-semibold text-sm px-4 py-2.5 rounded-xl border border-gray-700 backdrop-blur-md transition-all cursor-pointer"
          >
            <Info className="w-4 h-4" />
            <span>History ({state?.total_watch_play_count || history.length})</span>
          </button>
        </div>
      </div>
    </div>
  );
};
