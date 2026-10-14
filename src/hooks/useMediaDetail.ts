import { useState, useEffect, useCallback } from 'react';
import { Media, LocalFile, MediaHistory, MediaState } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { localLauncherService } from '../services/LocalLauncherService';
import { tmdbProvider } from '../providers/TMDBProvider';
import { igdbProvider } from '../providers/IGDBProvider';
import { artworkCacheProvider } from '../providers/ArtworkCacheProvider';
import { MetadataSearchResult } from '../providers/interfaces';

export function useMediaDetail(initialMedia: Media) {
  const [currentMedia, setCurrentMedia] = useState<Media>(initialMedia);
  const [historyList, setHistoryList] = useState<MediaHistory[]>(() =>
    dbService.getHistoryForMedia(initialMedia.id)
  );
  const [state, setState] = useState<MediaState>(() =>
    dbService.getMediaState(initialMedia.id)
  );
  const [localFiles, setLocalFiles] = useState<LocalFile[]>(() =>
    dbService.getLocalFilesForMedia(initialMedia.id)
  );
  const availabilities = dbService.getAvailabilityForMedia(initialMedia.id);

  // Related media state
  const [relatedMedia, setRelatedMedia] = useState<MetadataSearchResult[]>([]);
  const [isLoadingRelated, setIsLoadingRelated] = useState(false);
  const [addedExternalIds, setAddedExternalIds] = useState<Set<string>>(new Set());

  // Artwork state
  const [artwork, setArtwork] = useState<{ poster?: string; backdrop?: string; logo?: string }>({
    poster: initialMedia.poster,
    backdrop: initialMedia.backdrop,
    logo: initialMedia.logo
  });

  // UI status messages
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState('');
  const [launchMessage, setLaunchMessage] = useState('');

  // Synchronize added external IDs from database
  const refreshAddedExternalIds = useCallback(() => {
    const allMedia = dbService.getAllMedia();
    const set = new Set<string>();
    for (const m of allMedia) {
      if (m.external_ids) {
        for (const ext of m.external_ids) {
          set.add(ext.external_id);
          set.add(`${ext.provider}:${ext.external_id}`);
        }
      }
    }
    setAddedExternalIds(set);
  }, []);

  useEffect(() => {
    refreshAddedExternalIds();
  }, [refreshAddedExternalIds, currentMedia]);

  // Fetch related media asynchronously
  useEffect(() => {
    let isMounted = true;
    setIsLoadingRelated(true);

    const extId = currentMedia.external_ids && currentMedia.external_ids.length > 0
      ? currentMedia.external_ids[0].external_id
      : currentMedia.title;

    const provider = currentMedia.type === 'VideoGame' ? igdbProvider : tmdbProvider;

    if (provider.getRelatedMedia) {
      provider.getRelatedMedia(extId).then(items => {
        if (isMounted) {
          setRelatedMedia(items || []);
          setIsLoadingRelated(false);
        }
      }).catch(err => {
        console.warn('Failed to fetch related media:', err);
        if (isMounted) {
          setRelatedMedia([]);
          setIsLoadingRelated(false);
        }
      });
    } else {
      setIsLoadingRelated(false);
    }

    return () => {
      isMounted = false;
    };
  }, [currentMedia.id, currentMedia.external_ids, currentMedia.type, currentMedia.title]);

  // Resolve artwork
  useEffect(() => {
    let isMounted = true;
    artworkCacheProvider.resolveArtworkForMedia(currentMedia).then(res => {
      if (isMounted) {
        setArtwork({
          poster: res.poster || currentMedia.poster,
          backdrop: res.backdrop || currentMedia.backdrop,
          logo: res.logo || currentMedia.logo
        });
      }
    });
    return () => {
      isMounted = false;
    };
  }, [currentMedia]);

  const handleAddRelatedToLibrary = async (candidate: MetadataSearchResult): Promise<Media> => {
    // Check if external_id already exists in local DB
    if (candidate.external_id) {
      const existing = dbService.getMediaByExternalId(candidate.provider, candidate.external_id);
      if (existing) {
        refreshAddedExternalIds();
        return existing;
      }
    }

    let details: Partial<Media> = {};
    const provider = candidate.type === 'VideoGame' ? igdbProvider : tmdbProvider;
    try {
      details = await provider.getMediaDetails(candidate.external_id);
    } catch (err) {
      console.warn('Failed to fetch full details for related item:', err);
    }

    const now = new Date().toISOString();
    const mediaId = `media_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

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
      metadata_source: details.metadata_source || candidate.provider,
      metadata_refreshed_at: now,
      created_at: now,
      updated_at: now,
      external_ids: candidate.external_id ? [
        {
          id: `ext_${Date.now()}`,
          media_id: mediaId,
          provider: candidate.provider,
          external_id: candidate.external_id
        }
      ] : []
    };

    dbService.saveMedia(newMedia);
    dbService.saveHistory({
      id: `hist_${Date.now()}`,
      media_id: mediaId,
      status: 'Planned',
      source: 'Import',
      created_at: now
    });

    window.dispatchEvent(new CustomEvent('library-scanned'));
    refreshAddedExternalIds();
    return newMedia;
  };

  const updateCurrentMedia = useCallback((newMedia: Media) => {
    setCurrentMedia(newMedia);
    setHistoryList(dbService.getHistoryForMedia(newMedia.id));
    setState(dbService.getMediaState(newMedia.id));
    setLocalFiles(dbService.getLocalFilesForMedia(newMedia.id));
    setArtwork({
      poster: newMedia.poster,
      backdrop: newMedia.backdrop,
      logo: newMedia.logo
    });
  }, []);

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
    const activeLocalFile = localFiles.find(lf => lf.exists) || localFiles[0];
    const targetFile = file || activeLocalFile;
    if (!targetFile) return;

    const res = await localLauncherService.launchFile(targetFile);
    setLaunchMessage(res.message);
    setTimeout(() => setLaunchMessage(''), 4000);
  };

  const logSessionHistory = (params: {
    status: any;
    score: number;
    context?: string;
    thoughts?: string;
  }) => {
    const now = new Date().toISOString();
    dbService.saveHistory({
      id: `hist_manual_${Date.now()}`,
      media_id: currentMedia.id,
      completed_at: now.split('T')[0],
      status: params.status,
      score: params.score,
      context: params.context?.trim() || undefined,
      thoughts: params.thoughts?.trim() || undefined,
      source: 'Manual',
      created_at: now
    });
    refreshHistoryAndState();
  };

  const addCustomFilePath = (customPath: string) => {
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
  };

  return {
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
    addCustomFilePath,
    relatedMedia,
    isLoadingRelated,
    addedExternalIds,
    handleAddRelatedToLibrary,
    updateCurrentMedia
  };
}
