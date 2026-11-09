import React, { useState, useEffect, useRef } from 'react';
import { dbService } from '../services/DatabaseService';
import { localScannerService, isTauri } from '../services/LocalScannerService';
import { invoke } from '@tauri-apps/api/core';
import { AppSettings, MediaCardOrientation, MediaType, UiPreferences } from '../types/media';
import { useNotionImporter } from '../hooks/useNotionImporter';
import { useNotionSync } from '../hooks/useNotionSync';
import { useLibraryScanner } from '../hooks/useLibraryScanner';
import { DEFAULT_FOLDERS } from '../constants/appConstants';
import {
  Settings,
  Folder,
  Key,
  Globe,
  Database,
  Upload,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  FileSpreadsheet,
  FolderSearch,
  Loader2,
  Lock,
  ShieldCheck,
  ExternalLink,
  Layers,
  ArrowRightLeft,
  Check,
  Plus,
  Trash2
} from 'lucide-react';

import { useSidebarPadding } from '../hooks/useSidebarPadding';

interface SettingsViewProps {
  isCollapsed?: boolean;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ isCollapsed }) => {
  const { isDesktop, pagePadding } = useSidebarPadding(isCollapsed);
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const [settings, setSettings] = useState<AppSettings>({});

  // Input states
  const [moviesFolder, setMoviesFolder] = useState(settings.movies_folder || DEFAULT_FOLDERS.MOVIES);
  const [tvFolder, setTvFolder] = useState(settings.tv_folder || DEFAULT_FOLDERS.TV_SHOWS);
  const [gamesFolder, setGamesFolder] = useState(settings.games_folder || DEFAULT_FOLDERS.GAMES);
  const [region, setRegion] = useState(settings.country_region || 'United States');
  const [tmdbKey, setTmdbKey] = useState(settings.tmdb_api_key || '');
  const [twitchClientId, setTwitchClientId] = useState(settings.twitch_client_id || '');
  const [twitchClientSecret, setTwitchClientSecret] = useState(settings.twitch_client_secret || '');
  const [rawgApiKey, setRawgApiKey] = useState(settings.rawg_api_key || '');
  const [steamApiKey, setSteamApiKey] = useState(settings.steam_api_key || '');
  const [playerMode, setPlayerMode] = useState<'builtin' | 'os_default'>(settings.player_mode || 'builtin');
  const [autoplayNext, setAutoplayNext] = useState<boolean>(settings.autoplay_next_episode !== false);
  const [sidebarHideEnabled, setSidebarHideEnabled] = useState(settings.sidebar_hide_enabled !== false);
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>({
    home_card_orientation: 'landscape',
    card_orientation_by_type: {
      Film: 'portrait',
      'TV Series': 'portrait',
      VideoGame: 'portrait'
    }
  });

  const [savedMessage, setSavedMessage] = useState('');
  const [deleteError, setDeleteError] = useState('');

  // Folder Directory Input Refs
  const moviesFolderInputRef = useRef<HTMLInputElement>(null);
  const tvFolderInputRef = useRef<HTMLInputElement>(null);
  const gamesFolderInputRef = useRef<HTMLInputElement>(null);

  // Custom Hooks
  const { scanningType, scanProgressCount, scanResult, scanError, scanFolder } = useLibraryScanner();
  const {
    csvHeaders,
    csvRows,
    mapping: csvMapping,
    setMapping: setCsvMapping,
    isImporting: isCsvImporting,
    importResult: csvImportResult,
    parseCsvFile,
    runImport: runCsvImport
  } = useNotionImporter();

  const {
    token: notionToken,
    databaseId: notionDbId,
    databases,
    schema,
    mapping: notionApiMapping,
    setMapping: setNotionApiMapping,
    isLoadingDatabases,
    isLoadingSchema,
    isCreatingDatabase,
    isSyncing,
    syncResult,
    conflicts,
    lastSyncTime,
    syncErrors,
    connectNotionOAuth,
    createDatabaseInNotion,
    saveNotionConfig,
    triggerImportFromApi,
    triggerSync,
    resolveConflict
  } = useNotionSync();

  const [tokenInput, setTokenInput] = useState(notionToken);
  const [selectedDbId, setSelectedDbId] = useState(notionDbId);

  useEffect(() => {
    dbService.getSettings().then(nextSettings => {
      setSettings(nextSettings);
      setMoviesFolder(nextSettings.movies_folder || DEFAULT_FOLDERS.MOVIES);
      setTvFolder(nextSettings.tv_folder || DEFAULT_FOLDERS.TV_SHOWS);
      setGamesFolder(nextSettings.games_folder || DEFAULT_FOLDERS.GAMES);
      setRegion(nextSettings.country_region || 'United States');
      setTmdbKey(nextSettings.tmdb_api_key || '');
      setTwitchClientId(nextSettings.twitch_client_id || '');
      setTwitchClientSecret(nextSettings.twitch_client_secret || '');
      setRawgApiKey(nextSettings.rawg_api_key || '');
      setSteamApiKey(nextSettings.steam_api_key || '');
      setPlayerMode(nextSettings.player_mode || 'builtin');
      setAutoplayNext(nextSettings.autoplay_next_episode !== false);
      setSidebarHideEnabled(nextSettings.sidebar_hide_enabled !== false);
      setUiPreferences({
        home_card_orientation: nextSettings.ui_preferences?.home_card_orientation === 'portrait'
          ? 'portrait'
          : 'landscape',
        card_orientation_by_type: {
          Film: nextSettings.ui_preferences?.card_orientation_by_type?.Film === 'landscape' ? 'landscape' : 'portrait',
          'TV Series': nextSettings.ui_preferences?.card_orientation_by_type?.['TV Series'] === 'landscape' ? 'landscape' : 'portrait',
          VideoGame: nextSettings.ui_preferences?.card_orientation_by_type?.VideoGame === 'landscape' ? 'landscape' : 'portrait'
        }
      });
    }).catch(err => console.error('Failed to load settings:', err));
  }, []);

  useEffect(() => {
    setTokenInput(notionToken);
    setSelectedDbId(notionDbId);
  }, [notionToken, notionDbId]);

  const handleSaveFolders = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isAndroid) {
      setSavedMessage('Android file selections are temporary and do not save folder paths.');
      setTimeout(() => setSavedMessage(''), 3000);
      return;
    }

    await Promise.all([
      dbService.saveSetting('movies_folder', moviesFolder),
      dbService.saveSetting('tv_folder', tvFolder),
      dbService.saveSetting('games_folder', gamesFolder)
    ]);
    setSavedMessage('Library folder locations saved successfully.');
    setTimeout(() => setSavedMessage(''), 3000);
  };

  const handleScanDirectory = async (e: React.MouseEvent, folderPath: string, mediaType: MediaType) => {
    e.preventDefault();
    e.stopPropagation();
    await scanFolder(folderPath, mediaType);
    setSavedMessage(`Scanned ${mediaType} folder.`);
    setTimeout(() => setSavedMessage(''), 4000);
  };

  const handleSaveApiKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    await Promise.all([
      dbService.saveSetting('tmdb_api_key', tmdbKey.trim()),
      dbService.saveSetting('twitch_client_id', twitchClientId.trim()),
      dbService.saveSetting('twitch_client_secret', twitchClientSecret.trim()),
      dbService.saveSetting('rawg_api_key', rawgApiKey.trim()),
      dbService.saveSetting('steam_api_key', steamApiKey.trim()),
      dbService.saveSetting('country_region', region.trim()),
      dbService.saveSetting('player_mode', playerMode),
      dbService.saveSetting('autoplay_next_episode', autoplayNext),
      saveNotionConfig(tokenInput, selectedDbId, notionApiMapping)
    ]);
    setSavedMessage('API credentials and preferences saved locally in SQLite.');
    setTimeout(() => setSavedMessage(''), 3000);
  };

  const handleCardOrientationChange = async (type: MediaType, orientation: MediaCardOrientation) => {
    const nextPreferences: UiPreferences = {
      ...uiPreferences,
      card_orientation_by_type: {
        ...uiPreferences.card_orientation_by_type,
        [type]: orientation
      }
    };
    setUiPreferences(nextPreferences);
    try {
      await dbService.saveSetting('ui_preferences', nextPreferences);
      setSavedMessage('UI preferences saved.');
      setTimeout(() => setSavedMessage(''), 3000);
    } catch (error) {
      console.error('Failed to save UI preferences:', error);
      setSavedMessage('Could not save UI preferences.');
      setTimeout(() => setSavedMessage(''), 3000);
    }
  };

  const handleClearMediaType = async (type: MediaType, label: string) => {
    if (!window.confirm(`Delete all ${label.toLowerCase()} and their related library records? Local files on disk will not be deleted.`)) {
      return;
    }

    setDeleteError('');
    try {
      const deletedCount = await dbService.clearMediaByType(type);
      window.dispatchEvent(new CustomEvent('library-scanned'));
      setSavedMessage(`Deleted ${deletedCount} ${label.toLowerCase()} from your library.`);
      setTimeout(() => setSavedMessage(''), 4000);
    } catch (err) {
      console.error(`Failed to clear ${label.toLowerCase()}:`, err);
      setDeleteError(`Could not delete ${label.toLowerCase()}. Please try again.`);
    }
  };

  const handleFolderBrowseClick = async (e: React.MouseEvent, key: 'movies' | 'tv' | 'games') => {
    e.preventDefault();
    e.stopPropagation();

    const mediaType: MediaType = key === 'movies' ? 'Film' : key === 'tv' ? 'TV Series' : 'VideoGame';

    if (isAndroid) {
      if (isTauri()) {
        try {
          type AndroidFsUri = { uri: string; documentTopTreeUri: string | null };
          const selected = await invoke<AndroidFsUri[]>('plugin:android-fs|show_open_file_picker', {
            mimeTypes: key === 'games' ? ['*/*'] : ['video/*'],
            multiple: true,
            pickerType: 'FilePicker',
            needWritePermission: false,
            localOnly: true,
            initialLocation: null
          });
          await Promise.all(selected.map(uri => invoke<void>(
            'plugin:android-fs|persist_picker_uri_permission',
            { uri }
          )));
          const paths = selected.map(uri => uri.uri);
          if (paths.length > 0) {
            localScannerService.setNativeSelectedPaths(mediaType, paths);
            const selectionLabel = `Android selection (${paths.length} file${paths.length === 1 ? '' : 's'})`;
            if (key === 'movies') setMoviesFolder(selectionLabel);
            if (key === 'tv') setTvFolder(selectionLabel);
            if (key === 'games') setGamesFolder(selectionLabel);
            setSavedMessage(`Selected ${paths.length} file${paths.length === 1 ? '' : 's'}. Scan now to add their Android paths to your library.`);
            setTimeout(() => setSavedMessage(''), 4000);
          }
        } catch (err) {
          console.error('Failed to open the Android document picker:', err);
          setSavedMessage('Could not open the Android document picker. Please try again.');
          setTimeout(() => setSavedMessage(''), 4000);
        }
        return;
      }

      if (key === 'movies') moviesFolderInputRef.current?.click();
      if (key === 'tv') tvFolderInputRef.current?.click();
      if (key === 'games') gamesFolderInputRef.current?.click();
      return;
    }

    if (isTauri()) {
      try {
        const selected = await invoke<string | null>('select_folder');
        if (selected) {
          if (key === 'movies') setMoviesFolder(selected);
          if (key === 'tv') setTvFolder(selected);
          if (key === 'games') setGamesFolder(selected);

          await dbService.saveSetting(`${key}_folder`, selected);
          setSavedMessage(`Updated ${key} folder path: ${selected}`);
          setTimeout(() => setSavedMessage(''), 3000);
        }
      } catch (err) {
        console.error('Failed to open native folder picker in Tauri:', err);
      }
    } else {
      if ('showDirectoryPicker' in window) {
        try {
          const dirHandle = await (window as any).showDirectoryPicker();
          if (dirHandle) {
            const files: File[] = [];

            const collectFiles = async (handle: any) => {
              for await (const entry of handle.values()) {
                if (entry.kind === 'file') {
                  const file = await entry.getFile();
                  files.push(file);
                } else if (entry.kind === 'directory') {
                  await collectFiles(entry);
                }
              }
            };

            await collectFiles(dirHandle);

            localScannerService.setWebSelectedFiles(mediaType, files);

            const displayPath = `C:\\Media\\${dirHandle.name}`;
            if (key === 'movies') setMoviesFolder(displayPath);
            if (key === 'tv') setTvFolder(displayPath);
            if (key === 'games') setGamesFolder(displayPath);

            await dbService.saveSetting(`${key}_folder`, displayPath);
            setSavedMessage(`Selected web directory "${dirHandle.name}" containing ${files.length} files.`);
            setTimeout(() => setSavedMessage(''), 4000);
            return;
          }
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            console.warn('showDirectoryPicker error, falling back to file input:', err);
          } else {
            return;
          }
        }
      }

      if (key === 'movies' && moviesFolderInputRef.current) {
        moviesFolderInputRef.current.click();
      } else if (key === 'tv' && tvFolderInputRef.current) {
        tvFolderInputRef.current.click();
      } else if (key === 'games' && gamesFolderInputRef.current) {
        gamesFolderInputRef.current.click();
      }
    }
  };

  const handleHTMLFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>, key: 'movies' | 'tv' | 'games') => {
    const files = e.target.files;
    const mediaType: MediaType = key === 'movies' ? 'Film' : key === 'tv' ? 'TV Series' : 'VideoGame';

    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      localScannerService.setWebSelectedFiles(mediaType, fileArray);

      const firstFile = files[0];
      let folderName = 'Selected Folder';
      if (firstFile.webkitRelativePath) {
        folderName = firstFile.webkitRelativePath.split('/')[0];
      } else if (isAndroid) {
        folderName = firstFile.name;
      }

      const folderPath = isAndroid ? folderName : `C:\\Media\\${folderName}`;

      if (key === 'movies') setMoviesFolder(folderPath);
      if (key === 'tv') setTvFolder(folderPath);
      if (key === 'games') setGamesFolder(folderPath);

      if (!isAndroid) {
        await dbService.saveSetting(`${key}_folder`, folderPath);
      }
      setSavedMessage(isAndroid
        ? `Selected ${fileArray.length} files. Scan now to add them to your library.`
        : `Loaded ${fileArray.length} files from folder "${folderName}".`);
      setTimeout(() => setSavedMessage(''), 4000);
    }

    e.target.value = '';
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      parseCsvFile(file);
    }
  };

  const schemaKeys = Object.keys(schema);

  return (
    <div
      className="p-4 sm:p-6 md:p-8 pb-24 md:pb-8 space-y-8 max-w-5xl mx-auto transition-all duration-300"
      style={{
          paddingLeft: pagePadding,
          paddingTop: isDesktop?'': 'calc(env(safe-area-inset-top, 0px) + 12px)'
        }}
    >
      {/* Hidden Folder Directory Inputs */}
      <input
        type="file"
        ref={moviesFolderInputRef}
        onChange={(e) => handleHTMLFolderSelect(e, 'movies')}
        style={{ display: 'none' }}
        multiple={isAndroid}
        accept={isAndroid ? 'video/*' : undefined}
        {...(!isAndroid ? ({ webkitdirectory: '', directory: '' } as any) : {})}
      />
      <input
        type="file"
        ref={tvFolderInputRef}
        onChange={(e) => handleHTMLFolderSelect(e, 'tv')}
        style={{ display: 'none' }}
        multiple={isAndroid}
        accept={isAndroid ? 'video/*' : undefined}
        {...(!isAndroid ? ({ webkitdirectory: '', directory: '' } as any) : {})}
      />
      <input
        type="file"
        ref={gamesFolderInputRef}
        onChange={(e) => handleHTMLFolderSelect(e, 'games')}
        style={{ display: 'none' }}
        multiple={isAndroid}
        accept={isAndroid ? '*/*' : undefined}
        {...(!isAndroid ? ({ webkitdirectory: '', directory: '' } as any) : {})}
      />

      {/* Header */}
      <div className="border-b border-[#1f222e] pb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-[#ffffff] tracking-tight flex items-center space-x-3">
            <Settings className="w-8 h-8 text-[#E27D12]" />
            <span>Settings & Notion Hub</span>
          </h1>
          <p className="text-sm text-[#E27D12]/80 font-medium mt-1">
            Configure local folders, API integration keys, Notion database sync, and conflict resolution
          </p>
        </div>

        {savedMessage && (
          <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4" />
            <span>{savedMessage}</span>
          </span>
        )}
      </div>

      {/* Local Folder Architecture & Directory Scanner Section */}
      <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-4">
        <h2 className="text-lg font-bold text-white flex items-center space-x-2">
          <Folder className="w-5 h-5 text-[#E27D12]" />
          <span>Local Library Folders & Directory Scanner</span>
        </h2>
        <p className="text-xs text-gray-400">
          Configure root directories for media files on your Windows machine and run read-only local scans.
          {isAndroid && ' Android does not support folder selection here; use Browse to select media files instead. Selections are temporary.'}
        </p>

        <form onSubmit={handleSaveFolders} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Movies Folder */}
            <div className="bg-[#1a1d29] p-4 rounded-xl border border-[#2d3145] space-y-2 flex flex-col justify-between">
              <div>
                <label className="text-xs text-gray-300 font-bold block mb-1">Movies Folder</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={moviesFolder}
                    onChange={e => setMoviesFolder(e.target.value)}
                    placeholder="C:\Media\Movies"
                    className="w-full bg-[#13151f] border border-[#2d3145] rounded-lg p-2 text-xs text-gray-100 font-mono"
                  />
                  <button
                    type="button"
                    onClick={(e) => handleFolderBrowseClick(e, 'movies')}
                    className="bg-[#242838] hover:bg-[#2d3247] text-gray-200 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#3b4059] transition-all whitespace-nowrap cursor-pointer"
                  >
                    Browse
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={(e) => handleScanDirectory(e, moviesFolder, 'Film')}
                disabled={scanningType !== null}
                className="w-full bg-[#E27D12]/90 hover:bg-[#E27D12] disabled:opacity-50 text-white font-semibold text-xs py-2.5 rounded-lg flex items-center justify-center space-x-2 shadow-sm transition-all mt-4 cursor-pointer"
              >
                {scanningType === 'Film' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Scanning Movies... ({scanProgressCount})</span>
                  </>
                ) : (
                  <>
                    <FolderSearch className="w-4 h-4" />
                    <span>Scan Movies Folder</span>
                  </>
                )}
              </button>
            </div>

            {/* TV Shows Folder */}
            <div className="bg-[#1a1d29] p-4 rounded-xl border border-[#2d3145] space-y-2 flex flex-col justify-between">
              <div>
                <label className="text-xs text-gray-300 font-bold block mb-1">TV Shows Folder</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={tvFolder}
                    onChange={e => setTvFolder(e.target.value)}
                    placeholder="C:\Media\TV Shows"
                    className="w-full bg-[#13151f] border border-[#2d3145] rounded-lg p-2 text-xs text-gray-100 font-mono"
                  />
                  <button
                    type="button"
                    onClick={(e) => handleFolderBrowseClick(e, 'tv')}
                    className="bg-[#242838] hover:bg-[#2d3247] text-gray-200 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#3b4059] transition-all whitespace-nowrap cursor-pointer"
                  >
                    Browse
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={(e) => handleScanDirectory(e, tvFolder, 'TV Series')}
                disabled={scanningType !== null}
                className="w-full bg-sky-600/90 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold text-xs py-2.5 rounded-lg flex items-center justify-center space-x-2 shadow-sm transition-all mt-4 cursor-pointer"
              >
                {scanningType === 'TV Series' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Scanning TV Shows... ({scanProgressCount})</span>
                  </>
                ) : (
                  <>
                    <FolderSearch className="w-4 h-4" />
                    <span>Scan TV Folder</span>
                  </>
                )}
              </button>
            </div>

            {/* Games Folder */}
            <div className="bg-[#1a1d29] p-4 rounded-xl border border-[#2d3145] space-y-2 flex flex-col justify-between">
              <div>
                <label className="text-xs text-gray-300 font-bold block mb-1">Games Folder</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={gamesFolder}
                    onChange={e => setGamesFolder(e.target.value)}
                    placeholder="D:\Games"
                    className="w-full bg-[#13151f] border border-[#2d3145] rounded-lg p-2 text-xs text-gray-100 font-mono"
                  />
                  <button
                    type="button"
                    onClick={(e) => handleFolderBrowseClick(e, 'games')}
                    className="bg-[#242838] hover:bg-[#2d3247] text-gray-200 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#3b4059] transition-all whitespace-nowrap cursor-pointer"
                  >
                    Browse
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={(e) => handleScanDirectory(e, gamesFolder, 'VideoGame')}
                disabled={scanningType !== null}
                className="w-full bg-purple-600/90 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold text-xs py-2.5 rounded-lg flex items-center justify-center space-x-2 shadow-sm transition-all mt-4 cursor-pointer"
              >
                {scanningType === 'VideoGame' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>Scanning Games... ({scanProgressCount})</span>
                  </>
                ) : (
                  <>
                    <FolderSearch className="w-4 h-4" />
                    <span>Scan Games Folder</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              className="bg-[#E27D12] hover:bg-[#E27D12] text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-md transition-all cursor-pointer"
            >
              Save Folder Settings
            </button>
          </div>
        </form>

        {/* Live Active Scanning Banner */}
        {scanningType && (
          <div className="bg-[#1c2238] border border-sky-500/50 p-4 rounded-xl text-xs space-y-2 animate-pulse flex items-center space-x-3">
            <Loader2 className="w-5 h-5 text-sky-400 animate-spin flex-shrink-0" />
            <div>
              <h4 className="font-bold text-sky-300">Scanning in Progress: {scanningType} Folder</h4>
              <p className="text-gray-300 mt-0.5">
                Traversing directory structure, analyzing files, and running title matching algorithms... ({scanProgressCount} items processed)
              </p>
            </div>
          </div>
        )}

        {/* Real-time Scan Progress & Feedback Banner */}
        {scanResult && !scanningType && (
          <div className="bg-[#102419] border border-emerald-500/40 p-4 rounded-xl text-xs space-y-2 animate-fadeIn">
            <h4 className="font-bold text-emerald-400 flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Library Scan Completed Successfully ({scanResult.type})</span>
            </h4>
            <p className="text-gray-300">
              Scanned & Processed <strong className="text-white">{scanResult.result.totalScanned}</strong> files → Auto-matched & linked <strong className="text-emerald-400">{scanResult.result.autoMatchedCount}</strong> items directly to Media entities. Routed <strong className="text-amber-400">{scanResult.result.unmatchedCount}</strong> unknown/ambiguous files to Unmatched Inbox. Updated <strong className="text-gray-400">{scanResult.result.missingMarkedCount}</strong> offline files.
            </p>
          </div>
        )}
        {scanError && !scanningType && (
          <div role="alert" className="bg-[#2a1719] border border-[#E27D12]/40 p-4 rounded-xl text-xs flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-[#E27D12] flex-shrink-0" />
            <div>
              <h4 className="font-bold text-[#E27D12]">Library Scan Failed</h4>
              <p className="text-gray-300 mt-0.5">{scanError}</p>
            </div>
          </div>
        )}
      </section>

      <section className="bg-[#14161f] p-6 rounded-2xl border border-[#E27D12]/20 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center space-x-2">
            <Trash2 className="w-5 h-5 text-[#E27D12]" />
            <span>Clear Library Sections</span>
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Permanently remove a media section and its associated history, file records, availability, wishlist links, and metadata links. Files on disk are not deleted.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([
            { type: 'Film', label: 'Movies' },
            { type: 'TV Series', label: 'TV Shows' },
            { type: 'VideoGame', label: 'Games' }
          ] as const).map(section => (
            <button
              key={section.type}
              type="button"
              onClick={() => void handleClearMediaType(section.type, section.label)}
              className="bg-[#1a1d29] hover:bg-[#7A4509]/40 text-gray-200 hover:text-[#E27D12] border border-[#2d3145] hover:border-[#E27D12]/40 rounded-xl px-4 py-3 text-sm font-semibold transition-colors cursor-pointer"
            >
              Clear {section.label}
            </button>
          ))}
        </div>
        {deleteError && <p role="alert" className="text-xs text-[#E27D12]">{deleteError}</p>}
      </section>

      {/* UI Preferences Section */}
      <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-4">
        <h2 className="text-lg font-bold text-white flex items-center space-x-2">
          <Settings className="w-5 h-5 text-[#E27D12]" />
          <span>UI</span>
        </h2>
        <p className="text-xs text-gray-400">
          Configure desktop navigation and library card layouts across screen sizes. Home page rails use fixed layouts.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-[#1a1d29] p-4 rounded-xl border border-[#2d3145] space-y-3">
            <label className="flex items-center space-x-2 cursor-pointer text-gray-300 hover:text-white">
              <input
                type="checkbox"
                checked={sidebarHideEnabled}
                onChange={async event => {
                  const enabled = event.target.checked;
                  setSidebarHideEnabled(enabled);
                  try {
                    await dbService.saveSetting('sidebar_hide_enabled', enabled);
                  } catch (error) {
                    console.error('Failed to save sidebar visibility preference:', error);
                    setSavedMessage('Could not save UI preferences.');
                  }
                }}
                className="rounded text-[#E27D12] focus:ring-[#E27D12]"
              />
              <span>Hide sidebar in Detail View (show on left edge hover)</span>
            </label>
          </div>

          {([
            { type: 'Film', label: 'Movies' },
            { type: 'TV Series', label: 'TV Shows' },
            { type: 'VideoGame', label: 'Games' }
          ] as const).map(section => (
            <div key={section.type} className="bg-[#1a1d29] p-4 rounded-xl border border-[#2d3145] space-y-2">
              <label htmlFor={`card-orientation-${section.type}`} className="text-xs text-gray-200 font-bold block">
                {section.label} cards
              </label>
              <select
                id={`card-orientation-${section.type}`}
                value={uiPreferences.card_orientation_by_type[section.type] || 'portrait'}
                onChange={event => void handleCardOrientationChange(section.type, event.target.value as MediaCardOrientation)}
                className="w-full bg-[#13151f] border border-[#2d3145] rounded-lg p-2 text-xs text-gray-100"
              >
                <option value="portrait">Portrait (poster)</option>
                <option value="landscape">Landscape (backdrop)</option>
              </select>
            </div>
          ))}
        </div>
      </section>

      {/* Playback Preferences Section */}
      <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-4">
        <h2 className="text-lg font-bold text-white flex items-center space-x-2">
          <Sparkles className="w-5 h-5 text-[#E27D12]" />
          <span>Playback Preferences</span>
        </h2>
        <p className="text-xs text-gray-400">
          Choose whether to launch videos using the built-in HTML5 player or your operating system's default media player, and configure automatic episode progression.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-[#1a1d29] p-4 rounded-xl border border-[#2d3145] space-y-3">
            <label className="text-xs text-gray-200 font-bold block">Video Player Mode</label>
            <div className="space-y-2">
              <label className="flex items-center space-x-2 cursor-pointer text-gray-300 hover:text-white">
                <input
                  type="radio"
                  name="playerMode"
                  value="builtin"
                  checked={playerMode === 'builtin'}
                  onChange={() => {
                    setPlayerMode('builtin');
                    dbService.saveSetting('player_mode', 'builtin');
                  }}
                  className="text-[#E27D12] focus:ring-[#E27D12]"
                />
                <span>Built-in HTML5 Video Player (with resume, progress bars & subtitles)</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer text-gray-300 hover:text-white">
                <input
                  type="radio"
                  name="playerMode"
                  value="os_default"
                  checked={playerMode === 'os_default'}
                  onChange={() => {
                    setPlayerMode('os_default');
                    dbService.saveSetting('player_mode', 'os_default');
                  }}
                  className="text-[#E27D12] focus:ring-[#E27D12]"
                />
                <span>OS System Default Application (VLC, MPC-HC, etc.)</span>
              </label>
            </div>
          </div>

          <div className="bg-[#1a1d29] p-4 rounded-xl border border-[#2d3145] space-y-3">
            <label className="text-xs text-gray-200 font-bold block">TV Series Autoplay</label>
            <label className="flex items-center space-x-2 cursor-pointer text-gray-300 hover:text-white pt-1">
              <input
                type="checkbox"
                checked={autoplayNext}
                onChange={(e) => {
                  const val = e.target.checked;
                  setAutoplayNext(val);
                  dbService.saveSetting('autoplay_next_episode', val);
                }}
                className="rounded text-[#E27D12] focus:ring-[#E27D12]"
              />
              <span>Automatically play next episode on completion with countdown</span>
            </label>
          </div>

        </div>
      </section>

      {/* External Metadata API Credentials Section */}
      <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-4">
        <div className="flex items-center justify-between border-b border-[#232736] pb-3">
          <h2 className="text-lg font-bold text-white flex items-center space-x-2">
            <Key className="w-5 h-5 text-[#E27D12]" />
            <span>Metadata API Keys & Providers</span>
          </h2>
          <span className="text-xs text-gray-400 flex items-center space-x-1">
            <Lock className="w-3.5 h-3.5 text-emerald-400" />
            <span>Stored Locally in SQLite</span>
          </span>
        </div>

        <p className="text-xs text-gray-300 leading-relaxed">
          API credentials enable live metadata and artwork fetching from TMDB and IGDB.
        </p>

        {/* Integration Badges */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="bg-[#1a1d29] p-3 rounded-xl border border-[#2d3145] flex items-center justify-between">
            <span className="font-bold text-white">TMDB (Movies/TV)</span>
            {tmdbKey ? (
              <span className="bg-emerald-950 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-semibold text-[11px] flex items-center space-x-1">
                <ShieldCheck className="w-3 h-3" />
                <span>Configured</span>
              </span>
            ) : (
              <span className="bg-amber-950 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded font-semibold text-[11px]">
                Demo Fallback
              </span>
            )}
          </div>

          <div className="bg-[#1a1d29] p-3 rounded-xl border border-[#2d3145] flex items-center justify-between">
            <span className="font-bold text-white">IGDB (Twitch OAuth & Logos)</span>
            {twitchClientId && twitchClientSecret ? (
              <span className="bg-emerald-950 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-semibold text-[11px] flex items-center space-x-1">
                <ShieldCheck className="w-3 h-3" />
                <span>Configured</span>
              </span>
            ) : (
              <span className="bg-amber-950 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded font-semibold text-[11px]">
                Demo Fallback
              </span>
            )}
          </div>

        </div>

        <form onSubmit={handleSaveApiKeys} className="space-y-4 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-300 font-bold block mb-1">Country / Streaming Region</label>
              <div className="flex items-center space-x-2">
                <Globe className="w-4 h-4 text-[#E27D12] shrink-0" />
                <input
                  type="text"
                  value={region}
                  onChange={e => setRegion(e.target.value)}
                  placeholder="e.g. United States, India"
                  className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2.5 text-xs text-gray-100"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-gray-300 font-bold block mb-1">TMDB API Key (Movies & TV)</label>
              <input
                type="password"
                value={tmdbKey}
                onChange={e => setTmdbKey(e.target.value)}
                placeholder="TMDB v3 API Key"
                className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2.5 text-xs text-gray-100 font-mono"
              />
            </div>

            <div>
              <label className="text-xs text-gray-300 font-bold block mb-1">Twitch Client ID (IGDB)</label>
              <input
                type="password"
                value={twitchClientId}
                onChange={e => setTwitchClientId(e.target.value)}
                placeholder="Twitch Developer Client ID"
                className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2.5 text-xs text-gray-100 font-mono"
              />
            </div>

            <div>
              <label className="text-xs text-gray-300 font-bold block mb-1">Twitch Client Secret (IGDB)</label>
              <input
                type="password"
                value={twitchClientSecret}
                onChange={e => setTwitchClientSecret(e.target.value)}
                placeholder="Twitch Developer Client Secret"
                className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2.5 text-xs text-gray-100 font-mono"
              />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              className="bg-[#E27D12] hover:bg-[#E27D12] text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-md transition-all cursor-pointer"
            >
              Save API Settings
            </button>
          </div>
        </form>
      </section>

      {/* Notion CSV Import Fallback Wizard */}
      <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-4">
        <h2 className="text-lg font-bold text-white flex items-center space-x-2">
          <FileSpreadsheet className="w-5 h-5 text-[#E27D12]" />
          <span>Notion Database CSV Export Import Wizard</span>
        </h2>
        <p className="text-xs text-gray-400">
          Upload a local Notion database export (.csv). The importer will parse clean titles and context notes while preserving un-altered raw Notion records.
        </p>

        <div className="space-y-4 pt-2">
          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-2 bg-[#E27D12] hover:bg-[#E27D12] text-white font-semibold text-xs px-4 py-2.5 rounded-xl cursor-pointer transition-all shadow-md">
              <Upload className="w-4 h-4" />
              <span>Select Notion CSV File</span>
              <input type="file" accept=".csv" onChange={handleCsvFileUpload} className="hidden" />
            </label>
            {csvRows.length > 0 && (
              <span className="text-xs text-emerald-400 font-medium flex items-center space-x-1">
                <CheckCircle2 className="w-4 h-4" />
                <span>Loaded {csvRows.length} database rows</span>
              </span>
            )}
          </div>

          {/* Column Mapping UI */}
          {csvHeaders.length > 0 && (
            <div className="bg-[#1a1d29] p-5 rounded-xl border border-[#2d3145] space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-[#E27D12]" />
                <span>Configure Column Mapping</span>
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="text-gray-400 font-medium block mb-1">Title / Name Field</label>
                  <select
                    value={csvMapping.nameField}
                    onChange={e => setCsvMapping({ ...csvMapping, nameField: e.target.value })}
                    className="w-full bg-[#13151f] border border-[#2f3448] rounded p-2 text-gray-200"
                  >
                    {csvHeaders.map(h => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-gray-400 font-medium block mb-1">Type Field</label>
                  <select
                    value={csvMapping.typeField}
                    onChange={e => setCsvMapping({ ...csvMapping, typeField: e.target.value })}
                    className="w-full bg-[#13151f] border border-[#2f3448] rounded p-2 text-gray-200"
                  >
                    {csvHeaders.map(h => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-gray-400 font-medium block mb-1">Watched/Completed Field</label>
                  <select
                    value={csvMapping.watchedOnField}
                    onChange={e => setCsvMapping({ ...csvMapping, watchedOnField: e.target.value })}
                    className="w-full bg-[#13151f] border border-[#2f3448] rounded p-2 text-gray-200"
                  >
                    {csvHeaders.map(h => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-gray-400 font-medium block mb-1">Score / Rating Field</label>
                  <select
                    value={csvMapping.scoreField}
                    onChange={e => setCsvMapping({ ...csvMapping, scoreField: e.target.value })}
                    className="w-full bg-[#13151f] border border-[#2f3448] rounded p-2 text-gray-200"
                  >
                    {csvHeaders.map(h => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-gray-400 font-medium block mb-1">Status Field</label>
                  <select
                    value={csvMapping.statusField}
                    onChange={e => setCsvMapping({ ...csvMapping, statusField: e.target.value })}
                    className="w-full bg-[#13151f] border border-[#2f3448] rounded p-2 text-gray-200"
                  >
                    {csvHeaders.map(h => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-gray-400 font-medium block mb-1">Language Field</label>
                  <select
                    value={csvMapping.languageField}
                    onChange={e => setCsvMapping({ ...csvMapping, languageField: e.target.value })}
                    className="w-full bg-[#13151f] border border-[#2f3448] rounded p-2 text-gray-200"
                  >
                    {csvHeaders.map(h => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-gray-400 font-medium block mb-1">Thoughts Field</label>
                  <select
                    value={csvMapping.thoughtsField}
                    onChange={e => setCsvMapping({ ...csvMapping, thoughtsField: e.target.value })}
                    className="w-full bg-[#13151f] border border-[#2f3448] rounded p-2 text-gray-200"
                  >
                    {csvHeaders.map(h => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-gray-400 font-medium block mb-1">Publisher Field</label>
                  <select
                    value={csvMapping.publisherField}
                    onChange={e => setCsvMapping({ ...csvMapping, publisherField: e.target.value })}
                    className="w-full bg-[#13151f] border border-[#2f3448] rounded p-2 text-gray-200"
                  >
                    {csvHeaders.map(h => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                {([
                  ['tmdbIdField', 'TMDB ID Field'],
                  ['igdbIdField', 'IGDB ID Field']
                ] as const).map(([field, label]) => (
                  <div key={field}>
                    <label className="text-gray-400 font-medium block mb-1">{label}</label>
                    <select
                      value={csvMapping[field] || ''}
                      onChange={e => setCsvMapping({ ...csvMapping, [field]: e.target.value })}
                      className="w-full bg-[#13151f] border border-[#2f3448] rounded p-2 text-gray-200"
                    >
                      <option value="">Not mapped</option>
                      {csvHeaders.map(h => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={runCsvImport}
                  disabled={isCsvImporting}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-md transition-all flex items-center space-x-2 cursor-pointer"
                >
                  <Database className="w-4 h-4" />
                  <span>{isCsvImporting ? 'Importing Rows...' : 'Execute Notion CSV Import'}</span>
                </button>
              </div>
            </div>
          )}

          {/* CSV Import Results Banner */}
          {csvImportResult && (
            <div className="bg-[#102419] border border-emerald-500/40 p-4 rounded-xl text-xs space-y-2">
              <h4 className="font-bold text-emerald-400 flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>Notion CSV Import Summary</span>
              </h4>
              <p className="text-gray-300">
                Processed {csvImportResult.totalRows} Notion rows → Created/Updated {csvImportResult.importedMediaCount} canonical Media items & {csvImportResult.importedHistoryCount} MediaHistory interaction records. Archived {csvImportResult.rawRecordsSaved} raw records.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
