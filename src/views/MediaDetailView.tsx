import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LocalFile, Media, MediaHistory, MediaStatus, MediaType } from '../types/media';
import { useMediaDetail } from '../hooks/useMediaDetail';
import { useDominantColor } from '../helper/useDominantColour';
import { getMediaTheme } from '../helper/mediaDetailTheme';
import { getHighQualityBackdropUrl, getLastWatchedEpisodeArtwork, isEpisodeWatched } from '../helper/episodeProgress';
import { captureVideoFrameAtTime, getCachedVideoFrame } from '../helper/videoFrameCapture';
import { dbService } from '../services/DatabaseService';
import { SIDEBAR_BREAKPOINT } from '../constants/appConstants';
import { useSidebarPadding } from '../hooks/useSidebarPadding';
import './MediaDetailView.css';
import { MetadataSearchResult } from '../providers/interfaces';
import { FixMatchModal } from '../components/FixMatchModal';
import { BackdropPickerModal } from '../components/BackdropPickerModal';
import { MergeDuplicateModal } from '../components/MergeDuplicateModal';
import { VideoPlayerModal } from '../components/VideoPlayerModal';
import { TitleBarPortal } from '../components/TitleBarDragRegion';
import { HorizontalDragScroll } from '../components/HorizontalDragScroll';
import { toLanguageCode } from '../services/MediaTextFilter';
import { tmdbProvider } from '../providers/TMDBProvider';
import { igdbProvider } from '../providers/IGDBProvider';
import {
  ArrowLeft,
  Star,
  Calendar,
  Film,
  Tv,
  Gamepad2,
  FolderCheck,
  FolderX,
  Globe,
  Plus,
  History,
  FileText,
  Building,
  Tag,
  Play,
  Edit3,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  User,
  CheckCircle2,
  Loader2,
  Clock,
  Layers,
  Code,
  MoreVertical,
  Trash2,
  Link as LinkIcon,
  Sparkles,
  X,
  Check,
  Wallpaper
} from 'lucide-react';

// ============================================================================
// PHONE BACKDROP SCROLL & ZOOM CONFIGURATION (Easily editable)
// ============================================================================
export const PHONE_BACKDROP_CONFIG = {
  /** Screen width threshold (in px) below which phone backdrop behavior is active */
  PHONE_BREAKPOINT: 640,
  /** Initial backdrop height (in px) on phone screens before scroll */
  INITIAL_HEIGHT: 520,
  /** Rate at which backdrop height reduces relative to scroll (e.g. 0.5 = 1px shrink per 2px scroll) */
  SCROLL_SHRINK_RATE: 0.5,
  /** Target aspect ratio where image is no longer cropped on the sides (16:9 standard) */
  TARGET_ASPECT_RATIO: 16 / 9,
  /** Maximum zoom scale when pulling / overscrolling at the top */
  MAX_PULL_ZOOM: 1.35,
  /** Sensitivity of pull-to-zoom (higher = faster zoom per pixel of pull) */
  PULL_ZOOM_SENSITIVITY: 0.0025,
  /** Spring-back animation duration (in ms) when pull-zoom is released */
  SPRING_BACK_DURATION_MS: 300,
} as const;

interface MediaDetailViewProps {
  media: Media;
  onBack: () => void;
  isCollapsed: boolean;
  onSelectMedia?: (media: Media) => void;
  onSearchCast?: (castName: string) => void;
  onSearchFilter?: (filterText: string) => void;
  onAccentColorChange?: (color: string) => void;
  accentColorOverride?: string;
  autoPlayFileId?: string;
  autoPlayOnOpen?: boolean;
  onAutoPlayHandled?: () => void;
  isTransitioning?: boolean;
  initialBackdrop?: string;
  initialHistory?: MediaHistory[];
}

interface DominantColorExtractorProps {
  imageSrc: string;
  onColorCalculated: (color: string) => void;
}

const DominantColorExtractor: React.FC<DominantColorExtractorProps> = ({
  imageSrc,
  onColorCalculated
}) => {
  const dominantColor = useDominantColor(imageSrc);
  const hasReportedColor = useRef<string | null>(null);

  useEffect(() => {
    // Check if the current dominantColor belongs to the expected imageSrc
    if (!dominantColor || hasReportedColor.current === imageSrc) return;

    hasReportedColor.current = imageSrc;
    onColorCalculated(`rgb(${dominantColor.join(',')})`);
  }, [dominantColor, imageSrc, onColorCalculated]);

  return null;
};

function getFileQualityRank(file: LocalFile): number {
  const str = (file.filename + ' ' + file.path).toLowerCase();
  if (str.includes('2160p') || str.includes('4k') || str.includes('uhd')) return 4;
  if (str.includes('1080p') || str.includes('fhd') || str.includes('bluray') || str.includes('remux')) return 3;
  if (str.includes('720p') || str.includes('hd')) return 2;
  if (str.includes('480p') || str.includes('dvd') || str.includes('sd')) return 1;
  return 0;
}

function getFileQualityLabel(file: LocalFile): string {
  const rank = getFileQualityRank(file);
  if (rank === 4) return '4K / 2160p';
  if (rank === 3) return '1080p';
  if (rank === 2) return '720p';
  if (rank === 1) return '480p';
  return 'SD / Default';
}

export const MediaDetailView: React.FC<MediaDetailViewProps> = ({
  media: initialMedia,
  onBack,
  isCollapsed,
  onSelectMedia,
  onSearchCast,
  onSearchFilter,
  onAccentColorChange,
  accentColorOverride,
  autoPlayFileId,
  autoPlayOnOpen,
  onAutoPlayHandled,
  isTransitioning = false,
  initialBackdrop,
  initialHistory
}) => {
  const {
    currentMedia,
    historyList,
    state,
    localFiles,
    availabilities,
    artwork,
    isRefreshingMetadata,
    refreshMessage,
    launchMessage,
    handleManualMetadataRefresh,
    handlePlayFile,
    logSessionHistory,
    updateHistoryEntry,
    deleteHistoryEntry,
    addCustomFilePath,
    relatedMedia,
    isLoadingRelated,
    addedExternalIds,
    handleAddRelatedToLibrary,
    updateCurrentMedia,
    allProgress,
    getResumeTarget,
    toggleEpisodeWatchStatus,
    linkFileToEpisode,
    refreshLocalFiles,
    refreshHistoryAndState
  } = useMediaDetail(initialMedia, isTransitioning, initialHistory);

  const [playerModeSetting, setPlayerModeSetting] = useState<'builtin' | 'os_default'>('builtin');
  const [sidebarHideEnabled, setSidebarHideEnabled] = useState<boolean>(() =>
    typeof document !== 'undefined' ? document.body.classList.contains('sidebar-hide-enabled') : true
  );
  const [activePlayerSession, setActivePlayerSession] = useState<{
    file: LocalFile;
    season: number;
    episode: number;
    position: number;
    title?: string;
    previewFrame?: string | null;
    previewSourceRect?: { left: number; top: number; width: number; height: number } | null;
  } | null>(null);
  const resumeBackdropImgRef = useRef<HTMLImageElement>(null);
  const handledAutoPlayKey = useRef<string | null>(null);

  const [fillVideoToScreen, setFillVideoToScreen] = useState<boolean>(false);

  const loadSettings = useCallback(() => {
    dbService.getSettings().then(s => {
      setPlayerModeSetting(s.player_mode || 'builtin');
      setSidebarHideEnabled(s.sidebar_hide_enabled !== false);
      if (typeof s.player_fill_to_screen === 'boolean') {
        setFillVideoToScreen(s.player_fill_to_screen);
      }
    });
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const updateBodyClass = () => {
      if (sidebarHideEnabled) {
        document.body.classList.add('sidebar-hide-enabled');
      } else {
        document.body.classList.remove('sidebar-hide-enabled');
      }
    };
    updateBodyClass();
  }, [sidebarHideEnabled]);

  // Three dot menu state
  const [showMenu, setShowMenu] = useState(false);
  const [showFixMatchModal, setShowFixMatchModal] = useState(false);
  const [isDeletingMedia, setIsDeletingMedia] = useState(false);

  // Duplicates & Merge modal state
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergePair, setMergePair] = useState<{ mediaA: Media; mediaB: Media } | null>(null);
  const [showBackdropPicker, setShowBackdropPicker] = useState(false);
  const [customBackdrop, setCustomBackdrop] = useState<string | null>(null);

  // Ephemeral preview modal for related items
  const [previewRelatedItem, setPreviewRelatedItem] = useState<MetadataSearchResult | null>(null);
  const [previewDetails, setPreviewDetails] = useState<Partial<Media> | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const metadataRefreshStartedFor = useRef<string | null>(null);

  const [failedBackdropSources, setFailedBackdropSources] = useState<string[]>([]);
  const [calculatedAccent, setCalculatedAccent] = useState<{ src: string; color: string } | null>(null);
  const [isPlayButtonStuck, setIsPlayButtonStuck] = useState(false);
  const playButtonRowRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const lastWatchedEpisodeArtwork = getLastWatchedEpisodeArtwork(currentMedia, historyList);

  const handleTriggerSearch = useCallback(
    (filterSyntax: string) => {
      if (onSearchFilter) {
        onSearchFilter(filterSyntax);
      } else if (onSearchCast && filterSyntax.startsWith('cast:')) {
        const rawName = filterSyntax.slice('cast:'.length).replace(/-/g, ' ');
        onSearchCast(rawName);
      }
    },
    [onSearchFilter, onSearchCast]
  );

  const getTypeFilter = (type: MediaType) => {
    if (type === 'Film') return 'type:movie';
    if (type === 'TV Series') return 'type:show';
    return 'type:game';
  };

  const handleDeleteMedia = async () => {
    const shouldDelete = window.confirm(
      `Delete "${currentMedia.title}" and all related library records? Local files on disk will not be deleted.`
    );
    if (!shouldDelete) return;

    setIsDeletingMedia(true);
    try {
      await dbService.deleteMedia(currentMedia.id);
      window.dispatchEvent(new CustomEvent('library-scanned'));
      onBack();
    } catch (err) {
      console.error('Failed to delete media:', err);
      window.alert('Could not delete this item. Please try again.');
      setIsDeletingMedia(false);
    }
  };

  const [isDesktopLayout, setIsDesktopLayout] = useState(typeof window !== 'undefined' && window.innerWidth >= SIDEBAR_BREAKPOINT);
  const { pagePadding: sidebarPadding } = useSidebarPadding(isCollapsed, sidebarHideEnabled);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);

  useEffect(() => {
    let leaveTimer: ReturnType<typeof setTimeout> | null = null;
    const sidebar = document.querySelector<HTMLElement>('[data-media-sidebar]');
    const triggerZone = document.querySelector<HTMLElement>('.mdv-sidebar-trigger-zone');

    const handleMouseEnter = () => {
      if (leaveTimer) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
      setIsSidebarHovered(true);
    };

    const handleMouseLeave = () => {
      if (leaveTimer) clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => {
        setIsSidebarHovered(false);
        leaveTimer = null;
      }, 200);
    };

    sidebar?.addEventListener('mouseenter', handleMouseEnter);
    sidebar?.addEventListener('mouseleave', handleMouseLeave);
    triggerZone?.addEventListener('mouseenter', handleMouseEnter);
    triggerZone?.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      if (leaveTimer) clearTimeout(leaveTimer);
      sidebar?.removeEventListener('mouseenter', handleMouseEnter);
      sidebar?.removeEventListener('mouseleave', handleMouseLeave);
      triggerZone?.removeEventListener('mouseenter', handleMouseEnter);
      triggerZone?.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  const backButtonMarginLeft = isDesktopLayout
    ? (isSidebarHovered
        ? (isCollapsed ? '5rem' : '17rem')
        : (sidebarPadding && sidebarPadding !== '1rem' ? `calc(${sidebarPadding} - 1rem)` : '0px'))
    : '0px';

  useEffect(() => {
    const handleResize = () => {
      const isDesktop = window.innerWidth >= SIDEBAR_BREAKPOINT;
      setIsDesktopLayout(current => current === isDesktop ? current : isDesktop);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useLayoutEffect(() => {
    if (isTransitioning) return;
    const page = pageRef.current;
    const sidebar = document.querySelector<HTMLElement>('[data-media-sidebar]');
    if (!page || !sidebar) return;

    let animationFrame = 0;
    const updateContentPositions = () => {
      animationFrame = 0;
      const isSidebarVisible = !sidebarHideEnabled || isSidebarHovered;
      const sidebarRight = window.innerWidth >= SIDEBAR_BREAKPOINT && isSidebarVisible
        ? Math.max(0, sidebar.getBoundingClientRect().right)
        : 0;
      const content = page.querySelectorAll<HTMLElement>('[data-sidebar-aware]');

      const shifts = Array.from(content, element => {
        const previousShift = Number.parseFloat(element.style.getPropertyValue('--mdv-sidebar-overlap-shift')) || 0;
        const naturalLeft = element.getBoundingClientRect().left
          - previousShift
          + (Number.parseFloat(window.getComputedStyle(element).paddingLeft) || 0);
        return {
          element,
          previousShift,
          nextShift: Math.max(0, sidebarRight + 24 - naturalLeft)
        };
      });

      shifts.forEach(({ element, previousShift, nextShift }) => {
        if (Math.abs(nextShift - previousShift) < 0.1) return;
        if (nextShift === 0) {
          element.style.removeProperty('--mdv-sidebar-overlap-shift');
        } else {
          element.style.setProperty('--mdv-sidebar-overlap-shift', `${nextShift}px`);
        }
      });
    };
    const scheduleUpdate = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(updateContentPositions);
    };

    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(page);
    resizeObserver.observe(sidebar);
    sidebar.addEventListener('transitionend', scheduleUpdate);
    window.addEventListener('resize', scheduleUpdate);
    updateContentPositions();

    return () => {
      resizeObserver.disconnect();
      sidebar.removeEventListener('transitionend', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  }, [isTransitioning, sidebarHideEnabled, isSidebarHovered]);
  const [selectedEpFiles, setSelectedEpFiles] = useState<Record<string, string>>({});
  const [activeEpMenu, setActiveEpMenu] = useState<string | null>(null);
  const [linkEpTarget, setLinkEpTarget] = useState<{ season: number; episode: number } | null>(null);
  const [selectedFileToLink, setSelectedFileToLink] = useState<string>('');

  const artworkCandidates = [
    customBackdrop ? (getHighQualityBackdropUrl(customBackdrop) || customBackdrop) : undefined,
    showBackdropPicker ? (getHighQualityBackdropUrl(artwork.backdrop) || artwork.backdrop) : undefined,
    getHighQualityBackdropUrl(lastWatchedEpisodeArtwork.still),
    getHighQualityBackdropUrl(lastWatchedEpisodeArtwork.seasonPoster),
    getHighQualityBackdropUrl(artwork.backdrop) || artwork.backdrop,
    getHighQualityBackdropUrl(initialBackdrop) || initialBackdrop,
    artwork.poster
  ].filter((source): source is string => Boolean(source));
  const artworkSource = artworkCandidates.find(source => !failedBackdropSources.includes(source));

  useEffect(() => {
    const needsMetadataRefresh = currentMedia.metadata_source === 'Notion Import'
      && !currentMedia.metadata_refreshed_at;
    if (!needsMetadataRefresh || isRefreshingMetadata || metadataRefreshStartedFor.current === currentMedia.id) return;

    metadataRefreshStartedFor.current = currentMedia.id;
    void handleManualMetadataRefresh();
  }, [
    currentMedia.id,
    currentMedia.metadata_source,
    currentMedia.metadata_refreshed_at,
    handleManualMetadataRefresh,
    isRefreshingMetadata
  ]);

  useEffect(() => {
    setFailedBackdropSources([]);
    setCustomBackdrop(null);
  }, [currentMedia.id]);

 // Resolve the accent color based on the current artwork source
  const accentColorForPage = (calculatedAccent && calculatedAccent.src === artworkSource
    ? calculatedAccent.color
    : undefined)
    || currentMedia.accent_color;

  const handleDominantColorCalculated = useCallback((color: string) => {
    if (!artworkSource) return;
    setCalculatedAccent({ src: artworkSource, color });
    onAccentColorChange?.(color);

    //if (initialMedia.accent_color) return;

    try {
      void dbService.saveMedia({
        ...currentMedia,
        accent_color: color,
        updated_at: new Date().toISOString()
      }).then(() => {
        window.dispatchEvent(new CustomEvent('library-scanned'));
      }).catch(error => console.error('Failed to save calculated accent color:', error));
    } catch (error) {
      console.error('Failed to save calculated accent color:', error);
    }
  }, [currentMedia, artworkSource, onAccentColorChange]);

  const detailAccentColor = accentColorForPage || accentColorOverride;
  const theme = getMediaTheme(detailAccentColor);

  // Season accordion state
  const [expandedSeason, setExpandedSeason] = useState<number | null>(1);
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(false);

  // Local launcher & modals state
  const [showAddHistoryModal, setShowAddHistoryModal] = useState(false);
  const [editingHistory, setEditingHistory] = useState<MediaHistory | null>(null);
  const [newStatus, setNewStatus] = useState<MediaStatus>('Finished');
  const [newScore, setNewScore] = useState<number | ''>(4);
  const [newContext, setNewContext] = useState<string>('Rewatch');
  const [newThoughts, setNewThoughts] = useState<string>('');
  const [newStartedAt, setNewStartedAt] = useState('');
  const [newCompletedAt, setNewCompletedAt] = useState('');
  const [historyError, setHistoryError] = useState('');

  const [showFilePickerModal, setShowFilePickerModal] = useState(false);
  const [customPath, setCustomPath] = useState('');

  const activeLocalFile = localFiles.find(lf => lf.exists) || localFiles[0];
  const isAvailableLocally = localFiles.some(lf => lf.exists);
  const isLocalMissing = localFiles.length > 0 && !isAvailableLocally;
  const resumeTarget = getResumeTarget();
  const [isHoveringPlay, setIsHoveringPlay] = useState(false);
  const [hoverResumeFrame, setHoverResumeFrame] = useState<string | null>(null);

  const previewFrameToShow = activePlayerSession?.previewFrame || hoverResumeFrame;
  const isShowingResumePreview = Boolean(
    (isHoveringPlay || Boolean(activePlayerSession?.previewFrame)) &&
    previewFrameToShow &&
    resumeTarget &&
    resumeTarget.position > 0
  );

  useEffect(() => {
    if (!resumeTarget || !resumeTarget.hasSavedProgress || resumeTarget.position <= 0 || !resumeTarget.file?.path) {
      setHoverResumeFrame(null);
      return;
    }
    let isCancelled = false;
    void captureVideoFrameAtTime(resumeTarget.file.path, resumeTarget.position).then(frame => {
      if (!isCancelled && frame) {
        setHoverResumeFrame(frame);
      }
    });
    return () => {
      isCancelled = true;
    };
  }, [resumeTarget?.file?.path, resumeTarget?.position, resumeTarget?.hasSavedProgress]);

  const handleTriggerPlay = async (targetFile?: LocalFile, startFromBeginning: boolean = false, episodeTitle?: string) => {
    const targetSeason = targetFile ? (targetFile.season || 0) : (resumeTarget?.season || 0);
    const targetEpisode = targetFile ? (targetFile.episode || 0) : (resumeTarget?.episode || 0);
    const matchedSeason = currentMedia.seasons?.find(s => Number(s.season_number) === Number(targetSeason));
    const matchedEpisode = matchedSeason?.episodes?.find(e => Number(e.episode_number) === Number(targetEpisode));
    const resolvedFallbackTitle = matchedEpisode?.name;

    const target: {
      file: LocalFile;
      season: number;
      episode: number;
      position: number;
      label: string;
      hasSavedProgress: boolean;
      title?: string;
    } | null = targetFile ? {
      file: targetFile,
      season: targetFile.season || 0,
      episode: targetFile.episode || 0,
      position: startFromBeginning ? 0 : 0,
      label: 'Play',
      hasSavedProgress: false,
      title: episodeTitle || resolvedFallbackTitle
    } : (resumeTarget ? {
      ...resumeTarget,
      title: resumeTarget.title || resolvedFallbackTitle
    } : null);

    if (!target) {
      if (activeLocalFile) handlePlayFile(activeLocalFile);
      return;
    }

    if (currentMedia.type === 'VideoGame' || playerModeSetting === 'os_default') {
      await handlePlayFile(target.file);
    } else {
      const frame = startFromBeginning ? null : (hoverResumeFrame || getCachedVideoFrame(target.file.path, target.position));
      const rawRect = (!fillVideoToScreen && frame)
        ? (resumeBackdropImgRef.current?.getBoundingClientRect() || backdropRef.current?.getBoundingClientRect() || null)
        : null;
      const previewSourceRect = rawRect && rawRect.width > 0 && rawRect.height > 0
        ? { left: rawRect.left, top: rawRect.top, width: rawRect.width, height: rawRect.height }
        : null;
      setActivePlayerSession({
        file: target.file,
        season: target.season,
        episode: target.episode,
        position: startFromBeginning ? 0 : target.position,
        title: target.title || resolvedFallbackTitle || target.file.parsed_title || target.file.filename,
        previewFrame: frame,
        previewSourceRect
      });
    }
  };

  useEffect(() => {
    const autoPlayKey = autoPlayFileId || (autoPlayOnOpen ? 'resume' : null);
    if (!autoPlayKey) {
      handledAutoPlayKey.current = null;
      return;
    }
    if (!localFiles.length || handledAutoPlayKey.current === autoPlayKey) return;
    const file = autoPlayFileId ? localFiles.find(localFile => localFile.id === autoPlayFileId) : undefined;
    if (autoPlayFileId && !file) return;
    handledAutoPlayKey.current = autoPlayKey;
    if (autoPlayFileId) {
      if (file?.exists) void handleTriggerPlay(file);
    } else {
      void handleTriggerPlay();
    }
    onAutoPlayHandled?.();
  }, [autoPlayFileId, autoPlayOnOpen, localFiles, onAutoPlayHandled, handleTriggerPlay]);

  useEffect(() => {
    if (isTransitioning) return;
    const playButtonRow = playButtonRowRef.current;
    if (!playButtonRow) return;

    let scrollContainer: HTMLElement | null = playButtonRow.parentElement;
    while (scrollContainer && scrollContainer !== document.body) {
      const overflowY = window.getComputedStyle(scrollContainer).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      scrollContainer = scrollContainer.parentElement;
    }
    if (!scrollContainer || scrollContainer === document.body) return;

    // Calculate exactly how far down the row sits inside the scroll view natively
    const initialOffsetTop = playButtonRow.offsetTop;

    const updateStickyState = () => {
      // 74px is your sticky threshold gap from the top
      const triggerPoint = initialOffsetTop - 74;
      const isStuck = scrollContainer.scrollTop >= triggerPoint;
      
      setIsPlayButtonStuck(previousState => previousState === isStuck ? previousState : isStuck);
    };

    scrollContainer.addEventListener('scroll', updateStickyState, { passive: true });
    window.addEventListener('resize', updateStickyState);
    updateStickyState();

    return () => {
      scrollContainer.removeEventListener('scroll', updateStickyState);
      window.removeEventListener('resize', updateStickyState);
    };
  }, [isTransitioning, activeLocalFile, isAvailableLocally]);

  // Phone backdrop scroll & zoom effect: reduces height until uncropped, zooms in when trying to scroll past top
  useEffect(() => {
    if (isTransitioning) return;
    const backdropEl = backdropRef.current;
    const pageEl = pageRef.current;
    if (!backdropEl || !pageEl) return;

    let scrollContainer: HTMLElement | null = pageEl.parentElement;
    while (scrollContainer && scrollContainer !== document.body) {
      const overflowY = window.getComputedStyle(scrollContainer).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      scrollContainer = scrollContainer.parentElement;
    }
    if (!scrollContainer || scrollContainer === document.body) return;

    let touchStartY = 0;
    let isTouchingAtTop = false;
    let wheelPullDistance = 0;
    let wheelSpringTimeout: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;

    const getBackdropImages = () =>
      backdropEl.querySelectorAll<HTMLElement>('.mdv-backdrop-img');

    const applyBackdropState = (scrollTop: number, pullDistance = 0) => {
      const isPhone = window.innerWidth < PHONE_BACKDROP_CONFIG.PHONE_BREAKPOINT;

      if (!isPhone) {
        backdropEl.style.height = '';
        getBackdropImages().forEach(img => {
          img.style.transform = '';
          img.style.transition = '';
        });
        return;
      }

      const viewportWidth = scrollContainer.clientWidth || window.innerWidth;
      const uncroppedHeight = viewportWidth / PHONE_BACKDROP_CONFIG.TARGET_ASPECT_RATIO;

      // When scrolling down, reduce height slower than scroll until uncropped
      if (scrollTop > 0) {
        const heightReduction = scrollTop * PHONE_BACKDROP_CONFIG.SCROLL_SHRINK_RATE;
        const targetHeight = Math.max(
          uncroppedHeight,
          PHONE_BACKDROP_CONFIG.INITIAL_HEIGHT - heightReduction
        );
        backdropEl.style.height = `${targetHeight}px`;

        getBackdropImages().forEach(img => {
          img.style.transform = '';
          img.style.transition = '';
        });
      } else {
        // At the top (or overscrolling): keep initial height
        backdropEl.style.height = `${PHONE_BACKDROP_CONFIG.INITIAL_HEIGHT}px`;

        // Calculate zoom when trying to scroll past top
        const effectivePull = pullDistance > 0 ? pullDistance : Math.max(0, -scrollTop);
        if (effectivePull > 0) {
          const zoom = 1 + Math.min(
            PHONE_BACKDROP_CONFIG.MAX_PULL_ZOOM - 1,
            effectivePull * PHONE_BACKDROP_CONFIG.PULL_ZOOM_SENSITIVITY
          );
          getBackdropImages().forEach(img => {
            img.style.transition = 'none';
            img.style.transform = `scale(${zoom})`;
          });
        }
      }
    };

    const handleScroll = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        applyBackdropState(scrollContainer.scrollTop);
      });
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (window.innerWidth >= PHONE_BACKDROP_CONFIG.PHONE_BREAKPOINT) return;
      if (scrollContainer.scrollTop <= 1) {
        touchStartY = e.touches[0].clientY;
        isTouchingAtTop = true;
      } else {
        isTouchingAtTop = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isTouchingAtTop || window.innerWidth >= PHONE_BACKDROP_CONFIG.PHONE_BREAKPOINT) return;
      if (scrollContainer.scrollTop <= 1) {
        const currentY = e.touches[0].clientY;
        const deltaY = currentY - touchStartY;
        if (deltaY > 0) {
          applyBackdropState(0, deltaY);
        }
      } else {
        isTouchingAtTop = false;
      }
    };

    const handleTouchEnd = () => {
      if (!isTouchingAtTop) return;
      isTouchingAtTop = false;
      const images = getBackdropImages();
      images.forEach(img => {
        img.style.transition = `transform ${PHONE_BACKDROP_CONFIG.SPRING_BACK_DURATION_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1)`;
        img.style.transform = 'scale(1)';
      });
    };

    const handleWheel = (e: WheelEvent) => {
      if (window.innerWidth >= PHONE_BACKDROP_CONFIG.PHONE_BREAKPOINT) return;
      if (scrollContainer.scrollTop <= 0 && e.deltaY < 0) {
        wheelPullDistance = Math.min(250, wheelPullDistance + Math.abs(e.deltaY) * 0.4);
        applyBackdropState(0, wheelPullDistance);

        if (wheelSpringTimeout) clearTimeout(wheelSpringTimeout);
        wheelSpringTimeout = setTimeout(() => {
          wheelPullDistance = 0;
          const images = getBackdropImages();
          images.forEach(img => {
            img.style.transition = `transform ${PHONE_BACKDROP_CONFIG.SPRING_BACK_DURATION_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1)`;
            img.style.transform = 'scale(1)';
          });
        }, 150);
      }
    };

    const handleResize = () => {
      applyBackdropState(scrollContainer.scrollTop);
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    scrollContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
    scrollContainer.addEventListener('touchmove', handleTouchMove, { passive: true });
    scrollContainer.addEventListener('touchend', handleTouchEnd, { passive: true });
    scrollContainer.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    scrollContainer.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('resize', handleResize);

    applyBackdropState(scrollContainer.scrollTop);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (wheelSpringTimeout) clearTimeout(wheelSpringTimeout);
      scrollContainer.removeEventListener('scroll', handleScroll);
      scrollContainer.removeEventListener('touchstart', handleTouchStart);
      scrollContainer.removeEventListener('touchmove', handleTouchMove);
      scrollContainer.removeEventListener('touchend', handleTouchEnd);
      scrollContainer.removeEventListener('touchcancel', handleTouchEnd);
      scrollContainer.removeEventListener('wheel', handleWheel);
      window.removeEventListener('resize', handleResize);
    };
  }, [isTransitioning, currentMedia.id, artworkSource]);

  const openHistoryModal = (history?: MediaHistory) => {
    setEditingHistory(history || null);
    setNewStatus(history?.status || 'Finished');
    setNewScore(history ? (history.score ?? '') : 4);
    setNewContext(history?.context || (history ? '' : 'Rewatch'));
    setNewThoughts(history?.thoughts || '');
    setNewStartedAt(history?.started_at?.slice(0, 10) || '');
    setNewCompletedAt(history
      ? (history.completed_at?.slice(0, 10) || '')
      : new Date().toISOString().slice(0, 10));
    setHistoryError('');
    setShowAddHistoryModal(true);
  };

  const handleAddHistorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHistoryError('');
    try {
      if (editingHistory) {
        await updateHistoryEntry({
          ...editingHistory,
          status: newStatus,
          score: newScore === '' ? undefined : newScore,
          context: newContext.trim() || undefined,
          thoughts: newThoughts.trim() || undefined,
          started_at: newStartedAt || undefined,
          completed_at: newCompletedAt || undefined
        });
      } else {
        await logSessionHistory({
          status: newStatus,
          score: newScore === '' ? undefined : newScore,
          context: newContext,
          thoughts: newThoughts,
          started_at: newStartedAt || undefined,
          completed_at: newCompletedAt || undefined
        });
      }
      setShowAddHistoryModal(false);
      setEditingHistory(null);
      setNewThoughts('');
    } catch (error) {
      console.error('Failed to save history log:', error);
      setHistoryError('Could not save this log. Please try again.');
    }
  };

  const handleDeleteHistory = async (history: MediaHistory) => {
    if (!window.confirm('Delete this history log? This cannot be undone.')) return;
    setHistoryError('');
    try {
      await deleteHistoryEntry(history.id);
    } catch (error) {
      console.error('Failed to delete history log:', error);
      setHistoryError('Could not delete this log. Please try again.');
    }
  };

  const handleCustomPathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addCustomFilePath(customPath);
    setShowFilePickerModal(false);
    setCustomPath('');
  };

  const getTypeIcon = () => {
    switch (currentMedia.type) {
      case 'Film':
        return <Film className="mdv-icon-md mdv-icon-film" />;
      case 'TV Series':
        return <Tv className="mdv-icon-md mdv-icon-tv" />;
      case 'VideoGame':
        return <Gamepad2 className="mdv-icon-md mdv-icon-game" />;
    }
  };

  const logoUrl = artwork.logo || currentMedia.logo;

  return (
    <div
      ref={pageRef}
      className="mdv-page"
      data-tone={theme.tone}
      style={{
        ...theme.cssVars,
        backgroundColor: detailAccentColor || currentMedia.accent_color || '#423e3f'
      }}
    >
      {/* Pinned Backdrop */}
      <div ref={backdropRef} className="mdv-backdrop">
        {artworkSource ? (
          <img
            src={artworkSource}
            alt={currentMedia.title}
            className="mdv-backdrop-img"
            onError={() => {
              setFailedBackdropSources(failedSources =>
                failedSources.includes(artworkSource)
                  ? failedSources
                  : [...failedSources, artworkSource]
              );
            }}
          />
        ) : (
          <div className="mdv-backdrop-fallback" />
        )}
        {/* Hover preview when in standard (fit) mode: behaves like backdrop image */}
        {!fillVideoToScreen && previewFrameToShow && resumeTarget && resumeTarget.position > 0 && (
          <img
            ref={resumeBackdropImgRef}
            src={previewFrameToShow}
            alt="Resume frame preview"
            className={`mdv-backdrop-img transition-opacity duration-300 ease-in-out ${
              isShowingResumePreview ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          />
        )}
        {/* Hero Backlight Glow Effect */}
          {/* <div className="absolute -inset-10 opacity-40 transition-opacity duration-500 blur-3xl pointer-events-none z-0">
            <img 
              src={artworkSource} 
              alt="" 
              className="w-full h-full object-cover saturate-200" 
            />
          </div> */}
        {!isTransitioning && artworkSource && (
          <DominantColorExtractor
            key={artworkSource}
            imageSrc={artworkSource}
            onColorCalculated={handleDominantColorCalculated}
          />
        )}

        <div className="mdv-backdrop-overlay" />
      </div>

      {/* Hover preview when in fill-screen mode: matches full screen video player for a seamless transition */}
      {fillVideoToScreen && previewFrameToShow && resumeTarget && resumeTarget.position > 0 && (
        <img
          src={previewFrameToShow}
          alt="Resume frame preview"
          className={`fixed inset-0 w-full h-full object-cover object-center pointer-events-none transition-opacity duration-300 ease-in-out z-[1] ${
            isShowingResumePreview ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {/* Pinned Header Bar Actions */}
      {!activePlayerSession && (
        <>
          <TitleBarPortal target="left">
            <button
              onClick={onBack}
              onMouseDown={(e) => e.stopPropagation()}
              data-tauri-drag-region="false"
              className="mdv-btn mdv-btn-glass mdv-back-btn cursor-pointer group flex items-center h-8 w-8 hover:w-36 transition-[width,margin] duration-300 ease-in-out overflow-hidden whitespace-nowrap !p-0 !gap-0 hover:backdrop-blur-md justify-start"
              title="Back to Library"
              style={{
                marginLeft: backButtonMarginLeft,
                transition: 'margin-left 0.3s cubic-bezier(0.16, 1, 0.3, 1), width 0.3s ease-in-out'
              }}
            >
              <div className="w-8 h-8 flex items-center justify-center shrink-0">
                <ArrowLeft className="w-4 h-4 text-white" />
              </div>
              <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 delay-100 text-xs font-medium text-white pr-2.5">
                Back to Library
              </span>
            </button>
          </TitleBarPortal>

          <TitleBarPortal target="right">
            <div className="relative" data-tauri-drag-region="false">
              <button
                onClick={() => setShowMenu(!showMenu)}
                onMouseDown={(e) => e.stopPropagation()}
                data-tauri-drag-region="false"
                className="mdv-btn mdv-btn-glass mdv-btn-icon-glass cursor-pointer h-8 w-8 flex items-center justify-center !p-0"
                title="Media Options"
              >
                <MoreVertical className="w-4 h-4 text-white fill-current shrink-0" />
              </button>

              {showMenu && (
                <div 
                  onMouseDown={(e) => e.stopPropagation()}
                  data-tauri-drag-region="false"
                  onMouseLeave={() => setShowMenu(false)}
                  className="absolute right-0 top-full mt-2 w-56 bg-[#1b1d2a]/70 backdrop-blur-xl border border-white/15 rounded-xl shadow-2xl py-1 z-50 animate-fadeIn before:absolute before:-top-2 before:h-2 before:inset-x-0 after:absolute after:-bottom-4 after:h-4 after:inset-x-0"
                >
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      handleManualMetadataRefresh();
                    }}
                    disabled={isRefreshingMetadata}
                    className="w-full text-left px-4 py-2.5 text-xs text-gray-200 hover:bg-white/[0.08] hover:text-white hover:shadow-[inset_0_0_12px_rgba(255,255,255,0.05)] flex items-center space-x-2.5 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className="w-4 h-4 text-[#E27D12] shrink-0" />
                    <span>{isRefreshingMetadata ? 'Re-syncing Provider...' : 'Refresh Metadata'}</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowMenu(false);
                      setShowFixMatchModal(true);
                    }}
                    className="w-full text-left px-4 py-2.5 text-xs text-gray-200 hover:bg-white/[0.08] hover:text-white hover:shadow-[inset_0_0_12px_rgba(255,255,255,0.05)] flex items-center space-x-2.5 transition-all cursor-pointer border-t border-white/10"
                  >
                    <LinkIcon className="w-4 h-4 text-sky-400 shrink-0" />
                    <span>Fix Match / Change Metadata</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowMenu(false);
                      setShowBackdropPicker(true);
                    }}
                    className="w-full text-left px-4 py-2.5 text-xs text-gray-200 hover:bg-white/[0.08] hover:text-white hover:shadow-[inset_0_0_12px_rgba(255,255,255,0.05)] flex items-center space-x-2.5 transition-all cursor-pointer border-t border-white/10"
                  >
                    <Wallpaper className="w-4 h-4 text-sky-400 shrink-0" />
                    <span>Change Background Image</span>
                  </button>

                  <button
                    onClick={() => {
                      setShowMenu(false);
                      void handleDeleteMedia();
                    }}
                    disabled={isDeletingMedia}
                    className="w-full text-left px-4 py-2.5 text-xs text-[#ff3D12] hover:bg-[#ff3D12]/20 hover:text-red-300 flex items-center space-x-2.5 transition-colors cursor-pointer border-t border-white/10 disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4 shrink-0" />
                    <span>{isDeletingMedia ? 'Deleting...' : 'Delete from Library'}</span>
                  </button>
                </div>
              )}
            </div>
          </TitleBarPortal>
        </>
      )}

      {/* Scrollable Hero Content */}
      <div className="mdv-hero">
        <div
          className="mdv-hero-inner mdv-sidebar-aware"
          data-sidebar-aware
          style={{
            paddingLeft: isDesktopLayout ? undefined : '1rem'
          }}
        >
          <div className="mdv-title-block">
            <div className="mdv-badges">
              <span
                className="mdv-type-badge cursor-pointer transition-transform hover:scale-105 hover:brightness-125"
                title={`Filter by type: ${currentMedia.type}`}
                onClick={e => {
                  e.stopPropagation();
                  handleTriggerSearch(getTypeFilter(currentMedia.type));
                }}
              >
                {getTypeIcon()}
                <span>{currentMedia.type}</span>
              </span>

              {isAvailableLocally ? (
                <span
                  className="mdv-status-badge mdv-status-badge--ok cursor-pointer transition-transform hover:scale-105 hover:brightness-125"
                  title="Filter by local files: Available Locally"
                  onClick={e => {
                    e.stopPropagation();
                    handleTriggerSearch('local:available');
                  }}
                >
                  <FolderCheck className="mdv-icon-md" />
                  <span>🖥 Available Locally</span>
                </span>
              ) : isLocalMissing ? (
                <span
                  className="mdv-status-badge mdv-status-badge--warn cursor-pointer transition-transform hover:scale-105 hover:brightness-125"
                  title="Filter by local files: Local file missing"
                  onClick={e => {
                    e.stopPropagation();
                    handleTriggerSearch('local:missing');
                  }}
                >
                  <FolderX className="mdv-icon-md" />
                  <span>⚠ Local file missing</span>
                </span>
              ) : null}

              {currentMedia.release_year && (
                <span
                  className="mdv-pill cursor-pointer transition-transform hover:scale-105 hover:brightness-125"
                  title={`Filter by year: ${currentMedia.release_year}`}
                  onClick={e => {
                    e.stopPropagation();
                    handleTriggerSearch(`year:${currentMedia.release_year}`);
                  }}
                >
                  <Calendar className="mdv-icon-sm mdv-icon-accent-on-dark" />
                  <span>{currentMedia.release_year}</span>
                </span>
              )}

              {currentMedia.runtime && (
                <span
                  className="mdv-pill cursor-pointer transition-transform hover:scale-105 hover:brightness-125"
                  title={`Filter by runtime: ${currentMedia.runtime} mins`}
                  onClick={e => {
                    e.stopPropagation();
                    handleTriggerSearch(`runtime:${currentMedia.runtime}`);
                  }}
                >
                  <Clock className="mdv-icon-sm mdv-icon-accent-on-dark" />
                  <span>{currentMedia.runtime} mins</span>
                </span>
              )}

              {currentMedia.language && (
                <span
                  className="mdv-pill cursor-pointer transition-transform hover:scale-105 hover:brightness-125"
                  title={`Filter by language: ${currentMedia.language.toUpperCase()}`}
                  onClick={e => {
                    e.stopPropagation();
                    handleTriggerSearch(`lang:${toLanguageCode(currentMedia.language)}`);
                  }}
                >
                  <Globe className="mdv-icon-sm mdv-icon-accent-on-dark" />
                  <span>{currentMedia.language.toUpperCase()}</span>
                </span>
              )}

              {currentMedia.publisher && (
                <span
                  className="mdv-pill cursor-pointer transition-transform hover:scale-105 hover:brightness-125"
                  title={`Filter by publisher: ${currentMedia.publisher}`}
                  onClick={e => {
                    e.stopPropagation();
                    handleTriggerSearch(`publisher:${currentMedia.publisher!.trim().replace(/\s+/g, '-')}`);
                  }}
                >
                  <Building className="mdv-icon-sm mdv-icon-amber" />
                  <span>{currentMedia.publisher}</span>
                </span>
              )}

              {currentMedia.developer && (
                <span
                  className="mdv-pill cursor-pointer transition-transform hover:scale-105 hover:brightness-125"
                  title={`Filter by developer: ${currentMedia.developer}`}
                  onClick={e => {
                    e.stopPropagation();
                    handleTriggerSearch(`developer:${currentMedia.developer!.trim().replace(/\s+/g, '-')}`);
                  }}
                >
                  <Code className="mdv-icon-sm mdv-icon-purple" />
                  <span>{currentMedia.developer}</span>
                </span>
              )}
            </div>

            {logoUrl ? (
              <div className="mdv-title-lockup py-1" style={{ willChange: 'transform' }}>
                <img
                  src={logoUrl}
                  alt={currentMedia.title}
                  className="h-24 sm:h-35 max-w-md object-contain drop-shadow-[0_10px_10px_rgba(0,0,0,0.8)]"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const titleEl = document.getElementById(`media-title-text-${currentMedia.id}`);
                    if (titleEl) titleEl.classList.remove('hidden');
                  }}
                />
              </div>
            ) : null}

            <h1
              id={`media-title-text-${currentMedia.id}`}
              className={`mdv-title-lockup text-4xl sm:text-6xl font-extrabold uppercase text-white tracking-tight drop-shadow-md leading-none flex items-center space-x-3 ${logoUrl ? 'hidden' : ''}`}
              style={{ willChange: 'transform' }}
            >
              <span>{currentMedia.title}</span>
            </h1>

            {currentMedia.genres && currentMedia.genres.length > 0 && (
              <div className="mdv-genres">
                {currentMedia.genres.map(g => (
                  <span
                    key={g}
                    className="mdv-genre cursor-pointer transition-transform hover:scale-105 hover:brightness-125"
                    title={`Filter by genre: ${g}`}
                    onClick={e => {
                      e.stopPropagation();
                      handleTriggerSearch(`genre:${g.trim().replace(/\s+/g, '-')}`);
                    }}
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}

            <div className="mdv-feedback">
              {launchMessage && (
                <span className="mdv-message mdv-fade-in">
                  {launchMessage}
                </span>
              )}

              {refreshMessage && (
                <span className="mdv-message mdv-fade-in">
                  <CheckCircle2 className="mdv-icon-md" />
                  <span>{refreshMessage}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {activeLocalFile && isAvailableLocally && (
        <div
          ref={playButtonRowRef}
          className={`mdv-play-row mdv-sidebar-aware flex flex-wrap ${isPlayButtonStuck ? isDesktopLayout ?'w-full justify-center':'w-full justify-center' : ''} gap-3`}
          data-sidebar-aware
          style={{ 
            paddingLeft: isDesktopLayout ? undefined : '1rem',
            paddingTop: isPlayButtonStuck? undefined  :'1.5rem'
          }}
        >
          <button
            onMouseEnter={() => setIsHoveringPlay(true)}
            onMouseLeave={() => setIsHoveringPlay(false)}
            onClick={() => handleTriggerPlay(undefined, false)}
            className="mdv-btn mdv-btn-play flex items-center space-x-2"
          >
            <Play className="mdv-icon-lg" fill="currentColor" />
            <span>{resumeTarget ? resumeTarget.label.toUpperCase() : `PLAY ${currentMedia.type === 'VideoGame' ? 'GAME' : 'MEDIA'}`}</span>
          </button>

          {/* Only show Start from Beginning when there's saved progress */}
          {resumeTarget?.hasSavedProgress && currentMedia.type !== 'VideoGame' && (
            <button
              onClick={() => handleTriggerPlay(undefined, true)}
              className="px-4 py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/20 backdrop-blur-md transition-all cursor-pointer shadow-md"
              title="Restart playback from 00:00"
            >
              Start from Beginning
            </button>
          )}
        </div>
      )}
      {/* Main Content Layout */}
      <div
        className="mdv-main mdv-sidebar-aware"
        data-sidebar-aware
        style={{ paddingLeft: isDesktopLayout ? undefined : '1rem' }}
      >
        {/* Left Column: Overview, Multi-watch Breakdown, Seasons, Cast, Journal */}
        <div className="mdv-col mdv-col--main">
          {/* Overview */}
          <section className="mdv-card">
            <h2 className="mdv-card-title">
              <FileText className="mdv-icon-lg mdv-icon-accent" />
              <span>Overview & Synopsis</span>
            </h2>
            <p className="mdv-synopsis">
              {currentMedia.description || 'No detailed synopsis recorded yet for this entry.'}
            </p>
            {currentMedia.metadata_refreshed_at && (
              <p className="mdv-meta-note">
                Metadata Last Refreshed: {new Date(currentMedia.metadata_refreshed_at).toLocaleString()} ({currentMedia.metadata_source || 'TMDB/IGDB'})
              </p>
            )}
          </section>

          {/* Multi-Watch / Multi-Play Context Explanation Callout */}
          {/* {historyList.length > 1 && (
            <section className="bg-purple-950/40 border border-purple-500/40 p-5 rounded-2xl space-y-3 shadow-md">
              <div className="flex items-center space-x-2 text-purple-300 font-bold text-sm">
                <Info className="w-5 h-5 text-purple-400 shrink-0" />
                <span>Watch / Play History Breakdown ({historyList.length} Sessions Recorded)</span>
              </div>

              <p className="text-xs text-gray-200 leading-relaxed">
                This media item has multiple interaction logs in your database (e.g. initial plays, rewatches, restarts, or re-syncs). The app normalizes these into a <strong>single canonical entry</strong> with <strong>{historyList.length} historical tracking logs</strong> preserved below.
              </p>

              <div className="flex flex-wrap gap-2 pt-1 text-xs">
                <span className="bg-purple-900/80 text-purple-200 border border-purple-400/30 px-2.5 py-1 rounded-lg font-semibold">
                  Total Watches/Plays: {state.total_watch_play_count}
                </span>
                <span className="bg-[#B3620D]/80 text-[#E27D12] border border-[#E27D12]/30 px-2.5 py-1 rounded-lg font-semibold">
                  Rewatches / Replays: {state.rewatch_count}
                </span>
                {state.abandoned_count > 0 && (
                  <span className="bg-amber-900/80 text-amber-200 border border-amber-400/30 px-2.5 py-1 rounded-lg font-semibold">
                    Abandoned Sessions: {state.abandoned_count}
                  </span>
                )}
                {state.first_watched_played && (
                  <span className="bg-[#1c2030] text-gray-300 border border-[#2d3248] px-2.5 py-1 rounded-lg font-mono">
                    First Recorded: {state.first_watched_played}
                  </span>
                )}
              </div>
            </section>
          )} */}

          {/* Cast Rail */}
          {currentMedia.cast && currentMedia.cast.length > 0 && (
            <section className="mdv-card mdv-card--roomy">
              <h2 className="mdv-card-title">
                <User className="mdv-icon-lg mdv-icon-accent" />
                <span>Top Cast Members</span>
              </h2>

              <HorizontalDragScroll className="mdv-cast-rail">
                {currentMedia.cast.map(member => (
                  <div
                    key={member.id}
                    className="mdv-cast-member cursor-pointer select-none transition-transform hover:scale-105"
                    title="Click to find media with this actor"
                    onClick={e => {
                      e.stopPropagation();
                      handleTriggerSearch(`cast:${member.name.trim().replace(/\s+/g, '-')}`);
                    }}
                  >
                    <div className="mdv-cast-avatar select-none">
                      {member.profile_path ? (
                        <img
                          src={member.profile_path}
                          alt={member.name}
                          draggable={false}
                          className="select-none pointer-events-none"
                        />
                      ) : (
                        <div className="mdv-cast-avatar-empty select-none">
                          <User className="mdv-icon-xl" />
                        </div>
                      )}
                    </div>
                    <p className="mdv-cast-name select-none" title={member.name}>{member.name}</p>
                    {member.character && (
                      <p className="mdv-cast-role select-none" title={member.character}>{member.character}</p>
                    )}
                  </div>
                ))}
              </HorizontalDragScroll>
            </section>
          )}

          {/* TV Series Seasons & Episodes Accordion */}
          {currentMedia.type === 'TV Series' && currentMedia.seasons && currentMedia.seasons.length > 0 && (
            <section className="mdv-card mdv-card--roomy">
              <h2 className="mdv-card-title">
                <Layers className="mdv-icon-lg mdv-icon-accent" />
                <span>Seasons & Episode Guide ({currentMedia.seasons.length} Seasons)</span>
              </h2>

              <div className="mdv-seasons">
                {currentMedia.seasons.map(season => {
                  const isExpanded = expandedSeason === season.season_number;
                  return (
                    <div key={season.season_number} className="mdv-tile mdv-season">
                      <button
                        onClick={() => setExpandedSeason(isExpanded ? null : season.season_number)}
                        className="mdv-season-toggle"
                      >
                        <div className="mdv-season-info">
                          {season.poster_path && (
                            <img src={season.poster_path} alt={season.name} className="mdv-season-poster" />
                          )}
                          <div>
                            <h3 className="mdv-season-name">{season.name}</h3>
                            <p className="mdv-season-count">
                              {season.episode_count || (season.episodes ? season.episodes.length : 0)} Episodes
                            </p>
                          </div>
                        </div>

                        {isExpanded
                          ? <ChevronUp className="mdv-icon-lg mdv-icon-accent" />
                          : <ChevronDown className="mdv-icon-lg mdv-icon-accent" />}
                      </button>

                      {isExpanded && (
                        <div className="mdv-season-body">
                          {season.overview && (
                            <p className="mdv-season-overview">{season.overview}</p>
                          )}

                          {season.episodes && season.episodes.length > 0 ? (
                            <div className="mdv-episodes">
                              {season.episodes.map(ep => {
                                const epKey = `${season.season_number}_${ep.episode_number}`;
                                const epWatched = isEpisodeWatched(historyList, season.season_number, ep.episode_number);

                                const matchingFiles = localFiles.filter(lf =>
                                  lf.exists &&
                                  lf.media_id === currentMedia.id &&
                                  lf.season === season.season_number &&
                                  (lf.episode === ep.episode_number ||
                                    (lf.episode !== undefined && lf.end_episode !== undefined && lf.episode <= ep.episode_number && lf.end_episode >= ep.episode_number))
                                );

                                const sortedFiles = [...matchingFiles].sort((a, b) => getFileQualityRank(b) - getFileQualityRank(a) || b.size - a.size);
                                const selectedFileId = selectedEpFiles[epKey] || (sortedFiles[0] ? sortedFiles[0].id : undefined);
                                const activeEpFile = sortedFiles.find(f => f.id === selectedFileId) || sortedFiles[0];

                                const epProg = allProgress.find(p => p.season === season.season_number && p.episode === ep.episode_number);
                                const epPct = epProg && epProg.duration_seconds > 0 ? Math.min(100, Math.round((epProg.position_seconds / epProg.duration_seconds) * 100)) : 0;

                                return (
                                  <div key={ep.episode_number} className="mdv-tile mdv-tile--sm mdv-episode relative group">
                                    {ep.still_path ? (
                                      <img src={ep.still_path} alt={ep.name} className="mdv-episode-still" />
                                    ) : (
                                      <div className="w-28 h-16 bg-[#1a1c29] rounded-lg shrink-0 flex items-center justify-center text-gray-500 border border-[#2d3145]">
                                        <Tv className="w-6 h-6 text-sky-400" />
                                      </div>
                                    )}

                                    <div className="mdv-episode-info flex-1 min-w-0">
                                      <div className="mdv-episode-head flex items-center justify-between gap-2">
                                        <div className="flex items-center space-x-2 truncate">
                                          <h4 className="mdv-episode-title font-bold text-white text-sm truncate">
                                            E{ep.episode_number}. {ep.name}
                                          </h4>

                                          {epWatched ? (
                                            <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center space-x-1 shrink-0">
                                              <CheckCircle2 className="w-3 h-3" />
                                              <span>Watched</span>
                                            </span>
                                          ) : (
                                            <span className="bg-[#1e212d] text-gray-400 border border-[#2f3448] text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0">
                                              Unwatched
                                            </span>
                                          )}
                                        </div>

                                        {ep.air_date && <span className="mdv-episode-date text-xs text-gray-400 shrink-0">{ep.air_date}</span>}
                                      </div>

                                      {ep.overview && (
                                        <p className="mdv-episode-overview text-xs text-gray-300 line-clamp-2 mt-1">{ep.overview}</p>
                                      )}

                                      {epProg && !epProg.is_completed && epPct > 0 && (
                                        <div className="w-full bg-[#232736] h-1.5 rounded-full overflow-hidden my-1.5">
                                          <div className="bg-[#E27D12] h-full rounded-full" style={{ width: `${epPct}%` }} />
                                        </div>
                                      )}

                                      {/* Episode Playback & File Selector Row */}
                                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 mt-1 border-t border-[#232736]">
                                        <div className="flex items-center space-x-2">
                                          {sortedFiles.length > 0 ? (
                                            <>
                                              <button
                                                onClick={() => 
                                                  {
                                                    // handleTriggerPlay(activeEpFile, false, ep.name)
                                                    if (currentMedia.type === 'VideoGame' || playerModeSetting === 'os_default') {
                                                      handlePlayFile(activeEpFile);
                                                    } else {
                                                      const epPos = epProg?.position_seconds || 0;
                                                      setActivePlayerSession({
                                                        file: activeEpFile,
                                                        season: season.season_number,
                                                        episode: ep.episode_number,
                                                        position: epPos,
                                                        title: ep.name || "",
                                                        previewFrame: epPos > 0 ? getCachedVideoFrame(activeEpFile.path, epPos) : null
                                                      });
                                                    }
                                                  }
                                                }
                                                className="bg-[#E27D12] hover:bg-[#E27D12] text-white font-bold text-xs px-3 py-1 rounded-lg flex items-center space-x-1.5 shadow-sm transition-all cursor-pointer"
                                              >
                                                <Play className="w-3.5 h-3.5" fill="currentColor" />
                                                <span>{epProg && !epProg.is_completed && epPct > 0 ? `Resume (${epPct}%)` : 'Play Episode'}</span>
                                              </button>

                                              {sortedFiles.length > 1 ? (
                                                <select
                                                  value={activeEpFile.id}
                                                  onChange={(e) => setSelectedEpFiles({ ...selectedEpFiles, [epKey]: e.target.value })}
                                                  className="bg-[#181a26] text-gray-200 border border-[#2d3145] text-[11px] rounded px-2 py-1 cursor-pointer"
                                                >
                                                  {sortedFiles.map(f => (
                                                    <option key={f.id} value={f.id}>
                                                      {getFileQualityLabel(f)} ({f.filename})
                                                    </option>
                                                  ))}
                                                </select>
                                              ) : (
                                                <span className="text-[11px] text-emerald-400 font-semibold flex items-center space-x-1">
                                                  <FolderCheck className="w-3.5 h-3.5" />
                                                  <span>{getFileQualityLabel(activeEpFile)}</span>
                                                </span>
                                              )}
                                            </>
                                          ) : (
                                            <span className="text-[11px] text-gray-500 flex items-center space-x-1 italic">
                                              <FolderX className="w-3.5 h-3.5" />
                                              <span>No associated local video file</span>
                                            </span>
                                          )}
                                        </div>

                                        {/* Three-dot menu for Episode Options */}
                                        <div className="relative">
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setActiveEpMenu(activeEpMenu === epKey ? null : epKey);
                                            }}
                                            className="text-gray-400 hover:text-white p-1 rounded hover:bg-[#25293a] transition-colors cursor-pointer"
                                            title="Episode options"
                                          >
                                            <MoreVertical className="w-4 h-4" />
                                          </button>

                                          {activeEpMenu === epKey && (
                                            <div
                                              onClick={(e) => e.stopPropagation()}
                                              className="absolute right-0 bottom-full mb-1 w-48 bg-[#181a26] border border-[#2d3145] rounded-xl shadow-xl py-1 z-30 animate-fadeIn text-xs"
                                            >
                                              <button
                                                onClick={() => {
                                                  setActiveEpMenu(null);
                                                  toggleEpisodeWatchStatus(season.season_number, ep.episode_number, epWatched);
                                                }}
                                                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-[#7A4509]/50 hover:text-[#E27D12] flex items-center space-x-2 transition-colors cursor-pointer"
                                              >
                                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                                <span>{epWatched ? 'Mark as Unwatched' : 'Mark as Watched'}</span>
                                              </button>

                                              <button
                                                onClick={() => {
                                                  setActiveEpMenu(null);
                                                  setLinkEpTarget({ season: season.season_number, episode: ep.episode_number });
                                                }}
                                                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-[#7A4509]/50 hover:text-[#E27D12] flex items-center space-x-2 transition-colors cursor-pointer border-t border-[#232736]"
                                              >
                                                <LinkIcon className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                                <span>Link / Reassign File</span>
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="mdv-empty mdv-empty--sm">No individual episode listing downloaded.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Derived State & Session Summary */}
          <section className="mdv-card mdv-card--roomy">
            <h2 className="mdv-card-title">
              <Tag className="mdv-icon-lg mdv-icon-accent" />
              <span>Derived Library Statistics</span>
            </h2>
            <div className="mdv-stats">
              <div className="mdv-tile mdv-stat">
                <span className="mdv-stat-label">Current Status</span>
                <p className="mdv-stat-value mdv-stat-value--accent">{state.current_status}</p>
              </div>
              <div className="mdv-tile mdv-stat">
                <span className="mdv-stat-label">Total Sessions</span>
                <p className="mdv-stat-value">{historyList.length}</p>
              </div>
              <div className="mdv-tile mdv-stat">
                <span className="mdv-stat-label">Rewatch / Replays</span>
                <p className="mdv-stat-value">{state.rewatch_count}</p>
              </div>
              <div className="mdv-tile mdv-stat">
                <span className="mdv-stat-label">Last Watched/Played</span>
                <p className="mdv-stat-value">
                  {state.last_watched_played || 'N/A'}
                </p>
              </div>
            </div>
          </section>

          {/* History Timeline */}
          <section className="mdv-card mdv-card--roomy">
            <div className="mdv-card-header">
              <h2 className="mdv-card-title">
                <History className="mdv-icon-lg mdv-icon-accent" />
                <span>Interaction Journal ({historyList.length})</span>
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openHistoryModal()}
                  className="mdv-btn mdv-btn-accent mdv-btn-log"
                >
                  <Plus className="mdv-icon-sm" />
                  <span>Log Session</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsHistoryCollapsed(collapsed => !collapsed)}
                  aria-expanded={!isHistoryCollapsed}
                  aria-label={isHistoryCollapsed ? 'Expand log history' : 'Collapse log history'}
                  title={isHistoryCollapsed ? 'Expand log history' : 'Collapse log history'}
                  className="mdv-btn mdv-btn-glass"
                  style={{ padding: '0.375rem' }}
                >
                  {isHistoryCollapsed
                    ? <ChevronDown className="mdv-icon-sm" />
                    : <ChevronUp className="mdv-icon-sm" />}
                </button>
              </div>
            </div>

            {!isHistoryCollapsed && (
              <>
                {historyError && <p role="alert" className="text-sm text-red-400">{historyError}</p>}

                {historyList.length === 0 ? (
                  <p className="mdv-empty">No history sessions recorded yet.</p>
                ) : (
                  <div className="mdv-history-list">
                    {historyList.map(h => (
                      <div key={h.id} className="mdv-tile mdv-history-item">
                        <div className="mdv-history-row">
                          <div className="mdv-history-tags">
                            <span className="mdv-chip mdv-chip--status">
                              {h.status}
                            </span>
                            {h.context && (
                              <span className="mdv-chip mdv-chip--context">
                                Context: {h.context}
                              </span>
                            )}
                          </div>

                          <div className="mdv-history-meta">
                            {h.score && (
                              <span className="mdv-score">
                                <Star className="mdv-icon-sm" />
                                <span>{h.score} / 5</span>
                              </span>
                            )}
                            <span>{h.completed_at || h.started_at || h.created_at.split('T')[0]}</span>
                          </div>
                        </div>

                        {h.thoughts && (
                          <p className="mdv-thoughts">
                            "{h.thoughts}"
                          </p>
                        )}

                        <div className="flex items-center justify-between gap-3">
                          <div className="mdv-source">
                            Source: {h.source} {h.original_source_record_id ? `(ID: ${h.original_source_record_id})` : ''}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openHistoryModal(h)}
                              aria-label={`Edit ${h.status} log`}
                              title="Edit log"
                              className="text-gray-400 hover:text-white"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteHistory(h)}
                              aria-label={`Delete ${h.status} log`}
                              title="Delete log"
                              className="text-gray-400 hover:text-red-400"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        {/* Right Column: Local Files & Availability */}
        <div className="mdv-col mdv-col--side">
          {/* Local Storage & Executable Files */}
          <section className="mdv-card">
            <div className="mdv-card-header">
              <h2 className="mdv-card-title mdv-card-title--sm">
                <FolderCheck className="mdv-icon-md mdv-icon-accent" />
                <span>Local System Files</span>
              </h2>

              <button
                onClick={() => setShowFilePickerModal(true)}
                className="mdv-btn mdv-btn-configure"
              >
                <Edit3 className="mdv-icon-xs" />
                <span>Configure Path</span>
              </button>
            </div>

            {localFiles.length === 0 ? (
              <p className="mdv-empty mdv-empty--sm">No local file detected for this media item.</p>
            ) : (
              <details className="mdv-dropdown">
                <summary className="mdv-dropdown-trigger">
                  View Local Files ({localFiles.length})
                </summary>
                <div className="mdv-list">
                  {localFiles.map(lf => (
                    <div key={lf.id} className="mdv-tile mdv-tile--sm mdv-file">
                      <div className="mdv-file-head">
                        <p className="mdv-file-name" title={lf.path}>
                          {lf.filename}
                        </p>
                        {lf.exists ? (
                          <span className="mdv-tag mdv-tag--ok">Available</span>
                        ) : (
                          <span className="mdv-tag mdv-tag--warn">Missing</span>
                        )}
                      </div>

                      <p className="mdv-file-path">{lf.path}</p>

                      {lf.exists && (
                        <button
                          onClick={() => {
                            const season = currentMedia.seasons?.find(s => s.season_number === lf.season);
                            const episode = season?.episodes?.find(e => e.episode_number === lf.episode);
                            const episodeName = episode?.name || lf.parsed_title || lf.filename;
                            
                            // Get saved progress for this file/episode if available
                            const epProg = allProgress.find(p => 
                              // p.id === lf.id &&
                              p.season === Number(lf.season) &&
                              p.episode === Number(lf.episode)
                            );
                            const position = epProg?epProg?.position_seconds > 0 ? epProg.position_seconds : 0 : 0;
                            if (currentMedia.type === 'VideoGame' || playerModeSetting === 'os_default') {
                              handlePlayFile(lf);
                            } else {
                              setActivePlayerSession({
                                file: lf,
                                season: Number(lf.season),
                                episode: Number(lf.episode),
                                position: position,
                                title: episodeName || "",
                                previewFrame: position > 0 ? getCachedVideoFrame(lf.path, position) : null
                              });
                            }
                          }}
                          className="mdv-btn mdv-btn-launch"
                        >
                          <Play className="mdv-icon-sm" fill="currentColor" />
                          <span>Launch File</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                </details>
            )}
          </section>

          {/* Streaming & Provider Availability */}
          <section className="mdv-card">
            <h2 className="mdv-card-title mdv-card-title--sm">
              <Globe className="mdv-icon-md mdv-icon-accent" />
              <span>Streaming & Availability</span>
            </h2>
            {availabilities.length === 0 ? (
              <div className="mdv-tile mdv-tile--sm mdv-availability mdv-availability--empty">
                Streaming availability provider ready. Configure regional options in Settings.
              </div>
            ) : (
              <div className="mdv-list">
                {availabilities.map(av => (
                  <div key={av.id} className="mdv-tile mdv-tile--sm mdv-availability">
                    <div>
                      <p className="mdv-availability-provider">{av.provider}</p>
                      <p className="mdv-availability-type">{av.availability_type} ({av.country || 'Global'})</p>
                    </div>
                    {av.url && (
                      <a
                        href={av.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mdv-link"
                      >
                        Open
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
      {/* Related Media Rail Section */}
      <div
        className="mdv-related mdv-sidebar-aware max-w-7xl mx-auto px-6 pb-12"
        data-sidebar-aware
        style={{ paddingLeft: isDesktopLayout ? undefined : '1rem' }}
      >
        <section className="mdv-card mdv-card--roomy">
          <h2 className="mdv-card-title flex items-center space-x-2">
            <Sparkles className="mdv-icon-lg mdv-icon-accent" />
            <span>Related Media, Prequels & Sequels</span>
          </h2>

          {isLoadingRelated ? (
            <div className="flex items-center space-x-2 py-6 text-gray-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin text-[#E27D12]" />
              <span>Loading related media relationships from provider...</span>
            </div>
          ) : relatedMedia.length === 0 ? (
            <p className="mdv-empty">No direct prequels, sequels, or related series recorded for this media item.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 pt-3">
              {relatedMedia.map((item, idx) => {
                const isAdded = addedExternalIds.has(item.external_id) || addedExternalIds.has(`${item.provider}:${item.external_id}`);

                return (
                  <div
                    key={`${item.external_id}_${idx}`}
                    className="group relative bg-[#1b1d2a] border border-[#2d3145] hover:border-[#E27D12] rounded-xl overflow-hidden shadow-lg transition-all flex flex-col justify-between"
                  >
                    <div
                      onClick={async () => {
                        if (item.external_id) {
                          const existing = await dbService.getMediaByExternalId(item.provider, item.external_id);
                          if (existing) {
                            if (onSelectMedia) {
                              onSelectMedia(existing);
                            } else {
                              updateCurrentMedia(existing);
                            }
                            return;
                          }
                        }

                        const provider = item.type === 'VideoGame' ? igdbProvider : tmdbProvider;
                        setPreviewRelatedItem(item);
                        setIsLoadingPreview(true);
                        try {
                          const details = await provider.getMediaDetails(item.external_id);
                          setPreviewDetails(details);
                        } catch {
                          setPreviewDetails(null);
                        } finally {
                          setIsLoadingPreview(false);
                        }
                      }}
                      className="relative aspect-[2/3] cursor-pointer overflow-hidden bg-[#232736]"
                    >
                      {item.poster ? (
                        <img
                          src={item.poster}
                          alt={item.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center p-2 text-center text-gray-400">
                          {getTypeIcon()}
                          <span className="text-[10px] mt-1 line-clamp-2">{item.title}</span>
                        </div>
                      )}

                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!isAdded) {
                            await handleAddRelatedToLibrary(item);
                          }
                        }}
                        disabled={isAdded}
                        title={isAdded ? 'Already in Library' : 'Add to Library (Planned)'}
                        className={`absolute top-2 right-2 p-1.5 rounded-lg backdrop-blur-md shadow-lg transition-all cursor-pointer z-10 ${
                          isAdded
                            ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/50 cursor-default'
                            : 'bg-[#E27D12]/90 hover:bg-[#E27D12] text-white border border-[#E27D12]/30 hover:scale-110'
                        }`}
                      >
                        {isAdded ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    <div className="p-2.5 space-y-1">
                      <h4 className="font-bold text-xs text-white truncate" title={item.title}>
                        {item.title}
                      </h4>
                      <div className="flex items-center justify-between text-[10px] text-gray-400">
                        <span>{item.release_year || ''}</span>
                        {isAdded && <span className="text-emerald-400 font-semibold">In Library</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Ephemeral Related Media Detail Preview Modal */}
      {previewRelatedItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#14161f] border border-[#2d3145] rounded-2xl w-full max-w-2xl flex flex-col max-h-[85vh] shadow-2xl overflow-hidden animate-fadeIn">
            <div className="p-5 border-b border-[#232736] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-5 h-5 text-[#E27D12]" />
                <h3 className="text-lg font-bold text-white">Related Item Preview</h3>
              </div>
              <button
                onClick={() => {
                  setPreviewRelatedItem(null);
                  setPreviewDetails(null);
                }}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-[#1f222e] transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 flex-1 overflow-y-auto">
              {isLoadingPreview ? (
                <div className="flex items-center space-x-2 py-8 text-gray-400 text-xs justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-[#E27D12]" />
                  <span>Loading full entry details...</span>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row gap-5">
                  {(previewDetails?.poster || previewRelatedItem.poster) && (
                    <img
                      src={previewDetails?.poster || previewRelatedItem.poster}
                      alt={previewRelatedItem.title}
                      className="w-32 aspect-[2/3] object-cover rounded-xl border border-[#2d3145] shrink-0 shadow-lg"
                    />
                  )}

                  <div className="space-y-2 text-xs text-gray-300 flex-1">
                    <h2 className="text-xl font-black text-white">{previewDetails?.title || previewRelatedItem.title}</h2>
                    <div className="flex items-center space-x-3 text-[#E27D12] font-semibold">
                      <span>{previewDetails?.release_year || previewRelatedItem.release_year}</span>
                      <span>•</span>
                      <span>{previewRelatedItem.type}</span>
                      <span>•</span>
                      <span>{previewRelatedItem.provider}</span>
                    </div>

                    {previewDetails?.genres && previewDetails.genres.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {previewDetails.genres.map(g => (
                          <span key={g} className="bg-[#232736] text-gray-300 border border-[#2d3145] text-[10px] px-2 py-0.5 rounded-full">
                            {g}
                          </span>
                        ))}
                      </div>
                    )}

                    <p className="text-gray-300 leading-relaxed pt-2">
                      {previewDetails?.description || previewRelatedItem.description || 'No detailed synopsis recorded.'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-[#232736] flex items-center justify-between bg-[#11131c]">
              <span className="text-xs text-gray-400">
                {addedExternalIds.has(previewRelatedItem.external_id)
                  ? 'This entry is already in your library.'
                  : 'Browsing preview mode without persisting to database.'}
              </span>

              <div className="flex space-x-2">
                <button
                  onClick={() => {
                    setPreviewRelatedItem(null);
                    setPreviewDetails(null);
                  }}
                  className="px-4 py-2 rounded-xl border border-[#2d3145] text-gray-300 hover:bg-[#1a1c29] text-xs font-semibold transition-colors cursor-pointer"
                >
                  Close
                </button>

                {!addedExternalIds.has(previewRelatedItem.external_id) && (
                  <button
                    onClick={async () => {
                      await handleAddRelatedToLibrary(previewRelatedItem);
                      setPreviewRelatedItem(null);
                      setPreviewDetails(null);
                    }}
                    className="px-5 py-2 rounded-xl bg-[#E27D12] hover:bg-[#E27D12] text-white text-xs font-bold transition-all shadow-md cursor-pointer flex items-center space-x-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add to Library (Planned)</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fix Match Modal */}
      {showFixMatchModal && (
        <FixMatchModal
          media={currentMedia}
          isOpen={showFixMatchModal}
          onClose={() => setShowFixMatchModal(false)}
          onMatchedUpdated={(updated) => {
            updateCurrentMedia(updated);
          }}
          onRequestMerge={(mediaA, mediaB) => {
            setMergePair({ mediaA, mediaB });
            setShowMergeModal(true);
          }}
          isCollapsed={isCollapsed}
        />
      )}

      {/* Backdrop Picker Modal */}
      {showBackdropPicker && (
        <BackdropPickerModal
          media={currentMedia}
          isOpen={showBackdropPicker}
          onClose={() => setShowBackdropPicker(false)}
          onBackgroundUpdated={(updated, isApplied) => {
            if (isApplied) {
              setCustomBackdrop(updated.backdrop || null);
            }
            updateCurrentMedia(updated);
          }}
          isCollapsed={isCollapsed}
        />
      )}

      {/* Merge Duplicate Modal */}
      {showMergeModal && mergePair && (
        <MergeDuplicateModal
          mediaA={mergePair.mediaA}
          mediaB={mergePair.mediaB}
          isOpen={showMergeModal}
          onClose={() => {
            setShowMergeModal(false);
            setMergePair(null);
          }}
          onMerged={(surviving) => {
            setShowMergeModal(false);
            setMergePair(null);
            updateCurrentMedia(surviving);
          }}
        />
      )}

      {/* Log History Modal */}
      {showAddHistoryModal && (
        <div className="mdv-modal-backdrop">
          <div className="mdv-modal">
            <h3 className="mdv-modal-title">{editingHistory ? 'Edit Interaction Log' : 'Log Interaction Session'}</h3>
            <form onSubmit={handleAddHistorySubmit} className="mdv-form">
              <div>
                <label className="mdv-label">Status</label>
                <select
                  value={newStatus}
                  onChange={e => setNewStatus(e.target.value as MediaStatus)}
                  className="mdv-input"
                >
                  <option value="Finished">Finished</option>
                  {currentMedia.type === 'TV Series' && <option value="Watched Episode">Watched Episode</option>}
                  <option value="Currently">Currently Active</option>
                  <option value="Abandoned">Abandoned / Paused</option>
                  <option value="Paused">Paused</option>
                  <option value="Planned">Planned</option>
                </select>
              </div>

              <div>
                <label className="mdv-label">Started</label>
                <input
                  type="date"
                  value={newStartedAt}
                  onChange={e => setNewStartedAt(e.target.value)}
                  className="mdv-input"
                />
              </div>

              <div>
                <label className="mdv-label">Completed / Logged</label>
                <input
                  type="date"
                  value={newCompletedAt}
                  onChange={e => setNewCompletedAt(e.target.value)}
                  className="mdv-input"
                />
              </div>

              <div>
                <label className="mdv-label">Score (1 - 5)</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={newScore}
                  onChange={e => setNewScore(e.target.value === '' ? '' : Number(e.target.value))}
                  className="mdv-input"
                />
              </div>

              <div>
                <label className="mdv-label">Context Tag</label>
                <input
                  type="text"
                  placeholder="e.g. 2+ Rewatch, restart, Season 1-2 rewatch"
                  value={newContext}
                  onChange={e => setNewContext(e.target.value)}
                  className="mdv-input"
                />
              </div>

              <div>
                <label className="mdv-label">Thoughts / Review</label>
                <textarea
                  rows={3}
                  placeholder="Your personal review or notes..."
                  value={newThoughts}
                  onChange={e => setNewThoughts(e.target.value)}
                  className="mdv-input"
                />
              </div>

              {historyError && <p role="alert" className="text-sm text-red-400">{historyError}</p>}

              <div className="mdv-modal-actions">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddHistoryModal(false);
                    setEditingHistory(null);
                  }}
                  className="mdv-btn mdv-btn-cancel"
                >
                  Cancel
                </button>
                <button type="submit" className="mdv-btn mdv-btn-accent mdv-btn-save">
                  {editingHistory ? 'Save Changes' : 'Save Log'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Link File to Episode Modal */}
      {linkEpTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#14161f] border border-[#2d3145] rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-2xl animate-fadeIn">
            <div className="flex items-center justify-between border-b border-[#232736] pb-3">
              <h3 className="font-bold text-base text-white flex items-center space-x-2">
                <LinkIcon className="w-5 h-5 text-sky-400" />
                <span>Link Local File to Season {linkEpTarget.season} Episode {linkEpTarget.episode}</span>
              </h3>
              <button
                onClick={() => setLinkEpTarget(null)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-[#1f222e] transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-gray-300">
              Select an existing local file from your library or enter a custom file path to associate with Season {linkEpTarget.season} Episode {linkEpTarget.episode}.
            </p>

            <div className="space-y-3">
              {localFiles.length > 0 && (
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-400">Select Existing Library File</label>
                  <select
                    value={selectedFileToLink}
                    onChange={(e) => setSelectedFileToLink(e.target.value)}
                    className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-xl px-3 py-2 text-xs text-white"
                  >
                    <option value="">-- Choose Local File --</option>
                    {localFiles.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.filename} ({f.path})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-400">Or Enter Custom File Path</label>
                <input
                  type="text"
                  placeholder="C:\Media\TV\Show\S01E03.mkv"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-xl px-3 py-2 text-xs text-white font-mono"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-[#232736]">
              <button
                onClick={() => {
                  setLinkEpTarget(null);
                  setSelectedFileToLink('');
                  setCustomPath('');
                }}
                className="px-4 py-2 rounded-xl border border-[#2d3145] text-gray-300 hover:bg-[#1a1c29] text-xs font-semibold transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                onClick={async () => {
                  if (selectedFileToLink) {
                    await linkFileToEpisode(selectedFileToLink, linkEpTarget.season, linkEpTarget.episode);
                  } else if (customPath.trim()) {
                    const now = new Date().toISOString();
                    const filename = customPath.split(/\\|\//).pop() || customPath;
                    const ext = filename.split('.').pop() || 'mkv';
                    const newFile: LocalFile = {
                      id: `lf_ep_${Date.now()}`,
                      media_id: currentMedia.id,
                      path: customPath.trim(),
                      filename,
                      extension: ext,
                      size: 1500000000,
                      discovered_at: now,
                      last_seen_at: now,
                      exists: true,
                      file_type: 'tv_episode',
                      launch_info: customPath.trim(),
                      season: linkEpTarget.season,
                      episode: linkEpTarget.episode
                    };
                    await dbService.saveLocalFile(newFile);
                    await refreshLocalFiles();
                  }
                  setLinkEpTarget(null);
                  setSelectedFileToLink('');
                  setCustomPath('');
                }}
                disabled={!selectedFileToLink && !customPath.trim()}
                className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
              >
                Save Link
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video Player Modal Overlay */}
      {activePlayerSession && (
        <VideoPlayerModal
          media={currentMedia}
          activeFile={activePlayerSession.file}
          seasonNumber={activePlayerSession.season}
          episodeNumber={activePlayerSession.episode}
          episodeTitle={activePlayerSession.title}
          initialPosition={activePlayerSession.position}
          previewFrame={activePlayerSession.previewFrame}
          previewSourceRect={activePlayerSession.previewSourceRect}
          allLocalFiles={localFiles}
          initialFillToScreen={fillVideoToScreen}
          onClose={() => {
            setActivePlayerSession(null);
            loadSettings();
            void Promise.all([refreshLocalFiles(), refreshHistoryAndState()])
              .catch(error => console.error('Failed to refresh media details after playback:', error));
          }}
          onPlaybackCompleted={refreshHistoryAndState}
          onEpisodeChange={(nextFile, s, ep, title, position) => {
            const seasonNum = s || nextFile.season || 1;
            const epNum = ep || nextFile.episode || 1;
            const matchedSeason = currentMedia.seasons?.find(sm => Number(sm.season_number) === Number(seasonNum));
            const matchedEpisode = matchedSeason?.episodes?.find(em => Number(em.episode_number) === Number(epNum));
            const resolvedEpTitle = title || matchedEpisode?.name || nextFile.parsed_title || nextFile.filename;
            setActivePlayerSession({
              file: nextFile,
              season: seasonNum,
              episode: epNum,
              position: position || 0,
              title: resolvedEpTitle,
              previewFrame: position && position > 0 ? getCachedVideoFrame(nextFile.path, position) : null
            });
            refreshLocalFiles();
          }}
        />
      )}

      {/* File / Executable Selector Modal */}
      {showFilePickerModal && (
        <div className="mdv-modal-backdrop">
          <div className="mdv-modal">
            <h3 className="mdv-modal-title">Configure Executable or Video File</h3>
            <form onSubmit={handleCustomPathSubmit} className="mdv-form">
              <div>
                <label className="mdv-label">
                  Local File Path / Shortcut (.exe, .lnk, .mkv)
                </label>
                <input
                  type="text"
                  required
                  placeholder={currentMedia.type === 'VideoGame' ? 'D:\\Games\\Game.lnk or .exe' : 'D:\\Movies\\Film.mkv'}
                  value={customPath}
                  onChange={e => setCustomPath(e.target.value)}
                  className="mdv-input mdv-input--mono"
                />
              </div>

              <div className="mdv-modal-actions">
                <button
                  type="button"
                  onClick={() => setShowFilePickerModal(false)}
                  className="mdv-btn mdv-btn-cancel"
                >
                  Cancel
                </button>
                <button type="submit" className="mdv-btn mdv-btn-accent mdv-btn-save">
                  Save File Path
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
