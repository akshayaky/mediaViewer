import { useState, useEffect } from 'react';
import { Media, LocalFile, MediaHistory, MediaState } from '../types/media';
import { dbService } from '../services/DatabaseService';
import { localLauncherService } from '../services/LocalLauncherService';
import { tmdbProvider } from '../providers/TMDBProvider';
import { igdbProvider } from '../providers/IGDBProvider';
import { artworkCacheProvider } from '../providers/ArtworkCacheProvider';

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
    addCustomFilePath
  };
}
