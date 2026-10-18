import React, { useState, useEffect, useRef } from 'react';
import { dbService } from '../services/DatabaseService';
import { localScannerService, isTauri } from '../services/LocalScannerService';
import { invoke } from '@tauri-apps/api/core';
import { AppSettings, MediaType } from '../types/media';
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
  Plus
} from 'lucide-react';

export const SettingsView: React.FC = () => {
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

  const [savedMessage, setSavedMessage] = useState('');

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
    }).catch(err => console.error('Failed to load settings:', err));
  }, []);

  useEffect(() => {
    setTokenInput(notionToken);
    setSelectedDbId(notionDbId);
  }, [notionToken, notionDbId]);

  const handleSaveFolders = async (e: React.FormEvent) => {
    e.preventDefault();
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
      saveNotionConfig(tokenInput, selectedDbId, notionApiMapping)
    ]);
    setSavedMessage('API credentials and preferences saved locally in SQLite.');
    setTimeout(() => setSavedMessage(''), 3000);
  };

  const handleFolderBrowseClick = async (e: React.MouseEvent, key: 'movies' | 'tv' | 'games') => {
    e.preventDefault();
    e.stopPropagation();

    const mediaType: MediaType = key === 'movies' ? 'Film' : key === 'tv' ? 'TV Series' : 'VideoGame';

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
      }

      const folderPath = `C:\\Media\\${folderName}`;

      if (key === 'movies') setMoviesFolder(folderPath);
      if (key === 'tv') setTvFolder(folderPath);
      if (key === 'games') setGamesFolder(folderPath);

      await dbService.saveSetting(`${key}_folder`, folderPath);
      setSavedMessage(`Loaded ${fileArray.length} files from folder "${folderName}".`);
      setTimeout(() => setSavedMessage(''), 4000);
    }
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      parseCsvFile(file);
    }
  };

  const schemaKeys = Object.keys(schema);

  return (
    <div className="p-8 space-y-8 max-w-5xl mx-auto">
      {/* Hidden Folder Directory Inputs */}
      <input
        type="file"
        ref={moviesFolderInputRef}
        onChange={(e) => handleHTMLFolderSelect(e, 'movies')}
        style={{ display: 'none' }}
        {...({ webkitdirectory: '', directory: '' } as any)}
      />
      <input
        type="file"
        ref={tvFolderInputRef}
        onChange={(e) => handleHTMLFolderSelect(e, 'tv')}
        style={{ display: 'none' }}
        {...({ webkitdirectory: '', directory: '' } as any)}
      />
      <input
        type="file"
        ref={gamesFolderInputRef}
        onChange={(e) => handleHTMLFolderSelect(e, 'games')}
        style={{ display: 'none' }}
        {...({ webkitdirectory: '', directory: '' } as any)}
      />

      {/* Header */}
      <div className="border-b border-[#1f222e] pb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-[#ffffff] tracking-tight flex items-center space-x-3">
            <Settings className="w-8 h-8 text-rose-500" />
            <span>Settings & Notion Hub</span>
          </h1>
          <p className="text-sm text-rose-400/80 font-medium mt-1">
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

      {/* Notion Integration Hub Section */}
      <section className="bg-[#14161f] p-6 rounded-2xl border border-purple-500/30 space-y-5 shadow-lg">
        <div className="flex items-center justify-between border-b border-[#232736] pb-4">
          <div className="flex items-center space-x-3">
            <Database className="w-6 h-6 text-purple-400" />
            <div>
              <h2 className="text-xl font-bold text-white">Notion Database Integration & Sync Hub</h2>
              <p className="text-xs text-gray-400">
                Connect your Notion workspace, select tracking databases (or create a new tracking table with 1 click for backup & multi-device sync), inspect schema properties, map fields, and execute bidirectional sync
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {notionToken ? (
              <span className="bg-emerald-950 text-emerald-400 border border-emerald-500/40 text-xs px-3 py-1 rounded-full font-bold flex items-center space-x-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Notion Connected</span>
              </span>
            ) : (
              <span className="bg-amber-950 text-amber-400 border border-amber-500/40 text-xs px-3 py-1 rounded-full font-semibold">
                Disconnected
              </span>
            )}
          </div>
        </div>

        {/* 1. Connect Notion */}
        <div className="bg-[#1a1d29] p-5 rounded-xl border border-[#2d3145] space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center space-x-2">
            <Key className="w-4 h-4 text-purple-400" />
            <span>1. Connect Notion Workspace</span>
          </h3>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <button
              type="button"
              onClick={connectNotionOAuth}
              className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl flex items-center justify-center space-x-2 transition-all shadow-md cursor-pointer shrink-0"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Connect Notion Workspace</span>
            </button>

            <div className="flex-1 flex items-center space-x-2">
              <input
                type="password"
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                placeholder="Or paste Notion integration token (secret_...)"
                className="w-full bg-[#13151f] border border-[#2d3145] rounded-xl p-2.5 text-xs text-gray-100 font-mono"
              />

              <button
                type="button"
                onClick={() => saveNotionConfig(tokenInput, selectedDbId, notionApiMapping)}
                className="bg-[#242838] hover:bg-[#2d3247] text-white font-semibold text-xs px-4 py-2.5 rounded-xl border border-[#3b4059] transition-all shrink-0 cursor-pointer"
              >
                Save
              </button>
            </div>
          </div>
        </div>

        {/* 2. Select Database OR Create New Database in Notion */}
        {notionToken && (
          <div className="bg-[#1a1d29] p-5 rounded-xl border border-[#2d3145] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <Layers className="w-4 h-4 text-sky-400" />
                <span>2. Select Existing Database OR Create New Notion Tracking Table</span>
              </h3>

              {isLoadingDatabases && (
                <span className="text-xs text-sky-400 flex items-center space-x-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Loading databases from Notion...</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="space-y-3">
                <label className="text-gray-300 font-bold block mb-1">Target Tracking Database</label>
                <select
                  value={selectedDbId}
                  onChange={e => {
                    setSelectedDbId(e.target.value);
                    saveNotionConfig(tokenInput, e.target.value, notionApiMapping);
                  }}
                  className="w-full bg-[#13151f] border border-[#2f3448] rounded-xl p-2.5 text-gray-200 font-medium"
                >
                  <option value="">-- Select an Existing Database --</option>
                  {databases.map(db => (
                    <option key={db.id} value={db.id}>
                      {db.title} ({db.id.substring(0, 8)}...)
                    </option>
                  ))}
                </select>

                {/* Create Database Button for Backup & Multi-Device Sync */}
                <div className="pt-2 border-t border-[#2d3145] space-y-2">
                  <p className="text-[11px] text-purple-300 font-medium">
                    Don't have a database in Notion yet? Create one automatically for backup & syncing across devices:
                  </p>

                  <button
                    type="button"
                    onClick={createDatabaseInNotion}
                    disabled={isCreatingDatabase}
                    className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold text-xs py-2.5 px-4 rounded-xl flex items-center justify-center space-x-2 transition-all shadow-md cursor-pointer"
                  >
                    {isCreatingDatabase ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Creating Media Database in Notion...</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        <span>Create Media Library Database in Notion</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-gray-300 font-bold block mb-1">Detected Schema Properties ({schemaKeys.length})</label>
                {isLoadingSchema ? (
                  <p className="text-gray-400 italic py-2">Querying database schema...</p>
                ) : schemaKeys.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 py-1">
                    {schemaKeys.map(key => (
                      <span key={key} className="bg-[#232736] text-sky-300 border border-[#2d3145] px-2 py-0.5 rounded text-[11px] font-mono">
                        {key} ({schema[key]?.type})
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 italic py-2">Select or create a Notion database above to inspect schema properties.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 3. Map Fields & Sync Control */}
        {notionToken && selectedDbId && (
          <div className="bg-[#1a1d29] p-5 rounded-xl border border-[#2d3145] space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-rose-400" />
              <span>3. Configure Field Mapping & Execute Sync</span>
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="text-gray-400 font-medium block mb-1">Title / Name Field</label>
                <select
                  value={notionApiMapping.nameField}
                  onChange={e => {
                    const newMap = { ...notionApiMapping, nameField: e.target.value };
                    setNotionApiMapping(newMap);
                    saveNotionConfig(tokenInput, selectedDbId, newMap);
                  }}
                  className="w-full bg-[#13151f] border border-[#2f3448] rounded p-2 text-gray-200"
                >
                  {schemaKeys.map(k => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-gray-400 font-medium block mb-1">Type Field</label>
                <select
                  value={notionApiMapping.typeField}
                  onChange={e => {
                    const newMap = { ...notionApiMapping, typeField: e.target.value };
                    setNotionApiMapping(newMap);
                    saveNotionConfig(tokenInput, selectedDbId, newMap);
                  }}
                  className="w-full bg-[#13151f] border border-[#2f3448] rounded p-2 text-gray-200"
                >
                  {schemaKeys.map(k => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-gray-400 font-medium block mb-1">Watched/Completed Field</label>
                <select
                  value={notionApiMapping.watchedOnField}
                  onChange={e => {
                    const newMap = { ...notionApiMapping, watchedOnField: e.target.value };
                    setNotionApiMapping(newMap);
                    saveNotionConfig(tokenInput, selectedDbId, newMap);
                  }}
                  className="w-full bg-[#13151f] border border-[#2f3448] rounded p-2 text-gray-200"
                >
                  {schemaKeys.map(k => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-gray-400 font-medium block mb-1">Score / Rating Field</label>
                <select
                  value={notionApiMapping.scoreField}
                  onChange={e => {
                    const newMap = { ...notionApiMapping, scoreField: e.target.value };
                    setNotionApiMapping(newMap);
                    saveNotionConfig(tokenInput, selectedDbId, newMap);
                  }}
                  className="w-full bg-[#13151f] border border-[#2f3448] rounded p-2 text-gray-200"
                >
                  {schemaKeys.map(k => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-gray-400 font-medium block mb-1">Status Field</label>
                <select
                  value={notionApiMapping.statusField}
                  onChange={e => {
                    const newMap = { ...notionApiMapping, statusField: e.target.value };
                    setNotionApiMapping(newMap);
                    saveNotionConfig(tokenInput, selectedDbId, newMap);
                  }}
                  className="w-full bg-[#13151f] border border-[#2f3448] rounded p-2 text-gray-200"
                >
                  {schemaKeys.map(k => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-gray-400 font-medium block mb-1">Language Field</label>
                <select
                  value={notionApiMapping.languageField}
                  onChange={e => {
                    const newMap = { ...notionApiMapping, languageField: e.target.value };
                    setNotionApiMapping(newMap);
                    saveNotionConfig(tokenInput, selectedDbId, newMap);
                  }}
                  className="w-full bg-[#13151f] border border-[#2f3448] rounded p-2 text-gray-200"
                >
                  {schemaKeys.map(k => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-gray-400 font-medium block mb-1">Thoughts Field</label>
                <select
                  value={notionApiMapping.thoughtsField}
                  onChange={e => {
                    const newMap = { ...notionApiMapping, thoughtsField: e.target.value };
                    setNotionApiMapping(newMap);
                    saveNotionConfig(tokenInput, selectedDbId, newMap);
                  }}
                  className="w-full bg-[#13151f] border border-[#2f3448] rounded p-2 text-gray-200"
                >
                  {schemaKeys.map(k => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-gray-400 font-medium block mb-1">Publisher Field</label>
                <select
                  value={notionApiMapping.publisherField}
                  onChange={e => {
                    const newMap = { ...notionApiMapping, publisherField: e.target.value };
                    setNotionApiMapping(newMap);
                    saveNotionConfig(tokenInput, selectedDbId, newMap);
                  }}
                  className="w-full bg-[#13151f] border border-[#2f3448] rounded p-2 text-gray-200"
                >
                  {schemaKeys.map(k => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Sync Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#232736]">
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={triggerSync}
                  disabled={isSyncing}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-md transition-all flex items-center space-x-2 cursor-pointer"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                  <span>{isSyncing ? 'Synchronizing...' : 'Perform Bidirectional Sync'}</span>
                </button>

                <button
                  type="button"
                  onClick={triggerImportFromApi}
                  disabled={isSyncing}
                  className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-md transition-all flex items-center space-x-2 cursor-pointer"
                >
                  <Database className="w-4 h-4" />
                  <span>Import from Notion API</span>
                </button>
              </div>

              {lastSyncTime && (
                <span className="text-xs text-gray-400 font-mono">
                  Last Synced: {new Date(lastSyncTime).toLocaleString()}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Sync Summary & Conflict Resolution Panel */}
        {syncResult && (
          <div className="bg-[#102419] border border-emerald-500/40 p-4 rounded-xl text-xs space-y-2 animate-fadeIn">
            <h4 className="font-bold text-emerald-400 flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>Notion Sync Executed Successfully</span>
            </h4>
            <p className="text-gray-300">
              Pulled/Updated <strong className="text-emerald-400">{syncResult.importedCount}</strong> records from Notion → Pushed <strong className="text-purple-400">{syncResult.pushedCount}</strong> app tracking sessions to Notion pages. Detected <strong className="text-amber-400">{syncResult.conflictsCount}</strong> conflicts.
            </p>
          </div>
        )}

        {syncErrors.length > 0 && (
          <div className="bg-[#2a1719] border border-rose-500/40 p-4 rounded-xl text-xs text-rose-300 space-y-1">
            <h4 className="font-bold flex items-center space-x-1">
              <AlertCircle className="w-4 h-4" />
              <span>Sync Errors Encountered:</span>
            </h4>
            <ul className="list-disc pl-5 space-y-0.5 text-gray-300">
              {syncErrors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Conflict Resolution UI */}
        {conflicts.length > 0 && (
          <div className="bg-[#261d15] border border-amber-500/50 p-5 rounded-xl space-y-4 animate-fadeIn">
            <h3 className="text-sm font-bold text-amber-300 flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-amber-400" />
              <span>Active Conflicts Requiring Resolution ({conflicts.length})</span>
            </h3>

            <div className="space-y-3">
              {conflicts.map(conflict => (
                <div key={conflict.id} className="bg-[#1a1410] border border-amber-500/30 p-4 rounded-xl text-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white text-sm">{conflict.mediaTitle}</span>
                    <span className="bg-amber-950 text-amber-300 px-2 py-0.5 rounded text-[11px] font-semibold">
                      Field: {conflict.field}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-gray-300">
                    <div className="bg-[#211a14] p-3 rounded-lg border border-amber-500/20 space-y-1">
                      <span className="text-[10px] text-amber-400/80 font-bold block">NOTION VALUE</span>
                      <p className="font-mono text-white text-xs">{conflict.notionValue || '(empty)'}</p>
                    </div>

                    <div className="bg-[#211a14] p-3 rounded-lg border border-amber-500/20 space-y-1">
                      <span className="text-[10px] text-purple-400/80 font-bold block">APP LOCAL VALUE</span>
                      <p className="font-mono text-white text-xs">{conflict.appValue || '(empty)'}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-end space-x-2 pt-1">
                    <button
                      type="button"
                      onClick={() => resolveConflict(conflict, 'notion')}
                      className="bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center space-x-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Keep Notion Value</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => resolveConflict(conflict, 'app')}
                      className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg transition-all cursor-pointer flex items-center space-x-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Keep App Value</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Local Folder Architecture & Directory Scanner Section */}
      <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-4">
        <h2 className="text-lg font-bold text-white flex items-center space-x-2">
          <Folder className="w-5 h-5 text-rose-500" />
          <span>Local Library Folders & Directory Scanner</span>
        </h2>
        <p className="text-xs text-gray-400">
          Configure root directories for media files on your Windows machine using native file selection dialogs and run read-only local scans.
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
                className="w-full bg-rose-600/90 hover:bg-rose-500 disabled:opacity-50 text-white font-semibold text-xs py-2.5 rounded-lg flex items-center justify-center space-x-2 shadow-sm transition-all mt-4 cursor-pointer"
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
              className="bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-md transition-all cursor-pointer"
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
          <div role="alert" className="bg-[#2a1719] border border-rose-500/40 p-4 rounded-xl text-xs flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <div>
              <h4 className="font-bold text-rose-300">Library Scan Failed</h4>
              <p className="text-gray-300 mt-0.5">{scanError}</p>
            </div>
          </div>
        )}
      </section>

      {/* External Metadata API Credentials Section */}
      <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-4">
        <div className="flex items-center justify-between border-b border-[#232736] pb-3">
          <h2 className="text-lg font-bold text-white flex items-center space-x-2">
            <Key className="w-5 h-5 text-rose-500" />
            <span>Metadata API Keys & Providers</span>
          </h2>
          <span className="text-xs text-gray-400 flex items-center space-x-1">
            <Lock className="w-3.5 h-3.5 text-emerald-400" />
            <span>Stored Locally in SQLite</span>
          </span>
        </div>

        <p className="text-xs text-gray-300 leading-relaxed">
          API credentials enable live metadata and artwork fetching from TMDB and IGDB/RAWG. If keys are not configured, demo/mock metadata fallback mode is active.
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

          <div className="bg-[#1a1d29] p-3 rounded-xl border border-[#2d3145] flex items-center justify-between">
            <span className="font-bold text-white">RAWG (Games)</span>
            {rawgApiKey ? (
              <span className="bg-emerald-950 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-semibold text-[11px] flex items-center space-x-1">
                <ShieldCheck className="w-3 h-3" />
                <span>Configured</span>
              </span>
            ) : (
              <span className="bg-gray-800 text-gray-400 border border-gray-700 px-2 py-0.5 rounded text-[11px]">
                Optional
              </span>
            )}
          </div>
        </div>

        <form onSubmit={handleSaveApiKeys} className="space-y-4 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-300 font-bold block mb-1">Country / Streaming Region</label>
              <div className="flex items-center space-x-2">
                <Globe className="w-4 h-4 text-rose-400 shrink-0" />
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

            <div>
              <label className="text-xs text-gray-300 font-bold block mb-1">Steam API Key (Game Title Logos)</label>
              <input
                type="password"
                value={steamApiKey}
                onChange={e => setSteamApiKey(e.target.value)}
                placeholder="Steam Web API Key"
                className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2.5 text-xs text-gray-100 font-mono"
              />
            </div>

            <div>
              <label className="text-xs text-gray-300 font-bold block mb-1">RAWG API Key (Optional Game Fallback)</label>
              <input
                type="password"
                value={rawgApiKey}
                onChange={e => setRawgApiKey(e.target.value)}
                placeholder="RAWG API Key"
                className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2.5 text-xs text-gray-100 font-mono"
              />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              className="bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-md transition-all cursor-pointer"
            >
              Save API Settings
            </button>
          </div>
        </form>
      </section>

      {/* Notion CSV Import Fallback Wizard */}
      <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-4">
        <h2 className="text-lg font-bold text-white flex items-center space-x-2">
          <FileSpreadsheet className="w-5 h-5 text-rose-500" />
          <span>Notion Database CSV Export Import Wizard</span>
        </h2>
        <p className="text-xs text-gray-400">
          Upload a local Notion database export (.csv). The importer will parse clean titles and context notes while preserving un-altered raw Notion records.
        </p>

        <div className="space-y-4 pt-2">
          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-2 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs px-4 py-2.5 rounded-xl cursor-pointer transition-all shadow-md">
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
                <Sparkles className="w-4 h-4 text-rose-400" />
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
