import React, { useEffect, useRef, useState } from 'react';
import { Media, MediaHistory, MediaState } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { Play, Info, Star, Calendar, Clock, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';

interface HeroShowcaseProps {
  media: Media;
  mediaItems: Media[];
  onActiveMediaChange: (media: Media) => void;
  onSelectMedia: (media: Media, clickedCardRect?: DOMRect) => void;
  contentPaddingLeft: string;
}

export const HeroShowcase: React.FC<HeroShowcaseProps> = ({
  media,
  mediaItems,
  onActiveMediaChange,
  onSelectMedia,
  contentPaddingLeft
}) => {
  const [displayedMedia, setDisplayedMedia] = useState(media);
  const [outgoingMedia, setOutgoingMedia] = useState<Media | null>(null);
  const [latestHistory, setLatestHistory] = useState<MediaHistory>();
  const [state, setState] = useState<MediaState>();
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isManuallyPaused, setIsManuallyPaused] = useState(false);
  const manualPauseTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIndex = Math.max(0, mediaItems.findIndex(item => item.id === media.id));
  const canNavigate = mediaItems.length > 1;

  useEffect(() => {
    if (displayedMedia.id === media.id) return;

    setOutgoingMedia(displayedMedia);
    setDisplayedMedia(media);
  }, [displayedMedia, media]);

  useEffect(() => {
    if (!outgoingMedia) return;
    const timeout = setTimeout(() => setOutgoingMedia(null), 900);
    return () => clearTimeout(timeout);
  }, [outgoingMedia]);

  useEffect(() => {
    onActiveMediaChange(media);
  }, [media, onActiveMediaChange]);

  useEffect(() => {
    setLatestHistory(undefined);
    setState(undefined);
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

  useEffect(() => {
    if (!canNavigate || isHovered || isFocused || isManuallyPaused) return;
    const timeout = setTimeout(() => {
      onActiveMediaChange(mediaItems[(activeIndex + 1) % mediaItems.length]);
    }, 7000);
    return () => clearTimeout(timeout);
  }, [activeIndex, canNavigate, isFocused, isHovered, isManuallyPaused, mediaItems, onActiveMediaChange]);

  useEffect(() => () => {
    if (manualPauseTimeout.current) clearTimeout(manualPauseTimeout.current);
  }, []);

  const handleSelectFeaturedMedia = (event: React.MouseEvent<HTMLButtonElement>) => {
    const heroRect = event.currentTarget.closest('.hero-showcase')?.getBoundingClientRect();
    onSelectMedia(media, heroRect || event.currentTarget.getBoundingClientRect());
  };

  const navigate = (direction: -1 | 1) => {
    if (!canNavigate) return;
    setIsManuallyPaused(true);
    if (manualPauseTimeout.current) clearTimeout(manualPauseTimeout.current);
    manualPauseTimeout.current = setTimeout(() => setIsManuallyPaused(false), 7000);
    onActiveMediaChange(mediaItems[(activeIndex + direction + mediaItems.length) % mediaItems.length]);
  };

  const renderArtwork = (item: Media, outgoing = false) => (
    <div
      key={`${item.id}-${outgoing ? 'outgoing' : 'active'}`}
      className={`absolute inset-0 ${outgoing ? 'z-0 hero-artwork-exit' : 'z-[1] hero-artwork-enter'}`}
      aria-hidden="true"
    >
      <img src={item.backdrop} alt="" className="hero-backdrop-fill" />
      <img
        src={item.backdrop}
        alt={outgoing ? '' : item.title}
        className="hero-backdrop-img absolute inset-0 w-full h-full object-cover object-top opacity-75"
      />
    </div>
  );

  return (
    <div
      className="hero-showcase relative w-full h-[80vh] min-h-[50vh] sm:min-h-[80px] overflow-hidden group"
      style={{
        backgroundColor: 'var(--hero-accent, #e11d48)'
      } as React.CSSProperties}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocusCapture={() => setIsFocused(true)}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsFocused(false);
      }}
      aria-roledescription="carousel"
      role="region"
      aria-label="Featured media"
    >
      {outgoingMedia && renderArtwork(outgoingMedia, true)}
      {displayedMedia.backdrop ? renderArtwork(displayedMedia) : (
        <div
          className="absolute inset-0 z-0"
          style={{
            background: 'linear-gradient(135deg, rgba(var(--hero-accent-rgb), 0.18), rgba(var(--hero-accent-rgb), 0.05) 48%, var(--hero-accent) 100%)'
          }}
        />
      )}

      <div className="absolute inset-0 z-10" style={{
        background: 'linear-gradient(to top, var(--hero-accent) 0%, var(--hero-accent) 0%, rgba(var(--hero-accent-rgb), 0) 36%, rgba(0, 0, 0, 0.4) 100%)'
      }} />

      <div
        key={displayedMedia.id}
        className="relative z-30 h-full flex flex-col justify-end p-4 sm:p-6 md:py-8 md:pr-8 max-w-4xl space-y-3 sm:space-y-4 hero-content-enter"
        style={{
          paddingLeft: typeof window !== 'undefined' && window.innerWidth >= 768
            ? contentPaddingLeft
            : undefined
        }}
      >
        <div className="flex items-center space-x-2">
          <span
            className="text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider flex items-center space-x-1.5 shadow-md"
            style={{ backgroundColor: 'rgba(var(--hero-accent-rgb), 0.88)' }}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Featured Selection</span>
          </span>
          <span className="text-xs text-gray-400 font-medium">{displayedMedia.type}</span>
        </div>

        {displayedMedia.logo ? (
          <div className="py-1">
            <img
              src={displayedMedia.logo}
              alt={displayedMedia.title}
              className="h-16 max-w-md object-contain drop-shadow-[0_10px_10px_rgba(0,0,0,0.8)]"
              onError={event => {
                event.currentTarget.style.display = 'none';
                const titleElement = document.getElementById(`hero-title-text-${displayedMedia.id}`);
                if (titleElement) titleElement.classList.remove('hidden');
              }}
            />
          </div>
        ) : null}

        <h1
          id={`hero-title-text-${displayedMedia.id}`}
          className={`text-4xl font-extrabold text-white tracking-tight drop-shadow-md leading-none ${displayedMedia.logo ? 'hidden' : ''}`}
        >
          {displayedMedia.title}
        </h1>

        <div className="flex items-center space-x-4 text-xs font-semibold text-gray-300">
          {displayedMedia.release_year && (
            <span className="flex items-center space-x-1">
              <Calendar className="w-3.5 h-3.5" style={{ color: 'var(--hero-accent)' }} />
              <span>{displayedMedia.release_year}</span>
            </span>
          )}
          {displayedMedia.runtime && (
            <span className="flex items-center space-x-1">
              <Clock className="w-3.5 h-3.5" style={{ color: 'var(--hero-accent)' }} />
              <span>{displayedMedia.runtime} mins</span>
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

        <p className="text-sm text-gray-300 line-clamp-2 leading-relaxed opacity-90">
          {displayedMedia.description || 'No description available.'}
        </p>

        <div className="flex items-center space-x-3 pt-2">
          <button
            onClick={handleSelectFeaturedMedia}
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
            onClick={handleSelectFeaturedMedia}
            className="flex items-center space-x-2 bg-gray-800/80 hover:bg-gray-700/80 text-gray-200 font-semibold text-sm px-4 py-2.5 rounded-xl border border-gray-700 backdrop-blur-md transition-all cursor-pointer"
          >
            <Info className="w-4 h-4" />
            <span>History ({state?.total_watch_play_count ?? 0})</span>
          </button>
        </div>
      </div>

      {canNavigate && (
        <div className="absolute z-40 right-4 sm:right-8 bottom-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Previous featured item"
            className="touch-target flex items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur-md transition hover:bg-black/70"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-1.5 px-1">
            {mediaItems.map((item, index) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  setIsManuallyPaused(true);
                  if (manualPauseTimeout.current) clearTimeout(manualPauseTimeout.current);
                  manualPauseTimeout.current = setTimeout(() => setIsManuallyPaused(false), 7000);
                  onActiveMediaChange(item);
                }}
                aria-label={`Show ${item.title}`}
                aria-current={index === activeIndex ? 'true' : undefined}
                className={`h-2 rounded-full transition-all duration-300 ${index === activeIndex ? 'w-6' : 'w-2 bg-white/55 hover:bg-white/85'}`}
                style={index === activeIndex ? { backgroundColor: 'var(--hero-accent)' } : undefined}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => navigate(1)}
            aria-label="Next featured item"
            className="touch-target flex items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur-md transition hover:bg-black/70"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
};
