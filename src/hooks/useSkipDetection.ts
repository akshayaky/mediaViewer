import { useState, useEffect, useRef, useCallback } from 'react';
import { Media, MediaSkipSegments } from '../types/media';
import { skipSegmentCache } from '../services/skip/SkipSegmentCache';
import { SkipPlaybackDetector, ActiveSkipSegment } from '../services/skip/SkipPlaybackDetector';
import { dbService } from '../services/DatabaseService';

export interface UseSkipDetectionProps {
  media: Media;
  seasonNumber?: number;
  episodeNumber?: number;
  onSeek: (targetTime: number) => void;
  showNotice?: (message: string) => void;
}

export interface UseSkipDetectionReturn {
  activeSkipSegment: ActiveSkipSegment | null;
  skipSegments: MediaSkipSegments | null;
  isLoading: boolean;
  handleSkipClick: () => void;
  handleTimeUpdate: (currentTime: number) => void;
  notifySeek: (targetTime: number) => void;
}

export function useSkipDetection({
  media,
  seasonNumber = 1,
  episodeNumber = 1,
  onSeek,
  showNotice
}: UseSkipDetectionProps): UseSkipDetectionReturn {
  const [activeSkipSegment, setActiveSkipSegment] = useState<ActiveSkipSegment | null>(null);
  const [skipSegments, setSkipSegments] = useState<MediaSkipSegments | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const detectorRef = useRef<SkipPlaybackDetector>(new SkipPlaybackDetector());

  // Load user automatic skip settings from SQLite
  useEffect(() => {
    let cancelled = false;
    dbService.getSettings().then(settings => {
      if (!cancelled) {
        const autoIntro = Boolean(settings.auto_skip_intro);
        const autoRecap = Boolean(settings.auto_skip_recap);
        detectorRef.current.setAutoSkipSettings(autoIntro, autoRecap);
      }
    }).catch(err => {
      console.warn('Failed loading automatic skip settings:', err);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Asynchronously fetch or read cached skip segments whenever media or episode changes
  useEffect(() => {
    let cancelled = false;
    detectorRef.current.reset();
    detectorRef.current.setSegments(null, null);
    setActiveSkipSegment(null);
    setSkipSegments(null);

    // Skip games
    if (media.type === 'VideoGame') {
      return;
    }

    setIsLoading(true);
    skipSegmentCache.getOrFetchSkipSegments({
      media,
      season: seasonNumber,
      episode: episodeNumber
    })
      .then(segments => {
        if (!cancelled) {
          setSkipSegments(segments);
          detectorRef.current.setSegments(
            segments?.intro || null,
            segments?.recap || null
          );
        }
      })
      .catch(err => {
        console.warn('Failed to load skip segments:', err);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [media.id, seasonNumber, episodeNumber, media.type]);

  // Handle time progression
  const handleTimeUpdate = useCallback((currentTime: number) => {
    const { activeSegment, autoSeekTarget, autoSkipType } = detectorRef.current.evaluate(currentTime);

    if (autoSeekTarget !== null) {
      // Auto-skip triggered
      onSeek(autoSeekTarget);
      if (showNotice) {
        showNotice(autoSkipType === 'recap' ? 'Recap skipped' : 'Intro skipped');
      }
      setActiveSkipSegment(null);
    } else {
      setActiveSkipSegment(prev => {
        if (prev?.type === activeSegment?.type && prev?.targetTime === activeSegment?.targetTime) {
          return prev;
        }
        return activeSegment;
      });
    }
  }, [onSeek, showNotice, activeSkipSegment?.type]);

  // Handle user manual seeking
  const notifySeek = useCallback((targetTime: number) => {
    detectorRef.current.notifySeek(targetTime);
    const { activeSegment } = detectorRef.current.evaluate(targetTime);
    setActiveSkipSegment(activeSegment);
  }, []);

  // Handle manual skip button click
  const handleSkipClick = useCallback(() => {
    if (!activeSkipSegment) return;

    const segmentType = activeSkipSegment.type;
    const target = activeSkipSegment.targetTime;

    detectorRef.current.handleManualSkip(segmentType);
    setActiveSkipSegment(null);
    onSeek(target);

    if (showNotice) {
      showNotice(segmentType === 'recap' ? 'Recap skipped' : 'Intro skipped');
    }
  }, [activeSkipSegment, onSeek, showNotice]);

  return {
    activeSkipSegment,
    skipSegments,
    isLoading,
    handleSkipClick,
    handleTimeUpdate,
    notifySeek
  };
}
