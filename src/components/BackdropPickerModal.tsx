import React, { useState, useEffect, useRef } from 'react';
import { Media } from '../types/media';
import { tmdbProvider } from '../providers/TMDBProvider';
import { igdbProvider } from '../providers/IGDBProvider';
import { artworkCacheProvider } from '../providers/ArtworkCacheProvider';
import { Image as ImageIcon, X, Loader2, CheckCircle2 } from 'lucide-react';
import { dbService } from '../services/DatabaseService';
import { useSidebarPadding } from '../hooks/useSidebarPadding';
import { searchMediaMetadata } from '../services/MediaSearchService';

interface BackdropPickerModalProps {
  media: Media;
  isOpen: boolean;
  onClose: () => void;
  onBackgroundUpdated: (updatedMedia: Media) => void;
  isCollapsed: boolean;
}

type QualityLevel = 'veryHigh'| 'high' | 'med' | 'low';

const QUALITY_MAP = {
  "veryHigh": 2160,
  "high": 1080,//['3840x2160', '2560x1440', '1920x1080'],
  "med": 720,//['1280x720', '1024x768'],
  "low": 0//['854x480', '640x360']
};

export const BackdropPickerModal: React.FC<BackdropPickerModalProps> = ({
  media,
  isOpen,
  onClose,
  onBackgroundUpdated,
  isCollapsed
}) => {
  const [backdrops, setBackdrops] = useState<{ url: string; thumbnailUrl: string; width: number; height: number }[]>([]);
  const [resolvedExternalIds, setResolvedExternalIds] = useState(media.external_ids || []);
  const [selectedBackdrop, setSelectedBackdrop] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [quality, setQuality] = useState<QualityLevel>('veryHigh'); // default to high
  const { isDesktop, pagePadding} = useSidebarPadding(isCollapsed);
  const bottomPaddingForMobile = `5rem`;

  const initialBackdropRef = useRef<string | null>(media.backdrop || null);
  

  const qualityCounts = React.useMemo(() => {
    const counts = { veryHigh: 0, high: 0, med: 0, low: 0 };

    backdrops.forEach((backdrop) => {
      const height = Number(backdrop.height);
      if (height >= QUALITY_MAP.veryHigh) counts.veryHigh++;
      else if (height >= QUALITY_MAP.high) counts.high++;
      else if (height >= QUALITY_MAP.med) counts.med++;
      else counts.low++;
    });

    return counts;
  }, [backdrops]);

  React.useEffect(() => {
    // If the current quality has no items, or if it's the first load,
    // automatically find the highest tier that actually has backdrops
    if (qualityCounts[quality] === 0 || !quality) {
      if (qualityCounts.veryHigh > 0) setQuality('veryHigh');
      else if (qualityCounts.high > 0) setQuality('high');
      else if (qualityCounts.med > 0) setQuality('med');
      else if (qualityCounts.low > 0) setQuality('low');
    }
  }, [qualityCounts, quality]);

  useEffect(() => {
    if (media.backdrop) {
      setSelectedBackdrop(media.backdrop);
    }
  }, [media.backdrop]);

  useEffect(() => {
    setResolvedExternalIds(media.external_ids || []);
  }, [media.external_ids, media.id]);

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

  useEffect(() => {
    if (!isOpen) return;

    const findAndLinkProviderMatch = async (
      providerName: 'TMDB' | 'IGDB'
    ): Promise<string | undefined> => {
      try {
        const candidates = await searchMediaMetadata(media.title, media.type);
        const normalizedTitle = media.title.trim().toLocaleLowerCase();
        const providerMatches = Array.from(new Map(
          candidates
            .filter(candidate => candidate.provider === providerName)
            .map(candidate => [candidate.external_id, candidate])
        ).values());
        const match = providerMatches.find(candidate =>
          [candidate.title, candidate.original_title]
            .some(title => title?.trim().toLocaleLowerCase() === normalizedTitle)
        ) || providerMatches[0];
        if (!match) return undefined;

        const existingMedia = await dbService.getMediaByExternalId(providerName, match.external_id);
        if (!existingMedia || existingMedia.id === media.id) {
          const externalId = {
            id: `ext_${providerName.toLowerCase()}_${media.id}`,
            media_id: media.id,
            provider: providerName,
            external_id: match.external_id
          };
          await dbService.saveExternalId(externalId);
          setResolvedExternalIds(current => (
            current.some(ext => ext.provider === providerName && ext.external_id === match.external_id)
              ? current
              : [...current, externalId]
          ));
        }
        return match.external_id;
      } catch (err) {
        console.error(`Failed to find ${providerName} match for backdrop picker:`, err);
        return undefined;
      }
    };

    const fetchBackdrops = async () => {
      setIsLoading(true);
      try {
        const storedExternalIds = await dbService.getExternalIdsForMedia(media.id);
        const externalIds = [...storedExternalIds, ...(media.external_ids || [])];
        let tmdbExtId = externalIds.find(ext => ext.provider === 'TMDB')?.external_id;
        let igdbExtId = externalIds.find(ext => ext.provider === 'IGDB')?.external_id;

        if (!tmdbExtId && media.type !== 'VideoGame') {
          tmdbExtId = await findAndLinkProviderMatch('TMDB');
        }
        if (!igdbExtId && media.type === 'VideoGame') {
          igdbExtId = await findAndLinkProviderMatch('IGDB');
        }

        const [tmdbResults, igdbResults] = await Promise.all([
          tmdbExtId ? tmdbProvider.getBackdrops(tmdbExtId) : Promise.resolve([]),
          igdbExtId ? igdbProvider.getBackdrops(igdbExtId) : Promise.resolve([])
        ]);
        const results = [...tmdbResults, ...igdbResults];
        setBackdrops(results);
      } catch (err) {
        console.error('Failed to fetch backdrops for picker:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBackdrops();
  }, [isOpen, media.external_ids, media.id, media.title, media.type]);

  const handleApply = async (overrideUrl?: string, shouldClose: boolean = false) => {
    const finalUrl = overrideUrl || selectedBackdrop;
    if (!finalUrl) return;
    console.warn(overrideUrl);
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const updatedMedia: Media = {
        ...media,
        external_ids: resolvedExternalIds,
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
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      style={{ 
        paddingLeft: pagePadding,
        paddingBottom: isDesktop? undefined: bottomPaddingForMobile
        }}>
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
            if(selectedBackdrop)
              handleApply(undefined,true);
            else
              onClose();
            }
          }
             className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-[#1f222e] transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
        {/* 2. Add the Quality Dropdown UI */}
        {!isLoading && backdrops.length > 0 && (
          <div className="flex items-center justify-end mb-4 space-x-2">
            <label htmlFor="quality-select" className="text-sm text-gray-400">
              Quality:
            </label>
            <select
              id="quality-select"
              value={quality}
              onChange={(e) => setQuality(e.target.value as QualityLevel)}
              className="bg-gray-800 text-white border border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-sky-500 cursor-pointer"
            >
              { qualityCounts.veryHigh > 0 && (
              <option value="veryHigh">Highest ({qualityCounts.veryHigh})</option>)}
              { qualityCounts.high > 0 && (
              <option value="high">High({qualityCounts.high})</option>)}
              { qualityCounts.med> 0 && (
              <option value="med">Medium({qualityCounts.med})</option>)}
              { qualityCounts.low > 0 && (
              <option value="low">Low({qualityCounts.low})</option>)}
            </select>
          </div>
        )}

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
            {backdrops
            .filter((backdrop) => 
              {
                const height = Number(backdrop.height)
                if (quality === 'veryHigh') {
                  return height >= QUALITY_MAP.veryHigh;
                }
                if (quality === 'high') {
                  return height >= QUALITY_MAP.high && height < QUALITY_MAP.veryHigh;
                }
                if (quality === 'med') {
                  return height >= QUALITY_MAP.med && height < QUALITY_MAP.high;
                }
                if (quality === 'low') {
                  return height < QUALITY_MAP.med;
                }
                return false;

            })

            .map((backdrop, idx) => (
              <div
                key={idx}
                onClick={() => {
                  // 3. Pass the current quality state to your handler
                  handleApply(backdrop.url, false);
                }}
                className={`group relative aspect-video rounded-xl overflow-hidden cursor-pointer transition-all border-4 ${
                  selectedBackdrop === backdrop.url ? 'border-sky-500 scale-95 shadow-lg' : 'border-transparent hover:border-gray-600'
                }`}
              >
                <img
                  src={backdrop.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                />
                {selectedBackdrop === backdrop.url && (
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
