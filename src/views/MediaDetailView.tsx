import { convertFileSrc } from '@tauri-apps/api/core';
import React, { useState, useEffect } from 'react';
import { Media, LocalFile } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { localLauncherService } from '../services/LocalLauncherService';
import { tmdbProvider } from '../providers/TMDBProvider';
import { igdbProvider } from '../providers/IGDBProvider';
import { artworkCacheProvider } from '../providers/ArtworkCacheProvider';
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

export const MediaDetailView: React.FC<MediaDetailViewProps> = ({ media: initialMedia, onBack }) => {
  const [currentMedia, setCurrentMedia] = useState<Media>(initialMedia);
  const [historyList, setHistoryList] = useState(dbService.getHistoryForMedia(initialMedia.id));
  const [state, setState] = useState(dbService.getMediaState(initialMedia.id));
  const [localFiles, setLocalFiles] = useState<LocalFile[]>(dbService.getLocalFilesForMedia(initialMedia.id));
  const availabilities = dbService.getAvailabilityForMedia(initialMedia.id);

  // Artwork resolution
  const [artwork, setArtwork] = useState<{ poster?: string; backdrop?: string; logo?: string }>({
    poster: currentMedia.poster,
    backdrop: currentMedia.backdrop,
    logo: currentMedia.logo
  });

  // Season accordion state
  const [expandedSeason, setExpandedSeason] = useState<number | null>(1);

  // Manual Metadata Refresh state
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState('');

  // Local launcher & modals state
  const [showAddHistoryModal, setShowAddHistoryModal] = useState(false);
  const [newStatus, setNewStatus] = useState<any>('Finished');
  const [newScore, setNewScore] = useState<number>(4);
  const [newContext, setNewContext] = useState<string>('Rewatch');
  const [newThoughts, setNewThoughts] = useState<string>('');

  const [showFilePickerModal, setShowFilePickerModal] = useState(false);
  const [customPath, setCustomPath] = useState('');
  const [launchMessage, setLaunchMessage] = useState('');

  useEffect(() => {
    // Resolve artwork with caching priority
    artworkCacheProvider.resolveArtworkForMedia(currentMedia).then(res => {
      setArtwork({
        poster: res.poster || currentMedia.poster,
        backdrop: res.backdrop || currentMedia.backdrop,
        logo: res.logo || currentMedia.logo
      });
    });
  }, [currentMedia]);

  const activeLocalFile = localFiles.find(lf => lf.exists) || localFiles[0];
  const isAvailableLocally = localFiles.some(lf => lf.exists);
  const isLocalMissing = localFiles.length > 0 && !isAvailableLocally;

  const refreshLocalFiles = () => {
    setLocalFiles(dbService.getLocalFilesForMedia(currentMedia.id));
  };

  const refreshHistoryAndState = () => {
    setHistoryList(dbService.getHistoryForMedia(currentMedia.id));
    setState(dbService.getMediaState(currentMedia.id));
  };

  const handleManualMetadataRefresh = async () => {
    setIsRefreshingMetadata(true);
    setRefreshMessage('');

    try {
      let extId = currentMedia.external_ids && currentMedia.external_ids.length > 0
        ? currentMedia.external_ids[0].external_id
        : undefined;

      let freshDetails: Partial<Media> = {};

      if (currentMedia.type === 'VideoGame') {
        if (!extId || (!extId.startsWith('igdb:') && !extId.startsWith('rawg:'))) {
          const searchRes = await igdbProvider.searchMedia(currentMedia.title, 'VideoGame');
          if (searchRes.length > 0) extId = searchRes[0].external_id;
        }
        if (extId) {
          freshDetails = await igdbProvider.getMediaDetails(extId);
        } else {
          freshDetails = await igdbProvider.getMediaDetails(currentMedia.title);
        }
      } else {
        if (!extId || (!extId.startsWith('movie:') && !extId.startsWith('tv:'))) {
          const searchRes = await tmdbProvider.searchMedia(currentMedia.title, currentMedia.type);
          if (searchRes.length > 0) extId = searchRes[0].external_id;
        }
        if (extId) {
          freshDetails = await tmdbProvider.getMediaDetails(extId);
        } else {
          freshDetails = await tmdbProvider.getMediaDetails(currentMedia.title);
        }
      }

      if (!freshDetails || Object.keys(freshDetails).length === 0) {
        throw new Error('No metadata returned from provider.');
      }

      const now = new Date().toISOString();
      const updatedMedia: Media = {
        ...currentMedia,
        ...freshDetails,
        id: currentMedia.id,
        metadata_refreshed_at: now,
        updated_at: now
      };

      dbService.saveMedia(updatedMedia);
      setCurrentMedia(updatedMedia);

      if (updatedMedia.poster || updatedMedia.backdrop || updatedMedia.logo) {
        artworkCacheProvider.setCachedArtwork(
          currentMedia.id,
          {
            poster: updatedMedia.poster,
            backdrop: updatedMedia.backdrop,
            logo: updatedMedia.logo
          },
          'metadata_provider'
        );
        setArtwork({
          poster: updatedMedia.poster,
          backdrop: updatedMedia.backdrop,
          logo: updatedMedia.logo
        });
      }

      if (extId && (!currentMedia.external_ids || currentMedia.external_ids.length === 0)) {
        dbService.saveExternalId({
          id: `ext_${Date.now()}`,
          media_id: currentMedia.id,
          provider: currentMedia.type === 'VideoGame' ? 'IGDB' : 'TMDB',
          external_id: extId
        });
      }

      setRefreshMessage('Metadata & artwork successfully refreshed from provider!');
      setTimeout(() => setRefreshMessage(''), 4000);
    } catch (err: any) {
      console.error('Failed to refresh metadata:', err);
      setRefreshMessage(`Failed to refresh metadata: ${err?.message || 'Check title or API key'}`);
    } finally {
      setIsRefreshingMetadata(false);
    }
  };

  const handlePlayFile = async (file?: LocalFile) => {
    const targetFile = file || activeLocalFile;
    if (!targetFile) return;

    const res = await localLauncherService.launchFile(targetFile);
    setLaunchMessage(res.message);
    setTimeout(() => setLaunchMessage(''), 4000);
  };

  const handleAddHistory = (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date().toISOString();
    dbService.saveHistory({
      id: `hist_manual_${Date.now()}`,
      media_id: currentMedia.id,
      completed_at: now.split('T')[0],
      status: newStatus,
      score: newScore,
      context: newContext.trim() || undefined,
      thoughts: newThoughts.trim() || undefined,
      source: 'Manual',
      created_at: now
    });
    setShowAddHistoryModal(false);
    setNewThoughts('');
    refreshHistoryAndState();
  };

  const handleSaveCustomExecutable = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPath.trim()) return;

    const now = new Date().toISOString();
    const filename = customPath.split(/\\|\//).pop() || customPath;
    const ext = filename.split('.').pop() || 'exe';

    const newLocalFile: LocalFile = {
      id: `lf_custom_${Date.now()}`,
      media_id: currentMedia.id,
      path: customPath.trim(),
      filename,
      extension: ext,
      size: 2000000000,
      discovered_at: now,
      last_seen_at: now,
      exists: true,
      file_type: currentMedia.type === 'VideoGame' ? 'game_executable' : 'movie',
      launch_info: customPath.trim()
    };

    dbService.saveLocalFile(newLocalFile);
    refreshLocalFiles();
    setShowFilePickerModal(false);
    setCustomPath('');
  };

  const getTypeIcon = () => {
    switch (currentMedia.type) {
      case 'Film':
        return <Film className="w-4 h-4 text-rose-400" />;
      case 'TV Series':
        return <Tv className="w-4 h-4 text-sky-400" />;
      case 'VideoGame':
        return <Gamepad2 className="w-4 h-4 text-purple-400" />;
    }
  };

  return (
    <div className="relative min-h-screen bg-[#0c0d10] text-gray-100 pb-12">
      {/* Top Backdrop Header */}
      <div className="relative w-full h-[520px] bg-[#12141c] border-b border-[#232736]">
        {artwork.backdrop ? (
          <img
            src={artwork.backdrop}
            alt={currentMedia.title}
            // src={media.backdrop.startsWith('http') ? media.backdrop : (typeof window !== 'undefined' && (window as any).__TAURI__ ? convertFileSrc(media.backdrop) : media.backdrop)}
            // alt={media.title}
            className="w-full h-full object-cover object-center opacity-45"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-rose-950/30 via-[#12141c] to-[#0c0d10]" />
        )}

        {/* Backdrop Gradient Overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0c0d10] via-[#0c0d10]/60 to-black/30" />

        {/* Header Bar Actions */}
        <div className="absolute top-6 left-6 right-6 z-20 flex items-center justify-between">
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
            className="flex items-center space-x-2 bg-rose-600/90 hover:bg-rose-500 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-xl shadow-lg transition-all cursor-pointer"
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

        {/* Floating Poster & Title Overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-8 max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-end gap-6 z-10">
          {/* Poster */}
          <div className="w-48 aspect-[2/3] rounded-2xl overflow-hidden border-2 border-[#2f3448] shadow-2xl bg-[#1b1e2b] shrink-0">
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
              <span className="bg-rose-600/90 text-white text-xs font-bold px-3 py-1 rounded-full flex items-center space-x-1.5 uppercase tracking-wider">
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
                  <Calendar className="w-3.5 h-3.5 text-rose-400" />
                  <span>{currentMedia.release_year}</span>
                </span>
              )}

              {currentMedia.runtime && (
                <span className="bg-[#1b1e2b] text-gray-300 border border-[#2d3248] text-xs font-semibold px-2.5 py-1 rounded-full flex items-center space-x-1">
                  <Clock className="w-3.5 h-3.5 text-rose-400" />
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

            {/* Play Button & Feedback messages */}
            <div className="flex items-center space-x-3 pt-2">
              {activeLocalFile && isAvailableLocally && (
                <button
                  onClick={() => handlePlayFile(activeLocalFile)}
                  className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm px-6 py-3 rounded-xl shadow-xl shadow-emerald-950/40 transition-all transform hover:-translate-y-0.5 cursor-pointer"
                >
                  <Play className="w-5 h-5 fill-current" />
                  <span>PLAY {currentMedia.type === 'VideoGame' ? 'GAME' : 'MEDIA'}</span>
                </button>
              )}

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

      {/* Main Content Layout */}
      <div className="p-8 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Overview, Seasons, Cast, Journal */}
        <div className="lg:col-span-2 space-y-8">
          {/* Overview */}
          <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <FileText className="w-5 h-5 text-rose-500" />
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
            <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-4">
              <h2 className="text-lg font-bold text-white flex items-center space-x-2">
                <User className="w-5 h-5 text-rose-500" />
                <span>Top Cast Members</span>
              </h2>

              <div className="flex space-x-4 overflow-x-auto pb-2 scrollbar-none">
                {currentMedia.cast.map(member => (
                  <div key={member.id} className="w-28 shrink-0 space-y-1.5 text-center group">
                    <div className="w-24 h-24 mx-auto rounded-full overflow-hidden bg-[#1d202e] border-2 border-[#2e3347] group-hover:border-rose-500/50 transition-all">
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
            <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-4">
              <h2 className="text-lg font-bold text-white flex items-center space-x-2">
                <Layers className="w-5 h-5 text-rose-500" />
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

                        {isExpanded ? <ChevronUp className="w-5 h-5 text-rose-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
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
          <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <Tag className="w-5 h-5 text-rose-500" />
              <span>Derived Library Statistics</span>
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-[#1a1d29] p-3.5 rounded-xl border border-[#2d3145]">
                <span className="text-xs text-gray-400 font-medium">Current Status</span>
                <p className="text-sm font-bold text-rose-400 mt-1">{state.current_status}</p>
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
          <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center space-x-2">
                <History className="w-5 h-5 text-rose-500" />
                <span>Interaction Journal ({historyList.length})</span>
              </h2>
              <button
                onClick={() => setShowAddHistoryModal(true)}
                className="flex items-center space-x-1.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs px-3 py-1.5 rounded-lg transition-all shadow-md cursor-pointer"
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
                        <span className="text-xs font-bold px-2 py-0.5 rounded bg-rose-950/80 text-rose-400 border border-rose-500/30">
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
          <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-white flex items-center space-x-2">
                <FolderCheck className="w-4 h-4 text-rose-500" />
                <span>Local System Files</span>
              </h2>

              <button
                onClick={() => setShowFilePickerModal(true)}
                className="text-xs text-rose-400 hover:text-rose-300 font-semibold flex items-center space-x-1 bg-rose-950/50 border border-rose-500/30 px-2.5 py-1 rounded-lg cursor-pointer"
              >
                <Edit3 className="w-3 h-3" />
                <span>Configure Path</span>
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
          <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-3">
            <h2 className="text-base font-bold text-white flex items-center space-x-2">
              <Globe className="w-4 h-4 text-rose-500" />
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
                        className="text-xs text-rose-400 hover:underline font-medium"
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
            <form onSubmit={handleAddHistory} className="space-y-3">
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
                  className="px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-lg shadow-md"
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
            <form onSubmit={handleSaveCustomExecutable} className="space-y-3">
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
                  className="px-4 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded-lg shadow-md"
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
