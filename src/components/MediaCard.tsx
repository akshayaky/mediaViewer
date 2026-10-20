import React, { useState, useEffect } from 'react';
import { Media, MediaState } from '../types/media';
import { Film, Tv, Gamepad2, Play, RefreshCw, PauseCircle, Calendar, Star } from 'lucide-react';
import { artworkCacheProvider } from '../providers/ArtworkCacheProvider';
import { dbService } from '../services/DatabaseService';

interface MediaCardProps {
  media: Media;
  state?: MediaState;
  score?: number;
  onClick: (media: Media) => void;
}

export const MediaCard: React.FC<MediaCardProps> = ({ media, state, score, onClick }) => {
  const [posterUrl, setPosterUrl] = useState<string | undefined>(media.poster);
  const [imgFailed, setImgFailed] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    setPosterUrl(media.poster);
    setImgFailed(false);

    // If media.poster is missing, resolve artwork asynchronously via ArtworkCacheProvider
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
      });
    }

    return () => {
      isMounted = false;
    };
  }, [media]);

  const handleImageError = () => {
    setImgFailed(true);
    artworkCacheProvider.resolveArtworkForMedia(media).then(res => {
      if (res.poster && res.poster !== posterUrl) {
        setPosterUrl(res.poster);
        setImgFailed(false);
      }
    });
  };

  const getTypeIcon = () => {
    switch (media.type) {
      case 'Film':
        return <Film className="w-3.5 h-3.5 text-rose-400" />;
      case 'TV Series':
        return <Tv className="w-3.5 h-3.5 text-sky-400" />;
      case 'VideoGame':
        return <Gamepad2 className="w-3.5 h-3.5 text-purple-400" />;
    }
  };

  const renderBadge = () => {
    if (!state) return null;
    if (state.currently_watching_playing) {
      return (
        <span className="absolute top-2 left-2 bg-emerald-600/90 backdrop-blur-md text-white text-[11px] font-semibold px-2 py-0.5 rounded-md flex items-center space-x-1 shadow-md">
          <Play className="w-3 h-3 fill-current" />
          <span>Active</span>
        </span>
      );
    }
    if (state.rewatch_count > 0) {
      return (
        <span className="absolute top-2 left-2 bg-rose-600/90 backdrop-blur-md text-white text-[11px] font-semibold px-2 py-0.5 rounded-md flex items-center space-x-1 shadow-md">
          <RefreshCw className="w-3 h-3" />
          <span>{state.rewatch_count > 1 ? `${state.rewatch_count}x Rewatched` : 'Rewatched'}</span>
        </span>
      );
    }
    if (state.current_status === 'Abandoned') {
      return (
        <span className="absolute top-2 left-2 bg-amber-600/90 backdrop-blur-md text-white text-[11px] font-semibold px-2 py-0.5 rounded-md flex items-center space-x-1 shadow-md">
          <PauseCircle className="w-3 h-3" />
          <span>Paused/Abandoned</span>
        </span>
      );
    }
    return null;
  };

  return (
    <div
      onClick={() => onClick(media)}
      className="group relative cursor-pointer flex flex-col bg-[#151720] rounded-xl overflow-hidden border border-[#232736] hover:border-rose-500/50 hover:shadow-xl hover:shadow-rose-950/20 transition-all duration-300 transform hover:-translate-y-1"
    >
      {/* Poster Image Container */}
      <div className="relative aspect-[2/3] w-full bg-[#1b1e2b] overflow-hidden">
        {posterUrl && !imgFailed ? (
          <img
            //src={media.poster.startsWith('http') ? media.poster : (typeof window !== 'undefined' && (window as any).__TAURI__ ? convertFileSrc(media.poster) : media.poster)}
            src={posterUrl}
            alt={media.title}
            onError={handleImageError}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
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

        {/* Score Badge */}
        {score && (
          <span className="absolute top-2 right-2 bg-black/75 backdrop-blur-md text-amber-400 text-xs font-bold px-2 py-0.5 rounded-md flex items-center space-x-1 border border-amber-500/20">
            <Star className="w-3 h-3 fill-amber-400" />
            <span>{score}</span>
          </span>
        )}

        {/* Release Year & Type overlay on hover */}
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-xs text-gray-300 opacity-90">
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
        </div>
      </div>

      {/* Card Info */}
      {/* <div className="p-3.5 flex flex-col justify-between flex-1">
        <h3 className="font-semibold text-sm text-gray-100 group-hover:text-rose-400 transition-colors line-clamp-1">
          {media.title}
        </h3>
        <p className="text-xs text-gray-400 mt-1 line-clamp-1">
          {media.genres && media.genres.length > 0 ? media.genres.join(', ') : media.type}
        </p>
      </div> */}
    </div>
  );
};
