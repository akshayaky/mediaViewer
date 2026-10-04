import React, { useState } from 'react';
import { Media } from '../types/media';
import { dbService } from '../services/DatabaseService';
import {
  ArrowLeft,
  Star,
  Calendar,
  Film,
  Tv,
  Gamepad2,
  FolderCheck,
  Globe,
  Plus,
  History,
  FileText,
  Building,
  Tag
} from 'lucide-react';

interface MediaDetailViewProps {
  media: Media;
  onBack: () => void;
}

export const MediaDetailView: React.FC<MediaDetailViewProps> = ({ media, onBack }) => {
  const historyList = dbService.getHistoryForMedia(media.id);
  const state = dbService.getMediaState(media.id);
  const localFiles = dbService.getLocalFilesForMedia(media.id);
  const availabilities = dbService.getAvailabilityForMedia(media.id);

  // New history session state
  const [showAddHistoryModal, setShowAddHistoryModal] = useState(false);
  const [newStatus, setNewStatus] = useState<any>('Finished');
  const [newScore, setNewScore] = useState<number>(4);
  const [newContext, setNewContext] = useState<string>('Rewatch');
  const [newThoughts, setNewThoughts] = useState<string>('');

  const handleAddHistory = (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date().toISOString();
    dbService.saveHistory({
      id: `hist_manual_${Date.now()}`,
      media_id: media.id,
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
  };

  const getTypeIcon = () => {
    switch (media.type) {
      case 'Film':
        return <Film className="w-4 h-4 text-rose-400" />;
      case 'TV Series':
        return <Tv className="w-4 h-4 text-sky-400" />;
      case 'VideoGame':
        return <Gamepad2 className="w-4 h-4 text-purple-400" />;
    }
  };

  return (
    <div className="relative min-h-screen bg-[#0c0d10] text-gray-100">
      {/* Top Backdrop Header */}
      <div className="relative w-full h-[480px] bg-[#12141c] border-b border-[#232736]">
        {media.backdrop ? (
          <img
            src={media.backdrop}
            alt={media.title}
            className="w-full h-full object-cover object-center opacity-45"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-rose-950/30 via-[#12141c] to-[#0c0d10]" />
        )}

        {/* Backdrop Overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0c0d10] via-[#0c0d10]/60 to-black/30" />

        {/* Back Navigation Button */}
        <button
          onClick={onBack}
          className="absolute top-6 left-6 z-20 flex items-center space-x-2 bg-black/60 hover:bg-black/80 text-white font-medium text-xs px-3.5 py-2 rounded-xl backdrop-blur-md border border-white/10 transition-all shadow-lg"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Library</span>
        </button>

        {/* Floating Poster & Title Overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-8 max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-end gap-6 z-10">
          {/* Poster */}
          <div className="w-44 aspect-[2/3] rounded-2xl overflow-hidden border-2 border-[#2f3448] shadow-2xl bg-[#1b1e2b] shrink-0">
            {media.poster ? (
              <img src={media.poster} alt={media.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-4 text-center">
                {getTypeIcon()}
                <span className="text-xs text-gray-400 mt-2">{media.title}</span>
              </div>
            )}
          </div>

          {/* Title & Core Badges */}
          <div className="space-y-3 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="bg-rose-600/90 text-white text-xs font-bold px-3 py-1 rounded-full flex items-center space-x-1.5 uppercase tracking-wider">
                {getTypeIcon()}
                <span>{media.type}</span>
              </span>
              {media.release_year && (
                <span className="bg-[#1b1e2b] text-gray-300 border border-[#2d3248] text-xs font-semibold px-2.5 py-1 rounded-full flex items-center space-x-1">
                  <Calendar className="w-3.5 h-3.5 text-rose-400" />
                  <span>{media.release_year}</span>
                </span>
              )}
              {media.publisher && (
                <span className="bg-[#1b1e2b] text-gray-300 border border-[#2d3248] text-xs font-semibold px-2.5 py-1 rounded-full flex items-center space-x-1">
                  <Building className="w-3.5 h-3.5 text-amber-400" />
                  <span>{media.publisher}</span>
                </span>
              )}
              {media.language && (
                <span className="bg-[#1b1e2b] text-gray-300 border border-[#2d3248] text-xs font-semibold px-2.5 py-1 rounded-full">
                  {media.language}
                </span>
              )}
            </div>

            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight drop-shadow-lg">
              {media.title}
            </h1>

            {/* Genres */}
            {media.genres && media.genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {media.genres.map(g => (
                  <span
                    key={g}
                    className="bg-gray-800/80 text-gray-300 text-xs px-2.5 py-0.5 rounded-md border border-gray-700/60"
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Layout */}
      <div className="p-8 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Stats & Metadata */}
        <div className="lg:col-span-2 space-y-8">
          {/* Overview */}
          <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <FileText className="w-5 h-5 text-rose-500" />
              <span>Overview</span>
            </h2>
            <p className="text-sm text-gray-300 leading-relaxed">
              {media.description || 'No detailed synopsis recorded yet for this entry.'}
            </p>
          </section>

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
                className="flex items-center space-x-1.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs px-3 py-1.5 rounded-lg transition-all shadow-md"
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
          {/* Local Storage & Files */}
          <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-3">
            <h2 className="text-base font-bold text-white flex items-center space-x-2">
              <FolderCheck className="w-4 h-4 text-rose-500" />
              <span>Local System Files</span>
            </h2>
            {localFiles.length === 0 ? (
              <p className="text-xs text-gray-400">No local file detected for this media item.</p>
            ) : (
              <div className="space-y-2">
                {localFiles.map(lf => (
                  <div key={lf.id} className="bg-[#1a1d29] p-3 rounded-lg border border-[#2d3145] text-xs space-y-1">
                    <p className="font-medium text-gray-200 truncate" title={lf.path}>
                      {lf.filename}
                    </p>
                    <p className="text-[10px] text-gray-400 font-mono truncate">{lf.path}</p>
                    {lf.launch_info && (
                      <span className="inline-block text-[10px] text-rose-400 font-semibold bg-rose-950/50 px-2 py-0.5 rounded">
                        Launchable
                      </span>
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
                Placeholder: Search API integration pending for provider streaming links.
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
    </div>
  );
};
