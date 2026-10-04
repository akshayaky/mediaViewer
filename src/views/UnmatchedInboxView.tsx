import React, { useState } from 'react';
import { LocalFile, Media, MediaType } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { localScannerService } from '../services/LocalScannerService';
import { Inbox, CheckCircle2, Plus, Search, FileQuestion, Sparkles, Folder } from 'lucide-react';

interface UnmatchedInboxViewProps {
  onMediaMatched?: () => void;
}

export const UnmatchedInboxView: React.FC<UnmatchedInboxViewProps> = ({ onMediaMatched }) => {
  const [unmatchedFiles, setUnmatchedFiles] = useState<LocalFile[]>(dbService.getUnmatchedLocalFiles());
  const [searchQueries, setSearchQueryMap] = useState<Record<string, string>>({});
  const [successMessage, setSavedMessage] = useState('');

  const allMedia = dbService.getAllMedia();

  const refreshFiles = () => {
    setUnmatchedFiles(dbService.getUnmatchedLocalFiles());
    window.dispatchEvent(new CustomEvent('library-scanned'));
    if (onMediaMatched) onMediaMatched();
  };

  const handleLinkToMedia = (fileId: string, mediaId: string) => {
    dbService.linkLocalFileToMedia(fileId, mediaId);
    setSavedMessage('Local file successfully linked to media entry.');
    setTimeout(() => setSavedMessage(''), 3000);
    refreshFiles();
  };

  const handleCreateNewMedia = (file: LocalFile) => {
    const parsed = localScannerService.parseFilePath(
      file.path,
      file.file_type === 'game_executable' ? 'VideoGame' : file.file_type === 'tv_episode' ? 'TV Series' : 'Film'
    );

    const now = new Date().toISOString();
    const newMediaId = `media_created_${Date.now()}`;
    const mediaType: MediaType =
      file.file_type === 'game_executable' ? 'VideoGame' : file.file_type === 'tv_episode' ? 'TV Series' : 'Film';

    const newMedia: Media = {
      id: newMediaId,
      type: mediaType,
      title: parsed.cleanTitle || file.filename,
      release_year: parsed.year,
      genres: [],
      metadata_source: 'Created from Local Scanner File',
      created_at: now,
      updated_at: now
    };

    dbService.saveMedia(newMedia);
    dbService.linkLocalFileToMedia(file.id, newMedia.id);

    setSavedMessage(`Created new ${mediaType} record "${newMedia.title}" and linked file.`);
    setTimeout(() => setSavedMessage(''), 3000);
    refreshFiles();
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header Bar */}
      <div className="border-b border-[#1f222e] pb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center space-x-3">
            <Inbox className="w-8 h-8 text-rose-500" />
            <span>Unmatched Items Inbox</span>
          </h1>
          <p className="text-sm text-rose-400/80 font-medium mt-1">
            Review ambiguous local files and assign them to canonical Media entries
          </p>
        </div>

        {successMessage && (
          <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4" />
            <span>{successMessage}</span>
          </span>
        )}
      </div>

      {/* List of Unmatched Local Files */}
      {unmatchedFiles.length === 0 ? (
        <div className="p-12 text-center text-gray-400 bg-[#14161f] rounded-2xl border border-[#232736]">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-white mb-1">Inbox Clean & Up To Date!</h3>
          <p className="text-xs text-gray-400">All local library files have been matched to Media entities.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {unmatchedFiles.map(file => {
            const parsed = localScannerService.parseFilePath(
              file.path,
              file.file_type === 'game_executable' ? 'VideoGame' : file.file_type === 'tv_episode' ? 'TV Series' : 'Film'
            );

            // Candidate proposals from existing media
            const proposedMatch = localScannerService.findHighConfidenceMatch(
              parsed,
              file.file_type === 'game_executable' ? 'VideoGame' : file.file_type === 'tv_episode' ? 'TV Series' : 'Film',
              allMedia
            );

            const searchQuery = searchQueries[file.id] || '';
            const filteredMedia = searchQuery.trim()
              ? allMedia.filter(m => m.title.toLowerCase().includes(searchQuery.toLowerCase()))
              : allMedia.slice(0, 5);

            return (
              <div
                key={file.id}
                className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-4 transition-all"
              >
                {/* File Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-[#1f222e] pb-3">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="bg-amber-950/80 text-amber-400 border border-amber-500/30 text-[11px] font-bold px-2 py-0.5 rounded flex items-center space-x-1">
                        <FileQuestion className="w-3.5 h-3.5" />
                        <span>Unmatched File</span>
                      </span>
                      <span className="bg-[#1e212d] text-gray-300 text-xs font-semibold px-2 py-0.5 rounded uppercase">
                        {file.file_type}
                      </span>
                    </div>

                    <h3 className="font-bold text-base text-white font-mono truncate" title={file.filename}>
                      {file.filename}
                    </h3>
                    <p className="text-xs text-gray-400 font-mono flex items-center space-x-1">
                      <Folder className="w-3.5 h-3.5 text-rose-400" />
                      <span className="truncate">{file.path}</span>
                    </p>
                  </div>

                  <button
                    onClick={() => handleCreateNewMedia(file)}
                    className="flex items-center space-x-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs px-4 py-2 rounded-xl shadow-md transition-all shrink-0 self-start md:self-center"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create New Media Record</span>
                  </button>
                </div>

                {/* Candidate Proposal */}
                {proposedMatch && (
                  <div className="bg-[#102219] border border-emerald-500/30 p-3.5 rounded-xl flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-3">
                      <Sparkles className="w-4 h-4 text-emerald-400" />
                      <div>
                        <span className="font-bold text-emerald-300">Suggested Candidate Match: </span>
                        <span className="font-semibold text-white">{proposedMatch.title}</span>
                        {proposedMatch.release_year && (
                          <span className="text-gray-400 ml-1">({proposedMatch.release_year})</span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => handleLinkToMedia(file.id, proposedMatch.id)}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg shadow-sm"
                    >
                      Confirm Match
                    </button>
                  </div>
                )}

                {/* Manual Search & Select Candidate */}
                <div className="space-y-2 pt-1">
                  <span className="text-xs text-gray-400 font-medium block">
                    Search and pick existing Media entry to link:
                  </span>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Type title to search existing library..."
                      value={searchQuery}
                      onChange={e =>
                        setSearchQueryMap({ ...searchQueries, [file.id]: e.target.value })
                      }
                      className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg pl-9 pr-3 py-1.5 text-xs text-gray-100"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {filteredMedia.map(media => (
                      <button
                        key={media.id}
                        onClick={() => handleLinkToMedia(file.id, media.id)}
                        className="bg-[#1e212d] hover:bg-rose-950/60 hover:border-rose-500/50 border border-[#2f3448] text-gray-200 text-xs px-3 py-1.5 rounded-lg transition-all flex items-center space-x-1.5"
                      >
                        <span className="font-semibold">{media.title}</span>
                        <span className="text-[10px] text-gray-400">({media.type})</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
