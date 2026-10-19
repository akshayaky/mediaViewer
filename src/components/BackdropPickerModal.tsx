import React, { useState, useEffect, useRef } from 'react';
import { Media } from '../types/media';
import { tmdbProvider } from '../providers/TMDBProvider';
import { igdbProvider } from '../providers/IGDBProvider';
import { artworkCacheProvider } from '../providers/ArtworkCacheProvider';
import { Image as ImageIcon, X, Loader2, CheckCircle2 } from 'lucide-react';
import { dbService } from '../services/DatabaseService';

interface BackdropPickerModalProps {
  media: Media;
  isOpen: boolean;
  onClose: () => void;
  onBackgroundUpdated: (updatedMedia: Media) => void;
}

export const BackdropPickerModal: React.FC<BackdropPickerModalProps> = ({
  media,
  isOpen,
  onClose,
  onBackgroundUpdated
}) => {
  const [backdrops, setBackdrops] = useState<string[]>([]);
  const [selectedBackdrop, setSelectedBackdrop] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);


  const initialBackdropRef = useRef<string | null>(media.backdrop || null);
  
  useEffect(() => {
    if (media.backdrop) {
      setSelectedBackdrop(media.backdrop);
    }
  }, [media.backdrop]);

  useEffect(() => {
    if (!isOpen) return;

    const fetchBackdrops = async () => {
      setIsLoading(true);
      try {
        // We assume TMDB is the provider for backdrops as it has the best images API
        // Find the TMDB external ID
        const tmdbExtId = media.external_ids?.find(ext => ext.provider === 'TMDB')?.external_id;
        const igdbExtId = media.external_ids?.find(ext => ext.provider === 'IGDB')?.external_id;
        
        let results: string[] = [];
        if (tmdbExtId) {
          const tmdbResults = await tmdbProvider.getBackdrops(tmdbExtId);
          results = [...results, ...tmdbResults];
        }
        if (igdbExtId) {
          const igdbResults = await igdbProvider.getBackdrops(igdbExtId);
          results = [...results, ...igdbResults];
        }
        
        setBackdrops(results);
      } catch (err) {
        console.error('Failed to fetch backdrops for picker:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBackdrops();
  }, [isOpen]);

  const handleApply = async (overrideUrl?: string, shouldClose: boolean = false) => {
    const finalUrl = overrideUrl || selectedBackdrop;
    if (!finalUrl) return;
    console.warn(overrideUrl);
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const updatedMedia: Media = {
        ...media,
        backdrop: finalUrl,
        updated_at: now,
      };

      // Update cache so it's immediate
      artworkCacheProvider.setCachedArtwork(
        media.id,
        { backdrop: finalUrl }
      );

      onBackgroundUpdated(updatedMedia);
      if (shouldClose) {
        dbService.updateMediaArtwork(media.id, {poster: media.poster, backdrop: finalUrl,logo: media.logo});
        onClose();
      }
    } catch (err) {
      console.error('Failed to apply selected backdrop:', err);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#14161f] border border-[#2d3145] rounded-2xl w-full max-w-4xl flex flex-col max-h-[90vh] shadow-2xl overflow-hidden animate-fadeIn">
        <div className="p-5 border-b border-[#232736] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <ImageIcon className="w-5 h-5 text-sky-400" />
            <div>
              <h2 className="text-lg font-bold text-white">Select Background</h2>
              <p className="text-xs text-gray-400">Choose from available backdrops for {media.title}</p>
            </div>
          </div>
          <button onClick={() =>{
              handleApply(undefined,true);
              //onClose();
            }
          }
             className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-[#1f222e] transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
              <p className="text-gray-400 text-sm">Fetching official backdrops...</p>
            </div>
          ) : backdrops.length === 0 ? (
            <div className="text-center py-20">
              <ImageIcon className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <p className="text-gray-400">No additional backdrops found for this title.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {backdrops.map((url, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    //setSelectedBackdrop(url);
                    handleApply(url, false);
                  }}
                  className={`group relative aspect-video rounded-xl overflow-hidden cursor-pointer transition-all border-4 ${
                    selectedBackdrop === url ? 'border-sky-500 scale-95 shadow-lg' : 'border-transparent hover:border-gray-600'
                  }`}
                >
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  {selectedBackdrop === url && (
                    <div className="absolute top-2 right-2 bg-sky-500 text-white rounded-full p-1 shadow-md">
                      <CheckCircle2 className="w-3 h-3" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[#232736] flex items-center justify-end space-x-3 bg-[#11131c]">
          <button onClick={() => {
              handleApply(initialBackdropRef.current!!, false);
              onClose();
            }
          } className="px-4 py-2 rounded-xl border border-[#2d3145] text-gray-300 hover:bg-[#1a1c29] text-xs font-semibold transition-colors cursor-pointer">
            Cancel
          </button>
          <button
            onClick={() => handleApply(undefined, true)}
            disabled={!selectedBackdrop || isSaving}
            className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-md cursor-pointer flex items-center space-x-1.5"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            <span>Apply Background</span>
          </button>
        </div>
      </div>
    </div>
  );
};
