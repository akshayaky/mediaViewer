import React, { useState, useEffect } from 'react';
import { Media, MediaState } from '../types/media';
import { Film, Tv, Gamepad2, Play, RefreshCw, PauseCircle } from 'lucide-react';
import { artworkCacheProvider } from '../providers/ArtworkCacheProvider';
import { dbService } from '../services/DatabaseService';

interface MediaCardProps {
  media: Media;
  state?: MediaState;
  score?: number;
  landscape?: boolean;
  landscapeImage?: string;
  onClick: (media: Media, clickedCardRect?: DOMRect) => void;
  onPreviewStart?: (media: Media, rect: DOMRect) => void;
  onPreviewEnd?: () => void;
}

export const MediaCard = React.memo<MediaCardProps>(({
  media,
  state,
  landscape = false,
  landscapeImage,
  onClick,
  onPreviewStart,
  onPreviewEnd
}) => {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [posterUrl, setPosterUrl] = useState<string | undefined>(media.poster);
  const [imgFailed, setImgFailed] = useState<boolean>(false);
  const [usePosterFallback, setUsePosterFallback] = useState(false);
  const [progressPct, setProgressPct] = useState<number>(0);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const cardImageUrl = !isNearViewport
    ? undefined
    : imgFailed
    ? undefined
    : landscape && !usePosterFallback
      ? landscapeImage || media.backdrop || posterUrl
      : posterUrl;

  useEffect(() => {
    const card = cardRef.current;
    if (!card || isNearViewport) return;
    if (!('IntersectionObserver' in window)) {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setIsNearViewport(true);
      observer.disconnect();
    }, { rootMargin: '250px' });
    observer.observe(card);
    return () => observer.disconnect();
  }, [isNearViewport]);

  useEffect(() => {
    setUsePosterFallback(false);
  }, [media.id, landscapeImage]);

  useEffect(() => {
    if (!isNearViewport) return;
    let isMounted = true;
    setPosterUrl(media.poster);
    setImgFailed(false);
    setProgressPct(0);

    dbService.getAllPlaybackProgressForMedia(media.id).then(progs => {
      if (!isMounted || progs.length === 0) return;
      // Find latest or in-progress
      const active = progs.find(p => !p.is_completed && p.position_seconds > 10) || progs[0];
      if (active && !active.is_completed && active.duration_seconds > 0) {
        const pct = Math.min(100, Math.round((active.position_seconds / active.duration_seconds) * 100));
        if (pct > 1 && pct < 90) setProgressPct(pct);
      }
    }).catch(error => console.warn(`Failed to load playback progress for "${media.title}":`, error));

    if (!media.poster) {
      artworkCacheProvider.resolveArtworkForMedia(media).then(res => {
        if (isMounted && res.poster) {
          setPosterUrl(res.poster);
          if (res.source !== 'placeholder' && !media.poster) {
            try {
              void dbService.saveMedia({
                ...media,
                poster: res.poster,
                backdrop: res.backdrop || media.backdrop,
                logo: res.logo || media.logo
              }).catch(err => console.warn('Failed to auto-save resolved poster:', err));
            } catch (err) {
              console.warn('Failed to auto-save resolved poster:', err);
            }
          }
        }
      }).catch(error => console.warn(`Failed to resolve artwork for "${media.title}":`, error));
    }

    return () => {
      isMounted = false;
    };
  }, [isNearViewport, media]);

  const handleImageError = () => {
    setImgFailed(true);
    artworkCacheProvider.resolveArtworkForMedia(media).then(res => {
      if (res.poster && res.poster !== posterUrl) {
        setPosterUrl(res.poster);
        setImgFailed(false);
      }
    }).catch(error => console.warn(`Failed to recover artwork for "${media.title}":`, error));
  };

  const [isHovered, setIsHovered] = useState(false);

  const getTypeIcon = () => {
    switch (media.type) {
      case 'Film':
        return <Film className="w-3.5 h-3.5 text-[#E27D12]" />;
      case 'TV Series':
        return <Tv className="w-3.5 h-3.5 text-sky-400" />;
      case 'VideoGame':
        return <Gamepad2 className="w-3.5 h-3.5 text-purple-400" />;
      default:
        return null;
    }
  };

  const renderBadge = () => {
    if (!state) return null;
    
    // Only show badges on hover
    if (!isHovered) return null;
    
    if (state.currently_watching_playing) {
      return (
        <span className="absolute top-2 left-2 bg-emerald-600/90 backdrop-blur-md text-white text-[11px] font-semibold px-2 py-0.5 rounded-md flex items-center space-x-1 shadow-md transition-opacity duration-200">
          <Play className="w-3 h-3 fill-current" />
          <span>Active</span>
        </span>
      );
    }
    if (state.rewatch_count > 0) {
      return (
        <span className="absolute top-2 left-2 bg-[#E27D12]/90 backdrop-blur-md text-white text-[11px] font-semibold px-2 py-0.5 rounded-md flex items-center space-x-1 shadow-md transition-opacity duration-200">
          <RefreshCw className="w-3 h-3" />
          <span>{state.rewatch_count > 1 ? `${state.rewatch_count}x Rewatched` : 'Rewatched'}</span>
        </span>
      );
    }
    if (state.current_status === 'Abandoned') {
      return (
        <span className="absolute top-2 left-2 bg-amber-600/90 backdrop-blur-md text-white text-[11px] font-semibold px-2 py-0.5 rounded-md flex items-center space-x-1 shadow-md transition-opacity duration-200">
          <PauseCircle className="w-3 h-3" />
          <span>Paused/Abandoned</span>
        </span>
      );
    }
    return null;
  };

  const isFinePointer = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;

  return (
    <div
      ref={cardRef}
      onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        onClick(media, rect);
      }}
      onMouseEnter={event => {
        setIsHovered(true);
        if (isFinePointer) {
          const rect = event.currentTarget.getBoundingClientRect();
          onPreviewStart?.(media, rect);
        }
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        if (isFinePointer) {
          onPreviewEnd?.();
        }
      }}
      className="group relative cursor-pointer flex flex-col bg-[#151720] rounded-sm transition-all duration-300 transform hover:-translate-y-1 touch-target"
    >
      {/* Backlight Glow Effect */}
      <div className="absolute -inset-4 opacity-0 group-hover:opacity-70 transition-opacity duration-500 blur-3xl pointer-events-none z-0">
        {cardImageUrl && (
          <img
            src={cardImageUrl}
            alt=""
            className="w-full h-full object-cover saturate-200"
            loading="lazy"
          />
        )}
      </div>

      {/* Main Card Content */}
      <div className="relative flex flex-col bg-[#151720] rounded-sm overflow-hidden border border-transparent group-hover:border-white/10 hover:shadow-xl hover:shadow-black/50 transition-all duration-300 z-10">
        {/* Poster Image Container */}
        <div className={`relative w-full bg-[#1b1e2b] overflow-hidden ${landscape ? 'aspect-[2/3] sidebar:aspect-video' : 'aspect-[2/3]'}`}>
          {cardImageUrl ? (
            <img
              src={cardImageUrl}
              alt={media.title}
              onError={() => {
                if (landscape && !usePosterFallback && (landscapeImage || media.backdrop)) {
                  setUsePosterFallback(true);
                  return;
                }
                handleImageError();
              }}
              className="w-full h-full object-cover transition-transform duration-500"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center bg-gradient-to-b from-[#1b1e2b] to-[#12141d]">
              {getTypeIcon()}
              <span className="text-sm font-medium text-gray-300 mt-2 line-clamp-2">{media.title}</span>
            </div>
          )}
          {/* Gradient Overlay on Hover */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0c0d10] via-transparent to-black/20 opacity-80 group-hover:opacity-90 transition-opacity" />

          {/* Status Badge */}
          {renderBadge()}

          {/* Subtle Bottom Progress Bar */}
          {progressPct > 0 && (
            <div className="absolute bottom-0 inset-x-0 bg-black/60 h-0.5 z-10">
              <div
                className="bg-[#E27D12] h-full transition-all duration-300 shadow-[0_0_8px_rgba(244,63,94,0.8)]"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
          {landscape && (
            <div className="absolute inset-x-0 bottom-0 z-10 hidden bg-gradient-to-t from-black/90 via-black/45 to-transparent px-3 pb-3 pt-10 sidebar:block">
              <p className="truncate text-sm font-bold text-white drop-shadow">{media.title}</p>
              <p className="mt-0.5 text-[11px] text-gray-300">{media.release_year || media.type}</p>
            </div>
          )}
        </div>
        {/* Score Badge */}
        {/* {score && (
          <span className="absolute top-2 right-2 bg-black/75 backdrop-blur-md text-amber-400 text-xs font-bold px-2 py-0.5 rounded-md flex items-center space-x-1 border border-amber-500/20">
            <Star className="w-3 h-3 fill-amber-400" />
            <span>{score}</span>
          </span>
        )} */}

        {/* Release Year & Type overlay on hover */}
        {/* <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-xs text-gray-300 opacity-90">
          <span className="flex items-center space-x-1 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[11px]">
            {getTypeIcon()}
            <span className="ml-1">{media.type}</span>
          </span>
          {media.release_year && (
            <span className="flex items-center space-x-1 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[11px]">
              <Calendar className="w-3 h-3 text-gray-400" />
              <span>{media.release_year}</span>
            </span>
          )}
        </div> */}
      </div>

      {/* Card Info */}
      {/* <div className="p-3.5 flex flex-col justify-between flex-1">
        <h3 className="font-semibold text-sm text-gray-100 group-hover:text-[#E27D12] transition-colors line-clamp-1">
          {media.title}
        </h3>
        <p className="text-xs text-gray-400 mt-1 line-clamp-1">
          {media.genres && media.genres.length > 0 ? media.genres.join(', ') : media.type}
        </p>
      </div> */}
    </div>
  );
});
