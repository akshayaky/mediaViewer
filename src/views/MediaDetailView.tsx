import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Media } from '../types/media';
import { useMediaDetail } from '../hooks/useMediaDetail';
import { useDominantColor } from '../helper/useDominantColour'
import { dbService } from '../services/DatabaseService';
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
  Code
} from 'lucide-react';

interface MediaDetailViewProps {
  media: Media;
  onBack: () => void;
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
  const hasReportedColor = useRef(false);

  useEffect(() => {
    if (!dominantColor || hasReportedColor.current) return;

    hasReportedColor.current = true;
    onColorCalculated(`rgb(${dominantColor.join(',')})`);
  }, [dominantColor, onColorCalculated]);

  return null;
};

export const MediaDetailView: React.FC<MediaDetailViewProps> = ({ media: initialMedia, onBack }) => {
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
    addCustomFilePath
  } = useMediaDetail(initialMedia);
  const [loadedArtworkSrc, setLoadedArtworkSrc] = useState<string>();
  const [failedBackdropSrc, setFailedBackdropSrc] = useState<string>();
  const [calculatedAccent, setCalculatedAccent] = useState<{ mediaId: string; color: string }>();
  const [isPlayButtonStuck, setIsPlayButtonStuck] = useState(false);
  const playButtonRowRef = useRef<HTMLDivElement>(null);
  const artworkSource = artwork.backdrop && failedBackdropSrc !== artwork.backdrop
    ? artwork.backdrop
    : artwork.poster;
  const accentColorForPage = initialMedia.accent_color
    || (calculatedAccent?.mediaId === initialMedia.id ? calculatedAccent.color : undefined);

  const handleDominantColorCalculated = useCallback((color: string) => {
    setCalculatedAccent({ mediaId: initialMedia.id, color });

    if (initialMedia.accent_color) return;

    try {
      dbService.saveMedia({
        ...initialMedia,
        accent_color: color,
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to save calculated accent color:', error);
    }
  }, [initialMedia]);

  const accentColor = accentColorForPage || '#e5dfe1';
  const accentColorRgb = accentColorForPage
    ? accentColorForPage.startsWith('#')
      ? `${parseInt(accentColorForPage.slice(1, 3), 16)}, ${parseInt(accentColorForPage.slice(3, 5), 16)}, ${parseInt(accentColorForPage.slice(5, 7), 16)}`
      : accentColorForPage.startsWith('rgb')
        ? accentColorForPage.match(/\d+/g)?.join(', ') || '225, 29, 72'
        : '225, 29, 72'
    : '225, 29, 72';
  const accentBgLight = `rgba(${accentColorRgb}, 0.15)`;
  const accentBorderLight = `rgba(${accentColorRgb}, 0.3)`;

  const highContrastFilter = {
    filter: "brightness(2) saturate(2)"
  };

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
        return <Film className="w-4 h-4" style={{ color: accentColor, ...highContrastFilter}} />;
      case 'TV Series':
        return <Tv className="w-4 h-4 text-sky-400" />;
      case 'VideoGame':
        return <Gamepad2 className="w-4 h-4 text-purple-400" />;
    }
  };

  return (
    <div
      className="relative min-h-screen text-gray-100 pb-12 transition-colors duration-500"
      style={{
        backgroundColor: accentColor,
        '--accent-color': accentColor,
        '--accent-rgb': accentColorRgb,
      } as React.CSSProperties}
    >
      {/* Pinned Backdrop */}
      <div
        className="sticky top-0 z-0 -mb-[700px] h-[700px] w-full overflow-hidden pointer-events-none"
        style={{ backgroundColor: accentColor }}
      >
        {artwork.backdrop && failedBackdropSrc !== artwork.backdrop ? (
          <img
            src={artwork.backdrop}
            alt={currentMedia.title}
            className="w-full h-full object-cover opacity-45"
            onLoad={() => setLoadedArtworkSrc(artwork.backdrop)}
            onError={() => {
              setFailedBackdropSrc(artwork.backdrop);
              setLoadedArtworkSrc(loadedSrc =>
                loadedSrc === artwork.backdrop ? undefined : loadedSrc
              );
            }}
          />
        ) : (
          <div
            className="w-full h-full"
            style={{
              background: `linear-gradient(to bottom right, ${accentColor}, rgba(0, 0, 0, 0.3))`
            }}
          />
        )}
        {(!artwork.backdrop || failedBackdropSrc === artwork.backdrop) && artwork.poster && (
          <img
            src={artwork.poster}
            alt=""
            aria-hidden="true"
            className="hidden"
            onLoad={() => setLoadedArtworkSrc(artwork.poster)}
            onError={() => setLoadedArtworkSrc(loadedSrc =>
              loadedSrc === artwork.poster ? undefined : loadedSrc
            )}
          />
        )}
        {!accentColorForPage && artworkSource && loadedArtworkSrc === artworkSource && (
          <DominantColorExtractor
            key={`${initialMedia.id}:${artworkSource}`}
            imageSrc={artworkSource}
            onColorCalculated={handleDominantColorCalculated}
          />
        )}

        {/* Backdrop Gradient Overlays */}
        <div
          className="absolute inset-0 z-10"
          style={{
            background: `linear-gradient(to top, ${accentColor} 0%, ${accentColor} 10%, rgba(${accentColorRgb}, 0.8) 30%, rgba(0, 0, 0, 0.4) 100%)`
          }}
        />
      </div>

      {/* Pinned Header Bar Actions */}
      <div className={`sticky top-0 z-30 -mb-16 h-16 pointer-events-none transition-all duration-500 ease-in-out ${isPlayButtonStuck ? 'bg-black/25 backdrop-blur-md' : 'bg-transparent backdrop-blur-none'}`}>
        <div className="absolute top-6 left-6 right-6 flex items-center justify-between pointer-events-auto">
          <button
            onClick={onBack}
            className="flex items-center space-x-2 bg-black/60 hover:bg-black/80 text-white font-medium text-xs px-3.5 py-2 rounded-xl backdrop-blur-md border border-white/10 transition-all shadow-lg cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Library</span>
          </button>

          <button
            onClick={handleManualMetadataRefresh}
            disabled={isRefreshingMetadata}
            style={{ backgroundColor: accentColor }}
            className="flex items-center space-x-2 hover:opacity-90 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-lg transition-all cursor-pointer"
          >
            {isRefreshingMetadata ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Re-syncing Provider...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                <span>Refresh Metadata</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Scrollable Hero Content */}
      <div className="relative z-10 h-[700px]">
        {/* Floating Poster & Title Overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-8 max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-end gap-6 z-10">
          {/* Poster */}
          <div
            className="w-48 aspect-[2/3] rounded-2xl overflow-hidden border-2 shadow-2xl bg-[#1b1e2b] shrink-0"
            style={{
              borderColor: accentBorderLight,
              boxShadow: `0 20px 40px -15px rgba(${accentColorRgb}, 0.3)`
            }}
          >
            {artwork.poster ? (
              <img src={artwork.poster} alt={currentMedia.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center">
                {getTypeIcon()}
                <span className="text-xs text-gray-400 mt-2">{currentMedia.title}</span>
              </div>
            )}
          </div>

          {/* Title & Core Badges */}
          <div className="space-y-3 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                style={{ backgroundColor: accentColor }}
                className="text-white text-xs font-bold px-3 py-1 rounded-full flex items-center space-x-1.5 uppercase tracking-wider shadow-sm"
              >
                {getTypeIcon()}
                <span>{currentMedia.type}</span>
              </span>

              {/* Local Availability Badge */}
              {isAvailableLocally ? (
                <span className="bg-emerald-950/90 text-emerald-400 border border-emerald-500/40 text-xs font-bold px-3 py-1 rounded-full flex items-center space-x-1.5 shadow-md">
                  <FolderCheck className="w-4 h-4" />
                  <span>🖥 Available Locally</span>
                </span>
              ) : isLocalMissing ? (
                <span className="bg-amber-950/90 text-amber-400 border border-amber-500/40 text-xs font-bold px-3 py-1 rounded-full flex items-center space-x-1.5 shadow-md">
                  <FolderX className="w-4 h-4" />
                  <span>⚠ Local file missing</span>
                </span>
              ) : null}

              {currentMedia.release_year && (
                <span className="bg-[#1b1e2b] text-gray-300 border border-[#2d3248] text-xs font-semibold px-2.5 py-1 rounded-full flex items-center space-x-1">
                  <Calendar className="w-3.5 h-3.5" style={{ color: accentColor, ...highContrastFilter}} />
                  <span>{currentMedia.release_year}</span>
                </span>
              )}

              {currentMedia.runtime && (
                <span className="bg-[#1b1e2b] text-gray-300 border border-[#2d3248] text-xs font-semibold px-2.5 py-1 rounded-full flex items-center space-x-1">
                  <Clock className="w-3.5 h-3.5" style={{ color: accentColor, ...highContrastFilter}} />
                  <span>{currentMedia.runtime} mins</span>
                </span>
              )}

              {currentMedia.publisher && (
                <span className="bg-[#1b1e2b] text-gray-300 border border-[#2d3248] text-xs font-semibold px-2.5 py-1 rounded-full flex items-center space-x-1">
                  <Building className="w-3.5 h-3.5 text-amber-400" />
                  <span>{currentMedia.publisher}</span>
                </span>
              )}

              {currentMedia.developer && (
                <span className="bg-[#1b1e2b] text-gray-300 border border-[#2d3248] text-xs font-semibold px-2.5 py-1 rounded-full flex items-center space-x-1">
                  <Code className="w-3.5 h-3.5 text-purple-400" />
                  <span>{currentMedia.developer}</span>
                </span>
              )}
            </div>

            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight drop-shadow-lg flex items-center space-x-3">
              <span>{currentMedia.title}</span>
            </h1>

            {/* Genres list */}
            {currentMedia.genres && currentMedia.genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {currentMedia.genres.map(g => (
                  <span
                    key={g}
                    className="bg-[#1c1f2e] text-gray-300 border border-[#2e334a] text-[11px] font-semibold px-2.5 py-0.5 rounded-md"
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}

            {/* Feedback messages */}
            <div className="flex items-center space-x-3 pt-2">
              {launchMessage && (
                <span className="text-xs font-semibold text-emerald-400 bg-emerald-950/80 border border-emerald-500/30 px-3 py-2 rounded-lg animate-fadeIn">
                  {launchMessage}
                </span>
              )}

              {refreshMessage && (
                <span className="text-xs font-semibold text-emerald-400 bg-emerald-950/80 border border-emerald-500/30 px-3 py-2 rounded-lg flex items-center space-x-1 animate-fadeIn">
                  <CheckCircle2 className="w-4 h-4" />
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
          className="sticky top-6 z-30 mx-auto -mt-14 flex h-14 max-w-7xl items-center pr-8 pl-44 pointer-events-none"
        >
          <button
            onClick={() => handlePlayFile(activeLocalFile)}
            className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm px-6 py-3 rounded-xl shadow-xl shadow-emerald-950/40 transition-all transform hover:-translate-y-0.5 cursor-pointer pointer-events-auto"
          >
            <Play className="w-5 h-5 fill-current" />
            <span>PLAY {currentMedia.type === 'VideoGame' ? 'GAME' : 'MEDIA'}</span>
          </button>
        </div>
      )}

      {/* Main Content Layout */}
      <div className="relative z-10 p-8 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Overview, Seasons, Cast, Journal */}
        <div className="lg:col-span-2 space-y-8">
          {/* Overview */}
          <section className="bg-[#14161f]/95 backdrop-blur-md p-6 rounded-2xl border border-white/10 shadow-2xl space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <FileText className="w-5 h-5" style={{ color: accentColor, ...highContrastFilter}} />
              <span>Overview & Synopsis</span>
            </h2>
            <p className="text-sm text-gray-300 leading-relaxed">
              {currentMedia.description || 'No detailed synopsis recorded yet for this entry.'}
            </p>
            {currentMedia.metadata_refreshed_at && (
              <p className="text-[11px] text-gray-500 pt-2 border-t border-[#1f222e]">
                Metadata Last Refreshed: {new Date(currentMedia.metadata_refreshed_at).toLocaleString()} ({currentMedia.metadata_source || 'TMDB/IGDB'})
              </p>
            )}
          </section>

          {/* Cast Rail */}
          {currentMedia.cast && currentMedia.cast.length > 0 && (
            <section className="bg-[#14161f]/95 backdrop-blur-md p-6 rounded-2xl border border-white/10 shadow-2xl space-y-4">
              <h2 className="text-lg font-bold text-white flex items-center space-x-2">
                <User className="w-5 h-5" style={{ color: accentColor, ...highContrastFilter}} />
                <span>Top Cast Members</span>
              </h2>

              <div className="flex space-x-4 overflow-x-auto pb-2 scrollbar-none">
                {currentMedia.cast.map(member => (
                  <div key={member.id} className="w-28 shrink-0 space-y-1.5 text-center group">
                    <div className="w-24 h-24 mx-auto rounded-full overflow-hidden bg-[#1d202e] border-2 border-[#2e3347] group-hover:border-[var(--accent-color)] transition-all">
                      {member.profile_path ? (
                        <img src={member.profile_path} alt={member.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-500">
                          <User className="w-8 h-8" />
                        </div>
                      )}
                    </div>
                    <p className="text-xs font-bold text-white truncate" title={member.name}>{member.name}</p>
                    {member.character && (
                      <p className="text-[10px] text-gray-400 truncate" title={member.character}>{member.character}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* TV Series Seasons & Episodes Accordion */}
          {currentMedia.type === 'TV Series' && currentMedia.seasons && currentMedia.seasons.length > 0 && (
            <section className="bg-[#14161f]/95 backdrop-blur-md p-6 rounded-2xl border border-white/10 shadow-2xl space-y-4">
              <h2 className="text-lg font-bold text-white flex items-center space-x-2">
                <Layers className="w-5 h-5" style={{ color: accentColor, ...highContrastFilter }} />
                <span>Seasons & Episode Guide ({currentMedia.seasons.length} Seasons)</span>
              </h2>

              <div className="space-y-3">
                {currentMedia.seasons.map(season => {
                  const isExpanded = expandedSeason === season.season_number;
                  return (
                    <div key={season.season_number} className="bg-[#1a1d29] rounded-xl border border-[#2d3145] overflow-hidden">
                      <button
                        onClick={() => setExpandedSeason(isExpanded ? null : season.season_number)}
                        className="w-full p-4 flex items-center justify-between text-left hover:bg-[#202434] transition-colors cursor-pointer"
                      >
                        <div className="flex items-center space-x-3">
                          {season.poster_path && (
                            <img src={season.poster_path} alt={season.name} className="w-10 h-14 object-cover rounded border border-[#30354b]" />
                          )}
                          <div>
                            <h3 className="font-bold text-sm text-white">{season.name}</h3>
                            <p className="text-xs text-gray-400">
                              {season.episode_count || (season.episodes ? season.episodes.length : 0)} Episodes
                            </p>
                          </div>
                        </div>

                        {isExpanded ? <ChevronUp className="w-5 h-5" style={{ color: accentColor, ...highContrastFilter}} /> : <ChevronDown className="w-5 h-5 text-gray-400" style={{ color: accentColor, ...highContrastFilter}}/>}
                      </button>

                      {isExpanded && (
                        <div className="p-4 border-t border-[#2a2e42] bg-[#13151f] space-y-3">
                          {season.overview && (
                            <p className="text-xs text-gray-300 italic mb-2">{season.overview}</p>
                          )}

                          {season.episodes && season.episodes.length > 0 ? (
                            <div className="space-y-2">
                              {season.episodes.map(ep => (
                                <div key={ep.episode_number} className="bg-[#1a1d2b] p-3 rounded-lg border border-[#282c3f] flex space-x-3">
                                  {ep.still_path && (
                                    <img src={ep.still_path} alt={ep.name} className="w-20 aspect-video object-cover rounded border border-[#31364d]" />
                                  )}
                                  <div className="min-w-0 flex-1 space-y-0.5">
                                    <div className="flex items-center justify-between">
                                      <h4 className="font-bold text-xs text-white">
                                        E{ep.episode_number}. {ep.name}
                                      </h4>
                                      {ep.air_date && <span className="text-[10px] text-gray-400">{ep.air_date}</span>}
                                    </div>
                                    {ep.overview && (
                                      <p className="text-[11px] text-gray-400 line-clamp-2">{ep.overview}</p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-gray-500">No individual episode listing downloaded.</p>
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
          <section className="bg-[#14161f]/95 backdrop-blur-md p-6 rounded-2xl border border-white/10 shadow-2xl space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <Tag className="w-5 h-5" style={{ color: accentColor, ...highContrastFilter }} />
              <span>Derived Library Statistics</span>
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-[#1a1d29] p-3.5 rounded-xl border border-[#2d3145]">
                <span className="text-xs text-gray-400 font-medium">Current Status</span>
                <p className="text-sm font-bold mt-1" style={{ color: accentColor, ...highContrastFilter }}>{state.current_status}</p>
              </div>
              <div className="bg-[#1a1d29] p-3.5 rounded-xl border border-[#2d3145]">
                <span className="text-xs text-gray-400 font-medium">Total Sessions</span>
                <p className="text-sm font-bold text-white mt-1">{historyList.length}</p>
              </div>
              <div className="bg-[#1a1d29] p-3.5 rounded-xl border border-[#2d3145]">
                <span className="text-xs text-gray-400 font-medium">Rewatch / Replays</span>
                <p className="text-sm font-bold text-white mt-1">{state.rewatch_count}</p>
              </div>
              <div className="bg-[#1a1d29] p-3.5 rounded-xl border border-[#2d3145]">
                <span className="text-xs text-gray-400 font-medium">Last Watched/Played</span>
                <p className="text-sm font-bold text-white mt-1">
                  {state.last_watched_played || 'N/A'}
                </p>
              </div>
            </div>
          </section>

          {/* History Timeline */}
          <section className="bg-[#14161f]/95 backdrop-blur-md p-6 rounded-2xl border border-white/10 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center space-x-2">
                <History className="w-5 h-5" style={{ color: accentColor, ...highContrastFilter }} />
                <span>Interaction Journal ({historyList.length})</span>
              </h2>
              <button
                onClick={() => setShowAddHistoryModal(true)}
                style={{ backgroundColor: accentColor }}
                className="flex items-center space-x-1.5 hover:opacity-90 text-white font-semibold text-xs px-3 py-1.5 rounded-lg transition-all shadow-md cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Log Session</span>
              </button>
            </div>

            {historyList.length === 0 ? (
              <p className="text-sm text-gray-400">No history sessions recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {historyList.map(h => (
                  <div
                    key={h.id}
                    className="bg-[#1a1d2b] p-4 rounded-xl border border-[#282c3f] space-y-2 relative"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span
                          className="text-xs font-bold px-2 py-0.5 rounded border"
                          style={{
                            backgroundColor: accentBgLight,
                            color: accentColor,
                            ...highContrastFilter,
                            borderColor: accentBorderLight
                          }}
                        >
                          {h.status}
                        </span>
                        {h.context && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-500/30">
                            Context: {h.context}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center space-x-3 text-xs text-gray-400">
                        {h.score && (
                          <span className="flex items-center space-x-1 text-amber-400 font-bold">
                            <Star className="w-3.5 h-3.5 fill-amber-400" />
                            <span>{h.score} / 5</span>
                          </span>
                        )}
                        <span>{h.completed_at || h.started_at || h.created_at.split('T')[0]}</span>
                      </div>
                    </div>

                    {h.thoughts && (
                      <p className="text-xs text-gray-300 italic pt-1 border-t border-[#25293b]">
                        "{h.thoughts}"
                      </p>
                    )}

                    <div className="text-[10px] text-gray-500 pt-1">
                      Source: {h.source} {h.original_source_record_id ? `(ID: ${h.original_source_record_id})` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Local Files & Availability */}
        <div className="space-y-6">
          {/* Local Storage & Executable Files */}
          <section className="bg-[#14161f]/95 backdrop-blur-md p-6 rounded-2xl border border-white/10 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white flex items-center space-x-2">
                <FolderCheck className="w-4 h-4" style={{ color: accentColor, ...highContrastFilter }} />
                <span>Local System Files</span>
              </h2>

              <button
                onClick={() => setShowFilePickerModal(true)}
                style={{
                  color: accentColor,
                  backgroundColor: accentBgLight,
                  borderColor: accentBorderLight,
                  ...highContrastFilter
                }}
                className="text-xs hover:opacity-90 font-semibold flex items-center space-x-1 border px-2.5 py-1 rounded-lg cursor-pointer transition-colors"
              >
                <Edit3 className="w-3 h-3" />
                <span
                style={{
                  color: accentColor
                }}>Configure Path</span>
              </button>
            </div>

            {localFiles.length === 0 ? (
              <p className="text-xs text-gray-400">No local file detected for this media item.</p>
            ) : (
              <div className="space-y-2">
                {localFiles.map(lf => (
                  <div key={lf.id} className="bg-[#1a1d29] p-3 rounded-lg border border-[#2d3145] text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-gray-200 truncate" title={lf.path}>
                        {lf.filename}
                      </p>
                      {lf.exists ? (
                        <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/80 px-2 py-0.5 rounded">
                          Available
                        </span>
                      ) : (
                        <span className="text-[10px] text-amber-400 font-bold bg-amber-950/80 px-2 py-0.5 rounded">
                          Missing
                        </span>
                      )}
                    </div>

                    <p className="text-[10px] text-gray-400 font-mono truncate">{lf.path}</p>

                    {lf.exists && (
                      <button
                        onClick={() => handlePlayFile(lf)}
                        className="w-full bg-emerald-600/90 hover:bg-emerald-500 text-white font-bold text-xs py-1.5 rounded-lg flex items-center justify-center space-x-1.5 shadow-sm transition-all cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Launch File</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Streaming & Provider Availability */}
          <section className="bg-[#14161f]/95 backdrop-blur-md p-6 rounded-2xl border border-white/10 shadow-2xl space-y-3">
            <h2 className="text-base font-bold text-white flex items-center space-x-2">
              <Globe className="w-4 h-4" style={{ color: accentColor, ...highContrastFilter }} />
              <span>Streaming & Availability</span>
            </h2>
            {availabilities.length === 0 ? (
              <div className="bg-[#1a1d29] p-3 rounded-lg border border-[#2d3145] text-xs text-gray-400">
                Streaming availability provider ready. Configure regional options in Settings.
              </div>
            ) : (
              <div className="space-y-2">
                {availabilities.map(av => (
                  <div
                    key={av.id}
                    className="bg-[#1a1d29] p-3 rounded-lg border border-[#2d3145] flex items-center justify-between text-xs"
                  >
                    <div>
                      <p className="font-semibold text-gray-100">{av.provider}</p>
                      <p className="text-[10px] text-gray-400">{av.availability_type} ({av.country || 'Global'})</p>
                    </div>
                    {av.url && (
                      <a
                        href={av.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: accentColor, ...highContrastFilter }}
                        className="text-xs hover:underline font-medium"
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

      {/* Log History Modal */}
      {showAddHistoryModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#14161f] border border-[#2d3145] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Log Interaction Session</h3>
            <form onSubmit={handleAddHistorySubmit} className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Status</label>
                <select
                  value={newStatus}
                  onChange={e => setNewStatus(e.target.value)}
                  className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2 text-sm text-gray-100"
                >
                  <option value="Finished">Finished</option>
                  <option value="Currently">Currently Active</option>
                  <option value="Abandoned">Abandoned / Paused</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Score (1 - 5)</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={newScore}
                  onChange={e => setNewScore(Number(e.target.value))}
                  className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2 text-sm text-gray-100"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Context Tag</label>
                <input
                  type="text"
                  placeholder="e.g. 2+ Rewatch, restart, Season 1-2 rewatch"
                  value={newContext}
                  onChange={e => setNewContext(e.target.value)}
                  className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2 text-sm text-gray-100 placeholder-gray-500"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">Thoughts / Review</label>
                <textarea
                  rows={3}
                  placeholder="Your personal review or notes..."
                  value={newThoughts}
                  onChange={e => setNewThoughts(e.target.value)}
                  className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2 text-sm text-gray-100 placeholder-gray-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddHistoryModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ backgroundColor: accentColor }}
                  className="px-4 py-2 text-xs font-semibold hover:opacity-90 text-white rounded-lg shadow-md"
                >
                  Save Log
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* File / Executable Selector Modal */}
      {showFilePickerModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#14161f] border border-[#2d3145] rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Configure Executable or Video File</h3>
            <form onSubmit={handleCustomPathSubmit} className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 font-medium block mb-1">
                  Local File Path / Shortcut (.exe, .lnk, .mkv)
                </label>
                <input
                  type="text"
                  required
                  placeholder={currentMedia.type === 'VideoGame' ? 'D:\\Games\\Game.lnk or .exe' : 'D:\\Movies\\Film.mkv'}
                  value={customPath}
                  onChange={e => setCustomPath(e.target.value)}
                  className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2.5 text-xs text-gray-100 font-mono"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowFilePickerModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{ backgroundColor: accentColor }}
                  className="px-4 py-2 text-xs font-semibold hover:opacity-90 text-white rounded-lg shadow-md"
                >
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
