import React, { useEffect, useState } from 'react';
import { LocalFile, Media, MediaType } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { localScannerService } from '../services/LocalScannerService';
import { tmdbProvider } from '../providers/TMDBProvider';
import { igdbProvider } from '../providers/IGDBProvider';
import { MetadataSearchResult } from '../providers/interfaces';
import {
  Inbox,
  CheckCircle2,
  Plus,
  Search,
  FileQuestion,
  Sparkles,
  Folder,
  Globe,
  Loader2,
  Film,
  Tv,
  Gamepad2
} from 'lucide-react';

interface UnmatchedInboxViewProps {
  onMediaMatched?: () => void;
}

export const UnmatchedInboxView: React.FC<UnmatchedInboxViewProps> = ({ onMediaMatched }) => {
  const [unmatchedFiles, setUnmatchedFiles] = useState<LocalFile[]>([]);
  const [allMedia, setAllMedia] = useState<Media[]>([]);
  const [searchQueries, setSearchQueryMap] = useState<Record<string, string>>({});
  const [externalCandidates, setExternalCandidates] = useState<Record<string, MetadataSearchResult[]>>({});
  const [isSearchingExternal, setIsSearchingExternal] = useState<Record<string, boolean>>({});
  const [successMessage, setSavedMessage] = useState('');

  useEffect(() => {
    void refreshFiles();
  }, []);

  const refreshFiles = async () => {
    const [files, media] = await Promise.all([
      dbService.getUnmatchedLocalFiles(),
      dbService.getAllMedia()
    ]);
    setUnmatchedFiles(files);
    setAllMedia(media);
    window.dispatchEvent(new CustomEvent('library-scanned'));
    if (onMediaMatched) onMediaMatched();
  };

  const handleLinkToMedia = async (fileId: string, mediaId: string) => {
    await dbService.linkLocalFileToMedia(fileId, mediaId);
    setSavedMessage('Local file successfully linked to media entry.');
    setTimeout(() => setSavedMessage(''), 3000);
    await refreshFiles();
  };

  const handleSearchExternalProviders = async (file: LocalFile) => {
    const mediaType: MediaType =
      file.file_type === 'game_executable' ? 'VideoGame' : file.file_type === 'tv_episode' ? 'TV Series' : 'Film';

    const parsed = localScannerService.parseFilePath(file.path, mediaType);
    const query = searchQueries[file.id] || parsed.cleanTitle || file.filename;

    if (!query) return;

    setIsSearchingExternal(prev => ({ ...prev, [file.id]: true }));

    try {
      let results: MetadataSearchResult[] = [];
      if (mediaType === 'VideoGame') {
        results = await igdbProvider.searchMedia(query, 'VideoGame');
      } else {
        results = await tmdbProvider.searchMedia(query, mediaType);
      }
      setExternalCandidates(prev => ({ ...prev, [file.id]: results }));
    } catch (err) {
      console.error('Failed to search external provider:', err);
    } finally {
      setIsSearchingExternal(prev => ({ ...prev, [file.id]: false }));
    }
  };

  const handleConfirmExternalCandidate = async (file: LocalFile, candidate: MetadataSearchResult) => {
    if (candidate.external_id) {
      const existingMedia = await dbService.getMediaByExternalId(candidate.provider, candidate.external_id);
      if (existingMedia) {
        await dbService.linkLocalFileToMedia(file.id, existingMedia.id);
        setSavedMessage(`Linked local file to existing canonical entry "${existingMedia.title}"!`);
        setTimeout(() => setSavedMessage(''), 3000);
        await refreshFiles();
        return;
      }
    }

    const now = new Date().toISOString();
    const mediaType: MediaType = candidate.type;

    let details: Partial<Media> = {};
    try {
      if (mediaType === 'VideoGame') {
        details = await igdbProvider.getMediaDetails(candidate.external_id);
      } else {
        details = await tmdbProvider.getMediaDetails(candidate.external_id);
      }
    } catch (err) {
      console.error('Failed to fetch candidate details:', err);
    }

    const newMediaId = `media_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const newMedia: Media = {
      id: newMediaId,
      type: mediaType,
      title: details.title || candidate.title,
      original_title: details.original_title || candidate.original_title,
      release_year: details.release_year || candidate.release_year,
      description: details.description || candidate.description,
      genres: details.genres || [],
      runtime: details.runtime,
      poster: details.poster || candidate.poster,
      backdrop: details.backdrop || candidate.backdrop,
      logo: details.logo,
      publisher: details.publisher,
      developer: details.developer,
      cast: details.cast,
      seasons: details.seasons,
      metadata_source: details.metadata_source || candidate.provider,
      metadata_refreshed_at: now,
      created_at: now,
      updated_at: now,
      external_ids: [
        {
          id: `ext_${Date.now()}`,
          media_id: newMediaId,
          provider: candidate.provider,
          external_id: candidate.external_id
        }
      ]
    };

    await dbService.saveMedia(newMedia);
    await dbService.linkLocalFileToMedia(file.id, newMedia.id);

    setSavedMessage(`Matched "${newMedia.title}" with external metadata from ${candidate.provider}!`);
    setTimeout(() => setSavedMessage(''), 3000);
    await refreshFiles();
  };

  const handleCreateNewMedia = async (file: LocalFile) => {
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

    await dbService.saveMedia(newMedia);
    await dbService.linkLocalFileToMedia(file.id, newMedia.id);

    setSavedMessage(`Created new ${mediaType} record "${newMedia.title}" and linked file.`);
    setTimeout(() => setSavedMessage(''), 3000);
    await refreshFiles();
  };

  const getTypeIcon = (type: MediaType) => {
    switch (type) {
      case 'Film':
        return <Film className="w-3.5 h-3.5 text-rose-400" />;
      case 'TV Series':
        return <Tv className="w-3.5 h-3.5 text-sky-400" />;
      case 'VideoGame':
        return <Gamepad2 className="w-3.5 h-3.5 text-purple-400" />;
    }
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
            Review ambiguous local files, search external metadata providers (TMDB / IGDB), and confirm candidate matches
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
        <div className="space-y-6">
          {unmatchedFiles.map(file => {
            const mediaType: MediaType =
              file.file_type === 'game_executable' ? 'VideoGame' : file.file_type === 'tv_episode' ? 'TV Series' : 'Film';

            const parsed = localScannerService.parseFilePath(file.path, mediaType);

            // Candidate proposals from existing media
            const proposedMatch = localScannerService.findHighConfidenceMatch(
              parsed,
              mediaType,
              allMedia
            );

            const searchQuery = searchQueries[file.id] !== undefined ? searchQueries[file.id] : parsed.cleanTitle;
            const candidates = externalCandidates[file.id] || [];
            const isSearching = isSearchingExternal[file.id] || false;

            const filteredMedia = searchQuery.trim()
              ? allMedia.filter(m => m.title.toLowerCase().includes(searchQuery.toLowerCase()))
              : allMedia.slice(0, 4);

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
                      <span className="bg-[#1e212d] text-gray-300 text-xs font-semibold px-2 py-0.5 rounded flex items-center space-x-1">
                        {getTypeIcon(mediaType)}
                        <span className="uppercase">{file.file_type}</span>
                      </span>
                    </div>

                    <h3 className="font-bold text-base text-white font-mono truncate" title={file.filename}>
                      {file.filename}
                    </h3>
                    <p className="text-xs text-gray-400 font-mono flex items-center space-x-1">
                      <Folder className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      <span className="truncate">{file.path}</span>
                    </p>
                  </div>

                  <button
                    onClick={() => handleCreateNewMedia(file)}
                    className="flex items-center space-x-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs px-4 py-2 rounded-xl shadow-md transition-all shrink-0 self-start md:self-center cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create Basic Entry</span>
                  </button>
                </div>

                {/* Candidate Proposal from Local Library */}
                {proposedMatch && (
                  <div className="bg-[#102219] border border-emerald-500/30 p-3.5 rounded-xl flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-3">
                      <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
                      <div>
                        <span className="font-bold text-emerald-300">Suggested Existing Candidate: </span>
                        <span className="font-semibold text-white">{proposedMatch.title}</span>
                        {proposedMatch.release_year && (
                          <span className="text-gray-400 ml-1">({proposedMatch.release_year})</span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => handleLinkToMedia(file.id, proposedMatch.id)}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg shadow-sm cursor-pointer"
                    >
                      Confirm Match
                    </button>
                  </div>
                )}

                {/* External Metadata Provider Search */}
                <div className="space-y-3 pt-1 bg-[#1a1d29] p-4 rounded-xl border border-[#2d3145]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white font-bold flex items-center space-x-1.5">
                      <Globe className="w-4 h-4 text-rose-400" />
                      <span>External Metadata Search ({mediaType === 'VideoGame' ? 'IGDB / RAWG' : 'TMDB'})</span>
                    </span>
                  </div>

                  <div className="flex items-center space-x-2">
                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search candidate title on TMDB / IGDB..."
                        value={searchQuery}
                        onChange={e =>
                          setSearchQueryMap({ ...searchQueries, [file.id]: e.target.value })
                        }
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleSearchExternalProviders(file);
                        }}
                        className="w-full bg-[#13151f] border border-[#2d3145] rounded-lg pl-9 pr-3 py-2 text-xs text-gray-100"
                      />
                    </div>

                    <button
                      onClick={() => handleSearchExternalProviders(file)}
                      disabled={isSearching}
                      className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-semibold text-xs px-4 py-2 rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer shrink-0"
                    >
                      {isSearching ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Searching...</span>
                        </>
                      ) : (
                        <>
                          <Search className="w-3.5 h-3.5" />
                          <span>Search External</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* External Search Results Grid */}
                  {candidates.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-[#2a2e42]">
                      <span className="text-[11px] text-gray-400 font-bold uppercase tracking-wider block">
                        External Candidate Matches ({candidates.length})
                      </span>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {candidates.map((cand, idx) => (
                          <div
                            key={`${cand.external_id}_${idx}`}
                            className="bg-[#13151f] p-3 rounded-xl border border-[#2f3448] flex flex-col justify-between space-y-2 hover:border-rose-500/50 transition-all"
                          >
                            <div className="flex space-x-3">
                              {cand.poster ? (
                                <img
                                  src={cand.poster}
                                  alt={cand.title}
                                  className="w-14 aspect-[2/3] object-cover rounded-lg shrink-0 border border-[#2f3448]"
                                />
                              ) : (
                                <div className="w-14 aspect-[2/3] bg-[#1e212d] rounded-lg shrink-0 flex items-center justify-center border border-[#2f3448]">
                                  {getTypeIcon(cand.type)}
                                </div>
                              )}

                              <div className="space-y-1 min-w-0 flex-1">
                                <h4 className="font-bold text-xs text-white truncate" title={cand.title}>
                                  {cand.title}
                                </h4>
                                <div className="flex items-center space-x-1 text-[10px]">
                                  <span className="bg-rose-950/80 text-rose-300 border border-rose-500/30 px-1.5 py-0.2 rounded font-semibold">
                                    {cand.provider}
                                  </span>
                                  {cand.release_year && (
                                    <span className="text-gray-400">({cand.release_year})</span>
                                  )}
                                </div>
                                {cand.description && (
                                  <p className="text-[10px] text-gray-400 line-clamp-2 leading-tight">
                                    {cand.description}
                                  </p>
                                )}
                              </div>
                            </div>

                            <button
                              onClick={() => handleConfirmExternalCandidate(file, cand)}
                              className="w-full bg-emerald-600/90 hover:bg-emerald-500 text-white font-bold text-xs py-1.5 rounded-lg shadow-sm transition-all flex items-center justify-center space-x-1 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Confirm Candidate & Import</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Quick Link Existing Local Library Entry */}
                <div className="space-y-2 pt-1">
                  <span className="text-xs text-gray-400 font-medium block">
                    Or pick an existing entry in local library:
                  </span>

                  <div className="flex flex-wrap gap-2 pt-0.5">
                    {filteredMedia.map(media => (
                      <button
                        key={media.id}
                        onClick={() => handleLinkToMedia(file.id, media.id)}
                        className="bg-[#1e212d] hover:bg-rose-950/60 hover:border-rose-500/50 border border-[#2f3448] text-gray-200 text-xs px-3 py-1.5 rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer"
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
