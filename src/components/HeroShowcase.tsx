import React, { useEffect, useRef, useState } from 'react';
import { Media, MediaHistory, MediaState } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { Play, ChevronLeft, ChevronRight } from 'lucide-react';

interface HeroShowcaseProps {
  media: Media;
  mediaItems: Media[];
  onActiveMediaChange: (media: Media) => void;
  onSwipeAccentChange: (media: Media | null, progress: number) => void;
  onSelectMedia: (media: Media, clickedCardRect?: DOMRect) => void;
  contentPaddingLeft: string;
}

interface HeroSwipe {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  width: number;
  dx: number;
  direction: -1 | 1;
  progress: number;
  targetMedia: Media | null;
  isSettling: boolean;
}

export const HeroShowcase: React.FC<HeroShowcaseProps> = ({
  media,
  mediaItems,
  onActiveMediaChange,
  onSwipeAccentChange,
  onSelectMedia,
  contentPaddingLeft
}) => {
  const [displayedMedia, setDisplayedMedia] = useState(media);
  const [outgoingMedia, setOutgoingMedia] = useState<Media | null>(null);
  const [skipArtworkEnterId, setSkipArtworkEnterId] = useState<string | null>(null);
  const [latestHistory, setLatestHistory] = useState<MediaHistory>();
  const [state, setState] = useState<MediaState>();
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isManuallyPaused, setIsManuallyPaused] = useState(false);
  const manualPauseTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [swipe, setSwipe] = useState<HeroSwipe | null>(null);
  const swipeRef = useRef<HeroSwipe | null>(null);
  const swipeSettleTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accentAnimationFrame = useRef<number | null>(null);
  const skipNextCrossfade = useRef(false);
  const activeIndex = Math.max(0, mediaItems.findIndex(item => item.id === media.id));
  const canNavigate = mediaItems.length > 1;

  const updateSwipe = (nextSwipe: HeroSwipe | null) => {
    swipeRef.current = nextSwipe;
    setSwipe(nextSwipe);
  };

  const animateSwipeAccent = (target: Media | null, from: number, to: number) => {
    if (accentAnimationFrame.current !== null) {
      cancelAnimationFrame(accentAnimationFrame.current);
    }

    const startedAt = performance.now();
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;
    const animate = (now: number) => {
      const progress = duration ? Math.min((now - startedAt) / duration, 1) : 1;
      const eased = 1 - (1 - progress) ** 3;
      onSwipeAccentChange(target, from + (to - from) * eased);
      if (progress < 1) {
        accentAnimationFrame.current = requestAnimationFrame(animate);
      } else {
        accentAnimationFrame.current = null;
        if (to === 0) onSwipeAccentChange(null, 0);
      }
    };
    accentAnimationFrame.current = requestAnimationFrame(animate);
  };

  const clearSwipeSettleTimeout = () => {
    if (swipeSettleTimeout.current) {
      clearTimeout(swipeSettleTimeout.current);
      swipeSettleTimeout.current = null;
    }
  };

  useEffect(() => {
    if (displayedMedia.id === media.id) return;

    clearSwipeSettleTimeout();
    updateSwipe(null);
    if (skipNextCrossfade.current) {
      skipNextCrossfade.current = false;
      setOutgoingMedia(null);
      setSkipArtworkEnterId(media.id);
    } else {
      setOutgoingMedia(displayedMedia);
      setSkipArtworkEnterId(null);
    }
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
    console.log(latestHistory);
    console.log(state);
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
    if (swipeSettleTimeout.current) clearTimeout(swipeSettleTimeout.current);
    if (accentAnimationFrame.current !== null) cancelAnimationFrame(accentAnimationFrame.current);
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

  const handleSwipePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (
      !canNavigate ||
      event.pointerType === 'mouse' ||
      !window.matchMedia('(max-width: 639px)').matches ||
      (event.target as HTMLElement).closest('button')
    ) return;

    clearSwipeSettleTimeout();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsManuallyPaused(true);
    if (manualPauseTimeout.current) clearTimeout(manualPauseTimeout.current);
    manualPauseTimeout.current = setTimeout(() => setIsManuallyPaused(false), 7000);
    updateSwipe({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: event.timeStamp,
      width: event.currentTarget.clientWidth,
      dx: 0,
      direction: 1,
      progress: 0,
      targetMedia: null,
      isSettling: false
    });
  };

  const handleSwipePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const activeSwipe = swipeRef.current;
    if (!activeSwipe || activeSwipe.pointerId !== event.pointerId || activeSwipe.isSettling) return;

    const deltaX = event.clientX - activeSwipe.startX;
    const deltaY = event.clientY - activeSwipe.startY;
    if (Math.abs(deltaY) > 10 && Math.abs(deltaY) > Math.abs(deltaX)) {
      if (activeSwipe.targetMedia) {
        animateSwipeAccent(activeSwipe.targetMedia, activeSwipe.progress, 0);
      }
      updateSwipe(null);
      return;
    }
    if (Math.abs(deltaX) < 4) return;

    const direction: -1 | 1 = deltaX < 0 ? 1 : -1;
    const targetMedia = mediaItems[(activeIndex + direction + mediaItems.length) % mediaItems.length];
    const dx = Math.sign(deltaX) * Math.min(Math.abs(deltaX), activeSwipe.width);
    const progress = Math.min(Math.abs(dx) / activeSwipe.width, 1);
    const nextSwipe = { ...activeSwipe, dx, direction, progress, targetMedia };
    updateSwipe(nextSwipe);
    onSwipeAccentChange(targetMedia, progress);
  };

  const finishSwipe = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const activeSwipe = swipeRef.current;
    if (!activeSwipe || activeSwipe.pointerId !== event.pointerId || activeSwipe.isSettling) return;

    const elapsed = Math.max(event.timeStamp - activeSwipe.startedAt, 1);
    const velocity = Math.abs(activeSwipe.dx) / elapsed;
    const shouldNavigate = !cancelled && activeSwipe.targetMedia !== null &&
      (activeSwipe.progress >= 0.22 || (Math.abs(activeSwipe.dx) > 30 && velocity >= 0.55));
    const nextSwipe = {
      ...activeSwipe,
      dx: shouldNavigate ? -activeSwipe.direction * activeSwipe.width : 0,
      progress: shouldNavigate ? 1 : 0,
      isSettling: true
    };
    updateSwipe(nextSwipe);
    animateSwipeAccent(activeSwipe.targetMedia, activeSwipe.progress, shouldNavigate ? 1 : 0);
    clearSwipeSettleTimeout();
    swipeSettleTimeout.current = setTimeout(() => {
      swipeSettleTimeout.current = null;
      if (shouldNavigate && activeSwipe.targetMedia) {
        skipNextCrossfade.current = true;
        setIsManuallyPaused(true);
        if (manualPauseTimeout.current) clearTimeout(manualPauseTimeout.current);
        manualPauseTimeout.current = setTimeout(() => setIsManuallyPaused(false), 7000);
        onActiveMediaChange(activeSwipe.targetMedia);
      } else {
        updateSwipe(null);
      }
    }, 220);
  };

  const renderArtwork = (item: Media, outgoing = false, dragStyle?: React.CSSProperties) => (
    <div
      key={`${item.id}-${outgoing ? 'outgoing' : 'active'}`}
      className={`absolute inset-0 ${item.poster ? 'hero-artwork-has-poster' : ''} ${dragStyle || (!outgoing && item.id === skipArtworkEnterId) ? 'hero-artwork-dragging' : outgoing ? 'z-0 hero-artwork-exit' : 'z-[1] hero-artwork-enter'}`}
      aria-hidden="true"
      style={dragStyle}
    >
      {item.backdrop && (
        <>
          <img src={item.backdrop} alt="" className="hero-backdrop-fill" />
          <img
            src={item.backdrop}
            alt={outgoing ? '' : item.title}
            className="hero-backdrop-img absolute inset-0 w-full h-full object-cover object-top opacity-75"
          />
        </>
      )}
      {item.poster && (
        <img src={item.poster} alt="" className="hero-poster-img absolute inset-0 w-full h-full object-cover" />
      )}
    </div>
  );

  return (
    <div
      className="hero-showcase relative w-full h-[75vh] min-h-[50vh] sm:min-h-[80px] overflow-hidden group"
      style={{
        backgroundColor: 'var(--hero-accent, #E27D12)'
      } as React.CSSProperties}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onPointerDown={handleSwipePointerDown}
      onPointerMove={handleSwipePointerMove}
      onPointerUp={event => finishSwipe(event)}
      onPointerCancel={event => finishSwipe(event, true)}
      onFocusCapture={() => setIsFocused(true)}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsFocused(false);
      }}
      aria-roledescription="carousel"
      role="region"
      aria-label="Featured media"
    >
      {outgoingMedia && renderArtwork(outgoingMedia, true)}
      {swipe?.targetMedia && renderArtwork(swipe.targetMedia, false, {
        zIndex: 2,
        transform: `translateX(${swipe.direction * swipe.width + swipe.dx}px)`,
        transition: swipe.isSettling ? 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none'
      })}
      {displayedMedia.backdrop || displayedMedia.poster ? renderArtwork(displayedMedia, false, swipe?.targetMedia ? {
        zIndex: 1,
        transform: `translateX(${swipe.dx}px)`,
        transition: swipe.isSettling ? 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none'
      } : undefined) : (
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
        {/* <div className="flex items-center space-x-2">
          <span
            className="text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider flex items-center space-x-1.5 shadow-md"
            style={{ backgroundColor: 'rgba(var(--hero-accent-rgb), 0.88)' }}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Featured Selection</span>
          </span>
          <span className="text-xs text-gray-400 font-medium">{displayedMedia.type}</span>
        </div> */}

        {displayedMedia.logo ? (
          <div className="hero-title-lockup py-1">
            <img
              src={displayedMedia.logo}
              alt={displayedMedia.title}
              className="h-35 max-w-md object-contain drop-shadow-[0_10px_10px_rgba(0,0,0,0.8)]"
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
          className={`hero-title-text text-6xl font-extrabold uppercase text-white tracking-tight drop-shadow-md leading-none ${displayedMedia.logo ? 'hidden' : ''}`}
        >
          {displayedMedia.title}
        </h1>

        {/* <div className="flex items-center space-x-4 text-xs font-semibold text-gray-300">
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
        </div> */}

        <p className="text-sm text-gray-300 line-clamp-2 leading-relaxed opacity-90">
          {/* {displayedMedia.description || 'No description available.'} */}
        </p>

        <div className="flex items-center space-x-3 pt-2">
          <button
            onClick={handleSelectFeaturedMedia}
          className="flex items-center space-x-2 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-transform transform hover:-translate-y-0.5 cursor-pointer"
            style={{
              backgroundColor: 'var(--hero-accent)',
              boxShadow: '0 12px 28px rgba(var(--hero-accent-rgb), 0.24)'
            }}
          >
            <Play className="w-4 h-4 fill-current" />
            <span>View Details</span>
          </button>

        </div>
      </div>

      {canNavigate && (
        <div className="absolute z-40 right-4 sm:right-8 bottom-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Previous featured item"
            className="hero-navigation-arrow touch-target flex items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur-md transition hover:bg-black/70"
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
            className="hero-navigation-arrow touch-target flex items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur-md transition hover:bg-black/70"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
};
