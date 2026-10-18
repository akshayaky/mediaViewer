import React, { useEffect, useState } from 'react';
import { Media, MediaHistory, MediaState } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { Play, Info, Star, Calendar, Clock, Sparkles } from 'lucide-react';

interface HeroShowcaseProps {
  media: Media;
  onSelectMedia: (media: Media) => void;
}

export const HeroShowcase: React.FC<HeroShowcaseProps> = ({ media, onSelectMedia }) => {
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
    <div className="relative w-full h-[460px] rounded-2xl overflow-hidden border border-[#232736] bg-[#12141c] shadow-2xl mb-8 group">
      {/* Background Backdrop Image */}
      {media.backdrop ? (
        <img
          src={media.backdrop}
          alt={media.title}
          className="absolute inset-0 w-full h-full object-cover object-center group-hover:scale-102 transition-transform duration-700 opacity-60"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-rose-950/40 via-purple-950/20 to-[#0c0d10]" />
      )}

      {/* Cinematic Gradient Overlays */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#0c0d10] via-[#0c0d10]/80 to-transparent w-3/4" />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0c0d10] via-transparent to-transparent" />

      {/* Content Container */}
      <div className="relative h-full flex flex-col justify-end p-8 max-w-2xl space-y-4">
        {/* Featured Tag */}
        <div className="flex items-center space-x-2">
          <span className="bg-rose-600/90 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider flex items-center space-x-1.5 shadow-md">
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
              <Calendar className="w-3.5 h-3.5 text-rose-400" />
              <span>{media.release_year}</span>
            </span>
          )}
          {media.runtime && (
            <span className="flex items-center space-x-1">
              <Clock className="w-3.5 h-3.5 text-rose-400" />
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
            <span className="bg-rose-950/80 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded text-[11px]">
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
            className="flex items-center space-x-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-sm px-5 py-2.5 rounded-xl shadow-lg shadow-rose-900/40 transition-all transform hover:-translate-y-0.5 cursor-pointer"
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
