import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LocalFile, Media } from '../types/media';
import { useMediaDetail } from '../hooks/useMediaDetail';
import { useDominantColor } from '../helper/useDominantColour';
import { getMediaTheme } from '../helper/mediaDetailTheme';
import { getHighQualityBackdropUrl, getLastWatchedEpisodeArtwork, isEpisodeWatched } from '../helper/episodeProgress';
import { dbService } from '../services/DatabaseService';
import './MediaDetailView.css';
import { MetadataSearchResult } from '../providers/interfaces';
import { FixMatchModal } from '../components/FixMatchModal';
import { BackdropPickerModal } from '../components/BackdropPickerModal';
import { MergeDuplicateModal } from '../components/MergeDuplicateModal';
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
  Info,
  Wallpaper
} from 'lucide-react';

interface MediaDetailViewProps {
  media: Media;
  onBack: () => void;
  isSidebarCollapsed: boolean;
  onSelectMedia?: (media: Media) => void;
  onAccentColorChange?: (color: string) => void;
  accentColorOverride?: string;
  cardTransition?: {
    mediaId: string;
    centerX: number;
    centerY: number;
    detailCenterX: number;
    detailCenterY: number;
    radius: number;
    phase: 'preview' | 'reverse' | 'commit' | 'reveal';
    entered: boolean;
    color: string;
  };
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

export const MediaDetailView: React.FC<MediaDetailViewProps> = ({ media: initialMedia, onBack, isSidebarCollapsed, onSelectMedia, onAccentColorChange, cardTransition, accentColorOverride }) => {
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
    addCustomFilePath,
    relatedMedia,
    isLoadingRelated,
    addedExternalIds,
    handleAddRelatedToLibrary,
    updateCurrentMedia,
    toggleEpisodeWatchStatus,
    linkFileToEpisode,
    refreshLocalFiles
  } = useMediaDetail(initialMedia);

  // Three dot menu state
  const [showMenu, setShowMenu] = useState(false);
  const [showFixMatchModal, setShowFixMatchModal] = useState(false);
  const [isDeletingMedia, setIsDeletingMedia] = useState(false);

  // Duplicates & Merge modal state
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergePair, setMergePair] = useState<{ mediaA: Media; mediaB: Media } | null>(null);
  const [showBackdropPicker, setShowBackdropPicker] = useState(false);

  // Ephemeral preview modal for related items
  const [previewRelatedItem, setPreviewRelatedItem] = useState<MetadataSearchResult | null>(null);
  const [previewDetails, setPreviewDetails] = useState<Partial<Media> | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const metadataRefreshStartedFor = useRef<string | null>(null);

  const [failedBackdropSources, setFailedBackdropSources] = useState<string[]>([]);
  const [calculatedAccent, setCalculatedAccent] = useState<{ src: string; color: string } | null>(null);
  const [isPlayButtonStuck, setIsPlayButtonStuck] = useState(false);
  const playButtonRowRef = useRef<HTMLDivElement>(null);

  const lastWatchedEpisodeArtwork = getLastWatchedEpisodeArtwork(currentMedia, historyList);

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

  // Episode UI State
  const [selectedEpFiles, setSelectedEpFiles] = useState<Record<string, string>>({});
  const [activeEpMenu, setActiveEpMenu] = useState<string | null>(null);
  const [linkEpTarget, setLinkEpTarget] = useState<{ season: number; episode: number } | null>(null);
  const [selectedFileToLink, setSelectedFileToLink] = useState<string>('');

  const artworkCandidates = [
    getHighQualityBackdropUrl(lastWatchedEpisodeArtwork.still),
    getHighQualityBackdropUrl(lastWatchedEpisodeArtwork.seasonPoster),
    artwork.backdrop,
    artwork.poster
  ].filter((source): source is string => Boolean(source));
  const artworkSource = artworkCandidates.find(source => !failedBackdropSources.includes(source));

  useEffect(() => {
    const needsMetadataRefresh = artwork.backdrop === 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1280&q=80'
      || (
        currentMedia.metadata_source === 'Notion Import'
        && !currentMedia.poster
        && !currentMedia.backdrop
      );
    if (!needsMetadataRefresh || isRefreshingMetadata || metadataRefreshStartedFor.current === currentMedia.id) return;

    metadataRefreshStartedFor.current = currentMedia.id;
    void handleManualMetadataRefresh();
  }, [
    artwork.backdrop,
    currentMedia.backdrop,
    currentMedia.id,
    currentMedia.metadata_source,
    currentMedia.poster,
    handleManualMetadataRefresh,
    isRefreshingMetadata
  ]);

  useEffect(() => {
    setFailedBackdropSources([]);
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
  const isTransitioningBackground = Boolean(cardTransition && cardTransition.phase !== 'reveal');

  // Season accordion state
  const [expandedSeason, setExpandedSeason] = useState<number | null>(1);

  // Local launcher & modals state
  const [showAddHistoryModal, setShowAddHistoryModal] = useState(false);
  const [newStatus, setNewStatus] = useState<any>('Finished');
  const [newScore, setNewScore] = useState<number>(4);
  const [newContext, setNewContext] = useState<string>('Rewatch');
  const [newThoughts, setNewThoughts] = useState<string>('');

  const [showFilePickerModal, setShowFilePickerModal] = useState(false);
  const [customPath, setCustomPath] = useState('');

  const activeLocalFile = localFiles.find(lf => lf.exists) || localFiles[0];
  const isAvailableLocally = localFiles.some(lf => lf.exists);
  const isLocalMissing = localFiles.length > 0 && !isAvailableLocally;

  useEffect(() => {
    const playButtonRow = playButtonRowRef.current;
    if (!playButtonRow) return;

    let scrollContainer: HTMLElement | null = playButtonRow.parentElement;
    while (scrollContainer && scrollContainer !== document.body) {
      const overflowY = window.getComputedStyle(scrollContainer).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      scrollContainer = scrollContainer.parentElement;
    }
    if (!scrollContainer || scrollContainer === document.body) return;

    const updateStickyState = () => {
      const isStuck = playButtonRow.getBoundingClientRect().top <= 24;
      setIsPlayButtonStuck(previousState => previousState === isStuck ? previousState : isStuck);
    };

    scrollContainer.addEventListener('scroll', updateStickyState, { passive: true });
    window.addEventListener('resize', updateStickyState);
    updateStickyState();

    return () => {
      scrollContainer.removeEventListener('scroll', updateStickyState);
      window.removeEventListener('resize', updateStickyState);
    };
  }, [activeLocalFile, isAvailableLocally]);

  const handleAddHistorySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    logSessionHistory({
      status: newStatus,
      score: newScore,
      context: newContext,
      thoughts: newThoughts
    });
    setShowAddHistoryModal(false);
    setNewThoughts('');
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
      className="mdv-page"
      data-tone={theme.tone}
      style={{
        ...theme.cssVars,
        backgroundColor: detailAccentColor || currentMedia.accent_color || '#423e3f',
        clipPath: cardTransition && isTransitioningBackground
          ? `circle(${cardTransition.phase !== 'reverse' && cardTransition.entered ? cardTransition.radius : 0}px at ${cardTransition.detailCenterX}px ${cardTransition.detailCenterY}px)`
          : undefined,
        transition: cardTransition?.phase === 'commit'
          ? 'clip-path 710ms cubic-bezier(0.2, 0.8, 0.2, 1)'
          : cardTransition?.phase === 'preview'
            ? 'clip-path 115ms cubic-bezier(0.42, 0, 0.58, 1)'
            : undefined,
      }}
    >
      {/* Pinned Backdrop */}
      <div className="mdv-backdrop">
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
        {artworkSource && (
          <DominantColorExtractor
            key={artworkSource}
            imageSrc={artworkSource}
            onColorCalculated={handleDominantColorCalculated}
          />
        )}

        <div className="mdv-backdrop-overlay" />
      </div>

      {/* Pinned Header Bar Actions */}
      <div className={`mdv-header ${isPlayButtonStuck ? 'mdv-header--stuck' : ''}`}>
        <div className="mdv-header-actions" style={{ left: isSidebarCollapsed ? '6.5rem' : '17.5rem' }}>
          <button onClick={onBack} className="mdv-btn mdv-btn-glass cursor-pointer">
            <ArrowLeft className="mdv-icon-md" />
            <span>Back to Library</span>
          </button>

          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="mdv-btn mdv-btn-glass cursor-pointer"
              title="Media Options"
            >
              <MoreVertical className="mdv-icon-md" />
            </button>

            {showMenu && (
              <div className="absolute right-0 mt-2 w-56 bg-[#1b1d2a] border border-[#2d3145] rounded-xl shadow-2xl py-1 z-50 animate-fadeIn">
                <button
                  onClick={() => {
                    setShowMenu(false);
                    handleManualMetadataRefresh();
                  }}
                  disabled={isRefreshingMetadata}
                  className="w-full text-left px-4 py-2.5 text-xs text-gray-200 hover:bg-rose-950/50 hover:text-rose-300 flex items-center space-x-2 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{isRefreshingMetadata ? 'Re-syncing Provider...' : 'Refresh Metadata'}</span>
                </button>

                <button
                  onClick={() => {
                    setShowMenu(false);
                    setShowFixMatchModal(true);
                  }}
                  className="w-full text-left px-4 py-2.5 text-xs text-gray-200 hover:bg-rose-950/50 hover:text-rose-300 flex items-center space-x-2 transition-colors cursor-pointer border-t border-[#232736]"
                >
                  <LinkIcon className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>Fix Match / Change Metadata</span>
                </button>
                <button
                  onClick={() => {
                    setShowMenu(false);
                    setShowBackdropPicker(true);
                  }}
                  className="w-full text-left px-4 py-2.5 text-xs text-gray-200 hover:bg-rose-950/50 hover:text-rose-300 flex items-center space-x-2 transition-colors cursor-pointer border-t border-[#232736]"
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
                  className="w-full text-left px-4 py-2.5 text-xs text-rose-300 hover:bg-rose-950/50 flex items-center space-x-2 transition-colors cursor-pointer border-t border-[#232736] disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4 shrink-0" />
                  <span>{isDeletingMedia ? 'Deleting...' : 'Delete from Library'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable Hero Content */}
      <div className="mdv-hero">
        <div className="mdv-hero-inner">
          <div className="mdv-title-block">
            <div className="mdv-badges">
              <span className="mdv-type-badge">
                {getTypeIcon()}
                <span>{currentMedia.type}</span>
              </span>

              {isAvailableLocally ? (
                <span className="mdv-status-badge mdv-status-badge--ok">
                  <FolderCheck className="mdv-icon-md" />
                  <span>🖥 Available Locally</span>
                </span>
              ) : isLocalMissing ? (
                <span className="mdv-status-badge mdv-status-badge--warn">
                  <FolderX className="mdv-icon-md" />
                  <span>⚠ Local file missing</span>
                </span>
              ) : null}

              {currentMedia.release_year && (
                <span className="mdv-pill">
                  <Calendar className="mdv-icon-sm mdv-icon-accent-on-dark" />
                  <span>{currentMedia.release_year}</span>
                </span>
              )}

              {currentMedia.runtime && (
                <span className="mdv-pill">
                  <Clock className="mdv-icon-sm mdv-icon-accent-on-dark" />
                  <span>{currentMedia.runtime} mins</span>
                </span>
              )}

              {currentMedia.publisher && (
                <span className="mdv-pill">
                  <Building className="mdv-icon-sm mdv-icon-amber" />
                  <span>{currentMedia.publisher}</span>
                </span>
              )}

              {currentMedia.developer && (
                <span className="mdv-pill">
                  <Code className="mdv-icon-sm mdv-icon-purple" />
                  <span>{currentMedia.developer}</span>
                </span>
              )}
            </div>

            {logoUrl ? (
              <div className="py-1">
                <img
                  src={logoUrl}
                  alt={currentMedia.title}
                  className="h-16 md:h-24 max-w-xs md:max-w-md object-contain drop-shadow-[0_10px_10px_rgba(0,0,0,0.8)]"
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
              className={`text-4xl md:text-5xl font-black text-white tracking-tight drop-shadow-lg flex items-center space-x-3 ${logoUrl ? 'hidden' : ''}`}
            >
              <span>{currentMedia.title}</span>
            </h1>

            {currentMedia.genres && currentMedia.genres.length > 0 && (
              <div className="mdv-genres">
                {currentMedia.genres.map(g => (
                  <span key={g} className="mdv-genre">
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
        <div ref={playButtonRowRef} className="mdv-play-row">
          <button
            onClick={() => handlePlayFile(activeLocalFile)}
            className="mdv-btn mdv-btn-play"
          >
            <Play className="mdv-icon-lg" fill="currentColor" />
            <span>PLAY {currentMedia.type === 'VideoGame' ? 'GAME' : 'MEDIA'}</span>
          </button>
        </div>
      )}

      {/* Main Content Layout */}
      <div className="mdv-main">
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
          {historyList.length > 1 && (
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
                <span className="bg-rose-900/80 text-rose-200 border border-rose-400/30 px-2.5 py-1 rounded-lg font-semibold">
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
          )}

          {/* Cast Rail */}
          {currentMedia.cast && currentMedia.cast.length > 0 && (
            <section className="mdv-card mdv-card--roomy">
              <h2 className="mdv-card-title">
                <User className="mdv-icon-lg mdv-icon-accent" />
                <span>Top Cast Members</span>
              </h2>

              <div className="mdv-cast-rail">
                {currentMedia.cast.map(member => (
                  <div key={member.id} className="mdv-cast-member">
                    <div className="mdv-cast-avatar">
                      {member.profile_path ? (
                        <img src={member.profile_path} alt={member.name} />
                      ) : (
                        <div className="mdv-cast-avatar-empty">
                          <User className="mdv-icon-xl" />
                        </div>
                      )}
                    </div>
                    <p className="mdv-cast-name" title={member.name}>{member.name}</p>
                    {member.character && (
                      <p className="mdv-cast-role" title={member.character}>{member.character}</p>
                    )}
                  </div>
                ))}
              </div>
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

                                      {/* Episode Playback & File Selector Row */}
                                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 mt-1 border-t border-[#232736]">
                                        <div className="flex items-center space-x-2">
                                          {sortedFiles.length > 0 ? (
                                            <>
                                              <button
                                                onClick={() => handlePlayFile(activeEpFile)}
                                                className="bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs px-3 py-1 rounded-lg flex items-center space-x-1.5 shadow-sm transition-all cursor-pointer"
                                              >
                                                <Play className="w-3.5 h-3.5" fill="currentColor" />
                                                <span>Play Episode</span>
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
                                                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-rose-950/50 hover:text-rose-300 flex items-center space-x-2 transition-colors cursor-pointer"
                                              >
                                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                                <span>{epWatched ? 'Mark as Unwatched' : 'Mark as Watched'}</span>
                                              </button>

                                              <button
                                                onClick={() => {
                                                  setActiveEpMenu(null);
                                                  setLinkEpTarget({ season: season.season_number, episode: ep.episode_number });
                                                }}
                                                className="w-full text-left px-3 py-2 text-gray-200 hover:bg-rose-950/50 hover:text-rose-300 flex items-center space-x-2 transition-colors cursor-pointer border-t border-[#232736]"
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
              <button
                onClick={() => setShowAddHistoryModal(true)}
                className="mdv-btn mdv-btn-accent mdv-btn-log"
              >
                <Plus className="mdv-icon-sm" />
                <span>Log Session</span>
              </button>
            </div>

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

                    <div className="mdv-source">
                      Source: {h.source} {h.original_source_record_id ? `(ID: ${h.original_source_record_id})` : ''}
                    </div>
                  </div>
                ))}
              </div>
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
                        onClick={() => handlePlayFile(lf)}
                        className="mdv-btn mdv-btn-launch"
                      >
                        <Play className="mdv-icon-sm" fill="currentColor" />
                        <span>Launch File</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
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
      <div className="mdv-related max-w-7xl mx-auto px-6 pb-12">
        <section className="mdv-card mdv-card--roomy">
          <h2 className="mdv-card-title flex items-center space-x-2">
            <Sparkles className="mdv-icon-lg mdv-icon-accent" />
            <span>Related Media, Prequels & Sequels</span>
          </h2>

          {isLoadingRelated ? (
            <div className="flex items-center space-x-2 py-6 text-gray-400 text-xs">
              <Loader2 className="w-4 h-4 animate-spin text-rose-400" />
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
                    className="group relative bg-[#1b1d2a] border border-[#2d3145] hover:border-rose-500 rounded-xl overflow-hidden shadow-lg transition-all flex flex-col justify-between"
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
                            : 'bg-rose-600/90 hover:bg-rose-500 text-white border border-rose-400/30 hover:scale-110'
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
                <Sparkles className="w-5 h-5 text-rose-400" />
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
                  <Loader2 className="w-5 h-5 animate-spin text-rose-400" />
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
                    <div className="flex items-center space-x-3 text-rose-300 font-semibold">
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
                    className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer flex items-center space-x-1.5"
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
        />
      )}

      {/* Backdrop Picker Modal */}
      {showBackdropPicker && (
        <BackdropPickerModal
          media={currentMedia}
          isOpen={showBackdropPicker}
          onClose={() => setShowBackdropPicker(false)}
          onBackgroundUpdated={(updated) => {
            updateCurrentMedia(updated);
          }}
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
            <h3 className="mdv-modal-title">Log Interaction Session</h3>
            <form onSubmit={handleAddHistorySubmit} className="mdv-form">
              <div>
                <label className="mdv-label">Status</label>
                <select
                  value={newStatus}
                  onChange={e => setNewStatus(e.target.value)}
                  className="mdv-input"
                >
                  <option value="Finished">Finished</option>
                  <option value="Currently">Currently Active</option>
                  <option value="Abandoned">Abandoned / Paused</option>
                </select>
              </div>

              <div>
                <label className="mdv-label">Score (1 - 5)</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={newScore}
                  onChange={e => setNewScore(Number(e.target.value))}
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

              <div className="mdv-modal-actions">
                <button
                  type="button"
                  onClick={() => setShowAddHistoryModal(false)}
                  className="mdv-btn mdv-btn-cancel"
                >
                  Cancel
                </button>
                <button type="submit" className="mdv-btn mdv-btn-accent mdv-btn-save">
                  Save Log
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
