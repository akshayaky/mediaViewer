import React, { useState, useEffect } from 'react';
import { Media } from '../types/media';
import { MetadataSearchResult } from '../providers/interfaces';
import { tmdbProvider } from '../providers/TMDBProvider';
import { igdbProvider } from '../providers/IGDBProvider';
import { dbService } from '../services/DatabaseService';
import { artworkCacheProvider } from '../providers/ArtworkCacheProvider';
import { Search, Loader2, X, RefreshCw, CheckCircle2, Film, Tv, Gamepad2 } from 'lucide-react';

interface FixMatchModalProps {
  media: Media;
  isOpen: boolean;
  onClose: () => void;
  onMatchedUpdated: (updatedMedia: Media) => void;
  onRequestMerge?: (mediaA: Media, mediaB: Media) => void;
}

export const FixMatchModal: React.FC<FixMatchModalProps> = ({
  media,
  isOpen,
  onClose,
  onMatchedUpdated,
  onRequestMerge
}) => {
  const [query, setQuery] = useState(media.title);
  const [results, setResults] = useState<MetadataSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedResult, setSelectedResult] = useState<MetadataSearchResult | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewDetails, setPreviewDetails] = useState<Partial<Media> | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      window.history.pushState({ isModalOpen: true }, '');
    }
  }, [isOpen]);

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

  if (!isOpen) return null;

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    setResults([]);
    setSelectedResult(null);
    setPreviewDetails(null);

    try {
      let searchResults: MetadataSearchResult[] = [];
      if (media.type === 'VideoGame') {
        searchResults = await igdbProvider.searchMedia(query, 'VideoGame');
      } else {
        searchResults = await tmdbProvider.searchMedia(query, media.type);
      }
      setResults(searchResults);
    } catch (err) {
      console.error('Failed to search external provider for match correction:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectCandidate = async (candidate: MetadataSearchResult) => {
    setSelectedResult(candidate);
    setIsPreviewing(true);

    try {
      let details: Partial<Media> = {};
      if (candidate.type === 'VideoGame') {
        details = await igdbProvider.getMediaDetails(candidate.external_id);
      } else {
        details = await tmdbProvider.getMediaDetails(candidate.external_id);
      }
      setPreviewDetails(details);
    } catch (err) {
      console.error('Failed to preview candidate details:', err);
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleConfirmReassignment = async () => {
    if (!selectedResult) return;

    setIsSaving(true);
    try {
      // 1. Check if external_id is already linked to ANOTHER entity in local library
      const existingLinkedMedia = await dbService.getMediaByExternalId(
        selectedResult.provider,
        selectedResult.external_id
      );

      if (existingLinkedMedia && existingLinkedMedia.id !== media.id) {
        setIsSaving(false);
        onClose();
        if (onRequestMerge) {
          onRequestMerge(media, existingLinkedMedia);
        }
        return;
      }

      // 2. Otherwise update current entity's metadata association
      const details = previewDetails || {};
      const now = new Date().toISOString();

      const updatedMedia: Media = {
        ...media,
        title: details.title || selectedResult.title,
        original_title: details.original_title || selectedResult.original_title,
        release_year: details.release_year || selectedResult.release_year,
        description: details.description || selectedResult.description,
        genres: details.genres || media.genres || [],
        runtime: details.runtime || media.runtime,
        poster: details.poster || selectedResult.poster || media.poster,
        backdrop: details.backdrop || selectedResult.backdrop || media.backdrop,
        logo: details.logo || media.logo,
        publisher: details.publisher || media.publisher,
        developer: details.developer || media.developer,
        cast: details.cast || media.cast,
        seasons: details.seasons || media.seasons,
        metadata_source: details.metadata_source || selectedResult.provider,
        metadata_refreshed_at: now,
        updated_at: now,
        manually_matched: true,
        external_ids: [
          {
            id: `ext_${Date.now()}`,
            media_id: media.id,
            provider: selectedResult.provider,
            external_id: selectedResult.external_id
          }
        ]
      };

      await dbService.saveMedia(updatedMedia);

      if (updatedMedia.poster || updatedMedia.backdrop || updatedMedia.logo) {
        artworkCacheProvider.setCachedArtwork(
          media.id,
          {
            poster: updatedMedia.poster,
            backdrop: updatedMedia.backdrop,
            logo: updatedMedia.logo
          },
          'metadata_provider'
        );
      }

      window.dispatchEvent(new CustomEvent('library-scanned'));
      onMatchedUpdated(updatedMedia);
      onClose();
    } catch (err) {
      console.error('Failed to confirm match reassignment:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const getTypeIcon = () => {
    switch (media.type) {
      case 'Film':
        return <Film className="w-5 h-5 text-rose-400" />;
      case 'TV Series':
        return <Tv className="w-5 h-5 text-sky-400" />;
      default:
        return <Gamepad2 className="w-5 h-5 text-purple-400" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#14161f] border border-[#2d3145] rounded-2xl w-full max-w-3xl flex flex-col max-h-[85vh] shadow-2xl overflow-hidden animate-fadeIn">
        {/* Header */}
        <div className="p-5 border-b border-[#232736] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {getTypeIcon()}
            <div>
              <h2 className="text-lg font-bold text-white">Fix Match / Reassign Metadata</h2>
              <p className="text-xs text-gray-400">Correct metadata association for "{media.title}"</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-[#1f222e] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
          {/* Search bar */}
          <form onSubmit={handleSearch} className="flex space-x-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder={`Search correct ${media.type === 'VideoGame' ? 'game' : media.type === 'Film' ? 'movie' : 'TV series'}...`}
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-rose-500"
              />
            </div>

            <button
              type="submit"
              disabled={isSearching || !query.trim()}
              className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-semibold text-xs px-5 py-2.5 rounded-xl transition-all flex items-center space-x-2 cursor-pointer shrink-0"
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

          {/* Results list */}
          {results.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Search Candidates</h4>
              <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto pr-1">
                {results.map((res, idx) => {
                  const isSelected = selectedResult?.external_id === res.external_id;

                  return (
                    <div
                      key={`${res.external_id}_${idx}`}
                      onClick={() => handleSelectCandidate(res)}
                      className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-rose-950/40 border-rose-500'
                          : 'bg-[#1b1d2a] border-[#2d3145] hover:border-gray-500'
                      }`}
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        {res.poster ? (
                          <img src={res.poster} alt={res.title} className="w-10 aspect-[2/3] object-cover rounded border border-[#2d3145] shrink-0" />
                        ) : (
                          <div className="w-10 aspect-[2/3] bg-[#232736] rounded shrink-0 flex items-center justify-center">
                            {getTypeIcon()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <h5 className="font-bold text-xs text-white truncate">{res.title}</h5>
                          <p className="text-[11px] text-gray-400">{res.release_year ? `Year: ${res.release_year}` : ''} • {res.provider}</p>
                        </div>
                      </div>

                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                        isSelected ? 'bg-rose-500 border-rose-400 text-white' : 'border-gray-500'
                      }`}>
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Preview selected candidate */}
          {selectedResult && (
            <div className="bg-[#1b1d2a] border border-[#2d3145] p-4 rounded-xl space-y-3">
              <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wider flex items-center space-x-2">
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Selected Candidate Metadata Preview</span>
              </h4>

              {isPreviewing ? (
                <div className="flex items-center space-x-2 text-xs text-gray-400 py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-rose-400" />
                  <span>Loading full metadata preview...</span>
                </div>
              ) : (
                <div className="flex space-x-4">
                  {(previewDetails?.poster || selectedResult.poster) && (
                    <img
                      src={previewDetails?.poster || selectedResult.poster}
                      alt={selectedResult.title}
                      className="w-20 aspect-[2/3] object-cover rounded-lg border border-[#2d3145] shrink-0"
                    />
                  )}

                  <div className="space-y-1 text-xs text-gray-300 flex-1">
                    <h3 className="font-bold text-white text-base">{previewDetails?.title || selectedResult.title}</h3>
                    {(previewDetails?.release_year || selectedResult.release_year) && (
                      <p className="text-rose-300">Release Year: {previewDetails?.release_year || selectedResult.release_year}</p>
                    )}
                    {previewDetails?.genres && previewDetails.genres.length > 0 && (
                      <p className="text-gray-400">Genres: {previewDetails.genres.join(', ')}</p>
                    )}
                    <p className="text-gray-400 line-clamp-2 mt-1 italic">
                      {previewDetails?.description || selectedResult.description || 'No summary available.'}
                    </p>
                    <p className="text-[10px] text-gray-500 pt-1">
                      External ID: {selectedResult.provider} ({selectedResult.external_id})
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#232736] flex items-center justify-end space-x-3 bg-[#11131c]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-[#2d3145] text-gray-300 hover:bg-[#1a1c29] text-xs font-semibold transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmReassignment}
            disabled={!selectedResult || isSaving}
            className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-md cursor-pointer flex items-center space-x-1.5"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving Association...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirm & Reassign Match</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
