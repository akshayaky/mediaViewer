import { useState, useEffect, useCallback } from 'react';
import { Media, LocalFile, MediaHistory, MediaState, Availability, PlaybackProgress } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { localLauncherService } from '../services/LocalLauncherService';
import { tmdbProvider } from '../providers/TMDBProvider';
import { igdbProvider } from '../providers/IGDBProvider';
import { artworkCacheProvider } from '../providers/ArtworkCacheProvider';
import { MetadataSearchResult } from '../providers/interfaces';
import { searchMediaMetadata } from '../services/MediaSearchService';

export function useMediaDetail(initialMedia: Media) {
  const [currentMedia, setCurrentMedia] = useState<Media>(initialMedia);
  const [historyList, setHistoryList] = useState<MediaHistory[]>([]);
  const [state, setState] = useState<MediaState>({
    media_id: initialMedia.id,
    current_status: 'Planned',
    total_watch_play_count: 0,
    rewatch_count: 0,
    abandoned_count: 0,
    currently_watching_playing: false
  });
  const [localFiles, setLocalFiles] = useState<LocalFile[]>([]);
  const [availabilities, setAvailabilities] = useState<Availability[]>([]);
  const [allProgress, setAllProgress] = useState<PlaybackProgress[]>([]);

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
  const refreshAddedExternalIds = useCallback(async () => {
    const allMedia = await dbService.getAllMedia();
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
    void refreshAddedExternalIds();
  }, [refreshAddedExternalIds, currentMedia]);

  useEffect(() => {
    let isMounted = true;
    Promise.all([
      dbService.getHistoryForMedia(currentMedia.id),
      dbService.getMediaState(currentMedia.id),
      dbService.getLocalFilesForMedia(currentMedia.id),
      dbService.getAvailabilityForMedia(currentMedia.id),
      dbService.getAllPlaybackProgressForMedia(currentMedia.id)
    ]).then(([history, mediaState, files, availability, progress]) => {
      if (!isMounted) return;
      setHistoryList(history);
      setState(mediaState);
      setLocalFiles(files);
      setAvailabilities(availability);
      setAllProgress(progress);
    }).catch(err => console.error('Failed to load media details:', err));
    return () => {
      isMounted = false;
    };
  }, [currentMedia.id]);

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
      const existing = await dbService.getMediaByExternalId(candidate.provider, candidate.external_id);
      if (existing) {
        await refreshAddedExternalIds();
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

    await dbService.saveMedia(newMedia);
    await dbService.saveHistory({
      id: `hist_${Date.now()}`,
      media_id: mediaId,
      status: 'Planned',
      source: 'Import',
      created_at: now
    });

    window.dispatchEvent(new CustomEvent('library-scanned'));
    await refreshAddedExternalIds();
    return newMedia;
  };

  const updateCurrentMedia = useCallback(async (newMedia: Media) => {
    setCurrentMedia(newMedia);
    const [history, mediaState, files, availability] = await Promise.all([
      dbService.getHistoryForMedia(newMedia.id),
      dbService.getMediaState(newMedia.id),
      dbService.getLocalFilesForMedia(newMedia.id),
      dbService.getAvailabilityForMedia(newMedia.id)
    ]);
    setHistoryList(history);
    setState(mediaState);
    setLocalFiles(files);
    setAvailabilities(availability);
    setArtwork({
      poster: newMedia.poster,
      backdrop: newMedia.backdrop,
      logo: newMedia.logo
    });
  }, []);

  const refreshLocalFiles = async () => {
    setLocalFiles(await dbService.getLocalFilesForMedia(currentMedia.id));
    setAllProgress(await dbService.getAllPlaybackProgressForMedia(currentMedia.id));
  };

  const refreshHistoryAndState = useCallback(async () => {
    const [history, mediaState] = await Promise.all([
      dbService.getHistoryForMedia(currentMedia.id),
      dbService.getMediaState(currentMedia.id)
    ]);
    setHistoryList(history);
    setState(mediaState);
  }, [currentMedia.id]);

  const handleManualMetadataRefresh = async () => {
    setIsRefreshingMetadata(true);
    setRefreshMessage('');

    try {
      let extId = currentMedia.external_ids?.find(ext =>
        currentMedia.type === 'VideoGame'
          ? ext.provider === 'IGDB' || ext.provider === 'RAWG'
          : ext.provider === 'TMDB'
      )?.external_id;
      let matchedProviderResult: MetadataSearchResult | undefined;

      let freshDetails: Partial<Media> = {};

      if (currentMedia.type === 'VideoGame') {
        if (!extId || (!extId.startsWith('igdb:') && !extId.startsWith('rawg:'))) {
          const searchRes = await searchMediaMetadata(currentMedia.title, 'VideoGame');
          if (searchRes.length > 0) {
            matchedProviderResult = searchRes[0];
            extId = matchedProviderResult.external_id;
          }
        }
        if (extId) {
          freshDetails = await igdbProvider.getMediaDetails(extId);
        } else {
          freshDetails = await igdbProvider.getMediaDetails(currentMedia.title);
        }
      } else {
        if (!extId || (!extId.startsWith('movie:') && !extId.startsWith('tv:'))) {
          const searchRes = await searchMediaMetadata(currentMedia.title, currentMedia.type);
          if (searchRes.length > 0) {
            matchedProviderResult = searchRes[0];
            extId = matchedProviderResult.external_id;
          }
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
      const externalIds = [...(currentMedia.external_ids || [])];
      if (
        matchedProviderResult
        && !externalIds.some(ext =>
          ext.provider === matchedProviderResult?.provider
          && ext.external_id === matchedProviderResult.external_id
        )
      ) {
        const alreadyLinkedMedia = await dbService.getMediaByExternalId(
          matchedProviderResult.provider,
          matchedProviderResult.external_id
        );
        if (!alreadyLinkedMedia || alreadyLinkedMedia.id === currentMedia.id) {
          externalIds.push({
            id: `ext_${matchedProviderResult.provider.toLowerCase()}_${currentMedia.id}`,
            media_id: currentMedia.id,
            provider: matchedProviderResult.provider,
            external_id: matchedProviderResult.external_id
          });
        }
      }

      const updatedMedia: Media = {
        ...currentMedia,
        ...freshDetails,
        id: currentMedia.id,
        external_ids: externalIds,
        metadata_refreshed_at: now,
        updated_at: now
      };

      await dbService.saveMedia(updatedMedia);
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

  const logSessionHistory = async (params: {
    status: MediaHistory['status'];
    score?: number;
    context?: string;
    thoughts?: string;
    started_at?: string;
    completed_at?: string;
  }) => {
    const now = new Date().toISOString();
    await dbService.saveHistory({
      id: `hist_manual_${Date.now()}`,
      media_id: currentMedia.id,
      started_at: params.started_at,
      completed_at: params.completed_at || now.split('T')[0],
      status: params.status,
      score: params.score,
      context: params.context?.trim() || undefined,
      thoughts: params.thoughts?.trim() || undefined,
      source: 'Manual',
      created_at: now
    });
    await refreshHistoryAndState();
  };

  const updateHistoryEntry = async (history: MediaHistory) => {
    await dbService.saveHistory({
      ...history,
      media_id: currentMedia.id,
      updated_at: new Date().toISOString()
    });
    await refreshHistoryAndState();
  };

  const deleteHistoryEntry = async (historyId: string) => {
    await dbService.deleteHistory(historyId);
    await refreshHistoryAndState();
  };

  const addCustomFilePath = async (customPath: string) => {
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

    await dbService.saveLocalFile(newLocalFile);
    await refreshLocalFiles();
  };

  const toggleEpisodeWatchStatus = async (seasonNumber: number, episodeNumber: number, isCurrentlyWatched: boolean) => {
    const padS = String(seasonNumber).padStart(2, '0');
    const padE = String(episodeNumber).padStart(2, '0');
    const contextTag = `S${padS}E${padE}`;

    if (isCurrentlyWatched) {
      await dbService.deleteHistoryForEpisode(currentMedia.id, seasonNumber, episodeNumber);
    } else {
      const now = new Date().toISOString();
      await dbService.saveHistory({
        id: `hist_ep_${Date.now()}_${seasonNumber}_${episodeNumber}`,
        media_id: currentMedia.id,
        completed_at: now.split('T')[0],
        status: 'Watched Episode',
        context: contextTag,
        source: 'Manual',
        created_at: now
      });
    }
    await refreshHistoryAndState();
  };

  const linkFileToEpisode = async (fileId: string, seasonNumber: number, episodeNumber: number) => {
    await dbService.updateLocalFileAssociation(fileId, currentMedia.id, seasonNumber, episodeNumber);
    await refreshLocalFiles();
  };

  const getResumeTarget = useCallback(() => {
    const activeFiles = localFiles.filter(f => f.exists);
    if (activeFiles.length === 0) return null;

    if (currentMedia.type === 'TV Series') {
      // 1. Check for unfinished in-progress episode
      const inProgress = allProgress.find(p => !p.is_completed && p.position_seconds > 10 && (p.duration_seconds <= 0 || p.position_seconds / p.duration_seconds < 0.9));
      if (inProgress) {
        const file = activeFiles.find(f => f.season === inProgress.season && f.episode === inProgress.episode) || activeFiles[0];
        const padS = String(inProgress.season || 1).padStart(2, '0');
        const padE = String(inProgress.episode || 1).padStart(2, '0');
        
        // Try to find the episode name from media metadata
        const season = currentMedia.seasons?.find(s => s.season_number === inProgress.season);
        const episode = season?.episodes?.find(e => e.episode_number === inProgress.episode);

        return {
          file,
          season: inProgress.season || 1,
          episode: inProgress.episode || 1,
          position: inProgress.position_seconds,
          label: `Resume S${padS}E${padE}`,
          hasSavedProgress: true,
          title: episode?.name
        };
      }

      // 2. Check for highest completed episode to find next unwatched
      const completed = allProgress.filter(p => p.is_completed).sort((a, b) => (b.season || 0) - (a.season || 0) || (b.episode || 0) - (a.episode || 0));
      if (completed.length > 0) {
        const lastComp = completed[0];
        const nextEp = (lastComp.episode || 1) + 1;
        const nextS = lastComp.season || 1;

        let nextFile = activeFiles.find(f => f.season === nextS && f.episode === nextEp);
        let targetS = nextS;
        let targetEp = nextEp;

        if (!nextFile) {
          targetS = nextS + 1;
          targetEp = 1;
          nextFile = activeFiles.find(f => f.season === targetS && f.episode === targetEp);
        }

        if (nextFile) {
          const padS = String(targetS).padStart(2, '0');
          const padE = String(targetEp).padStart(2, '0');
          
          const season = currentMedia.seasons?.find(s => s.season_number === targetS);
          const episode = season?.episodes?.find(e => e.episode_number === targetEp);

          return {
            file: nextFile,
            season: targetS,
            episode: targetEp,
            position: 0,
            label: `Play Next S${padS}E${padE}`,
            hasSavedProgress: false,
            title: episode?.name
          };
        }
      }

      // 3. First available episode
      const sorted = [...activeFiles].sort((a, b) => (a.season || 0) - (b.season || 0) || (a.episode || 0) - (b.episode || 0));
      const first = sorted[0];
      const s = first.season || 1;
      const ep = first.episode || 1;
      const padS = String(s).padStart(2, '0');
      const padE = String(ep).padStart(2, '0');
      
      const season = currentMedia.seasons?.find(season => season.season_number === s);
      const episode = season?.episodes?.find(e => e.episode_number === ep);

      return {
        file: first,
        season: s,
        episode: ep,
        position: 0,
        label: `Play S${padS}E${padE}`,
        hasSavedProgress: false,
        title: episode?.name
      };
    } else {
      // Movie / single file
      const movieProg = allProgress.find(p => p.season === 0 && p.episode === 0) || allProgress[0];
      const activeFile = activeFiles[0];

      if (movieProg && !movieProg.is_completed && movieProg.position_seconds > 10) {
        const mins = Math.floor(movieProg.position_seconds / 60);
        return {
          file: activeFile,
          season: 0,
          episode: 0,
          position: movieProg.position_seconds,
          label: `Resume Movie (${mins}m)`,
          hasSavedProgress: true
        };
      }

      return {
        file: activeFile,
        season: 0,
        episode: 0,
        position: 0,
        label: 'Play Movie',
        hasSavedProgress: false
      };
    }
  }, [currentMedia, localFiles, allProgress]);

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
    updateHistoryEntry,
    deleteHistoryEntry,
    addCustomFilePath,
    relatedMedia,
    isLoadingRelated,
    addedExternalIds,
    handleAddRelatedToLibrary,
    updateCurrentMedia,
    allProgress,
    getResumeTarget,
    toggleEpisodeWatchStatus,
    linkFileToEpisode,
    refreshLocalFiles,
    refreshHistoryAndState
  };
}
