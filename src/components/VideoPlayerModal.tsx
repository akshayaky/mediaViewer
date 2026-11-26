import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Media, LocalFile, SubtitleStyleSettings, PlaybackProgress } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { subtitleService, SubtitleTrack } from '../services/SubtitleService';
import { nativePlayerService } from '../services/NativePlayerService';
import { localScannerService } from '../services/LocalScannerService';
import { createMkvAudioTrackExtractor, createMkvSubtitleExtractor, extractMkvAudioTracks, extractMkvSubtitleTracks } from '../services/SubtitleExtraction';
import { useSkipDetection } from '../hooks/useSkipDetection';
import { getNextEpisodePromptTime } from '../helper/nextEpisodePrompt';
import { TitleBarDragRegion } from './TitleBarDragRegion';
import {
  createVideoFramePreviewSession,
  getCachedVideoFrame,
  VideoFramePreviewSession
} from '../helper/videoFrameCapture';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  ArrowLeft,
  RotateCw,
  RotateCcw,
  SkipForward,
  Subtitles,
  Sliders,
  AlertTriangle,
  Loader2,
  ChevronRight,
  ChevronDown,
  AudioLines,
  Settings2,
  Crop,
  Film,
  FolderOpen
} from 'lucide-react';

const DEFAULT_SUBTITLE_STYLE: SubtitleStyleSettings = {
  preset: 'default',
  fontSize: 20,
  fontFamily: 'system-ui, sans-serif',
  textColor: '#ffffff',
  background: 'semi-transparent',
  outline: true,
  verticalPosition: 0
};

const SUBTITLE_STYLE_PRESETS: Record<SubtitleStyleSettings['preset'], SubtitleStyleSettings> = {
  default: DEFAULT_SUBTITLE_STYLE,
  'high-contrast': {
    preset: 'high-contrast',
    fontSize: 24,
    fontFamily: 'system-ui, sans-serif',
    textColor: '#ffff00',
    background: 'solid',
    outline: true,
    verticalPosition: 0
  },
  'large-text': {
    preset: 'large-text',
    fontSize: 32,
    fontFamily: 'system-ui, sans-serif',
    textColor: '#ffffff',
    background: 'semi-transparent',
    outline: true,
    verticalPosition: 0
  },
  minimal: {
    preset: 'minimal',
    fontSize: 20,
    fontFamily: 'system-ui, sans-serif',
    textColor: '#ffffff',
    background: 'none',
    outline: false,
    verticalPosition: 0
  },
  custom: {
    ...DEFAULT_SUBTITLE_STYLE,
    preset: 'custom'
  }
};

const SUBTITLE_FONT_FAMILIES = [
  { label: 'System default', value: 'system-ui, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' }
];

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const normalizeSubtitleStyle = (value: unknown): SubtitleStyleSettings => {
  const style = typeof value === 'object' && value !== null
    ? value as Partial<SubtitleStyleSettings>
    : {};
  const presets: SubtitleStyleSettings['preset'][] = ['default', 'high-contrast', 'large-text', 'minimal', 'custom'];
  const backgrounds: SubtitleStyleSettings['background'][] = ['none', 'semi-transparent', 'solid'];
  const fontFamilies = SUBTITLE_FONT_FAMILIES.map(font => font.value);

  return {
    preset: style.preset && presets.includes(style.preset) ? style.preset : DEFAULT_SUBTITLE_STYLE.preset,
    fontSize: typeof style.fontSize === 'number' && Number.isFinite(style.fontSize)
      ? Math.min(48, Math.max(8, style.fontSize))
      : DEFAULT_SUBTITLE_STYLE.fontSize,
    fontFamily: style.fontFamily && fontFamilies.includes(style.fontFamily)
      ? style.fontFamily
      : DEFAULT_SUBTITLE_STYLE.fontFamily,
    textColor: typeof style.textColor === 'string' && /^#[\da-f]{6}$/i.test(style.textColor)
      ? style.textColor
      : DEFAULT_SUBTITLE_STYLE.textColor,
    background: style.background && backgrounds.includes(style.background)
      ? style.background
      : DEFAULT_SUBTITLE_STYLE.background,
    outline: typeof style.outline === 'boolean' ? style.outline : DEFAULT_SUBTITLE_STYLE.outline,
    verticalPosition: typeof style.verticalPosition === 'number' && Number.isFinite(style.verticalPosition)
      ? Math.min(50, Math.max(0, Math.round(style.verticalPosition)))
      : DEFAULT_SUBTITLE_STYLE.verticalPosition
  };
};

const getNativeSubPos = (verticalPosition: number, controlsVisible: boolean): string =>
  String(100 - Math.max(verticalPosition, controlsVisible ? 16 : 0));

interface NativeAudioTrack {
  label?: string;
  language?: string;
  enabled: boolean;
}

interface NativeAudioTrackList {
  length: number;
  [index: number]: NativeAudioTrack;
}

interface VideoWithAudioTracks extends HTMLVideoElement {
  audioTracks?: NativeAudioTrackList;
}

interface EmbeddedSubtitleTrack {
  id: string;
  label: string;
  track: TextTrack;
}

export interface VideoPlayerModalProps {
  media: Media;
  activeFile: LocalFile;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  initialPosition?: number;
  previewFrame?: string | null;
  previewSourceRect?: { left: number; top: number; width: number; height: number } | null;
  allLocalFiles?: LocalFile[];
  initialFillToScreen?: boolean;
  onClose: () => void;
  onPlaybackCompleted?: () => Promise<void>;
  onEpisodeChange?: (nextFile: LocalFile, season?: number, episode?: number, title?: string, position?: number) => void;
}

function formatAirDate(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const d = new Date(year, month, day);
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }
  } catch {
    // fallback
  }
  return dateStr;
}

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

export const VideoPlayerModal: React.FC<VideoPlayerModalProps> = ({
  media,
  activeFile,
  seasonNumber = activeFile.season || 1,
  episodeNumber = activeFile.episode || 1,
  episodeTitle,
  initialPosition = 0,
  previewFrame,
  previewSourceRect,
  allLocalFiles = [],
  initialFillToScreen = false,
  onClose,
  onPlaybackCompleted,
  onEpisodeChange
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Responsive mobile portrait state (< 640px and portrait orientation, or any portrait orientation on Android)
  const [isMobilePortrait, setIsMobilePortrait] = useState(() =>
    typeof window !== 'undefined'
      ? (isAndroid ? window.innerHeight >= window.innerWidth : (window.innerWidth < 640 && window.innerHeight >= window.innerWidth))
      : false
  );
  const [windowSize, setWindowSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 720
  }));
  const [allProgress, setAllProgress] = useState<PlaybackProgress[]>([]);

  useEffect(() => {
    let animFrame: number | null = null;
    const handleResize = () => {
      if (animFrame !== null) return;
      animFrame = requestAnimationFrame(() => {
        animFrame = null;
        setWindowSize({
          width: window.innerWidth,
          height: window.innerHeight
        });
        setIsMobilePortrait(
          isAndroid
            ? window.innerHeight >= window.innerWidth
            : (window.innerWidth < 640 && window.innerHeight >= window.innerWidth)
        );
      });
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      if (animFrame !== null) cancelAnimationFrame(animFrame);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  const initialWindowedRef = useRef<boolean | null>(null);

  const applyFullscreen = useCallback(async (fullscreen: boolean): Promise<boolean> => {
    if (isAndroid) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_screen_orientation', { orientation: fullscreen ? 'landscape' : 'portrait' });
        return true;
      } catch (err) {
        console.warn('Android orientation change failed:', err);
        return false;
      }
    }

    if (isTauri) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_fullscreen', { fullscreen });
        return true;
      } catch {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          await getCurrentWindow().setFullscreen(fullscreen);
          return true;
        } catch (err) {
          console.warn('Tauri setFullscreen failed:', err);
        }
      }
    }

    if (typeof document !== 'undefined') {
      try {
        if (fullscreen) {
          if (!document.fullscreenElement && containerRef.current) {
            await containerRef.current.requestFullscreen();
          }
        } else {
          if (document.fullscreenElement) {
            await document.exitFullscreen();
          }
        }
        return true;
      } catch (err) {
        console.warn('DOM fullscreen failed:', err);
      }
    }
    return false;
  }, []);

  const queryFullscreenState = useCallback(async (): Promise<boolean> => {
    if (isTauri && !isAndroid) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<boolean>('is_fullscreen');
      } catch {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          return await getCurrentWindow().isFullscreen();
        } catch {
          return false;
        }
      }
    }
    return Boolean(document.fullscreenElement);
  }, []);

  useEffect(() => {
    let unlistenTauriFs: (() => void) | undefined;
    if (isTauri && !isAndroid) {
      void queryFullscreenState().then(isFs => {
        if (initialWindowedRef.current === null) {
          initialWindowedRef.current = !isFs;
        }
        setIsFullscreen(true);
        if (!isFs) {
          void applyFullscreen(true);
        }
      });

      import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        const win = getCurrentWindow();
        win.onResized(() => {
          void queryFullscreenState().then(isFs => setIsFullscreen(isFs));
        }).then(unlisten => {
          unlistenTauriFs = unlisten;
        }).catch(() => {});
      }).catch(() => {});
    }

    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      if (unlistenTauriFs) unlistenTauriFs();
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [applyFullscreen, queryFullscreenState]);

  useLayoutEffect(() => {
    document.documentElement.classList.add('video-player-active');
    document.body.classList.add('video-player-active');
    return () => {
      document.documentElement.classList.remove('video-player-active');
      document.body.classList.remove('video-player-active');
      if (isTauri && !isAndroid && initialWindowedRef.current) {
        void applyFullscreen(false);
      }
      if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
        import('@tauri-apps/api/core').then(({ invoke }) => {
          void invoke('set_screen_orientation', { orientation: 'user' });
        }).catch(() => {});
      }
      void nativePlayerService.destroy();
    };
  }, [applyFullscreen]);

  const [useNativePlayer, setUseNativePlayer] = useState<boolean>(() => Boolean(isTauri));
  const [engineFallbackReason, setEngineFallbackReason] = useState<string | null>(null);

  useEffect(() => {
    if (media.type !== 'TV Series') return;
    let isMounted = true;
    dbService.getAllPlaybackProgressForMedia(media.id).then(progs => {
      if (isMounted) setAllProgress(progs);
    }).catch(err => {
      console.warn('Failed to load playback progress for media episodes:', err);
    });
    return () => {
      isMounted = false;
    };
  }, [media.id, seasonNumber, episodeNumber]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const currentTimeRef = useRef<number>(0);
  const durationRef = useRef<number>(0);

  // Stream URL state
  const [streamUrl, setStreamUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [showSpinner, setShowSpinner] = useState<boolean>(!previewFrame);
  const [videoFrameReady, setVideoFrameReady] = useState<boolean>(false);
  const initialSeekDoneRef = useRef<boolean>(false);
  const initialSeekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shouldMorphPreview = Boolean(previewFrame && previewSourceRect && !initialFillToScreen && !isMobilePortrait);
  const [isPreviewMorphing, setIsPreviewMorphing] = useState<boolean>(shouldMorphPreview);
  const [morphRect, setMorphRect] = useState<{ left: number; top: number; width: number; height: number } | null>(
    () => (shouldMorphPreview && previewSourceRect ? previewSourceRect : null)
  );
  const previewImgRef = useRef<HTMLImageElement>(null);
  const morphStartedRef = useRef<boolean>(false);

  const startPreviewMorph = useCallback((imgEl: HTMLImageElement | null) => {
    if (!shouldMorphPreview || !previewSourceRect || morphStartedRef.current) return;
    morphStartedRef.current = true;

    const viewW = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const viewH = typeof window !== 'undefined' ? window.innerHeight : 720;
    const natW = imgEl?.naturalWidth || 16;
    const natH = imgEl?.naturalHeight || 9;
    const imgAspect = natW / Math.max(1, natH);
    const viewAspect = viewW / Math.max(1, viewH);

    let targetW = viewW;
    let targetH = viewH;
    let targetLeft = 0;
    let targetTop = 0;

    if (imgAspect > viewAspect) {
      targetW = viewW;
      targetH = viewW / imgAspect;
      targetTop = (viewH - targetH) / 2;
    } else {
      targetH = viewH;
      targetW = viewH * imgAspect;
      targetLeft = (viewW - targetW) / 2;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setMorphRect({ left: targetLeft, top: targetTop, width: targetW, height: targetH });
      });
    });
  }, [previewSourceRect, shouldMorphPreview]);

  useEffect(() => {
    if (!shouldMorphPreview) {
      setIsPreviewMorphing(false);
      return;
    }
    const imgEl = previewImgRef.current;
    if (imgEl && imgEl.complete && imgEl.naturalWidth > 0) {
      startPreviewMorph(imgEl);
    }
    const timer = setTimeout(() => {
      setIsPreviewMorphing(false);
    }, 440);
    return () => clearTimeout(timer);
  }, [shouldMorphPreview, startPreviewMorph]);

  useEffect(() => {
    if (!loading) {
      setShowSpinner(false);
      return;
    }
    if (!previewFrame) {
      setShowSpinner(true);
      return;
    }
    const timer = setTimeout(() => {
      setShowSpinner(true);
    }, 250);
    return () => clearTimeout(timer);
  }, [loading, previewFrame]);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const volumeRef = useRef<number>(1);
  const isMutedRef = useRef<boolean>(false);
  const [audioSettingsLoaded, setAudioSettingsLoaded] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => Boolean(isTauri && !isAndroid));
  const [fillVideoToScreen, setFillVideoToScreen] = useState<boolean>(() => Boolean(initialFillToScreen));
  const [fillSettingsLoaded, setFillSettingsLoaded] = useState<boolean>(false);

  const showPortraitLayout = isMobilePortrait && !isFullscreen;
  const showWindowControls = !isFullscreen && !isAndroid && !showPortraitLayout;
  const showPortraitLayoutRef = useRef(showPortraitLayout);
  useEffect(() => {
    showPortraitLayoutRef.current = showPortraitLayout;
  }, [showPortraitLayout]);

  const fillVideoToScreenRef = useRef(Boolean(initialFillToScreen));
  useEffect(() => {
    fillVideoToScreenRef.current = fillVideoToScreen;
  }, [fillVideoToScreen]);

  const showControlsRef = useRef(true);
  const isNarrowScreen = showPortraitLayout || windowSize.width < 640 || windowSize.height < 500;

  // Subtitles & Audio Tracks
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [embeddedSubtitleTracks, setEmbeddedSubtitleTracks] = useState<EmbeddedSubtitleTrack[]>([]);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string>('off');
  const [subtitleTracksLoaded, setSubtitleTracksLoaded] = useState<boolean>(false);
  const [videoMetadataLoaded, setVideoMetadataLoaded] = useState<boolean>(false);
  const [subtitleAutoSelectionDone, setSubtitleAutoSelectionDone] = useState<boolean>(false);
  const [lastSelectedSubtitleId, setLastSelectedSubtitleId] = useState(0);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [activeSubtitleText, setActiveSubtitleText] = useState('');
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyleSettings>(DEFAULT_SUBTITLE_STYLE);
  const subtitleVerticalPosRef = useRef<number>(subtitleStyle.verticalPosition);
  subtitleVerticalPosRef.current = subtitleStyle.verticalPosition;
  const [subtitleStyleLoaded, setSubtitleStyleLoaded] = useState(false);
  const [showSubtitleStyleEditor, setShowSubtitleStyleEditor] = useState(false);
  const [showSpeedPicker, setShowSpeedPicker] = useState(false);
  const [showSubtitlePicker, setShowSubtitlePicker] = useState(false);
  const [showAudioPicker, setShowAudioPicker] = useState(false);
  const [audioTracks, setAudioTracks] = useState<{ id: string; label: string }[]>([]);
  const extractedAudioTracksRef = useRef<{ id: string; label: string }[]>([]);
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<string>('');
  const lastNativeAidRef = useRef<string | null>(null);
  const lastNativeSidRef = useRef<string | null>(null);
  const subtitleAutoSelectionDoneRef = useRef(false);
  const [audioTrackSupport, setAudioTrackSupport] = useState<boolean | null>(null);
  const subtitleTrackElementsRef = useRef(new Map<string, HTMLTrackElement>());

  // UI Control visibility state
  const [showControls, setShowControls] = useState<boolean>(true);
  showControlsRef.current = showControls;
  const [cursorPointerOverride, setCursorPointerOverride] = useState(false);
  const [showSeekLeft, setShowSeekLeft] = useState(false);
  const [showSeekRight, setShowSeekRight] = useState(false);
  const [showVolumeChange, setShowVolumeChange] = useState(false);
  const [playbackNotice, setPlaybackNotice] = useState('');
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorOverrideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isEpisodePickerOpen, setIsEpisodePickerOpen] = useState(false);
  const isEpisodePickerOpenRef = useRef(false);
  isEpisodePickerOpenRef.current = isEpisodePickerOpen;
  const [selectedPickerSeason, setSelectedPickerSeason] = useState(seasonNumber);
  const [isHoveringNextEp, setIsHoveringNextEp] = useState(false);
  const [hoverSeekState, setHoverSeekState] = useState<{
    time: number;
    percent: number;
    frame: string | null;
    isLoading: boolean;
  } | null>(null);
  const seekInputRef = useRef<HTMLInputElement>(null);
  const volumeInputRef = useRef<HTMLInputElement>(null);
  const isScrubbingRef = useRef(false);
  const isPointerOverSeekbarRef = useRef(false);
  const previewSessionRef = useRef<VideoFramePreviewSession | null>(null);
  const hoverSeekDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestHoverSeekTimeRef = useRef<number | null>(null);

  const isAnyPanelOpen = isEpisodePickerOpen || showSpeedPicker || showSubtitlePicker || showSubtitleStyleEditor || showAudioPicker;
  const isAnyPanelOpenRef = useRef(false);
  isAnyPanelOpenRef.current = isAnyPanelOpen;

  const closeAllPanels = useCallback(() => {
    setIsEpisodePickerOpen(false);
    setShowSpeedPicker(false);
    setShowSubtitlePicker(false);
    setShowSubtitleStyleEditor(false);
    setShowAudioPicker(false);
  }, []);

  // Android back button & mobile sheet popstate handling
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.history.pushState({ isVideoPlayer: true }, '');

    const handleCloseSheets = (event: Event) => {
      if (isAnyPanelOpenRef.current) {
        closeAllPanels();
        event.preventDefault();
        return;
      }
      event.preventDefault();
      onClose();
    };

    window.addEventListener('close-mobile-sheets', handleCloseSheets);
    return () => {
      window.removeEventListener('close-mobile-sheets', handleCloseSheets);
    };
  }, [closeAllPanels, onClose]);

  const episodeListRef = useRef<HTMLDivElement>(null);

  const togglePlayerPanel = (
    panel: 'episode' | 'speed' | 'subtitle' | 'subtitleStyle' | 'audio'
  ) => {
    setIsEpisodePickerOpen(current => panel === 'episode' ? !current : false);
    setShowSpeedPicker(current => panel === 'speed' ? !current : false);
    setShowSubtitlePicker(current => panel === 'subtitle' ? !current : false);
    setShowSubtitleStyleEditor(current => panel === 'subtitleStyle' ? !current : false);
    setShowAudioPicker(current => panel === 'audio' ? !current : false);
  };

  const showPlaybackNotice = useCallback((message: string) => {
    setPlaybackNotice(message);
    if (playbackNoticeTimerRef.current) clearTimeout(playbackNoticeTimerRef.current);
    playbackNoticeTimerRef.current = setTimeout(() => setPlaybackNotice(''), 1800);
  }, []);

  const handleSkipSeek = useCallback((targetTime: number) => {
    if (useNativePlayer) {
      void nativePlayerService.seek(targetTime);
      setCurrentTime(targetTime);
      currentTimeRef.current = targetTime;
    } else if (videoRef.current) {
      videoRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
    }
  }, [useNativePlayer]);

  const {
    activeSkipSegment,
    skipSegments,
    handleSkipClick,
    handleTimeUpdate: handleSkipTimeUpdate,
    notifySeek: notifySkipSeek
  } = useSkipDetection({
    media,
    seasonNumber,
    episodeNumber,
    onSeek: handleSkipSeek,
    showNotice: showPlaybackNotice
  });

  useEffect(() => () => {
    if (playbackNoticeTimerRef.current) clearTimeout(playbackNoticeTimerRef.current);
  }, []);

  useEffect(() => {
    if (isEpisodePickerOpen && episodeListRef.current) {
      const activeElement = episodeListRef.current.querySelector('[data-current-episode="true"]');
      if (activeElement) {
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }
  }, [isEpisodePickerOpen, selectedPickerSeason]);

  // Next Episode Countdown state
  const [showNextCountdown, setShowNextCountdown] = useState<boolean>(false);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(5);
  const [countdownCancelled, setCountdownCancelled] = useState<boolean>(false);
  const countdownIntervalRef = useRef<any>(null);

  // Settings: Autoplay Next
  const [autoplayNextSetting, setAutoplayNextSetting] = useState<boolean>(true);

  // Save Progress Throttle
  const lastSavedPosRef = useRef<number>(0);
  const completionNotificationKeyRef = useRef<string | null>(null);

  const volumeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [mkvParsing, setMkvParsing] = useState<boolean>(false);

  // Find Next Episode
  const getNextEpisodeFile = useCallback((): { file: LocalFile; season: number; episode: number } | null => {
    if (media.type !== 'TV Series') return null;

    // First check if a local file exists for season, episode + 1
    let nextEp = episodeNumber + 1;
    let nextSeason = seasonNumber;

    let match = allLocalFiles.find(f =>
      f.exists && (!f.media_id || f.media_id === media.id) &&
      Number(f.season) === nextSeason && Number(f.episode) === nextEp
    );

    // If not found, check if next season exists (season + 1, ep 1)
    if (!match) {
      nextSeason = seasonNumber + 1;
      nextEp = 1;
      match = allLocalFiles.find(f =>
        f.exists && (!f.media_id || f.media_id === media.id) &&
        Number(f.season) === nextSeason && Number(f.episode) === nextEp
      );
    }

    if (match) {
      return { file: match, season: nextSeason, episode: nextEp };
    }
    return null;
  }, [media, seasonNumber, episodeNumber, allLocalFiles]);

  const nextEpInfo = useMemo(() => getNextEpisodeFile(), [getNextEpisodeFile]);
  const pickerSeasons = useMemo(() => {
    const seasonsSet = new Set<number>();
    allLocalFiles
      .filter(file => file.exists && file.season !== undefined && file.episode !== undefined)
      .forEach(file => seasonsSet.add(file.season!));
    if (media.seasons && media.seasons.length > 0) {
      media.seasons.forEach(s => {
        if (s.season_number > 0) seasonsSet.add(s.season_number);
      });
    }
    if (seasonsSet.size === 0) {
      seasonsSet.add(seasonNumber);
    }
    return Array.from(seasonsSet).sort((a, b) => a - b);
  }, [allLocalFiles, media.seasons, seasonNumber]);

  useEffect(() => {
    setSelectedPickerSeason(seasonNumber);
  }, [seasonNumber]);

  const getEpisodeDetails = useCallback((season?: number, episode?: number) => {
    if (season === undefined || episode === undefined) return undefined;
    return media.seasons
      ?.find(item => Number(item.season_number) === Number(season))
      ?.episodes?.find(item => Number(item.episode_number) === Number(episode));
  }, [media.seasons]);

  const getEpisodeTitle = useCallback((file: LocalFile, season?: number, episode?: number) => {
    const s = season ?? file.season;
    const ep = episode ?? file.episode;
    const details = getEpisodeDetails(s, ep);
    return details?.name || file.parsed_title || file.filename;
  }, [getEpisodeDetails]);

  const currentEpisodeDetails = useMemo(() => {
    return getEpisodeDetails(seasonNumber, episodeNumber);
  }, [getEpisodeDetails, seasonNumber, episodeNumber]);

  const currentEpisodeName = useMemo(() => {
    return currentEpisodeDetails?.name
      || (episodeTitle && !episodeTitle.includes('.') && episodeTitle !== activeFile?.filename ? episodeTitle : null)
      || activeFile?.parsed_title
      || activeFile?.filename;
  }, [currentEpisodeDetails?.name, episodeTitle, activeFile?.filename, activeFile?.parsed_title]);

  const nextEpDetails = useMemo(
    () => (nextEpInfo ? getEpisodeDetails(nextEpInfo.season, nextEpInfo.episode) : undefined),
    [getEpisodeDetails, nextEpInfo]
  );

  const blurPlayerSlider = useCallback((el: HTMLInputElement | null, stopScrubbing: boolean = false) => {
    if (el) {
      el.blur();
    }
    if (stopScrubbing) {
      isScrubbingRef.current = false;
      if (!isPointerOverSeekbarRef.current) {
        setHoverSeekState(null);
      }
    }
  }, []);

  const handleSliderPointerDown = useCallback((el: HTMLInputElement | null, isSeekSlider: boolean = false) => {
    if (isSeekSlider) {
      isScrubbingRef.current = true;
    }
    const finish = () => {
      blurPlayerSlider(el, isSeekSlider);
    };
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('mouseup', finish, { once: true });
    window.addEventListener('touchend', finish, { once: true });
  }, [blurPlayerSlider]);

  useEffect(() => {
    setIsHoveringNextEp(false);
    setHoverSeekState(null);
    latestHoverSeekTimeRef.current = null;
  }, [activeFile.path]);

  useEffect(() => {
    if (!showControls && !isScrubbingRef.current) {
      setHoverSeekState(null);
      setIsHoveringNextEp(false);
    }
  }, [showControls]);

  useEffect(() => {
    if (!videoFrameReady && !streamUrl) return;

    let cancelled = false;
    let objectUrlToRevoke: string | null = null;

    const initPreviewSession = async () => {
      let resolvedUrl = streamUrl;
      if (!resolvedUrl) {
        const selectedFile = localScannerService.getWebSelectedFile(media.type, activeFile.path);
        if (selectedFile) {
          objectUrlToRevoke = URL.createObjectURL(selectedFile);
          resolvedUrl = objectUrlToRevoke;
        } else if (isTauri) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            if (!activeFile.path.startsWith('content://')) {
              await invoke('grant_video_files_access', { videoPath: activeFile.path }).catch(() => {});
            }
            resolvedUrl = await invoke<string>('get_video_stream_url', { filePath: activeFile.path });
          } catch (err) {
            console.warn('[VideoPlayerModal] Failed to resolve preview stream URL:', err);
          }
        } else {
          resolvedUrl = activeFile.path;
        }
      }

      if (cancelled || !resolvedUrl) {
        if (objectUrlToRevoke) URL.revokeObjectURL(objectUrlToRevoke);
        return;
      }

      previewSessionRef.current?.dispose();
      previewSessionRef.current = createVideoFramePreviewSession(resolvedUrl, activeFile.path);
    };

    void initPreviewSession();

    return () => {
      cancelled = true;
      if (hoverSeekDebounceRef.current) {
        clearTimeout(hoverSeekDebounceRef.current);
        hoverSeekDebounceRef.current = null;
      }
      previewSessionRef.current?.dispose();
      previewSessionRef.current = null;
      if (objectUrlToRevoke) {
        URL.revokeObjectURL(objectUrlToRevoke);
      }
    };
  }, [activeFile.path, media.type, streamUrl, videoFrameReady]);

  const updateHoverSeekPreview = useCallback((clientX: number, rect: DOMRect) => {
    const effectiveDuration = duration > 0 ? duration : durationRef.current;
    if (effectiveDuration <= 0 || rect.width <= 0) return;

    const percent = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const hoverTime = percent * effectiveDuration;
    latestHoverSeekTimeRef.current = hoverTime;

    const cached = getCachedVideoFrame(activeFile.path, hoverTime);
    setHoverSeekState(prev => ({
      time: hoverTime,
      percent,
      frame: cached ?? (prev && Math.abs(prev.time - hoverTime) < 1.5 ? prev.frame : null),
      isLoading: !cached && Boolean(previewSessionRef.current)
    }));

    if (cached) {
      if (hoverSeekDebounceRef.current) {
        clearTimeout(hoverSeekDebounceRef.current);
        hoverSeekDebounceRef.current = null;
      }
      return;
    }

    if (!previewSessionRef.current) return;

    if (hoverSeekDebounceRef.current) {
      clearTimeout(hoverSeekDebounceRef.current);
    }
    hoverSeekDebounceRef.current = setTimeout(() => {
      hoverSeekDebounceRef.current = null;
      const session = previewSessionRef.current;
      if (!session) return;
      void session.requestFrame(hoverTime).then(frame => {
        const latest = latestHoverSeekTimeRef.current;
        if (latest === null || Math.abs(latest - hoverTime) > Math.max(2, effectiveDuration * 0.02)) {
          return;
        }
        setHoverSeekState(prev => (
          prev
            ? { ...prev, frame: frame ?? prev.frame, isLoading: false }
            : null
        ));
      });
    }, 35);
  }, [activeFile.path, duration]);

  const selectSubtitle = useCallback((id: string) => {
    setSelectedSubtitleId(id);
    const trackId = id.startsWith('sidecar:') ? id.slice('sidecar:'.length) : id;
    const track = [...subtitleTracks, ...embeddedSubtitleTracks].find(item => item.id === trackId);
    showPlaybackNotice(id === 'off' ? 'Subtitles Off' : track?.label || 'Subtitle changed');
    if (useNativePlayer) {
      const nativeId = id === 'off' ? 'no' : trackId;
      lastNativeSidRef.current = nativeId;
      void nativePlayerService.setSubtitleTrack(nativeId);
    }
  }, [subtitleTracks, embeddedSubtitleTracks, showPlaybackNotice, useNativePlayer]);

  const handleLoadCustomSubtitle = useCallback(async () => {
    if (!isTauri) {
      showPlaybackNotice('Custom subtitle loading requires desktop or Android app');
      return;
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      let pickedPath: string | null = null;

      if (isAndroid) {
        type AndroidFsUri = { uri: string; documentTopTreeUri: string | null };
        const selected = await invoke<AndroidFsUri[]>('plugin:android-fs|show_open_file_picker', {
          mimeTypes: ['*/*'],
          multiple: false,
          pickerType: 'FilePicker',
          needWritePermission: false,
          localOnly: true,
          initialLocation: null
        });
        if (selected.length > 0) {
          await invoke<void>('plugin:android-fs|persist_picker_uri_permission', {
            uri: selected[0]
          });
          pickedPath = selected[0].uri;
        }
      } else {
        pickedPath = await invoke<string | null>('select_subtitle_file');
      }

      if (!pickedPath) return;

      await dbService.saveCustomSubtitleForFile(activeFile.id, pickedPath);

      if (useNativePlayer) {
        await nativePlayerService.addSubtitleFile(pickedPath);
        showPlaybackNotice('Loaded custom subtitle');
      } else {
        const track = await subtitleService.loadCustomSubtitleTrack(pickedPath);
        setSubtitleTracks(prev => [...prev.filter(t => t.id !== track.id), track]);
        setSubtitleTracksLoaded(true);
        selectSubtitle(`sidecar:${track.id}`);
      }
      setShowSubtitlePicker(false);
    } catch (err) {
      console.error('Failed to load custom subtitle:', err);
      showPlaybackNotice('Could not load custom subtitle');
    }
  }, [activeFile.id, selectSubtitle, showPlaybackNotice, useNativePlayer]);

  const selectAudioTrack = useCallback((trackId: string) => {
    setSelectedAudioTrackId(trackId);
    const track = audioTracks.find(item => item.id === trackId);
    showPlaybackNotice(track?.label ? `Audio: ${track.label}` : 'Audio track changed');
    if (useNativePlayer) {
      lastNativeAidRef.current = trackId;
      void nativePlayerService.setAudioTrack(trackId);
    } else {
      const tracks = (videoRef.current as VideoWithAudioTracks | null)?.audioTracks;
      if (tracks) {
        for (let index = 0; index < tracks.length; index++) {
          tracks[index].enabled = String(index) === trackId;
        }
      }
    }
  }, [audioTracks, showPlaybackNotice, useNativePlayer]);

  const cycleAudio = useCallback((reverse: boolean = false) => {
    if (audioTracks.length === 0) return;
    let currentIndex = audioTracks.findIndex(t => t.id === selectedAudioTrackId);
    let nextIndex = 0;
    if (currentIndex >= 0) {
      nextIndex = reverse
        ? (currentIndex - 1 + audioTracks.length) % audioTracks.length
        : (currentIndex + 1) % audioTracks.length;
    }
    const target = audioTracks[nextIndex];
    if (target) {
      selectAudioTrack(target.id);
    }
  }, [audioTracks, selectedAudioTrackId, selectAudioTrack]);
  
    const cycleSubtitles = useCallback(() => {
     // Toggle on/off between available tracks and "off"
     const allTracks = [...subtitleTracks, ...embeddedSubtitleTracks];

     if (allTracks.length === 0) return;

     let currentIndex = allTracks.findIndex(track =>
       selectedSubtitleId === `sidecar:${track.id}` || selectedSubtitleId === track.id
     );

     if (currentIndex >= 0) {
       // If currently enabled, move to next (or off at end)
       currentIndex = (currentIndex + 1) % (allTracks.length + 1);
       setLastSelectedSubtitleId(currentIndex);
     } else {
       // Start from beginning
       currentIndex = allTracks.length > 0 ? 0 : 0;
     }

     const targetTrack = currentIndex >= allTracks.length
       ? 'off'
       : `sidecar:${allTracks[currentIndex].id}`;

     selectSubtitle(targetTrack);
   }, [selectedSubtitleId, subtitleTracks, embeddedSubtitleTracks, lastSelectedSubtitleId, selectSubtitle]);

   const toggleSubtitles = useCallback(() => {
     // Toggle on/off between available tracks and "off"
     const allTracks = [...subtitleTracks, ...embeddedSubtitleTracks];

     if (allTracks.length === 0) return;

     let currentIndex = allTracks.findIndex(track =>
       selectedSubtitleId === `sidecar:${track.id}` || selectedSubtitleId === track.id
     );

     if (currentIndex < 0) {
      if(lastSelectedSubtitleId >= 0 && lastSelectedSubtitleId < allTracks.length)
        currentIndex = lastSelectedSubtitleId;
      else
        currentIndex = 0;
     } else {
       setLastSelectedSubtitleId(currentIndex);
       currentIndex = allTracks.length;
     }

     const targetTrack = currentIndex >= allTracks.length
       ? 'off'
       : `sidecar:${allTracks[currentIndex].id}`;

     selectSubtitle(targetTrack);
   }, [selectedSubtitleId, subtitleTracks, embeddedSubtitleTracks, setLastSelectedSubtitleId, selectSubtitle]);

  // Load Settings
  useEffect(() => {
    dbService.getSettings().then(s => {
      setAutoplayNextSetting(s.autoplay_next_episode !== false);
      const audioSettings = s.player_audio_settings;
      if (audioSettings && Number.isFinite(audioSettings.volume)) {
        const loadedVol = Math.min(1, Math.max(0, audioSettings.volume));
        const loadedMuted = audioSettings.muted === true;
        setVolume(loadedVol);
        setIsMuted(loadedMuted);
        volumeRef.current = loadedVol;
        isMutedRef.current = loadedMuted;
        if (useNativePlayer) {
          void nativePlayerService.setVolume(loadedVol * 100);
          void nativePlayerService.setMute(loadedMuted || loadedVol === 0);
        }
      }
      if (typeof s.player_fill_to_screen === 'boolean') {
        setFillVideoToScreen(s.player_fill_to_screen);
        fillVideoToScreenRef.current = s.player_fill_to_screen;
      }
      setFillSettingsLoaded(true);
      setSubtitleStyle(normalizeSubtitleStyle(s.player_subtitle_style));
      setSubtitleStyleLoaded(true);
      setAudioSettingsLoaded(true);
    }).catch(error => {
      console.error('Failed to load player settings:', error);
    });
  }, [useNativePlayer]);

  useEffect(() => {
    if (!fillSettingsLoaded) return;
    void dbService.saveSetting('player_fill_to_screen', fillVideoToScreen).catch(error => {
      console.error('Failed to save fill video setting:', error);
    });
  }, [fillVideoToScreen, fillSettingsLoaded]);

  useEffect(() => {
    if (!subtitleStyleLoaded) return;
    void dbService.saveSetting('player_subtitle_style', subtitleStyle).catch(error => {
      console.error('Failed to save subtitle style:', error);
    });
    if (useNativePlayer) {
      void nativePlayerService.setProperty('sub-use-margins', 'no');
      void nativePlayerService.setProperty('sub-scale-by-window', showPortraitLayout ? 'no' : 'yes');
      void nativePlayerService.setProperty('sub-ass-scale-with-window', showPortraitLayout ? 'no' : 'yes');
      const baseFontSize = isAndroid ? 26 : DEFAULT_SUBTITLE_STYLE.fontSize * 2;
      void nativePlayerService.setProperty('sub-font-size', String(baseFontSize));
      if (subtitleStyle.fontSize) {
        const subScale = subtitleStyle.fontSize / DEFAULT_SUBTITLE_STYLE.fontSize;
        void nativePlayerService.setProperty('sub-scale', subScale.toFixed(3));
      }
      if (subtitleStyle.textColor) {
        void nativePlayerService.setProperty('sub-color', subtitleStyle.textColor);
      }
      if (subtitleStyle.outline !== undefined) {
        void nativePlayerService.setProperty('sub-border-size', subtitleStyle.outline ? '3' : '0');
      }
      if (subtitleStyle.fontFamily) {
        const rawFont = subtitleStyle.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
        const cleanFont = rawFont === 'system-ui' ? 'sans-serif' : rawFont;
        void nativePlayerService.setProperty('sub-font', cleanFont);
      }
      if (subtitleStyle.background === 'none') {
        void nativePlayerService.setProperty('sub-border-style', 'outline-and-shadow');
        void nativePlayerService.setProperty('sub-back-color', '0.0/0.0/0.0/0.0');
        void nativePlayerService.setProperty('sub-shadow-offset', '0');
      } else {
        const backColor = subtitleStyle.background === 'solid'
          ? '0.0/0.0/0.0/1.0'
          : '0.0/0.0/0.0/0.65';
        void nativePlayerService.setProperty('sub-border-style', 'background-box');
        void nativePlayerService.setProperty('sub-back-color', backColor);
        void nativePlayerService.setProperty('sub-shadow-offset', '4');
      }
      // 'scale' respects author-styled subtitles (ASS/SSA), while applying appearance settings to plain text (SRT/VTT)
      void nativePlayerService.setProperty('sub-ass-override', 'scale');
    }
  }, [subtitleStyleLoaded, subtitleStyle, useNativePlayer, showPortraitLayout]);

  // Shift subtitles up when on-screen controls are active so controls don't occlude them;
  // Shift subtitles back down when on-screen controls hide
  useEffect(() => {
    if (useNativePlayer) {
      void nativePlayerService.setProperty('sub-use-margins', 'no');
      void nativePlayerService.setProperty('sub-pos', getNativeSubPos(subtitleStyle.verticalPosition, showControls));
    }
  }, [showControls, subtitleStyle.verticalPosition, useNativePlayer]);

  // Adjust video pan & scan (fill vs fit screen)
  const prevFillRef = useRef(fillVideoToScreen);
  useEffect(() => {
    if (useNativePlayer) {
      const effectiveFill = fillVideoToScreen && !showPortraitLayout;
      void nativePlayerService.setProperty('panscan', effectiveFill ? '1.0' : '0.0');
    }
    if (prevFillRef.current !== fillVideoToScreen) {
      prevFillRef.current = fillVideoToScreen;
      showPlaybackNotice(fillVideoToScreen ? 'Fill to Screen' : 'Fit to Screen');
    }
  }, [fillVideoToScreen, showPortraitLayout, useNativePlayer, showPlaybackNotice]);

  // Align video to the top in narrow / portrait view, or center in landscape / fullscreen
  useEffect(() => {
    if (useNativePlayer) {
      void nativePlayerService.setProperty('video-align-y', showPortraitLayout ? '-1.0' : '0.0');
    }
  }, [showPortraitLayout, useNativePlayer]);

  useEffect(() => {
    volumeRef.current = volume;
    isMutedRef.current = isMuted;
    if (!audioSettingsLoaded) return;
    void dbService.saveSetting('player_audio_settings', { volume, muted: isMuted }).catch(error => {
      console.error('Failed to save player audio settings:', error);
    });
    if (useNativePlayer) {
      void nativePlayerService.setVolume(volume * 100);
      void nativePlayerService.setMute(isMuted || volume === 0);
    }
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
      video.muted = isMuted;
    }
  }, [audioSettingsLoaded, volume, isMuted, useNativePlayer]);

  useEffect(() => () => {
    for (const track of subtitleTracks) {
      if (track.url.startsWith('blob:')) URL.revokeObjectURL(track.url);
    }
  }, [subtitleTracks]);

  // Resolve Video Stream URL & Subtitles
  useEffect(() => {
    let isMounted = true;
    let objectUrl: string | undefined;
    setLoading(true);
    setVideoFrameReady(false);
    initialSeekDoneRef.current = false;
    if (initialSeekTimeoutRef.current) {
      clearTimeout(initialSeekTimeoutRef.current);
      initialSeekTimeoutRef.current = null;
    }
    setError(null);
    setStreamUrl('');
    setSubtitleTracks([]);
    setEmbeddedSubtitleTracks([]);
    setSelectedSubtitleId('off');
    setSubtitleTracksLoaded(false);
    setVideoMetadataLoaded(false);
    setSubtitleAutoSelectionDone(false);
    subtitleAutoSelectionDoneRef.current = false;
    setSubtitleError(null);
    setActiveSubtitleText('');
    extractedAudioTracksRef.current = [];
    setAudioTracks([]);
    setSelectedAudioTrackId('');
    setAudioTrackSupport(null);
    setMkvParsing(false);

    const loadSubtitleTracks = async (webFile?: File) => {
      const discoveredTracks: SubtitleTrack[] = [];
      try {
        discoveredTracks.push(...await subtitleService.discoverSubtitlesForVideo(activeFile.path));
      } catch (subtitleLoadError) {
        const message = subtitleLoadError instanceof Error
          ? subtitleLoadError.message
          : String(subtitleLoadError);
        console.error('Failed to discover subtitle tracks:', subtitleLoadError);
        if (isMounted) setSubtitleError(message);
      }

      const isMkv = activeFile.path.toLowerCase().endsWith('.mkv');
      if (isMkv) {
        if (isMounted) setMkvParsing(true);
        try {
          let bytes: ArrayBuffer | Uint8Array;
          let extractedSubtitles;
          let extractedAudioTracks: Array<{ id: string; label: string; language: string; codec: string; name: string; channels: number | null; samplingFrequency: number | null; bitDepth: number | null; }> = [];
          if (webFile) {
            bytes = await webFile.arrayBuffer();
            extractedSubtitles = extractMkvSubtitleTracks(bytes);
            extractedAudioTracks = extractMkvAudioTracks(bytes);
          } else if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
            const { open } = await import('@tauri-apps/plugin-fs');
            const file = await open(activeFile.path);
            const subtitleExtractor = createMkvSubtitleExtractor();
            const audioExtractor = createMkvAudioTrackExtractor();
            const chunk = new Uint8Array(4 * 1024 * 1024);
            try {
              while (true) {
                const bytesRead = await file.read(chunk);
                if (bytesRead === null || bytesRead === 0) break;
                subtitleExtractor.push(chunk.subarray(0, bytesRead));
                audioExtractor.push(chunk.subarray(0, bytesRead));
              }
              extractedSubtitles = subtitleExtractor.finish();
              extractedAudioTracks = audioExtractor.finish();
              console.log(extractedAudioTracks.length)
            } finally {
              await file.close();
            }
          } else {
            throw new Error('The MKV file is not available for embedded subtitle extraction.');
          }

          const extractedTracks = extractedSubtitles.map(track => ({
            id: track.id,
            label: track.label,
            language: track.language,
            url: URL.createObjectURL(new Blob([track.webVtt], { type: 'text/vtt;charset=utf-8' })),
            embedded: true
          }));
          discoveredTracks.push(...extractedTracks);
          console.log(extractedAudioTracks.length);
          if (extractedAudioTracks.length > 0) {
            const mappedAudio = extractedAudioTracks.map(track => ({
              id: track.id,
              label: track.label
            }));
            extractedAudioTracksRef.current = mappedAudio;
            setAudioTracks(mappedAudio);
            setSelectedAudioTrackId(extractedAudioTracks[0].id);
            setAudioTrackSupport(true);
          }
        } catch (subtitleParseError) {
          const message = subtitleParseError instanceof Error
            ? subtitleParseError.message
            : String(subtitleParseError);
          console.error('Failed to extract embedded MKV subtitles:', subtitleParseError);
          if (isMounted) setSubtitleError(message);
        } finally {
          if (isMounted) setMkvParsing(false);
        }
      }

      if (isTauri) {
        try {
          const customSubtitlePaths = await dbService.getCustomSubtitlesForFile(activeFile.id);
          for (const customPath of customSubtitlePaths) {
            if (discoveredTracks.some(track => track.id === customPath)) continue;
            try {
              const customTrack = await subtitleService.loadCustomSubtitleTrack(customPath);
              discoveredTracks.push(customTrack);
            } catch (customErr) {
              console.warn('Failed to load saved custom subtitle:', customPath, customErr);
            }
          }
        } catch (customDbErr) {
          console.warn('Failed to query saved custom subtitles:', customDbErr);
        }
      }

      if (isMounted) {
        setSubtitleTracks(discoveredTracks);
        setSubtitleTracksLoaded(true);
      }
      else {
        for (const track of discoveredTracks) {
          if (track.url.startsWith('blob:')) URL.revokeObjectURL(track.url);
        }
      }
    };

    let cleanupNative = () => {};

    const resolveStream = async () => {
      try {
        if (isTauri) {
          setLoading(true);
          try {
            console.info('[VideoPlayerModal] Initializing native player for:', activeFile.path);
            const ok = await nativePlayerService.init();
            if (ok) {
              console.info('[VideoPlayerModal] Native player initialized successfully');
              if (isMounted) {
                setUseNativePlayer(true);
                setEngineFallbackReason(null);
              }
              let frameSafetyTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
                if (isMounted) {
                  setVideoFrameReady(true);
                  setLoading(false);
                }
              }, 2500);

              const unlistenState = nativePlayerService.onStateChange((state) => {
                if (!isMounted) return;
                setCurrentTime(state.currentTime);
                currentTimeRef.current = state.currentTime;
                if (state.duration > 0) {
                  setDuration(state.duration);
                  durationRef.current = state.duration;
                }
                setIsPlaying(state.isPlaying);
                checkPlaybackProgressRef.current(state.currentTime, state.duration > 0 ? state.duration : durationRef.current);
                if (state.isFrameReady) {
                  if (frameSafetyTimeout) {
                    clearTimeout(frameSafetyTimeout);
                    frameSafetyTimeout = null;
                  }
                  setVideoFrameReady(true);
                  setLoading(false);
                  void nativePlayerService.setProperty('video-align-y', showPortraitLayoutRef.current ? '-1.0' : '0.0');
                  void nativePlayerService.setProperty('panscan', (!showPortraitLayoutRef.current && fillVideoToScreenRef.current) ? '1.0' : '0.0');
                  void nativePlayerService.setProperty('sub-use-margins', 'no');
                  void nativePlayerService.setProperty('sub-scale-by-window', showPortraitLayoutRef.current ? 'no' : 'yes');
                  void nativePlayerService.setProperty('sub-ass-scale-with-window', showPortraitLayoutRef.current ? 'no' : 'yes');
                  void nativePlayerService.setProperty('sub-pos', getNativeSubPos(subtitleVerticalPosRef.current, showControlsRef.current));
                }
                if (state.audioTracks.length > 0) {
                  setAudioTracks(prev => {
                    if (prev.length === state.audioTracks.length &&
                        prev.every((t, i) => t.id === state.audioTracks[i].id && t.label === state.audioTracks[i].title)) {
                      return prev;
                    }
                    return state.audioTracks.map(t => ({ id: t.id, label: t.title }));
                  });
                  setAudioTrackSupport(true);
                  if (state.selectedAudioTrackId) {
                    lastNativeAidRef.current = state.selectedAudioTrackId;
                    setSelectedAudioTrackId(state.selectedAudioTrackId);
                  }
                }
                if (state.subtitleTracks.length > 0) {
                  setSubtitleTracks(prev => {
                    if (prev.length === state.subtitleTracks.length &&
                        prev.every((t, i) => t.id === state.subtitleTracks[i].id && t.label === state.subtitleTracks[i].title)) {
                      return prev;
                    }
                    return state.subtitleTracks.map(t => ({
                      id: t.id,
                      label: t.title,
                      language: t.language || 'und',
                      url: ''
                    }));
                  });
                  setSubtitleTracksLoaded(true);
                  if (state.selectedSubtitleTrackId) {
                    lastNativeSidRef.current = state.selectedSubtitleTrackId;
                    setSelectedSubtitleId(state.selectedSubtitleTrackId);
                  } else if (!subtitleAutoSelectionDoneRef.current) {
                    // Activate first subtitle track if available
                    subtitleAutoSelectionDoneRef.current = true;
                    setSubtitleAutoSelectionDone(true);
                    const firstTrack = state.subtitleTracks[0];
                    lastNativeSidRef.current = firstTrack.id;
                    setSelectedSubtitleId(firstTrack.id);
                    void nativePlayerService.setSubtitleTrack(firstTrack.id);
                  }
                }
                if (state.error) {
                  setError(state.error);
                  setLoading(false);
                }
              });

              const unlistenEnded = nativePlayerService.onEnded(() => {
                if (!isMounted) return;
                setIsPlaying(false);
                saveProgress(durationRef.current, durationRef.current, true);
              });

              try {
                await nativePlayerService.loadFile(activeFile.path, initialPosition);
                console.info('[VideoPlayerModal] File loaded into native player at position:', initialPosition);
                try {
                  const customSubtitlePaths = await dbService.getCustomSubtitlesForFile(activeFile.id);
                  for (const customPath of customSubtitlePaths) {
                    try {
                      await nativePlayerService.addSubtitleFile(customPath);
                    } catch (customSubErr) {
                      console.warn('Failed to load saved custom subtitle into native player:', customPath, customSubErr);
                    }
                  }
                } catch (customDbErr) {
                  console.warn('Failed to query saved custom subtitles:', customDbErr);
                }
                void nativePlayerService.setProperty('video-align-y', showPortraitLayoutRef.current ? '-1.0' : '0.0');
                void nativePlayerService.setProperty('panscan', (!showPortraitLayoutRef.current && fillVideoToScreenRef.current) ? '1.0' : '0.0');
                void nativePlayerService.setProperty('sub-use-margins', 'no');
                void nativePlayerService.setProperty('sub-pos', getNativeSubPos(subtitleVerticalPosRef.current, showControlsRef.current));
                void nativePlayerService.setVolume(volumeRef.current * 100);
                void nativePlayerService.setMute(isMutedRef.current || volumeRef.current === 0);
              } catch (loadErr) {
                console.error('[VideoPlayerModal] Failed to load file in native player:', loadErr);
                throw loadErr;
              }

              cleanupNative = () => {
                if (frameSafetyTimeout) {
                  clearTimeout(frameSafetyTimeout);
                  frameSafetyTimeout = null;
                }
                unlistenState();
                unlistenEnded();
                void nativePlayerService.stop();
              };
              return;
            } else {
              const reason = 'Native player initialization returned false';
              console.warn(`[VideoPlayerModal] ${reason}; falling back to HTTP stream`);
              if (isMounted) {
                setUseNativePlayer(false);
                setEngineFallbackReason(reason);
              }
            }
          } catch (initErr) {
            const reason = initErr instanceof Error ? initErr.message : String(initErr);
            console.warn('[VideoPlayerModal] Error during native player init; falling back to HTTP stream:', initErr);
            if (isMounted) {
              setUseNativePlayer(false);
              setEngineFallbackReason(reason);
            }
          }
        } else {
          console.info('[VideoPlayerModal] Not running in Tauri; using HTML5 player');
          if (isMounted) {
            setUseNativePlayer(false);
            setEngineFallbackReason('Web browser (Tauri not detected)');
          }
        }

        const selectedFile = localScannerService.getWebSelectedFile(media.type, activeFile.path);
        if (selectedFile) {
          objectUrl = URL.createObjectURL(selectedFile);
          if (isMounted) setStreamUrl(objectUrl);
          void loadSubtitleTracks(selectedFile);
          return;
        }

        if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
          const { invoke } = await import('@tauri-apps/api/core');
          if (!activeFile.path.startsWith('content://')) {
            await invoke('grant_video_files_access', { videoPath: activeFile.path });
          }
          const url = await invoke<string>('get_video_stream_url', { filePath: activeFile.path });
          if (isMounted) setStreamUrl(url);
          void loadSubtitleTracks();
        } else {
          setStreamUrl(activeFile.path);
          void loadSubtitleTracks();
        }
      } catch (err) {
        if (isMounted) {
          const message = err instanceof Error ? err.message : String(err);
          setError(`Failed to initialize stream for file: ${message || activeFile.filename}`);
          setLoading(false);
        }
      }
    };

    void resolveStream();

    return () => {
      isMounted = false;
      cleanupNative();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (initialSeekTimeoutRef.current) {
        clearTimeout(initialSeekTimeoutRef.current);
        initialSeekTimeoutRef.current = null;
      }
    };
  }, [activeFile.path, activeFile.filename, media.type]);

  const discoverEmbeddedSubtitleTracks = useCallback(() => {
    const textTracks = videoRef.current?.textTracks;
    if (!textTracks) {
      setEmbeddedSubtitleTracks([]);
      return;
    }

    const sidecarElements = new Set(subtitleTrackElementsRef.current.values());
    const embedded = Array.from({ length: textTracks.length }, (_, index) => {
      const track = textTracks[index];
      if (
        !['subtitles', 'captions'].includes(track.kind)
        || Array.from(sidecarElements).some(element => element.track === track)
      ) return null;

      return {
        id: `embedded:${index}`,
        label: track.label || track.language || `Embedded subtitle ${index + 1}`,
        track
      };
    }).filter((track): track is EmbeddedSubtitleTrack => track !== null);

    setEmbeddedSubtitleTracks(embedded);
  }, []);

  useEffect(() => {
    const textTracks = videoRef.current?.textTracks;
    if (!textTracks) return;

    const handleTrackListChange = () => discoverEmbeddedSubtitleTracks();
    textTracks.addEventListener('addtrack', handleTrackListChange);
    textTracks.addEventListener('removetrack', handleTrackListChange);
    discoverEmbeddedSubtitleTracks();

    return () => {
      textTracks.removeEventListener('addtrack', handleTrackListChange);
      textTracks.removeEventListener('removetrack', handleTrackListChange);
    };
  }, [streamUrl, subtitleTracks, discoverEmbeddedSubtitleTracks]);

  useEffect(() => {
    if (!subtitleTracksLoaded || !videoMetadataLoaded || subtitleAutoSelectionDone) return;

    const preferredTrack = subtitleTracks.find(track => track.custom)
      || subtitleTracks.find(track => track.embedded)
      || embeddedSubtitleTracks[0]
      || subtitleTracks[0];
    if (!preferredTrack) return;

    setSelectedSubtitleId('track' in preferredTrack
      ? preferredTrack.id
      : `sidecar:${preferredTrack.id}`);
    setSubtitleAutoSelectionDone(true);
  }, [
    subtitleTracksLoaded,
    videoMetadataLoaded,
    subtitleAutoSelectionDone,
    subtitleTracks,
    embeddedSubtitleTracks
  ]);

  const applySubtitleSelection = useCallback((selectedId: string) => {
    if (useNativePlayer) {
      const trackId = selectedId === 'off' ? 'no' : selectedId.replace(/^(sidecar|embedded):/, '');
      if (lastNativeSidRef.current !== trackId) {
        lastNativeSidRef.current = trackId;
        void nativePlayerService.setSubtitleTrack(trackId);
      }
      return;
    }
    setActiveSubtitleText('');
    for (const [id, element] of subtitleTrackElementsRef.current) {
      const track = element.track;
      const trackId = `sidecar:${id}`;
      track.oncuechange = trackId === selectedId
        ? () => {
            const cues = track.activeCues;
            setActiveSubtitleText(cues
              ? Array.from(cues)
                .map(cue => cue instanceof VTTCue ? cue.text : '')
                .filter(Boolean)
                .join('\n')
              : '');
          }
        : null;
      track.mode = trackId === selectedId ? 'hidden' : 'disabled';
    }
    for (const { id, track } of embeddedSubtitleTracks) {
      track.oncuechange = id === selectedId
        ? () => {
            const cues = track.activeCues;
            setActiveSubtitleText(cues
              ? Array.from(cues)
                .map(cue => cue instanceof VTTCue ? cue.text : '')
                .filter(Boolean)
                .join('\n')
              : '');
          }
        : null;
      track.mode = id === selectedId ? 'hidden' : 'disabled';
    }
  }, [embeddedSubtitleTracks, useNativePlayer]);

  useEffect(() => {
    applySubtitleSelection(selectedSubtitleId);
  }, [applySubtitleSelection, selectedSubtitleId]);

  const applyAudioSelection = useCallback((selectedId: string) => {
    if (useNativePlayer) {
      if (selectedId && lastNativeAidRef.current !== selectedId) {
        lastNativeAidRef.current = selectedId;
        void nativePlayerService.setAudioTrack(selectedId);
      }
      return;
    }
    const tracks = (videoRef.current as VideoWithAudioTracks | null)?.audioTracks;
    if (!tracks) return;

    for (let index = 0; index < tracks.length; index++) {
      tracks[index].enabled = String(index) === selectedId;
    }
  }, [useNativePlayer]);

  useEffect(() => {
    if (!useNativePlayer) {
      applyAudioSelection(selectedAudioTrackId);
    }
  }, [applyAudioSelection, selectedAudioTrackId, audioTracks, useNativePlayer]);

  const discoverAudioTracks = () => {
    const video = videoRef.current as VideoWithAudioTracks | null;
    const tracks = video?.audioTracks;
    if (!tracks) {
      if (extractedAudioTracksRef.current.length > 0) {
        setAudioTracks(extractedAudioTracksRef.current);
        setSelectedAudioTrackId(prev => prev || extractedAudioTracksRef.current[0].id);
        setAudioTrackSupport(true);
        return;
      }
      if (audioTracks.length > 0) {
        setAudioTrackSupport(true);
        return;
      }
      setAudioTrackSupport(Boolean(video && 'audioTracks' in video));
      return;
    }

  setAudioTrackSupport(true);
  const parsedTracks = Array.from({ length: tracks.length }, (_, index) => ({
    id: String(index),
    label: tracks[index].label || tracks[index].language || `Audio Track ${index + 1}`
  }));
  setAudioTracks(parsedTracks);
  const enabledTrackIndex = Array.from({ length: tracks.length })
    .findIndex((_, index) => tracks[index].enabled);
  setSelectedAudioTrackId(String(enabledTrackIndex >= 0 ? enabledTrackIndex : 0));
  };

  // Handle Video Metadata Loaded & Initial Seek
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;

    setDuration(video.duration || 0);
    discoverEmbeddedSubtitleTracks();
    setVideoMetadataLoaded(true);

    if (initialPosition > 0 && initialPosition < video.duration) {
      video.currentTime = initialPosition;
      // Fallback timer: ensure video becomes visible even if onSeeked is delayed or skipped
      initialSeekTimeoutRef.current = setTimeout(() => {
        setVideoFrameReady(true);
        setLoading(false);
      }, 3000);
    } else {
      setVideoFrameReady(true);
      setLoading(false);
    }

    // Play video
    video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));

    discoverAudioTracks();
  };

  const handleSeeked = () => {
    if (!initialSeekDoneRef.current) {
      initialSeekDoneRef.current = true;
      if (initialSeekTimeoutRef.current) {
        clearTimeout(initialSeekTimeoutRef.current);
        initialSeekTimeoutRef.current = null;
      }
      setVideoFrameReady(true);
      setLoading(false);
    }
  };

  const handlePlaying = () => {
    setIsPlaying(true);
    if (!videoFrameReady) {
      setVideoFrameReady(true);
      setLoading(false);
    }
  };

  // Save Progress Function
  const saveProgress = useCallback((pos: number, dur: number, forceCompleted: boolean = false) => {
    if (!media.id || dur <= 0) return;
    if (Math.abs(pos - lastSavedPosRef.current) < 1 && !forceCompleted) return;

    lastSavedPosRef.current = pos;
    const now = new Date().toISOString();
    const isCompleted = forceCompleted || (
      skipSegments?.outro?.start && skipSegments.outro.start > 0
        ? pos >= skipSegments.outro.start
        : (dur > 0 && pos / dur >= 0.9)
    );
    const completionKey = `${media.id}_${seasonNumber}_${episodeNumber}`;
    const shouldNotifyCompletion = isCompleted && completionNotificationKeyRef.current !== completionKey;
    if (shouldNotifyCompletion) completionNotificationKeyRef.current = completionKey;

    void dbService.savePlaybackProgress({
      id: `prog_${media.id}_${seasonNumber}_${episodeNumber}`,
      media_id: media.id,
      season: media.type === 'TV Series' ? seasonNumber : 0,
      episode: media.type === 'TV Series' ? episodeNumber : 0,
      position_seconds: pos,
      duration_seconds: dur,
      updated_at: now,
      is_completed: isCompleted
    }).then(async () => {
      if (shouldNotifyCompletion) await onPlaybackCompleted?.();
    }).catch(error => {
      if (shouldNotifyCompletion && completionNotificationKeyRef.current === completionKey) {
        completionNotificationKeyRef.current = null;
      }
      console.error('Failed to save playback progress or refresh episode history:', error);
    });
  }, [media.id, media.type, seasonNumber, episodeNumber, onPlaybackCompleted, skipSegments?.outro?.start]);

  const switchEpisode = useCallback(async (file: LocalFile, season: number, episode: number, title: string) => {
    if (!onEpisodeChange) return;

    if (useNativePlayer) {
      if (durationRef.current > 0) {
        saveProgress(currentTimeRef.current, durationRef.current);
      }
      void nativePlayerService.destroy();
    } else {
      const video = videoRef.current;
      if (video && video.duration > 0) {
        saveProgress(video.currentTime, video.duration);
      }
    }

    try {
      const progress = await dbService.getPlaybackProgress(media.id, season, episode);
      const currentEpisodePosition = useNativePlayer && season === seasonNumber && episode === episodeNumber
        ? currentTimeRef.current
        : videoRef.current && season === seasonNumber && episode === episodeNumber
          ? videoRef.current.currentTime
          : undefined;
      onEpisodeChange(
        file,
        season,
        episode,
        title,
        currentEpisodePosition ?? (progress && !progress.is_completed ? progress.position_seconds : 0)
      );
    } catch (progressError) {
      console.error('Failed to load episode playback progress:', progressError);
      setError('Could not load playback progress for this episode.');
    }
  }, [episodeNumber, media.id, onEpisodeChange, saveProgress, seasonNumber, useNativePlayer]);

  // Periodic Progress Saving
  useEffect(() => {
    const interval = setInterval(() => {
      if (useNativePlayer) {
        if (isPlaying && durationRef.current > 0) {
          saveProgress(currentTimeRef.current, durationRef.current);
        }
      } else {
        const video = videoRef.current;
        if (video && !video.paused && video.duration > 0) {
          saveProgress(video.currentTime, video.duration);
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [saveProgress, useNativePlayer, isPlaying]);

  const scheduleControlsHide = useCallback(() => {
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    if (isAnyPanelOpenRef.current || !isPlaying) return;

    hideControlsTimerRef.current = setTimeout(() => {
      if (!isAnyPanelOpenRef.current && isPlaying) setShowControls(false);
      hideControlsTimerRef.current = null;
    }, 3000);
  }, [isPlaying]);

  const revealControls = useCallback(() => {
    setShowControls(true);
    if (isPlaying) {
      scheduleControlsHide();
    }
  }, [isPlaying, scheduleControlsHide]);

  const preservePointerDuringTransition = () => {
    setShowControls(false);
    setCursorPointerOverride(true);
    if (cursorOverrideTimerRef.current) clearTimeout(cursorOverrideTimerRef.current);
    cursorOverrideTimerRef.current = setTimeout(() => {
      setCursorPointerOverride(false);
      cursorOverrideTimerRef.current = null;
    }, 3000);
  };

  useEffect(() => () => {
    if (cursorOverrideTimerRef.current) clearTimeout(cursorOverrideTimerRef.current);
  }, []);

  // Keep controls active when paused or when any picker/editor panel is open; hide after three idle seconds during playback.
  useEffect(() => {
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = null;

    if (isAnyPanelOpen || !isPlaying) {
      setShowControls(true);
      return;
    }

    if (showControls) scheduleControlsHide();
    return () => {
      if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
      hideControlsTimerRef.current = null;
    };
  }, [isAnyPanelOpen, showControls, isPlaying, scheduleControlsHide]);

  const handleMouseMove = () => revealControls();

  // Video Time Update & Completion Logic (Shared between NativePlayer and HTML5)
  const checkPlaybackProgress = useCallback((curTime: number, dur: number) => {
    if (dur <= 0) return;

    handleSkipTimeUpdate(curTime);

    const nextEpisodeTriggerTime = getNextEpisodePromptTime(skipSegments?.outro, dur);
    if (curTime >= nextEpisodeTriggerTime && !showNextCountdown && !countdownCancelled) {
      saveProgress(curTime, dur, true);

      if (media.type === 'TV Series' && nextEpInfo) {
        setShowNextCountdown(true);
        if (autoplayNextSetting) {
          setCountdownSeconds(5);
        }
      }
    } else if (
      curTime < nextEpisodeTriggerTime &&
      (showNextCountdown || countdownCancelled)
    ) {
      // If user seeks back before trigger time, hide the countdown and reset cancellation
      setShowNextCountdown(false);
      setCountdownCancelled(false);
    }
  }, [autoplayNextSetting, countdownCancelled, handleSkipTimeUpdate, media.type, nextEpInfo, saveProgress, showNextCountdown, skipSegments?.outro]);

  const checkPlaybackProgressRef = useRef(checkPlaybackProgress);
  checkPlaybackProgressRef.current = checkPlaybackProgress;

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    setCurrentTime(video.currentTime);
    checkPlaybackProgress(video.currentTime, video.duration);
  };

  // Countdown interval starts at the outro and runs for five seconds when autoplay is enabled.
  useEffect(() => {
    if (showNextCountdown && autoplayNextSetting && countdownSeconds > 0) {
      countdownIntervalRef.current = setTimeout(() => {
        setCountdownSeconds(prev => prev - 1);
      }, 1000);

      return () => {
        if (countdownIntervalRef.current) clearTimeout(countdownIntervalRef.current);
      };
    }
    else if (showNextCountdown && autoplayNextSetting && countdownSeconds === 0) {
      // Countdown finished - transition to next episode
      setShowNextCountdown(false);
      preservePointerDuringTransition();
      if (nextEpInfo && onEpisodeChange) {
        setCountdownCancelled(false);
        void switchEpisode(
          nextEpInfo.file,
          nextEpInfo.season,
          nextEpInfo.episode,
          getEpisodeTitle(nextEpInfo.file, nextEpInfo.season, nextEpInfo.episode)
        );
      }
      if (countdownIntervalRef.current) clearTimeout(countdownIntervalRef.current);
    } else {
      // Cancelled or non-autoplay prompt
      if (countdownIntervalRef.current) {
        clearTimeout(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    }
    
    return () => {
      if (countdownIntervalRef.current) clearTimeout(countdownIntervalRef.current);
    };
  }, [showNextCountdown, autoplayNextSetting, countdownSeconds, nextEpInfo, switchEpisode]);

  // Play / Pause Toggle
  const togglePlay = () => {
    setIsEpisodePickerOpen(false);
    if (useNativePlayer) {
      void nativePlayerService.togglePause();
      if (isPlaying && durationRef.current > 0) {
        saveProgress(currentTimeRef.current, durationRef.current);
      }
      return;
    }
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
      saveProgress(video.currentTime, video.duration);
    }
  };

  // Seek
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    closeAllPanels();
    const targetTime = Number(e.target.value);
    if (useNativePlayer) {
      void nativePlayerService.seek(targetTime);
      setCurrentTime(targetTime);
      currentTimeRef.current = targetTime;
      saveProgress(targetTime, durationRef.current);
      notifySkipSeek(targetTime);
      return;
    }
    const video = videoRef.current;
    if (video) {
      video.currentTime = targetTime;
      setCurrentTime(targetTime);
      saveProgress(targetTime, video.duration);
      notifySkipSeek(targetTime);
    }
  };

  // Volume Change
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setVolume(val);
    setIsMuted(val === 0);
    if (useNativePlayer) {
      void nativePlayerService.setVolume(val * 100);
      void nativePlayerService.setMute(val === 0);
      return;
    }
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
    }
  };

  const toggleMute = useCallback(() => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (useNativePlayer) {
      void nativePlayerService.setMute(nextMuted);
      return;
    }
    if (videoRef.current) {
      videoRef.current.muted = nextMuted;
    }
  }, [isMuted, useNativePlayer]);

  // Speed
  const handleSpeedChange = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
    if (useNativePlayer) {
      void nativePlayerService.setSpeed(speed);
    } else if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    showPlaybackNotice(`${speed}x`);
  }, [showPlaybackNotice, useNativePlayer]);

  // Fullscreen
  const toggleFullscreen = useCallback(async () => {
    const nextFs = !isFullscreen;
    setIsFullscreen(nextFs);
    await applyFullscreen(nextFs);
  }, [isFullscreen, applyFullscreen]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Allow player shortcuts even if a player range slider still holds focus; blur it first.
      const target = e.target as HTMLElement | null;
      if (target) {
        const isPlayerSlider =
          target instanceof HTMLInputElement &&
          target.type === 'range' &&
          target.dataset.playerSlider === 'true';
        if (isPlayerSlider) {
          target.blur();
        } else if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
          return;
        }
      }

      const video = videoRef.current;
      if (!video && !useNativePlayer) return;

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          revealControls();
          setShowSeekLeft(true);
          setShowSeekRight(false);
          setTimeout(() => setShowSeekLeft(false), 800);
          {
            const delta = e.shiftKey ? -5 : -10;
            if (useNativePlayer) {
              const next = Math.max(0, currentTimeRef.current + delta);
              void nativePlayerService.seek(next);
              setCurrentTime(next);
              currentTimeRef.current = next;
              notifySkipSeek(next);
            } else if (video) {
              video.currentTime = Math.max(0, video.currentTime + delta);
              setCurrentTime(video.currentTime);
              notifySkipSeek(video.currentTime);
            }
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          revealControls();
          setShowSeekLeft(false);
          setShowSeekRight(true);
          setTimeout(() => setShowSeekRight(false), 800);
          {
            const delta = e.shiftKey ? 5 : 10;
            if (useNativePlayer) {
              const next = Math.min(durationRef.current, currentTimeRef.current + delta);
              void nativePlayerService.seek(next);
              setCurrentTime(next);
              currentTimeRef.current = next;
              notifySkipSeek(next);
            } else if (video) {
              video.currentTime = Math.min(video.duration, video.currentTime + delta);
              setCurrentTime(video.currentTime);
              notifySkipSeek(video.currentTime);
            }
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          
          if (volumeTimerRef.current) {
            clearTimeout(volumeTimerRef.current);
          }
          setShowVolumeChange(false);
          volumeTimerRef.current = setTimeout(() => {
            setShowVolumeChange(false);
          }, 800);
          setShowVolumeChange(true);

          setVolume(prev => {
            const next = Math.min(1, prev + 0.1);
            if (useNativePlayer) {
              void nativePlayerService.setVolume(next * 100);
            } else if (video) {
              video.volume = next;
            }
            return next;
          });
          break;
        case 'ArrowDown':
          e.preventDefault();

          if (volumeTimerRef.current) {
            clearTimeout(volumeTimerRef.current);
          }
          setShowVolumeChange(false);
          volumeTimerRef.current = setTimeout(() => {
            setShowVolumeChange(false);
          }, 800);
          setShowVolumeChange(true);

          setVolume(prev => {
            const next = Math.max(0, prev - 0.1);
            if (useNativePlayer) {
              void nativePlayerService.setVolume(next * 100);
            } else if (video) {
              video.volume = next;
            }
            return next;
          });
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          setFillVideoToScreen(current => !current);
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
        case ',':
          e.preventDefault();
          handleSpeedChange(PLAYBACK_SPEEDS[Math.max(0, PLAYBACK_SPEEDS.indexOf(playbackSpeed) - 1)]);
          break;
        case '.':
          e.preventDefault();
          handleSpeedChange(PLAYBACK_SPEEDS[Math.min(
            PLAYBACK_SPEEDS.length - 1,
            PLAYBACK_SPEEDS.indexOf(playbackSpeed) + 1
          )]);
          break;
        case 'v':
        case 'V':
          if (e.shiftKey) {
            e.preventDefault();
            toggleSubtitles()
            console.log("Shift + V pressed");
          } else {
            e.preventDefault();
            cycleSubtitles();
          }
          break;
        case 'b':
        case 'B':
          e.preventDefault();
          cycleAudio(e.shiftKey);
          break;
        case 'Escape':
          if (!document.fullscreenElement) {
            e.preventDefault();
            handleExitPlayer();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, toggleMute, toggleFullscreen, toggleSubtitles, cycleSubtitles, cycleAudio, handleSpeedChange, playbackSpeed]);

  const handleExitPlayer = () => {
    if (isAndroid && typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        void invoke('set_screen_orientation', { orientation: 'user' });
      }).catch(() => {});
    }
    if (isTauri && !isAndroid && initialWindowedRef.current) {
      void applyFullscreen(false);
    }
    if (useNativePlayer) {
      if (durationRef.current > 0) {
        saveProgress(currentTimeRef.current, durationRef.current);
      }
      void nativePlayerService.destroy();
    } else {
      const video = videoRef.current;
      if (video && video.duration > 0) {
        saveProgress(video.currentTime, video.duration);
      }
    }
    onClose();
  };

  const touchGestureRef = useRef<{
    startX: number;
    startY: number;
    startVol: number;
    isVolumeGesture: boolean;
    hasMoved: boolean;
  } | null>(null);
  const suppressNextVideoClickRef = useRef(false);

  const handleVideoTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const touchX = touch.clientX - rect.left;
    const isRightHalf = touchX > rect.width * 0.5;

    touchGestureRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startVol: volumeRef.current,
      isVolumeGesture: isRightHalf,
      hasMoved: false,
    };

    handleVideoTouch(e);
  };

  const handleVideoTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const gesture = touchGestureRef.current;
    if (!gesture || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const deltaY = gesture.startY - touch.clientY;
    const deltaX = Math.abs(touch.clientX - gesture.startX);

    if (Math.abs(deltaY) > 8 && Math.abs(deltaY) > deltaX) {
      gesture.hasMoved = true;
      suppressNextVideoClickRef.current = true;
      if (gesture.isVolumeGesture) {
        e.preventDefault();
        const deltaPercent = deltaY / 220;
        const nextVol = Math.min(1, Math.max(0, gesture.startVol + deltaPercent));
        setVolume(nextVol);
        setIsMuted(nextVol === 0);
        volumeRef.current = nextVol;
        if (useNativePlayer) {
          void nativePlayerService.setVolume(nextVol * 100);
          void nativePlayerService.setMute(nextVol === 0);
        } else if (videoRef.current) {
          videoRef.current.volume = nextVol;
          videoRef.current.muted = nextVol === 0;
        }
        showPlaybackNotice(`Volume: ${Math.round(nextVol * 100)}%`);
      }
    }
  };

  const handleVideoTouchEnd = () => {
    touchGestureRef.current = null;
  };

  const handleVideoTouch = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;

    const touch = e.touches[0]; // Accessing the first touch item
    const now = e.timeStamp;
    
    // Use type assertion to safely access the dataset from currentTarget
    const currentTarget = e.currentTarget as HTMLDivElement;
    const lastTap = parseFloat(currentTarget.dataset.lastTap || '0');
    const delay = now - lastTap;

    if (delay > 0 && delay < 300) {
      e.preventDefault();
      suppressNextVideoClickRef.current = true;
      
      const rect = currentTarget.getBoundingClientRect();
      const touchX = touch.clientX - rect.left;
      const midPoint = rect.width / 2;

      if (touchX < midPoint) {
        handleDoubleTapLeft();
      } else {
        handleDoubleTapRight();
      }

      currentTarget.dataset.lastTap = '0';
    } else {
      currentTarget.dataset.lastTap = now.toString();
    }
  };

  const handleDoubleTapLeft = () => {
    closeAllPanels();
    revealControls();
    setShowSeekLeft(true);
    setTimeout(() => setShowSeekLeft(false), 800);
    if (useNativePlayer) {
      const nextTime = Math.max(0, currentTimeRef.current - 10);
      void nativePlayerService.seek(nextTime);
      setCurrentTime(nextTime);
      currentTimeRef.current = nextTime;
      notifySkipSeek(nextTime);
    } else if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
      notifySkipSeek(videoRef.current.currentTime);
    }
  };

  const handleDoubleTapRight = () => {
    closeAllPanels();
    revealControls();
    setShowSeekRight(true);
    setTimeout(() => setShowSeekRight(false), 800);
    if (useNativePlayer) {
      const nextTime = Math.min(durationRef.current, currentTimeRef.current + 10);
      void nativePlayerService.seek(nextTime);
      setCurrentTime(nextTime);
      currentTimeRef.current = nextTime;
      notifySkipSeek(nextTime);
    } else if (videoRef.current) {
      videoRef.current.currentTime = Math.min(videoRef.current.duration, videoRef.current.currentTime + 10);
      notifySkipSeek(videoRef.current.currentTime);
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return '00:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);

    const pad = (n: number) => String(n).padStart(2, '0');
    if (h > 0) {
      return `${h}:${pad(m)}:${pad(s)}`;
    }
    return `${pad(m)}:${pad(s)}`;
  };

  // Header Title Text
  const headerTitle = media.type === 'TV Series'
    ? `${media.title} `
    : media.title;
  const subHeader = media.type === 'TV Series'
    ? `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}${currentEpisodeName ? ` - ${currentEpisodeName}` : ''}`
    : '';
  const portraitSubHeader = media.type === 'TV Series'
    ? `S${seasonNumber} E${episodeNumber}${currentEpisodeName ? ` ${currentEpisodeName}` : ''}`
    : '';
  const subtitleBackground = subtitleStyle.background === 'solid'
    ? '#000000'
    : subtitleStyle.background === 'semi-transparent'
      ? 'rgba(0, 0, 0, 0.7)'
      : 'transparent';
  
  const modalContent = (
    <div
      ref={containerRef}
      className={
        showPortraitLayout
          ? `fixed inset-0 z-[9999] flex flex-col pt-[var(--sat,0px)] ${
              useNativePlayer && videoFrameReady && !isPreviewMorphing ? 'bg-transparent' : 'bg-[#0c0d10]'
            } font-sans select-none overflow-hidden`
          : `fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden ${
              useNativePlayer && videoFrameReady && !isPreviewMorphing ? 'bg-transparent' : 'bg-black'
            } font-sans select-none ${
              showControls || cursorPointerOverride ? 'cursor-pointer' : 'cursor-none'
            }`
      }
    >
      {showWindowControls && (
        <TitleBarDragRegion
          enablePortals={false}
          className="z-[55]"
          onMouseMove={handleMouseMove}
          onMouseEnter={handleMouseMove}
        />
      )}

      {/* Video Viewport Container */}
      <div
        onTouchStart={handleVideoTouchStart}
        onTouchMove={handleVideoTouchMove}
        onTouchEnd={handleVideoTouchEnd}
        onMouseMove={handleMouseMove}
        onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          if (isAnyPanelOpen) {
            closeAllPanels();
            revealControls();
            return;
          }
          revealControls();
        }}
        className={
          showPortraitLayout
            ? `relative w-full aspect-video shrink-0 ${
                useNativePlayer && videoFrameReady ? 'bg-transparent' : 'bg-black'
              } overflow-hidden flex items-center justify-center ${
                showControls || cursorPointerOverride ? 'cursor-pointer' : 'cursor-none'
              }`
            : `relative w-full h-full flex items-center justify-center overflow-hidden ${
                useNativePlayer && videoFrameReady && !isPreviewMorphing ? 'bg-transparent' : 'bg-black'
              }`
        }
      >
      {/* Centered Play Icon Wrapper */}
      {!isPlaying && !showVolumeChange ? (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="animate-[ping_0.15s_cubic-bezier(0.175,0.885,0.32,1.275)_reverse] transform origin-center">
            <Play className="h-16 w-16 fill-current text-white opacity-80 drop-shadow-2xl" />
          </div>
        </div>
      ) : showVolumeChange && (
        
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <div className="animate-[ping_0.15s_ease-in_reverse] transform origin-center">
            {volume === 0 ? (
              <VolumeX className="h-16 w-16 fill-current text-white opacity-80 drop-shadow-2xl" />
            ) : (
              <Volume2 className="h-16 w-16 fill-current text-white opacity-80 drop-shadow-2xl" />
            )}
          </div>
        </div>
      )}

      {/* Seek Overlays */}
      <div className="absolute inset-0 pointer-events-none z-20 flex items-center justify-between px-20">
        <div className={`flex items-center justify-center w-16 h-16 rounded-full bg-white/10 backdrop-blur-sm text-white drop-shadow-lg transition-opacity duration-300 ${showSeekLeft ? 'opacity-100' : 'opacity-0'}`}>
          <RotateCcw className="h-8 w-8" />
        </div>
        <div className={`flex items-center justify-center w-16 h-16 rounded-full bg-white/10 backdrop-blur-sm text-white drop-shadow-lg transition-opacity duration-300 ${showSeekRight ? 'opacity-100' : 'opacity-0'}`}>
          <RotateCw  className="h-8 w-8" />
        </div>
      </div>
      {/* Video Element */}
      {useNativePlayer ? (
        <div
          ref={viewportRef}
          className={`h-full w-full ${!showPortraitLayout && fillVideoToScreen ? 'object-cover' : 'object-contain'} bg-transparent select-none flex items-center justify-center`}
          onClick={(e) => {
            if (suppressNextVideoClickRef.current) {
              suppressNextVideoClickRef.current = false;
              return;
            }
            if (isAnyPanelOpen) {
              e.stopPropagation();
              closeAllPanels();
              revealControls();
              return;
            }
            togglePlay();
          }}
        />
      ) : streamUrl ? (
        <video
          ref={videoRef}
          src={streamUrl}
          className={`h-full w-full ${!showPortraitLayout && fillVideoToScreen ? 'object-cover' : 'object-contain'}`}
          onClick={(e) => {
            if (suppressNextVideoClickRef.current) {
              suppressNextVideoClickRef.current = false;
              return;
            }
            if (isAnyPanelOpen) {
              e.stopPropagation();
              closeAllPanels();
              revealControls();
              return;
            }
            togglePlay();
          }}
          onLoadedMetadata={handleLoadedMetadata}
          onSeeked={handleSeeked}
          onPlaying={handlePlaying}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onTimeUpdate={handleTimeUpdate}
          onError={(e) => {
            const vid = e.currentTarget;
            const code = vid.error?.code;
            const msg = vid.error?.message;
            console.error('[VideoPlayer] onError', { src: streamUrl, error: vid.error });
            setError(`Playback error: ${msg || (code === 4 ? 'Unsupported format or codec' : 'File cannot be read')} at ${activeFile.path}`);
            setLoading(false);
          }}
          onEnded={() => {
            setIsPlaying(false);
            if (videoRef.current) {
              saveProgress(videoRef.current.duration, videoRef.current.duration, true);
            }
          }}
        >
          {/* Sidecar Subtitles Tracks */}
          {subtitleTracks.map(sub => (
            <track
              key={sub.id}
              ref={element => {
                if (element) {
                  subtitleTrackElementsRef.current.set(sub.id, element);
                  element.track.mode = selectedSubtitleId === `sidecar:${sub.id}` ? 'hidden' : 'disabled';
                } else {
                  subtitleTrackElementsRef.current.delete(sub.id);
                }
              }}
              kind="subtitles"
              label={sub.label}
              srcLang={sub.language}
              src={sub.url}
              onLoad={() => {
                discoverEmbeddedSubtitleTracks();
                applySubtitleSelection(selectedSubtitleId);
              }}
              onError={() => {
                setSubtitleError(`Could not load subtitle track "${sub.label}".`);
              }}
            />
          ))}
        </video>
      ) : null}

      {/* Seamless Resume Frame Placeholder */}
      {previewFrame && (
        shouldMorphPreview && morphRect ? (
          <div
            className={`fixed pointer-events-none overflow-hidden z-[1] ${
              videoFrameReady && !isPreviewMorphing ? 'opacity-0' : 'opacity-100'
            }`}
            style={{
              left: morphRect.left,
              top: morphRect.top,
              width: morphRect.width,
              height: morphRect.height,
              transition:
                'left 420ms cubic-bezier(0.22, 1, 0.36, 1), top 420ms cubic-bezier(0.22, 1, 0.36, 1), width 420ms cubic-bezier(0.22, 1, 0.36, 1), height 420ms cubic-bezier(0.22, 1, 0.36, 1), opacity 300ms ease-out'
            }}
          >
            <img
              ref={previewImgRef}
              src={previewFrame}
              alt="Playback preview"
              onLoad={(e) => startPreviewMorph(e.currentTarget)}
              className="h-full w-full object-cover object-top"
            />
          </div>
        ) : (
          <img
            src={previewFrame}
            alt="Playback preview"
            className={`absolute inset-0 h-full w-full pointer-events-none transition-opacity duration-300 ease-out z-[1] ${
              !showPortraitLayout && fillVideoToScreen ? 'object-cover' : 'object-contain'
            } ${videoFrameReady && !isPreviewMorphing ? 'opacity-0' : 'opacity-100'}`}
          />
        )
      )}
      
      {activeSubtitleText && (
        <div
          aria-live="off"
          className="pointer-events-none absolute left-1/2 z-20 max-w-[85vw] -translate-x-1/2 whitespace-pre-line rounded px-3 py-1.5 text-center font-semibold leading-relaxed"
          style={{
            bottom: `${Math.max(subtitleStyle.verticalPosition, showControls ? (showPortraitLayout ? 22 : 18) : 2)}%`,
            backgroundColor: subtitleBackground,
            color: subtitleStyle.textColor,
            fontFamily: subtitleStyle.fontFamily,
            fontSize: isNarrowScreen
              ? `${Math.max(8, Math.round(subtitleStyle.fontSize * 0.65))}px`
              : `${subtitleStyle.fontSize}px`,
            textShadow: subtitleStyle.outline
              ? '0 1px 2px #000, 1px 0 2px #000, -1px 0 2px #000, 0 -1px 2px #000'
              : 'none'
          }}
        >
          {activeSubtitleText}
        </div>
      )}

      {/* Loading Spinner */}
      {loading && showSpinner && (
        <div className={`absolute inset-0 flex flex-col items-center justify-center space-y-3 z-10 pointer-events-none ${previewFrame ? '' : 'bg-black/60 backdrop-blur-sm'}`}>
          <div className="p-3 rounded-full bg-black/40 shadow-2xl backdrop-blur-xs">
            <Loader2 className="w-12 h-12 text-[#E27D12] animate-spin" />
          </div>
          <p className="text-sm font-semibold text-white drop-shadow-md">Buffering Media Stream...</p>
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 p-6 text-center space-y-4 z-20">
          <AlertTriangle className="w-16 h-16 text-[#E27D12]" />
          <h3 className="text-xl font-bold text-white">Playback Error Encountered</h3>
          <p className="text-sm text-gray-300 max-w-lg leading-relaxed">{error}</p>
          <div className="flex space-x-3 pt-2">
            <button
              onClick={handleExitPlayer}
              className="bg-[#E27D12] hover:bg-[#E27D12] text-white font-bold text-xs px-6 py-2.5 rounded-xl shadow-lg transition-all cursor-pointer"
            >
              Return to Details
            </button>
          </div>
        </div>
      )}

      {playbackNotice && (
        <div
          className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-40 rounded-xl border border-white/20 bg-[#111319]/55 px-4 py-2 text-sm font-semibold text-white shadow-[0_20px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-inset ring-white/15 [text-shadow:0_1px_2px_rgba(0,0,0,0.65)] ${
            showWindowControls ? 'top-12' : 'top-4'
          }`}
        >
          {playbackNotice}
        </div>
      )}


      {media.type === 'TV Series' && pickerSeasons.length > 0 && !showPortraitLayout && (
        <div
          onClick={event => event.stopPropagation()}
          onMouseDown={event => event.stopPropagation()}
          data-tauri-drag-region="false"
          className={`absolute transition-opacity duration-300 ${
            showWindowControls ? 'top-1 right-[144px] z-[60]' : 'top-4 right-4 z-30'
          } ${
            showControls || isEpisodePickerOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedPickerSeason(seasonNumber);
              togglePlayerPanel('episode');
            }}
            aria-expanded={isEpisodePickerOpen}
            className={`flex items-center rounded-xl border border-white/20 bg-[#111319]/55 font-semibold text-white shadow-xl backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-inset ring-white/15 transition-colors hover:bg-[#1a1d26]/70 [text-shadow:0_1px_2px_rgba(0,0,0,0.65)] ${
              showWindowControls
                ? 'h-8 gap-1.5 px-3 text-xs sm:gap-2 sm:px-3.5'
                : 'gap-1.5 px-3 py-2 text-xs sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm'
            }`}
          >
            <span>S{String(seasonNumber).padStart(2, '0')}E{String(episodeNumber).padStart(2, '0')}</span>
            <ChevronDown className={`h-4 w-4 transition-transform ${isEpisodePickerOpen ? 'rotate-180' : ''}`} />
          </button>

          {isEpisodePickerOpen && (
            <div
              className={`absolute flex h-[18rem] max-h-[max(0px,calc(100dvh-12rem-var(--sab,0px)))] w-[calc(100vw-2rem)] max-w-2xl flex-col overflow-hidden rounded-xl border border-white/20 bg-[#111319]/55 shadow-[0_24px_60px_rgba(0,0,0,0.6)] backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-inset ring-white/15 [text-shadow:0_1px_2px_rgba(0,0,0,0.65)] sm:w-[min(42rem,calc(100vw-2rem))] sidebar:h-[min(36rem,max(0px,calc(100dvh-12rem-var(--sab,0px))))] sidebar:max-h-[max(0px,calc(100dvh-12rem-var(--sab,0px)))] sidebar:flex-row sm:rounded-2xl ${
                showWindowControls ? 'right-[-8rem] top-11' : 'right-0 top-14'
              }`}
              onMouseEnter={() => {
                if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
              }}
            >
              <nav aria-label="Select season" className="flex w-full shrink-0 flex-row gap-0.5 overflow-x-auto overscroll-contain border-b border-white/15 bg-black/20 p-1 touch-pan-x sidebar:w-24 sidebar:flex-col sidebar:gap-1 sidebar:overflow-x-hidden sidebar:overflow-y-auto sidebar:border-b-0 sidebar:border-r sidebar:p-2 sidebar:touch-pan-y">
                {pickerSeasons.map(season => (
                  <button
                    key={season}
                    type="button"
                    onClick={() => setSelectedPickerSeason(season)}
                    aria-pressed={selectedPickerSeason === season}
                    className={`whitespace-nowrap rounded-lg px-1.5 py-1.5 text-[10px] font-semibold transition-colors min-[380px]:px-2 min-[380px]:text-[11px] sm:py-2 sm:text-xs ${
                      selectedPickerSeason === season
                        ? 'bg-[#E27D12]/25 text-[#E27D12]'
                        : 'text-gray-200 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    Season {season}
                  </button>
                ))}
              </nav>

              <div 
                ref={episodeListRef}
                className="min-h-0 min-w-0 flex flex-1 flex-row items-stretch gap-1 overflow-x-auto overflow-y-hidden overscroll-contain p-1.5 touch-pan-x min-[380px]:p-2 sidebar:flex-col sidebar:space-y-1 sidebar:overflow-x-hidden sidebar:overflow-y-auto sidebar:touch-pan-y sm:p-3">
                {(() => {
                  const seasonMeta = media.seasons?.find(s => Number(s.season_number) === Number(selectedPickerSeason));
                  const seasonEpisodes = seasonMeta?.episodes;

                  if (seasonEpisodes && seasonEpisodes.length > 0) {
                    return seasonEpisodes.map(ep => {
                      const season = selectedPickerSeason;
                      const episode = ep.episode_number;
                      const matchingFile = allLocalFiles.find(lf =>
                        lf.exists &&
                        lf.media_id === media.id &&
                        Number(lf.season) === Number(season) &&
                        (Number(lf.episode) === Number(episode) ||
                          (lf.episode !== undefined && lf.end_episode !== undefined && Number(lf.episode) <= Number(episode) && Number(lf.end_episode) >= Number(episode)))
                      );
                      const isCurrentEpisode = Number(season) === Number(seasonNumber) && Number(episode) === Number(episodeNumber);
                      const epProg = allProgress.find(p => Number(p.season) === Number(season) && Number(p.episode) === Number(episode));
                      const epPct = epProg && epProg.duration_seconds > 0
                        ? Math.min(100, Math.round((epProg.position_seconds / epProg.duration_seconds) * 100))
                        : 0;

                      return (
                        <button
                          key={ep.episode_number}
                          type="button"
                          disabled={!matchingFile}
                          data-current-episode={isCurrentEpisode}
                          onClick={() => {
                            if (matchingFile) {
                              void switchEpisode(matchingFile, season, episode, ep.name || getEpisodeTitle(matchingFile, season, episode));
                              setIsEpisodePickerOpen(false);
                            }
                          }}
                          className={`flex min-w-0 flex-[0_0_calc(33.333%_-_0.167rem)] flex-col gap-1 rounded-lg p-1 text-left transition-colors sidebar:w-full sidebar:flex-none sidebar:flex-row sidebar:gap-3 sidebar:rounded-xl sidebar:p-2 ${
                            matchingFile
                              ? isCurrentEpisode
                                ? 'bg-white/15'
                                : 'hover:bg-white/10'
                              : 'opacity-50 cursor-not-allowed'
                          }`}
                        >
                          <span className="group/image relative h-20 w-full shrink-0 overflow-hidden rounded-md bg-black/40 sidebar:h-20 sidebar:w-32 sidebar:rounded-lg">
                            {(ep.still_path || media.backdrop || media.poster) && (
                              <img
                                src={ep.still_path || media.backdrop || media.poster}
                                alt=""
                                className={`h-full w-full object-cover transition-transform duration-200 ${matchingFile ? 'group-hover/image:scale-105' : ''}`}
                              />
                            )}
                            {matchingFile && (
                              <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover/image:bg-black/45 group-focus-visible/image:bg-black/45">
                                <Play className="h-5 w-5 scale-75 fill-current text-white opacity-0 drop-shadow transition-all group-hover/image:scale-100 group-hover/image:opacity-100 group-focus-visible/image:scale-100 group-focus-visible/image:opacity-100" />
                              </span>
                            )}
                            {epProg && !epProg.is_completed && epPct > 0 && (
                              <span className="absolute bottom-0 inset-x-0 h-1 bg-black/60 z-10">
                                <span className="block bg-[#E27D12] h-full" style={{ width: `${epPct}%` }} />
                              </span>
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[10px] font-semibold text-[#E27D12] sidebar:text-xs">
                              S{String(season).padStart(2, '0')}E{String(episode).padStart(2, '0')}
                            </span>
                            <span className="block truncate text-[10px] font-bold text-white sidebar:mt-1 sidebar:text-sm">
                              {ep.name || (matchingFile ? getEpisodeTitle(matchingFile, season, episode) : `Episode ${episode}`)}
                            </span>
                            <span className="mt-0.5 line-clamp-3 text-[9px] leading-tight text-gray-200 sidebar:mt-1 sidebar:line-clamp-2 sidebar:text-xs sidebar:leading-relaxed">
                              {ep.overview || 'Episode description unavailable.'}
                            </span>
                          </span>
                        </button>
                      );
                    });
                  }

                  const filesForSeason = allLocalFiles
                    .filter(file => file.exists && Number(file.season) === Number(selectedPickerSeason) && file.episode !== undefined)
                    .sort((a, b) => (Number(a.episode) ?? 0) - (Number(b.episode) ?? 0));

                  if (filesForSeason.length === 0) {
                    return (
                      <p className="p-4 text-center text-xs text-gray-300">No available episodes in this season.</p>
                    );
                  }

                  return filesForSeason.map(file => {
                    const season = file.season ?? 0;
                    const episode = file.episode ?? 0;
                    const details = getEpisodeDetails(season, episode);
                    const isCurrentEpisode = Number(season) === Number(seasonNumber) && Number(episode) === Number(episodeNumber);
                    const epProg = allProgress.find(p => Number(p.season) === Number(season) && Number(p.episode) === Number(episode));
                    const epPct = epProg && epProg.duration_seconds > 0
                      ? Math.min(100, Math.round((epProg.position_seconds / epProg.duration_seconds) * 100))
                      : 0;

                    return (
                      <button
                        key={file.id}
                        type="button"
                        data-current-episode={isCurrentEpisode}
                        onClick={() => {
                          void switchEpisode(file, season, episode, getEpisodeTitle(file, season, episode));
                          setIsEpisodePickerOpen(false);
                        }}
                        className={`flex min-w-0 flex-[0_0_calc(33.333%_-_0.167rem)] flex-col gap-1 rounded-lg p-1 text-left transition-colors sidebar:w-full sidebar:flex-none sidebar:flex-row sidebar:gap-3 sidebar:rounded-xl sidebar:p-2 ${
                          isCurrentEpisode ? 'bg-white/15' : 'hover:bg-white/10'
                        }`}
                      >
                        <span className="group/image relative h-20 w-full shrink-0 overflow-hidden rounded-md bg-black/40 sidebar:h-20 sidebar:w-32 sidebar:rounded-lg">
                          {(details?.still_path || media.backdrop || media.poster) && (
                            <img
                              src={details?.still_path || media.backdrop || media.poster}
                              alt=""
                              className="h-full w-full object-cover transition-transform duration-200 group-hover/image:scale-105"
                            />
                          )}
                          <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover/image:bg-black/45 group-focus-visible/image:bg-black/45">
                            <Play className="h-5 w-5 scale-75 fill-current text-white opacity-0 drop-shadow transition-all group-hover/image:scale-100 group-hover/image:opacity-100 group-focus-visible/image:scale-100 group-focus-visible/image:opacity-100" />
                          </span>
                          {epProg && !epProg.is_completed && epPct > 0 && (
                            <span className="absolute bottom-0 inset-x-0 h-1 bg-black/60 z-10">
                              <span className="block bg-[#E27D12] h-full" style={{ width: `${epPct}%` }} />
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[10px] font-semibold text-[#E27D12] sidebar:text-xs">
                            S{String(season).padStart(2, '0')}E{String(episode).padStart(2, '0')}
                          </span>
                          <span className="block truncate text-[10px] font-bold text-white sidebar:mt-1 sidebar:text-sm">
                            {getEpisodeTitle(file, season, episode)}
                          </span>
                          <span className="mt-0.5 line-clamp-3 text-[9px] leading-tight text-gray-200 sidebar:mt-1 sidebar:line-clamp-2 sidebar:text-xs sidebar:leading-relaxed">
                            {details?.overview || 'Episode description unavailable.'}
                          </span>
                        </span>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Back Button */}
      <button
        type="button"
        data-tauri-drag-region="false"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          closeAllPanels();
          handleExitPlayer();
        }}
        title="Back to Details"
        className={`mdv-btn mdv-btn-glass mdv-back-btn absolute z-[60] cursor-pointer group flex items-center transition-[width,opacity] duration-300 ease-in-out overflow-hidden whitespace-nowrap !p-0 !gap-0 hover:backdrop-blur-md ${
          showControls ? 'opacity-100' : 'pointer-events-none opacity-0'
        } ${
          showPortraitLayout
            ? 'left-2 top-2 h-8 w-8 hover:w-8 justify-center'
            : showWindowControls
              ? 'left-4 top-[calc(0.25rem+var(--sat,0px))] h-8 w-8 hover:w-36 hover:px-0 justify-start'
              : 'left-4 top-[calc(0.75rem+var(--sat,0px))] h-8 w-8 hover:w-36 hover:px-0 justify-start'
        }`}
      >
        <div className="w-8 h-8 flex items-center justify-center shrink-0">
          <ArrowLeft className="w-4 h-4 text-white" />
        </div>
        {!showPortraitLayout && (
          <span className="opacity-0 transition-opacity duration-200 delay-100 group-hover:opacity-100 text-xs font-medium text-white pr-2.5">
            Back to Details
          </span>
        )}
      </button>

      {/* Bottom Header Overlay */}
      {!showPortraitLayout && (
        <div
          onClick={e => e.stopPropagation()}
          className={`absolute bottom-20 left-0 right-0 
            p-6 flex items-center justify-between transition-opacity duration-300 z-10 
            ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        >
          <div className="relative isolate flex flex-col space-y-1 text-white truncate max-w-2xl px-4 py-3 -ml-3
            before:content-[''] before:absolute before:inset-0 before:-z-10
            before:rounded-2xl before:bg-white/[0.08] before:backdrop-blur-xl
            before:[mask-image:linear-gradient(to_right,black_0%,black_55%,transparent_100%)]">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl lg:text-4xl xl:text-5xl font-bold truncate drop-shadow-md">
                {headerTitle}
              </h1>
              {useNativePlayer ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/30">
                  {isAndroid ? 'libmpv · MediaCodec' : 'libmpv · D3D11VA'}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold text-amber-400 border border-amber-500/30" title={engineFallbackReason || 'HTML5 Fallback'}>
                  HTML5 Fallback
                </span>
              )}
            </div>
            <h5 className="text-sm lg:text-base font-bold opacity-90">
              {subHeader}
            </h5>
          </div>
        </div>
      )}

      {/* Next Episode Countdown Overlay */}
      {showNextCountdown && nextEpInfo && (
        <div
          onClick={e => e.stopPropagation()}
          className={`absolute ${
            showPortraitLayout
              ? 'bottom-12 right-2 p-3 max-w-[240px] text-xs'
              : 'bottom-24 right-8 p-5 max-w-sm'
          } bg-[#111319]/55 border border-white/20 ring-1 ring-inset ring-white/15 backdrop-blur-2xl backdrop-saturate-150 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.6)] [text-shadow:0_1px_2px_rgba(0,0,0,0.65)] space-y-2 z-30 animate-fadeIn`}
        >
          <div className="flex items-center space-x-2 text-[#E27D12] font-bold text-xs">
            <SkipForward className="w-3.5 h-3.5" />
            <span>{autoplayNextSetting ? `Up Next in ${countdownSeconds}s` : 'Next Episode'}</span>
          </div>

          <p className="text-xs sm:text-sm font-bold text-white truncate">
            S{String(nextEpInfo.season).padStart(2, '0')}E{String(nextEpInfo.episode).padStart(2, '0')} - {getEpisodeTitle(nextEpInfo.file, nextEpInfo.season, nextEpInfo.episode)}
          </p>

          <div className="flex items-center space-x-2 pt-1">
            <button
              onClick={() => {
                if (countdownIntervalRef.current) clearTimeout(countdownIntervalRef.current);
                setShowNextCountdown(false);
                setCountdownCancelled(true);
              }}
              className="px-3 py-1 rounded-xl border border-white/20 text-gray-300 hover:bg-white/10 text-xs font-semibold cursor-pointer"
            >
              Cancel
            </button>

            <button
              onClick={() => {
                if (countdownIntervalRef.current) clearTimeout(countdownIntervalRef.current);
                setShowNextCountdown(false);
                void switchEpisode(
                  nextEpInfo.file,
                  nextEpInfo.season,
                  nextEpInfo.episode,
                  getEpisodeTitle(nextEpInfo.file, nextEpInfo.season, nextEpInfo.episode)
                );
              }}
              className="px-3.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-bold cursor-pointer flex items-center space-x-1 transition-colors"
            >
              <span>Play Now</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Skip Intro / Skip Recap Overlay Button */}
      {activeSkipSegment && (
        <div
          className={`absolute ${
            showPortraitLayout
              ? (showNextCountdown ? 'bottom-20 right-2' : 'bottom-12 right-2')
              : (showNextCountdown ? 'bottom-48 right-8' : 'bottom-24 right-8')
          } z-30 transition-all duration-300 animate-fadeIn opacity-85 hover:opacity-100`}
        >
          <button
            type="button"
            onClick={() => {
              closeAllPanels();
              handleSkipClick();
            }}
            className={`flex items-center space-x-1.5 ${
              showPortraitLayout ? 'px-3 py-1.5 text-xs' : 'px-5 py-2.5 text-sm'
            } rounded-xl bg-[#111319]/55 hover:bg-[#1a1d26]/70 text-white border border-white/20 hover:border-[#E27D12]/70 ring-1 ring-inset ring-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl backdrop-saturate-150 [text-shadow:0_1px_2px_rgba(0,0,0,0.65)] cursor-pointer font-semibold transition-all group`}
            title={`${activeSkipSegment.label} (${formatTime(activeSkipSegment.targetTime)})`}
          >
            <SkipForward className="w-3.5 h-3.5 text-[#E27D12] transition-transform group-hover:scale-110" />
            <span>{activeSkipSegment.label}</span>
          </button>
        </div>
      )}

      {/* Bottom Control Bar Overlay */}
      <div
        onClick={e => {
          e.stopPropagation();
          if (isPlaying && !isAnyPanelOpenRef.current) scheduleControlsHide();
        }}
        onTouchStart={() => {
          if (isPlaying && !isAnyPanelOpenRef.current) scheduleControlsHide();
        }}
        className={`absolute left-0 right-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent transition-opacity duration-300 z-10 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        } ${
          showPortraitLayout
            ? 'px-3 py-2 space-y-1'
            : 'p-6 space-y-3'
        }`}
      >
        {/* Seekbar Progress Slider */}
        <div
          className="relative group flex items-center py-1"
          onPointerEnter={() => {
            isPointerOverSeekbarRef.current = true;
          }}
          onPointerMove={(e) => {
            if (showPortraitLayout) return;
            isPointerOverSeekbarRef.current = true;
            updateHoverSeekPreview(e.clientX, e.currentTarget.getBoundingClientRect());
          }}
          onMouseMove={(e) => {
            if (showPortraitLayout) return;
            isPointerOverSeekbarRef.current = true;
            updateHoverSeekPreview(e.clientX, e.currentTarget.getBoundingClientRect());
          }}
          onPointerLeave={() => {
            isPointerOverSeekbarRef.current = false;
            if (!isScrubbingRef.current) {
              setHoverSeekState(null);
            }
          }}
          onMouseLeave={() => {
            isPointerOverSeekbarRef.current = false;
            if (!isScrubbingRef.current) {
              setHoverSeekState(null);
            }
          }}
        >
          {!showPortraitLayout && hoverSeekState && duration > 0 && (
            <div
              className="pointer-events-none absolute bottom-full mb-3 z-40 w-48 rounded-xl border border-white/20 bg-[#111319]/55 p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-inset ring-white/15"
              style={{
                left: `clamp(96px, ${hoverSeekState.percent * 100}%, calc(100% - 96px))`,
                transform: 'translateX(-50%)'
              }}
            >
              <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black/75 flex items-center justify-center">
                {hoverSeekState.frame ? (
                  <img
                    src={hoverSeekState.frame}
                    alt={`Preview at ${formatTime(hoverSeekState.time)}`}
                    className="h-full w-full object-cover"
                  />
                ) : hoverSeekState.isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-[#E27D12]" />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-gray-300">
                    <Film className="h-5 w-5 text-gray-400" />
                    <span className="text-[10px] font-medium">Preview unavailable</span>
                  </div>
                )}
              </div>
              <div className="mt-1.5 text-center font-mono text-xs font-bold tracking-wide text-white">
                {formatTime(hoverSeekState.time)}
              </div>
            </div>
          )}

          <input
            ref={seekInputRef}
            data-player-slider="true"
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (isAnyPanelOpen) closeAllPanels();
              handleSliderPointerDown(e.currentTarget, true);
              if (!showPortraitLayout) {
                updateHoverSeekPreview(e.clientX, e.currentTarget.getBoundingClientRect());
              }
            }}
            onPointerUp={(e) => {
              blurPlayerSlider(e.currentTarget, true);
            }}
            onMouseUp={(e) => {
              blurPlayerSlider(e.currentTarget, true);
            }}
            onTouchEnd={(e) => {
              blurPlayerSlider(e.currentTarget, true);
            }}
            onChange={(e) => {
              if (isAnyPanelOpen) closeAllPanels();
              handleSeek(e);
            }}
            style={{
                  background: `linear-gradient(to right, #E27D12  0%, #E27D12  ${(currentTime/ duration) * 100 }%, 
                  rgba(255, 255, 255, 0.3) ${((currentTime/ duration)* 100)}%, rgba(255, 255, 255, 0.3) 100%)`
                }}
            className="w-full h-1.5 bg-white/20 hover:h-2.5 rounded-lg appearance-none cursor-pointer accent-[#E27D12] transition-all"
          />
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between text-white">
          <div className={`flex items-center ${showPortraitLayout ? 'space-x-1' : 'space-x-4'}`}>
            {/* Play/Pause */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeAllPanels();
                togglePlay();
              }}
              className={`group text-white cursor-pointer ${showPortraitLayout ? 'p-1' : 'p-2'}`}
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying
                ? <Pause className={`${showPortraitLayout ? 'w-5 h-5' : 'w-7 h-7'} transition-transform group-hover:scale-110 group-focus-visible:scale-110`} />
                : <Play className={`${showPortraitLayout ? 'w-5 h-5' : 'w-7 h-7'} fill-current transition-transform group-hover:scale-110 group-focus-visible:scale-110`} />}
            </button>

            {/* Restart From Beginning */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeAllPanels();
                handleSkipSeek(0);
                notifySkipSeek(0);
              }}
              className={`group text-gray-300 hover:text-white cursor-pointer ${showPortraitLayout ? 'p-1' : 'p-2'}`}
              title="Restart from Beginning"
            >
              <RotateCcw className={`${showPortraitLayout ? 'w-4 h-4' : 'w-6 h-6'} transition-transform group-hover:scale-110 group-focus-visible:scale-110`} />
            </button>

            {/* Next Episode Button if available */}
            {media.type === 'TV Series' && nextEpInfo && (
              <div
                className="relative flex items-center"
                onMouseEnter={() => setIsHoveringNextEp(true)}
                onMouseLeave={() => setIsHoveringNextEp(false)}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsHoveringNextEp(false);
                    closeAllPanels();
                    void switchEpisode(
                      nextEpInfo.file,
                      nextEpInfo.season,
                      nextEpInfo.episode,
                      getEpisodeTitle(nextEpInfo.file, nextEpInfo.season, nextEpInfo.episode)
                    );
                  }}
                  aria-label={`Next Episode (S${String(nextEpInfo.season).padStart(2, '0')}E${String(nextEpInfo.episode).padStart(2, '0')})`}
                  className={`group text-gray-300 hover:text-white cursor-pointer ${showPortraitLayout ? 'p-1' : 'p-2'}`}
                >
                  <SkipForward className={`${showPortraitLayout ? 'w-4 h-4' : 'w-6 h-6'} transition-transform group-hover:scale-110 group-focus-visible:scale-110`} />
                </button>

                {!showPortraitLayout && isHoveringNextEp && (
                  <div className="pointer-events-none absolute bottom-full left-0 z-40 mb-3 w-64 overflow-hidden rounded-2xl border border-white/20 bg-[#111319]/55 p-2 shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-inset ring-white/15 [text-shadow:0_1px_2px_rgba(0,0,0,0.65)]">
                    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black/60">
                      {(nextEpDetails?.still_path || media.backdrop || media.poster) ? (
                        <img
                          src={nextEpDetails?.still_path || media.backdrop || media.poster}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-gray-400">
                          <Film className="h-6 w-6" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" />
                      <span className="absolute bottom-1.5 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#E27D12] backdrop-blur-sm">
                        Up Next
                      </span>
                    </div>
                    <div className="px-1 pt-2 pb-0.5">
                      <p className="text-[11px] font-semibold text-[#E27D12]">
                        Season {nextEpInfo.season} • Episode {nextEpInfo.episode} (S{String(nextEpInfo.season).padStart(2, '0')}E{String(nextEpInfo.episode).padStart(2, '0')})
                      </p>
                      <p className="mt-0.5 truncate text-xs font-bold text-white">
                        {getEpisodeTitle(nextEpInfo.file, nextEpInfo.season, nextEpInfo.episode)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Volume */}
            <div className={`flex items-center group ${showPortraitLayout ? 'space-x-1' : 'space-x-2'}`}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeAllPanels();
                  toggleMute();
                }}
                className={`group text-white cursor-pointer ${showPortraitLayout ? 'p-1' : 'p-1.5'}`}
                title={isMuted || volume === 0 ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0
                  ? <VolumeX className={`${showPortraitLayout ? 'w-4 h-4' : 'w-6 h-6'} transition-transform group-hover:scale-110 group-focus-visible:scale-110`} />
                  : <Volume2 className={`${showPortraitLayout ? 'w-4 h-4' : 'w-6 h-6'} transition-transform group-hover:scale-110 group-focus-visible:scale-110`} />}
              </button>
              <input
                ref={volumeInputRef}
                data-player-slider="true"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (isAnyPanelOpen) closeAllPanels();
                  handleSliderPointerDown(e.currentTarget, false);
                }}
                onPointerUp={(e) => blurPlayerSlider(e.currentTarget)}
                onMouseUp={(e) => blurPlayerSlider(e.currentTarget)}
                onTouchEnd={(e) => blurPlayerSlider(e.currentTarget)}
                onChange={(e) => {
                  if (isAnyPanelOpen) closeAllPanels();
                  handleVolumeChange(e);
                }}
                style={{
                  background: `linear-gradient(to right, #E27D12  0%, #E27D12  ${(isMuted ? 0 : volume) * 100}%, 
                  rgba(255, 255, 255, 0.3) ${(isMuted ? 0 : volume) * 100}%, rgba(255, 255, 255, 0.3) 100%)`
                }}
                className={`w-14 sm:w-16 h-1 bg-white/30 rounded appearance-none cursor-pointer accent-[#E27D12] opacity-80 group-hover:opacity-100 transition-opacity block`}
              />
            </div>

            {/* Time Stamp */}
            <div className={`font-mono text-gray-300 ${showPortraitLayout ? 'text-[11px] pl-0.5' : 'text-lg pl-2'}`}>
              <span>{formatTime(currentTime)}</span>
              <span className="text-gray-500 mx-0.5">/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          <div className={`flex items-center ${showPortraitLayout ? 'space-x-0.5' : 'space-x-1.5 min-[1090px]:space-x-3'}`}>
            {/* Playback Speed Selector */}
            <div
              className={`relative flex shrink-0 items-center justify-center text-white ${showSpeedPicker ? 'z-[60]' : 'z-20'}`}
              title={`Playback speed: ${playbackSpeed}x`}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlayerPanel('speed');
                }}
                className={`group text-gray-300 hover:text-white cursor-pointer flex items-center justify-center ${
                  showPortraitLayout ? 'p-1' : 'p-2'
                }`}
              >
                <Sliders className={`${showPortraitLayout ? 'w-4 h-4' : 'w-5 h-5'} text-gray-400 transition-transform group-hover:scale-110 group-hover:text-white group-focus-within:scale-110 group-focus-within:text-white`} />
              </button>
              
              {!showPortraitLayout && showSpeedPicker && (
                <div 
                  className="absolute bottom-full right-0 z-[60] mb-3 w-40 rounded-xl border border-white/20 bg-[#111319]/55 p-1.5 text-white shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-inset ring-white/15 [text-shadow:0_1px_2px_rgba(0,0,0,0.65)]"
                  onClick={e => e.stopPropagation()}
                >
                  {PLAYBACK_SPEEDS.map(speed => (
                    <button
                      key={speed}
                      onClick={() => {
                        handleSpeedChange(speed);
                        setShowSpeedPicker(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors ${
                        playbackSpeed === speed ? 'bg-[#E27D12]/25 text-[#E27D12] font-semibold' : 'hover:bg-white/10 text-gray-200 hover:text-white'
                      }`}
                    >
                      <span>{speed}x</span>
                      {playbackSpeed === speed && <div className="h-1 w-1 rounded-full bg-[#E27D12]" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Subtitles Selector */}
            <div
              className={`relative flex shrink-0 items-center justify-center text-white ${showSubtitlePicker ? 'z-[60]' : 'z-20'}`}
              title={subtitleError || 'Subtitle track'}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlayerPanel('subtitle');
                }}
                className={`group text-gray-300 hover:text-white cursor-pointer flex items-center justify-center ${
                  showPortraitLayout ? 'p-1' : 'p-2'
                }`}
              >
                <Subtitles className={`${showPortraitLayout ? 'w-4 h-4' : 'w-5 h-5'} transition-transform group-hover:scale-110 group-hover:brightness-125 group-focus-within:scale-110 group-focus-within:brightness-125 ${
                  selectedSubtitleId === 'off' ? 'text-white' : 'text-[#E27D12]'
                }`} />
              </button>

              {!showPortraitLayout && showSubtitlePicker && (
                <div 
                  className="absolute bottom-full right-0 z-[60] mb-3 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-white/20 bg-[#111319]/55 p-1.5 text-white shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-inset ring-white/15 [text-shadow:0_1px_2px_rgba(0,0,0,0.65)] overflow-hidden"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="max-h-60 overflow-y-auto overscroll-contain p-1 space-y-0.5">
                    <button
                      onClick={() => {
                        selectSubtitle('off');
                        setShowSubtitlePicker(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors ${
                        selectedSubtitleId === 'off' ? 'bg-[#E27D12]/25 text-[#E27D12] font-semibold' : 'hover:bg-white/10 text-gray-200 hover:text-white'
                      }`}
                    >
                      <span>Subtitles Off</span>
                      {selectedSubtitleId === 'off' && <div className="h-1 w-1 rounded-full bg-[#E27D12]" />}
                    </button>
                    
                    {subtitleTracks.length + embeddedSubtitleTracks.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-gray-300 italic">
                        {mkvParsing ? 'Reading embedded subtitles…' : subtitleError ? 'Subtitle load failed' : loading ? 'Searching subtitles…' : 'No subtitles available'}
                      </div>
                    ) : (
                      <>
                        {subtitleTracks.map(sub => {
                          const isSelected = selectedSubtitleId === `sidecar:${sub.id}` || selectedSubtitleId === sub.id;
                          return (
                            <button
                              key={sub.id}
                              onClick={() => {
                                selectSubtitle(useNativePlayer ? sub.id : `sidecar:${sub.id}`);
                                setShowSubtitlePicker(false);
                              }}
                              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors ${
                                isSelected ? 'bg-[#E27D12]/25 text-[#E27D12] font-semibold' : 'hover:bg-white/10 text-gray-200 hover:text-white'
                              }`}
                            >
                              <span>{sub.label}{sub.embedded ? ' (Embedded)' : ''}</span>
                              {isSelected && <div className="h-1 w-1 rounded-full bg-[#E27D12]" />}
                            </button>
                          );
                        })}
                        {embeddedSubtitleTracks.map(track => (
                          <button
                            key={track.id}
                            onClick={() => {
                              selectSubtitle(track.id);
                              setShowSubtitlePicker(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors ${
                              selectedSubtitleId === track.id ? 'bg-[#E27D12]/25 text-[#E27D12] font-semibold' : 'hover:bg-white/10 text-gray-200 hover:text-white'
                            }`}
                          >
                            <span>{track.label} (Embedded)</span>
                            {selectedSubtitleId === track.id && <div className="h-1 w-1 rounded-full bg-[#E27D12]" />}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                  <div className="border-t border-white/10 p-1">
                    <button
                      type="button"
                      onClick={() => void handleLoadCustomSubtitle()}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-gray-200 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
                    >
                      <FolderOpen className="h-3.5 w-3.5 text-[#E27D12]" />
                      <span>Load Custom Subtitle...</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Subtitle Style Controls */}
            <div className={`relative flex shrink-0 items-center ${showSubtitleStyleEditor ? 'z-10' : 'z-10'}`}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlayerPanel('subtitleStyle');
                }}
                aria-label="Customize subtitles"
                aria-expanded={showSubtitleStyleEditor}
                title="Customize subtitles"
                className="group p-2 text-gray-300 hover:text-white cursor-pointer"
              >
                <Settings2 className="w-5 h-5 transition-transform group-hover:rotate-45 group-focus-visible:rotate-45" />
              </button>
              {!showPortraitLayout && showSubtitleStyleEditor && (
                <div
                  className="absolute bottom-full right-0 z-50 mb-3 w-64 sm:w-72 max-w-[calc(100vw-1.5rem)] max-h-[min(19rem,calc(100dvh-9rem))] overflow-y-auto overscroll-contain space-y-2 rounded-xl border border-white/20 bg-[#111319]/55 p-3 text-white shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-inset ring-white/15 [text-shadow:0_1px_2px_rgba(0,0,0,0.65)]"
                  aria-label="Subtitle appearance settings"
                  onClick={event => event.stopPropagation()}
                >
                  <div className="flex items-center justify-between border-b border-white/15 pb-1.5">
                    <h2 className="text-xs font-bold text-white">Subtitle Appearance</h2>
                    <button
                      type="button"
                      onClick={() => setShowSubtitleStyleEditor(false)}
                      className="text-[11px] font-semibold text-[#E27D12] hover:text-white transition-colors cursor-pointer"
                    >
                      Done
                    </button>
                  </div>

                  <label className="block space-y-0.5 text-[11px] text-gray-200">
                    <span className="font-medium">Preset</span>
                    <select
                      value={subtitleStyle.preset}
                      onChange={event => {
                        const preset = event.target.value as SubtitleStyleSettings['preset'];
                        setSubtitleStyle(preset === 'custom'
                          ? style => ({ ...style, preset })
                          : SUBTITLE_STYLE_PRESETS[preset]);
                      }}
                      className="w-full rounded-lg border border-white/20 bg-black/45 px-2 py-1 text-xs text-white"
                    >
                      <option value="default" className="bg-[#161923] text-white">Default</option>
                      <option value="high-contrast" className="bg-[#161923] text-white">High contrast</option>
                      <option value="large-text" className="bg-[#161923] text-white">Large text</option>
                      <option value="minimal" className="bg-[#161923] text-white">Minimal</option>
                      <option value="custom" className="bg-[#161923] text-white">Custom</option>
                    </select>
                  </label>

                  <label className="block space-y-0.5 text-[11px] text-gray-200">
                    <span className="flex justify-between font-medium">
                      <span>Font size</span>
                      <span className="text-[#E27D12]">{subtitleStyle.fontSize}px</span>
                    </span>
                    <input
                      type="range"
                      min={8}
                      max={48}
                      step={1}
                      value={subtitleStyle.fontSize}
                      onChange={event => setSubtitleStyle(style => ({
                        ...style,
                        preset: 'custom',
                        fontSize: Number(event.target.value)
                      }))}
                      aria-label="Subtitle font size"
                      className="w-full accent-[#E27D12] h-1 bg-white/20 rounded cursor-pointer"
                    />
                  </label>

                  <label className="block space-y-0.5 text-[11px] text-gray-200">
                    <span className="font-medium">Font family</span>
                    <select
                      value={subtitleStyle.fontFamily}
                      onChange={event => setSubtitleStyle(style => ({
                        ...style,
                        preset: 'custom',
                        fontFamily: event.target.value
                      }))}
                      className="w-full rounded-lg border border-white/20 bg-black/45 px-2 py-1 text-xs text-white"
                    >
                      {SUBTITLE_FONT_FAMILIES.map(font => (
                        <option key={font.value} value={font.value} className="bg-[#161923] text-white">{font.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-0.5 text-[11px] text-gray-200">
                    <span className="font-medium">Text color</span>
                    <select
                      value={subtitleStyle.textColor === '#ffffff'
                        ? 'white'
                        : subtitleStyle.textColor === '#ffff00'
                          ? 'yellow'
                          : 'custom'}
                      onChange={event => {
                        const color = event.target.value === 'white'
                          ? '#ffffff'
                          : event.target.value === 'yellow'
                            ? '#ffff00'
                            : (subtitleStyle.textColor === '#ffffff' || subtitleStyle.textColor === '#ffff00')
                              ? '#00ffff'
                              : subtitleStyle.textColor;
                        setSubtitleStyle(style => ({ ...style, preset: 'custom', textColor: color }));
                      }}
                      className="w-full rounded-lg border border-white/20 bg-black/45 px-2 py-1 text-xs text-white"
                    >
                      <option value="white" className="bg-[#161923] text-white">White</option>
                      <option value="yellow" className="bg-[#161923] text-white">Yellow</option>
                      <option value="custom" className="bg-[#161923] text-white">Custom…</option>
                    </select>
                    {subtitleStyle.textColor !== '#ffffff' && subtitleStyle.textColor !== '#ffff00' && (
                      <input
                        type="color"
                        value={subtitleStyle.textColor}
                        onChange={event => setSubtitleStyle(style => ({
                          ...style,
                          preset: 'custom',
                          textColor: event.target.value
                        }))}
                        aria-label="Custom subtitle text color"
                        className="h-6 w-full cursor-pointer rounded border border-white/20 bg-transparent mt-1"
                      />
                    )}
                  </label>

                  <label className="block space-y-0.5 text-[11px] text-gray-200">
                    <span className="font-medium">Background</span>
                    <select
                      value={subtitleStyle.background}
                      onChange={event => setSubtitleStyle(style => ({
                        ...style,
                        preset: 'custom',
                        background: event.target.value as SubtitleStyleSettings['background']
                      }))}
                      className="w-full rounded-lg border border-white/20 bg-black/45 px-2 py-1 text-xs text-white"
                    >
                      <option value="none" className="bg-[#161923] text-white">None</option>
                      <option value="semi-transparent" className="bg-[#161923] text-white">Semi-transparent</option>
                      <option value="solid" className="bg-[#161923] text-white">Solid</option>
                    </select>
                  </label>

                  <label className="block space-y-0.5 text-[11px] text-gray-200">
                    <span className="flex justify-between font-medium">
                      <span>Height</span>
                      <span className="text-[#E27D12]">{subtitleStyle.verticalPosition}%</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={50}
                      step={1}
                      value={subtitleStyle.verticalPosition}
                      onChange={event => setSubtitleStyle(style => ({
                        ...style,
                        preset: 'custom',
                        verticalPosition: Number(event.target.value)
                      }))}
                      aria-label="Subtitle height"
                      className="w-full accent-[#E27D12] h-1 bg-white/20 rounded cursor-pointer"
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Audio Track Selector */}
            <div
              className={`relative flex shrink-0 items-center justify-center text-white ${showAudioPicker ? 'z-[60]' : 'z-20'}`}
              title={audioTrackSupport === false ? 'Audio track switching is not supported by this video runtime.' : 'Audio track'}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlayerPanel('audio');
                }}
                className={`group text-gray-300 hover:text-white cursor-pointer flex items-center justify-center ${
                  showPortraitLayout ? 'p-1' : 'p-2'
                }`}
                title="Audio tracks"
              >
                <AudioLines className={`${showPortraitLayout ? 'w-4 h-4' : 'w-5 h-5'} ${
                  audioTracks.length > 1 ? 'text-[#E27D12]' : selectedAudioTrackId ? 'text-white' : 'text-gray-400'
                } transition-transform group-hover:scale-110 group-hover:brightness-125 group-focus-within:scale-110 group-focus-within:brightness-125`} />
              </button>

              {!showPortraitLayout && showAudioPicker && (
                <div 
                  className="absolute bottom-full right-0 z-[60] mb-3 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-white/20 bg-[#111319]/55 p-1.5 text-white shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-inset ring-white/15 [text-shadow:0_1px_2px_rgba(0,0,0,0.65)] overflow-hidden"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="max-h-60 overflow-y-auto overscroll-contain p-1 space-y-0.5">
                    {audioTracks.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-gray-300 italic">
                        {mkvParsing ? 'Scanning audio tracks…' : audioTrackSupport === false
                          ? 'Audio switching unavailable'
                          : audioTrackSupport === null
                            ? 'Detecting audio…'
                            : 'Default audio'}
                      </div>
                    ) : (
                      audioTracks.map(track => (
                        <button
                          key={track.id}
                          onClick={() => {
                            selectAudioTrack(track.id);
                            setShowAudioPicker(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs transition-colors ${
                            selectedAudioTrackId === track.id ? 'bg-[#E27D12]/25 text-[#E27D12] font-semibold' : 'hover:bg-white/10 text-gray-200 hover:text-white'
                          }`}
                        >
                          <span>{track.label}</span>
                          {selectedAudioTrackId === track.id && <div className="h-1 w-1 rounded-full bg-[#E27D12]" />}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Fill to Screen Toggle */}
            {!showPortraitLayout && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeAllPanels();
                  setFillVideoToScreen(current => !current);
                }}
                aria-label={fillVideoToScreen ? 'Fit video to screen' : 'Fill screen with video'}
                aria-pressed={fillVideoToScreen}
                className={`group p-2 cursor-pointer ${fillVideoToScreen ? 'text-[#E27D12]' : 'text-white'}`}
                title={`Fill to screen (C)${fillVideoToScreen ? ' — on' : ''}`}
              >
                <Crop className="w-5 h-5 transition-transform group-hover:scale-110 group-focus-visible:scale-110" />
              </button>
            )}

            {/* Fullscreen Toggle */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                closeAllPanels();
                toggleFullscreen();
              }}
              className={`group text-white cursor-pointer ${showPortraitLayout ? 'p-1' : 'p-2'}`}
              title="Fullscreen (F)"
            >
              {isFullscreen
                ? <Minimize className={`${showPortraitLayout ? 'w-4 h-4' : 'w-5 h-5'} transition-transform group-hover:scale-110 group-focus-visible:scale-110`} />
                : <Maximize className={`${showPortraitLayout ? 'w-4 h-4' : 'w-5 h-5'} transition-transform group-hover:scale-110 group-focus-visible:scale-110`} />}
            </button>
          </div>
        </div>
      </div>
    </div>

    {/* Mobile Portrait View: Details & Episode Picker OR Active Video Panel Below Video */}
    {showPortraitLayout && (
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-[#0c0d10] text-white">
        {isAnyPanelOpen ? (
          /* Active Video Panel in Bottom Area */
          <div className="p-4 space-y-4 animate-fadeIn">
            {showSpeedPicker && (
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                  <h2 className="text-base font-bold text-white">Playback Speed</h2>
                  <button
                    type="button"
                    onClick={() => setShowSpeedPicker(false)}
                    className="text-xs font-semibold text-[#E27D12] hover:text-white transition-colors cursor-pointer"
                  >
                    Done
                  </button>
                </div>
                <div className="space-y-1">
                  {PLAYBACK_SPEEDS.map(speed => (
                    <button
                      key={speed}
                      onClick={() => {
                        handleSpeedChange(speed);
                        setShowSpeedPicker(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm transition-colors ${
                        playbackSpeed === speed
                          ? 'bg-[#E27D12]/20 text-[#E27D12] font-semibold'
                          : 'hover:bg-white/10 text-gray-300 hover:text-white'
                      }`}
                    >
                      <span>{speed}x</span>
                      {playbackSpeed === speed && <div className="h-2 w-2 rounded-full bg-[#E27D12]" />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {showSubtitlePicker && (
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                  <h2 className="text-base font-bold text-white">Subtitles</h2>
                  <button
                    type="button"
                    onClick={() => setShowSubtitlePicker(false)}
                    className="text-xs font-semibold text-[#E27D12] hover:text-white transition-colors cursor-pointer"
                  >
                    Done
                  </button>
                </div>
                <div className="space-y-1">
                  <button
                    onClick={() => {
                      selectSubtitle('off');
                      setShowSubtitlePicker(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm transition-colors ${
                      selectedSubtitleId === 'off'
                        ? 'bg-[#E27D12]/20 text-[#E27D12] font-semibold'
                        : 'hover:bg-white/10 text-gray-300 hover:text-white'
                    }`}
                  >
                    <span>Subtitles Off</span>
                    {selectedSubtitleId === 'off' && <div className="h-2 w-2 rounded-full bg-[#E27D12]" />}
                  </button>

                  {subtitleTracks.length + embeddedSubtitleTracks.length === 0 ? (
                    <div className="p-4 text-center text-xs text-gray-400 italic">
                      {mkvParsing ? 'Reading embedded subtitles…' : subtitleError ? 'Subtitle load failed' : loading ? 'Searching subtitles…' : 'No subtitles available'}
                    </div>
                  ) : (
                    <>
                      {subtitleTracks.map(sub => {
                        const isSelected = selectedSubtitleId === `sidecar:${sub.id}` || selectedSubtitleId === sub.id;
                        return (
                          <button
                            key={sub.id}
                            onClick={() => {
                              selectSubtitle(useNativePlayer ? sub.id : `sidecar:${sub.id}`);
                              setShowSubtitlePicker(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm transition-colors ${
                              isSelected
                                ? 'bg-[#E27D12]/20 text-[#E27D12] font-semibold'
                                : 'hover:bg-white/10 text-gray-300 hover:text-white'
                            }`}
                          >
                            <span>{sub.label}{sub.embedded ? ' (Embedded)' : ''}</span>
                            {isSelected && <div className="h-2 w-2 rounded-full bg-[#E27D12]" />}
                          </button>
                        );
                      })}
                      {embeddedSubtitleTracks.map(track => (
                        <button
                          key={track.id}
                          onClick={() => {
                            selectSubtitle(track.id);
                            setShowSubtitlePicker(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm transition-colors ${
                            selectedSubtitleId === track.id
                              ? 'bg-[#E27D12]/20 text-[#E27D12] font-semibold'
                              : 'hover:bg-white/10 text-gray-300 hover:text-white'
                          }`}
                        >
                          <span>{track.label} (Embedded)</span>
                          {selectedSubtitleId === track.id && <div className="h-2 w-2 rounded-full bg-[#E27D12]" />}
                        </button>
                      ))}
                    </>
                  )}
                  <div className="border-t border-white/10 pt-2 mt-2">
                    <button
                      type="button"
                      onClick={() => void handleLoadCustomSubtitle()}
                      className="flex w-full items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
                    >
                      <FolderOpen className="h-4 w-4 text-[#E27D12]" />
                      <span>Load Custom Subtitle...</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showSubtitleStyleEditor && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                  <h2 className="text-base font-bold text-white">Subtitle Appearance</h2>
                  <button
                    type="button"
                    onClick={() => setShowSubtitleStyleEditor(false)}
                    className="text-xs font-semibold text-[#E27D12] hover:text-white transition-colors cursor-pointer"
                  >
                    Done
                  </button>
                </div>

                <div className="space-y-3">
                  <label className="block space-y-1 text-xs text-gray-300">
                    <span className="font-semibold text-white">Preset</span>
                    <select
                      value={subtitleStyle.preset}
                      onChange={event => {
                        const preset = event.target.value as SubtitleStyleSettings['preset'];
                        setSubtitleStyle(preset === 'custom'
                          ? style => ({ ...style, preset })
                          : SUBTITLE_STYLE_PRESETS[preset]);
                      }}
                      className="w-full rounded-xl border border-white/20 bg-black/60 px-3 py-2 text-sm text-white"
                    >
                      <option value="default">Default</option>
                      <option value="high-contrast">High contrast</option>
                      <option value="large-text">Large text</option>
                      <option value="minimal">Minimal</option>
                      <option value="custom">Custom</option>
                    </select>
                  </label>

                  <label className="block space-y-1 text-xs text-gray-300">
                    <span className="flex justify-between font-semibold text-white">
                      <span>Font size</span>
                      <span className="text-[#E27D12]">{subtitleStyle.fontSize}px</span>
                    </span>
                    <input
                      type="range"
                      min={8}
                      max={48}
                      step={1}
                      value={subtitleStyle.fontSize}
                      onChange={event => setSubtitleStyle(style => ({
                        ...style,
                        preset: 'custom',
                        fontSize: Number(event.target.value)
                      }))}
                      aria-label="Subtitle font size"
                      className="w-full accent-[#E27D12] h-2 bg-white/20 rounded cursor-pointer"
                    />
                  </label>

                  <label className="block space-y-1 text-xs text-gray-300">
                    <span className="font-semibold text-white">Font family</span>
                    <select
                      value={subtitleStyle.fontFamily}
                      onChange={event => setSubtitleStyle(style => ({
                        ...style,
                        preset: 'custom',
                        fontFamily: event.target.value
                      }))}
                      className="w-full rounded-xl border border-white/20 bg-black/60 px-3 py-2 text-sm text-white"
                    >
                      {SUBTITLE_FONT_FAMILIES.map(font => (
                        <option key={font.value} value={font.value}>{font.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1 text-xs text-gray-300">
                    <span className="font-semibold text-white">Text color</span>
                    <select
                      value={subtitleStyle.textColor === '#ffffff'
                        ? 'white'
                        : subtitleStyle.textColor === '#ffff00'
                          ? 'yellow'
                          : 'custom'}
                      onChange={event => {
                        const color = event.target.value === 'white'
                          ? '#ffffff'
                          : event.target.value === 'yellow'
                            ? '#ffff00'
                            : (subtitleStyle.textColor === '#ffffff' || subtitleStyle.textColor === '#ffff00')
                              ? '#00ffff'
                              : subtitleStyle.textColor;
                        setSubtitleStyle(style => ({ ...style, preset: 'custom', textColor: color }));
                      }}
                      className="w-full rounded-xl border border-white/20 bg-black/60 px-3 py-2 text-sm text-white"
                    >
                      <option value="white">White</option>
                      <option value="yellow">Yellow</option>
                      <option value="custom">Custom…</option>
                    </select>
                    {subtitleStyle.textColor !== '#ffffff' && subtitleStyle.textColor !== '#ffff00' && (
                      <input
                        type="color"
                        value={subtitleStyle.textColor}
                        onChange={event => setSubtitleStyle(style => ({
                          ...style,
                          preset: 'custom',
                          textColor: event.target.value
                        }))}
                        aria-label="Custom subtitle text color"
                        className="h-9 w-full cursor-pointer rounded-xl border border-white/20 bg-transparent mt-1.5"
                      />
                    )}
                  </label>

                  <label className="block space-y-1 text-xs text-gray-300">
                    <span className="font-semibold text-white">Background</span>
                    <select
                      value={subtitleStyle.background}
                      onChange={event => setSubtitleStyle(style => ({
                        ...style,
                        preset: 'custom',
                        background: event.target.value as SubtitleStyleSettings['background']
                      }))}
                      className="w-full rounded-xl border border-white/20 bg-black/60 px-3 py-2 text-sm text-white"
                    >
                      <option value="none">None</option>
                      <option value="semi-transparent">Semi-transparent</option>
                      <option value="solid">Solid</option>
                    </select>
                  </label>

                  <label className="block space-y-1 text-xs text-gray-300">
                    <span className="flex justify-between font-semibold text-white">
                      <span>Height</span>
                      <span className="text-[#E27D12]">{subtitleStyle.verticalPosition}%</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={50}
                      step={1}
                      value={subtitleStyle.verticalPosition}
                      onChange={event => setSubtitleStyle(style => ({
                        ...style,
                        preset: 'custom',
                        verticalPosition: Number(event.target.value)
                      }))}
                      aria-label="Subtitle height"
                      className="w-full accent-[#E27D12] h-2 bg-white/20 rounded cursor-pointer"
                    />
                  </label>
                </div>
              </div>
            )}

            {showAudioPicker && (
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                  <h2 className="text-base font-bold text-white">Audio Tracks</h2>
                  <button
                    type="button"
                    onClick={() => setShowAudioPicker(false)}
                    className="text-xs font-semibold text-[#E27D12] hover:text-white transition-colors cursor-pointer"
                  >
                    Done
                  </button>
                </div>
                <div className="space-y-1">
                  {audioTracks.length === 0 ? (
                    <div className="p-4 text-center text-xs text-gray-400 italic">
                      {mkvParsing ? 'Scanning audio tracks…' : audioTrackSupport === false
                        ? 'Audio switching unavailable'
                        : audioTrackSupport === null
                          ? 'Detecting audio…'
                          : 'Default audio'}
                    </div>
                  ) : (
                    audioTracks.map(track => (
                      <button
                        key={track.id}
                        onClick={() => {
                          selectAudioTrack(track.id);
                          setShowAudioPicker(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm transition-colors ${
                          selectedAudioTrackId === track.id
                            ? 'bg-[#E27D12]/20 text-[#E27D12] font-semibold'
                            : 'hover:bg-white/10 text-gray-300 hover:text-white'
                        }`}
                      >
                        <span>{track.label}</span>
                        {selectedAudioTrackId === track.id && <div className="h-2 w-2 rounded-full bg-[#E27D12]" />}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Episode List / Show Details when no panel is open */
          <>
            {/* Show Title & Episode Subheader */}
            <div className="px-4 pt-4 pb-2">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white tracking-tight leading-snug">
                  {media.title}
                </h1>
                {useNativePlayer ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/30">
                    libmpv
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/30" title={engineFallbackReason || 'HTML5 Fallback'}>
                    HTML5
                  </span>
                )}
              </div>
              {portraitSubHeader && (
                <p className="text-sm font-medium text-gray-400 mt-0.5">
                  {portraitSubHeader}
                </p>
              )}
            </div>

            {/* TV Series: Episodes Section */}
            {media.type === 'TV Series' && pickerSeasons.length > 0 && (
              <div className="mt-3">
                <div className="px-4 mb-2">
                  <h2 className="text-base font-bold text-white tracking-tight">
                    Episodes
                  </h2>
                </div>

                {/* Horizontal Season Tabs */}
                <div className="flex items-center space-x-6 overflow-x-auto scrollbar-none px-4 border-b border-white/10 touch-pan-x">
                  {pickerSeasons.map(season => {
                    const isSelected = Number(selectedPickerSeason) === Number(season);
                    return (
                      <button
                        key={season}
                        type="button"
                        onClick={() => setSelectedPickerSeason(season)}
                        className={`whitespace-nowrap pb-2.5 text-sm transition-colors cursor-pointer relative ${
                          isSelected
                            ? 'text-white font-bold border-b-2 border-white -mb-[1px]'
                            : 'text-gray-400 hover:text-gray-200 font-medium'
                        }`}
                      >
                        Season {season}
                      </button>
                    );
                  })}
                </div>

                {/* Episode List */}
                <div className="divide-y divide-white/[0.06] px-4 py-2">
                  {(() => {
                    const seasonMeta = media.seasons?.find(s => Number(s.season_number) === Number(selectedPickerSeason));
                    const seasonEpisodes = seasonMeta?.episodes;

                    if (seasonEpisodes && seasonEpisodes.length > 0) {
                      return seasonEpisodes.map(ep => {
                        const season = selectedPickerSeason;
                        const episode = ep.episode_number;
                        const matchingFile = allLocalFiles.find(lf =>
                          lf.exists &&
                          lf.media_id === media.id &&
                          Number(lf.season) === Number(season) &&
                          (Number(lf.episode) === Number(episode) ||
                            (lf.episode !== undefined && lf.end_episode !== undefined && Number(lf.episode) <= Number(episode) && Number(lf.end_episode) >= Number(episode)))
                        );
                        const isCurrentEpisode = Number(season) === Number(seasonNumber) && Number(episode) === Number(episodeNumber);
                        const epProg = allProgress.find(p => Number(p.season) === Number(season) && Number(p.episode) === Number(episode));
                        const epPct = epProg && epProg.duration_seconds > 0
                          ? Math.min(100, Math.round((epProg.position_seconds / epProg.duration_seconds) * 100))
                          : 0;

                        return (
                          <div
                            key={ep.episode_number}
                            onClick={() => {
                              if (matchingFile) {
                                void switchEpisode(matchingFile, season, episode, ep.name || getEpisodeTitle(matchingFile, season, episode));
                              }
                            }}
                            className={`flex items-center gap-3 py-3 transition-colors rounded-xl px-2 -mx-2 ${
                              matchingFile ? 'cursor-pointer group hover:bg-white/[0.04]' : 'opacity-50 cursor-not-allowed'
                            } ${isCurrentEpisode ? 'bg-white/[0.08]' : ''}`}
                          >
                            {/* Thumbnail with Play Icon & Progress */}
                            <div className="relative aspect-video w-28 min-[380px]:w-32 shrink-0 overflow-hidden rounded-lg bg-black/40">
                              {(ep.still_path || media.backdrop || media.poster) && (
                                <img
                                  src={ep.still_path || media.backdrop || media.poster}
                                  alt=""
                                  className={`h-full w-full object-cover transition-transform duration-200 ${matchingFile ? 'group-hover:scale-105' : ''}`}
                                />
                              )}
                              {matchingFile && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-active:bg-black/40 group-hover:bg-black/40 transition-colors">
                                  <Play className="h-4 w-4 fill-current text-white opacity-0 group-active:opacity-100 group-hover:opacity-100 transition-opacity drop-shadow" />
                                </div>
                              )}
                              {epProg && !epProg.is_completed && epPct > 0 && (
                                <div className="absolute bottom-0 inset-x-0 h-1 bg-black/60 z-10">
                                  <div className="bg-[#E27D12] h-full" style={{ width: `${epPct}%` }} />
                                </div>
                              )}
                            </div>

                            {/* Title & Metadata */}
                            <div className="min-w-0 flex-1">
                              <h3 className={`text-xs min-[380px]:text-sm font-semibold truncate ${
                                isCurrentEpisode ? 'text-[#E27D12]' : 'text-white'
                              }`}>
                                {ep.name || `Episode ${episode}`}
                              </h3>
                              <div className="flex items-center space-x-1.5 text-[11px] text-gray-400 mt-1 truncate">
                                <span>S{season} E{episode}</span>
                                {ep.air_date && (
                                  <>
                                    <span>•</span>
                                    <span>{formatAirDate(ep.air_date)}</span>
                                  </>
                                )}
                                {media.runtime && (
                                  <>
                                    <span>•</span>
                                    <span>{media.runtime}m</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      });
                    }

                    // Fallback to local files if no season episode metadata
                    const filesForSeason = allLocalFiles
                      .filter(file => file.exists && Number(file.season) === Number(selectedPickerSeason) && file.episode !== undefined)
                      .sort((a, b) => (Number(a.episode) ?? 0) - (Number(b.episode) ?? 0));

                    if (filesForSeason.length === 0) {
                      return (
                        <p className="p-6 text-center text-xs text-gray-400">
                          No available episodes in this season.
                        </p>
                      );
                    }

                    return filesForSeason.map(file => {
                      const season = file.season ?? 0;
                      const episode = file.episode ?? 0;
                      const details = getEpisodeDetails(season, episode);
                      const isCurrentEpisode = Number(season) === Number(seasonNumber) && Number(episode) === Number(episodeNumber);
                      const title = details?.name || getEpisodeTitle(file, season, episode);
                      const epProg = allProgress.find(p => Number(p.season) === Number(season) && Number(p.episode) === Number(episode));
                      const epPct = epProg && epProg.duration_seconds > 0
                        ? Math.min(100, Math.round((epProg.position_seconds / epProg.duration_seconds) * 100))
                        : 0;

                      return (
                        <div
                          key={file.id}
                          onClick={() => {
                            void switchEpisode(file, season, episode, title);
                          }}
                          className={`flex items-center gap-3 py-3 cursor-pointer group transition-colors rounded-xl px-2 -mx-2 hover:bg-white/[0.04] ${
                            isCurrentEpisode ? 'bg-white/[0.08]' : ''
                          }`}
                        >
                          {/* Thumbnail with Play Icon & Progress */}
                          <div className="relative aspect-video w-28 min-[380px]:w-32 shrink-0 overflow-hidden rounded-lg bg-black/40">
                            {(details?.still_path || media.backdrop || media.poster) && (
                              <img
                                src={details?.still_path || media.backdrop || media.poster}
                                alt=""
                                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                              />
                            )}
                            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-active:bg-black/40 group-hover:bg-black/40 transition-colors">
                              <Play className="h-4 w-4 fill-current text-white opacity-0 group-active:opacity-100 group-hover:opacity-100 transition-opacity drop-shadow" />
                            </div>
                            {epProg && !epProg.is_completed && epPct > 0 && (
                              <div className="absolute bottom-0 inset-x-0 h-1 bg-black/60 z-10">
                                <div className="bg-[#E27D12] h-full" style={{ width: `${epPct}%` }} />
                              </div>
                            )}
                          </div>

                          {/* Title & Metadata */}
                          <div className="min-w-0 flex-1">
                            <h3 className={`text-xs min-[380px]:text-sm font-semibold truncate ${
                              isCurrentEpisode ? 'text-[#E27D12]' : 'text-white'
                            }`}>
                              {title}
                            </h3>
                            <div className="flex items-center space-x-1.5 text-[11px] text-gray-400 mt-1 truncate">
                              <span>S{season} E{episode}</span>
                              {details?.air_date && (
                                <>
                                  <span>•</span>
                                  <span>{formatAirDate(details.air_date)}</span>
                                </>
                              )}
                              {media.runtime && (
                                <>
                                  <span>•</span>
                                  <span>{media.runtime}m</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}

            {/* Movies or other media types */}
            {media.type !== 'TV Series' && (
              <div className="px-4 py-2 space-y-2">
                {media.description && (
                  <p className="text-xs text-gray-300 leading-relaxed">
                    {media.description}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    )}
  </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
};
