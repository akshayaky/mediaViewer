import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Media } from '../types/media';
import { useMediaDetail } from '../hooks/useMediaDetail';
import { useDominantColor } from '../helper/useDominantColour';
import { getMediaTheme } from '../helper/mediaDetailTheme';
import { dbService } from '../services/DatabaseService';
import './MediaDetailView.css';
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

  if(!isRefreshingMetadata && artwork.backdrop == "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1280&q=80")
  {
    console.log("Loading now");
    handleManualMetadataRefresh();
  }
  else
  {
    console.log("already loaded " + artwork.backdrop);
  }

  console.log("Detailed view");
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

  // Light/dark tone + accent-derived colours. All other styling lives in MediaDetailView.css
  const theme = getMediaTheme(accentColorForPage);

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
      style={theme.cssVars}
    >
      {/* Pinned Backdrop */}
      <div className="mdv-backdrop">
        {artwork.backdrop && failedBackdropSrc !== artwork.backdrop ? (
          <img
            src={artwork.backdrop}
            alt={currentMedia.title}
            className="mdv-backdrop-img"
            onLoad={() => setLoadedArtworkSrc(artwork.backdrop)}
            onError={() => {
              setFailedBackdropSrc(artwork.backdrop);
              setLoadedArtworkSrc(loadedSrc =>
                loadedSrc === artwork.backdrop ? undefined : loadedSrc
              );
            }}
          />
        ) : (
          <div className="mdv-backdrop-fallback" />
        )}
        {(!artwork.backdrop || failedBackdropSrc === artwork.backdrop) && artwork.poster && (
          <img
            src={artwork.poster}
            alt=""
            aria-hidden="true"
            className="mdv-hidden-img"
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
        <div className="mdv-backdrop-overlay" />
      </div>

      {/* Pinned Header Bar Actions */}
      <div className={`mdv-header ${isPlayButtonStuck ? 'mdv-header--stuck' : ''}`}>
        <div className="mdv-header-actions">
          <button onClick={onBack} className="mdv-btn mdv-btn-glass">
            <ArrowLeft className="mdv-icon-md" />
            <span>Back to Library</span>
          </button>

          <button
            onClick={handleManualMetadataRefresh}
            disabled={isRefreshingMetadata}
            className="mdv-btn mdv-btn-accent mdv-btn-refresh"
          >
            {isRefreshingMetadata ? (
              <>
                <Loader2 className="mdv-icon-md mdv-spin" />
                <span>Re-syncing Provider...</span>
              </>
            ) : (
              <>
                <RefreshCw className="mdv-icon-md" />
                <span>Refresh Metadata</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Scrollable Hero Content */}
      <div className="mdv-hero">
        {/* Floating Poster & Title Overlay */}
        <div className="mdv-hero-inner">
          {/* Poster */}
          {/* <div className="mdv-poster">
            {artwork.poster ? (
              <img src={artwork.poster} alt={currentMedia.title} />
            ) : (
              <div className="mdv-poster-fallback">
                {getTypeIcon()}
                <span>{currentMedia.title}</span>
              </div>
            )}
          </div> */}

          {/* Title & Core Badges */}
          <div className="mdv-title-block">
            <div className="mdv-badges">
              <span className="mdv-type-badge">
                {getTypeIcon()}
                <span>{currentMedia.type}</span>
              </span>

              {/* Local Availability Badge */}
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

            {/* Logo Image or Fallback Title Text */}
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

            {/* Genres list */}
            {currentMedia.genres && currentMedia.genres.length > 0 && (
              <div className="mdv-genres">
                {currentMedia.genres.map(g => (
                  <span key={g} className="mdv-genre">
                    {g}
                  </span>
                ))}
              </div>
            )}

            {/* Feedback messages */}
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
        {/* Left Column: Overview, Seasons, Cast, Journal */}
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
                              {season.episodes.map(ep => (
                                <div key={ep.episode_number} className="mdv-tile mdv-tile--sm mdv-episode">
                                  {ep.still_path && (
                                    <img src={ep.still_path} alt={ep.name} className="mdv-episode-still" />
                                  )}
                                  <div className="mdv-episode-info">
                                    <div className="mdv-episode-head">
                                      <h4 className="mdv-episode-title">
                                        E{ep.episode_number}. {ep.name}
                                      </h4>
                                      {ep.air_date && <span className="mdv-episode-date">{ep.air_date}</span>}
                                    </div>
                                    {ep.overview && (
                                      <p className="mdv-episode-overview">{ep.overview}</p>
                                    )}
                                  </div>
                                </div>
                              ))}
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
