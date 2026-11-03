import React, { useState, useEffect } from 'react';
import { Media, MediaType } from '../types/media';
import { MetadataSearchOptions, MetadataSearchResult } from '../providers/interfaces';
import { igdbProvider } from '../providers/IGDBProvider';
import { tmdbProvider } from '../providers/TMDBProvider';
import { searchMediaMetadata, getMetadataSearchKey } from '../services/MediaSearchService';
import { MetadataSearchFilters } from './MetadataSearchFilters';
import { dbService } from '../services/DatabaseService';
import { Search, Loader2, X, Plus, CheckCircle2, Film, Tv, Gamepad2 } from 'lucide-react';
import { useSidebarPadding } from '../hooks/useSidebarPadding';

interface AddMediaModalProps {
  type: MediaType;
  isOpen: boolean;
  onClose: () => void;
  onMediaAdded?: (media: Media) => void;
  isCollapsed?: boolean;
}

export const AddMediaModal: React.FC<AddMediaModalProps> = ({
  type,
  isOpen,
  onClose,
  onMediaAdded,
  isCollapsed
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<Record<MediaType, MetadataSearchResult[]>>({} as Record<MediaType, MetadataSearchResult[]>);
  const [isSearching, setIsSearching] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  const [lastSearchedKey, setLastSearchedKey] = useState('');
  const [searchOptions, setSearchOptions] = useState<MetadataSearchOptions>({});
  // const [mediaType, setMediaType] = useState(type);

  const { pagePadding } = useSidebarPadding(isCollapsed);
  const handleSearch = async (searchQuery: string, options: MetadataSearchOptions = searchOptions) => {
    if (!searchQuery.trim()) return;

    setLastSearchedKey(getMetadataSearchKey(searchQuery, options));
    setIsSearching(true);

    try {
      const searchResults = await searchMediaMetadata(searchQuery, type, options);
      setResults(prev => ({ ...prev, [type]: searchResults }));
    } catch (err) {
      console.error('Failed to search external provider:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (getMetadataSearchKey(searchQuery, searchOptions) !== lastSearchedKey) {
      handleSearch(searchQuery, searchOptions);
    }
  };


  useEffect(() => {
    if (isOpen) {
      window.history.pushState({ isModalOpen: true }, '');
    }
  }, [isOpen]);

  useEffect(() => {
    if (searchQuery.trim() && (!results[type] || results[type].length === 0)) {
      handleSearch(searchQuery, searchOptions);
    }
  }, [type])

  useEffect(() => {
    if (!isOpen) return;
    const handleCloseSheets = (e: CustomEvent) => {
      onClose();
      e.preventDefault();
    };
    window.addEventListener('close-mobile-sheets' as any, handleCloseSheets);
    return () => {
      window.removeEventListener('close-mobile-sheets' as any, handleCloseSheets);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 800);

    return () => {
      clearTimeout(handler);
    };
  }, [searchQuery]);

  useEffect(() => {
    if (!debouncedQuery.trim() || debouncedQuery.trim() !== searchQuery.trim()) return;
    if (getMetadataSearchKey(debouncedQuery, searchOptions) === lastSearchedKey) return;

    const handler = setTimeout(() => {
      setResults({} as Record<MediaType, MetadataSearchResult[]>);
      handleSearch(debouncedQuery, searchOptions);
    }, 400);
    return () => clearTimeout(handler);
  }, [debouncedQuery, searchQuery, searchOptions.releaseYear, searchOptions.language]);

  if (!isOpen) return null;



  const handleImportMedia = async (candidate: MetadataSearchResult) => {
    setImportingId(candidate.external_id);

    try {
      let details: Partial<Media> = {};
      if (candidate.type === 'VideoGame') {
        details = await igdbProvider.getMediaDetails(candidate.external_id);
      } else {
        details = await tmdbProvider.getMediaDetails(candidate.external_id);
      }

      const now = new Date().toISOString();
      const mediaId = `media_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      // Extract language with fallback: details > candidate > undefined
      const newLanguage = details.language || candidate.language || undefined;

      const newMedia: Media = {
        id: mediaId,
        type: candidate.type,
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
        language: newLanguage,
        metadata_source: details.metadata_source || candidate.provider,
        metadata_refreshed_at: now,
        created_at: now,
        updated_at: now,
        external_ids: [
          {
            id: `ext_${Date.now()}`,
            media_id: mediaId,
            provider: candidate.provider,
            external_id: candidate.external_id
          }
        ]
      };

      await dbService.saveMedia(newMedia);
      await dbService.saveHistory({
        id: `hist_${Date.now()}`,
        media_id: mediaId,
        status: 'Planned',
        source: 'Manual',
        created_at: now,
        updated_at: now
      });
      window.dispatchEvent(new CustomEvent('library-scanned'));

      setAddedIds(prev => new Set(prev).add(candidate.external_id));

      if (onMediaAdded) {
        onMediaAdded(newMedia);
      }
    } catch (err) {
      console.error('Failed to import media:', err);
    } finally {
      setImportingId(null);
    }
  };

  const getTypeIcon = () => {
    switch (type) {
      case 'Film':
        return <Film className="w-5 h-5 text-[#E27D12]" />;
      case 'TV Series':
        return <Tv className="w-5 h-5 text-sky-400" />;
      case 'VideoGame':
        return <Gamepad2 className="w-5 h-5 text-purple-400" />;
    }
  };

  const getProviderLabel = () => {
    return type === 'VideoGame' ? 'IGDB / RAWG' : 'TMDB';
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
    style={{ paddingLeft: pagePadding }}>
      <div className="bg-[#14161f] border border-[#2d3145] rounded-2xl w-full max-w-3xl flex flex-col max-h-[85vh] shadow-2xl overflow-hidden animate-fadeIn">
        {/* Modal Header */}
        <div className="p-6 border-b border-[#232736] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {getTypeIcon()}
            <div>
              <h2 className="text-xl font-bold text-white">Add New {type === 'VideoGame' ? 'Game' : type === 'Film' ? 'Movie' : 'TV Show'}</h2>
              <p className="text-xs text-gray-400">Search and import from {getProviderLabel()}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-[#1f222e] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
          {/* Search Form */}
          <form onSubmit={handleSubmit} className="flex space-x-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder={`Search ${type === 'VideoGame' ? 'games' : type === 'Film' ? 'movies' : 'TV series'}...`}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-[#E27D12]"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={isSearching || !searchQuery.trim()}
              className="bg-[#E27D12] hover:bg-[#E27D12] disabled:opacity-50 text-white font-semibold text-xs px-5 py-2.5 rounded-xl transition-all flex items-center space-x-2 cursor-pointer shrink-0"
            >
              {isSearching ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Searching...</span>
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  <span>Search</span>
                </>
              )}
            </button>
          </form>

          <MetadataSearchFilters type={type} options={searchOptions} onChange={setSearchOptions} />

          {/* Results Grid */}
          {results[type] && results[type].length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              {results[type].map((res, idx) => {
                const isAdded = addedIds.has(res.external_id);
                const isImporting = importingId === res.external_id;

                return (
                  <div
                    key={`${res.external_id}_${idx}`}
                    className="bg-[#1b1d2a] border border-[#2d3145] hover:border-[#E27D12]/50 rounded-xl p-3 flex space-x-3 transition-all"
                  >
                    {res.poster ? (
                      <img
                        src={res.poster}
                        alt={res.title}
                        className="w-16 aspect-[2/3] object-cover rounded-lg shrink-0 border border-[#2d3145]"
                      />
                    ) : (
                      <div className="w-16 aspect-[2/3] bg-[#232736] rounded-lg shrink-0 flex items-center justify-center border border-[#2d3145]">
                        {getTypeIcon()}
                      </div>
                    )}

                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-1">
                          <h4 className="font-bold text-sm text-white truncate" title={res.title}>
                            {res.title}
                          </h4>
                          {res.release_year && (
                            <span className="text-xs text-gray-400 shrink-0">({res.release_year})</span>
                          )}
                        </div>

                        <span className="inline-block bg-[#E27D12]/80 text-[#E27D12]-300 border border-[#E27D12]/30 text-[10px] font-bold px-1.5 py-0.2 rounded">
                          {res.provider}
                        </span>

                        {res.description && (
                          <p className="text-xs text-gray-400 line-clamp-2 leading-tight">
                            {res.description}
                          </p>
                        )}
                      </div>

                      <button
                        onClick={() => handleImportMedia(res)}
                        disabled={isAdded || isImporting}
                        className={`w-full text-xs font-bold py-1.5 px-3 rounded-lg flex items-center justify-center space-x-1.5 transition-all mt-2 cursor-pointer ${
                          isAdded
                            ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/40'
                            : 'bg-[#E27D12] hover:bg-[#E27D12] text-white shadow-md'
                        }`}
                      >
                        {isImporting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Importing...</span>
                          </>
                        ) : isAdded ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>In Library</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add to Library</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : searchQuery && !isSearching && (!results[type] || results[type].length === 0) ? (
            <div className="p-8 text-center text-gray-400 bg-[#1b1d2a] rounded-xl border border-[#2d3145]">
              <p className="text-sm font-medium">No results found for "{searchQuery}". Try a different search term.</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
