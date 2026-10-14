import React, { useState, useEffect, useRef } from 'react';
import { dbService } from '../services/DatabaseService';
import { localScannerService, isTauri } from '../services/LocalScannerService';
import { invoke } from '@tauri-apps/api/core';
import { AppSettings, MediaType } from '../types/media';
import { useNotionImporter } from '../hooks/useNotionImporter';
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
  ShieldCheck
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(dbService.getSettings());

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
  const [notionToken, setNotionToken] = useState(settings.notion_integration_token || '');

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
    mapping,
    setMapping,
    isImporting,
    importResult,
    parseCsvFile,
    runImport
  } = useNotionImporter();

  useEffect(() => {
    setSettings(dbService.getSettings());
  }, []);

  const handleSaveFolders = (e: React.FormEvent) => {
    e.preventDefault();
    dbService.saveSetting('movies_folder', moviesFolder);
    dbService.saveSetting('tv_folder', tvFolder);
    dbService.saveSetting('games_folder', gamesFolder);
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

  const handleSaveApiKeys = (e: React.FormEvent) => {
    e.preventDefault();
    dbService.saveSetting('tmdb_api_key', tmdbKey.trim());
    dbService.saveSetting('twitch_client_id', twitchClientId.trim());
    dbService.saveSetting('twitch_client_secret', twitchClientSecret.trim());
    dbService.saveSetting('rawg_api_key', rawgApiKey.trim());
    dbService.saveSetting('steam_api_key', steamApiKey.trim());
    dbService.saveSetting('notion_integration_token', notionToken.trim());
    dbService.saveSetting('country_region', region.trim());
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

          dbService.saveSetting(`${key}_folder`, selected);
          setSavedMessage(`Updated ${key} folder path: ${selected}`);
          setTimeout(() => setSavedMessage(''), 3000);
        }
      } catch (err) {
        console.error('Failed to open native folder picker in Tauri:', err);
      }
    } else {
      // Web Mode: Try showDirectoryPicker or fallback to hidden file input
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

            dbService.saveSetting(`${key}_folder`, displayPath);
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

      // Fallback HTML directory input
      if (key === 'movies' && moviesFolderInputRef.current) {
        moviesFolderInputRef.current.click();
      } else if (key === 'tv' && tvFolderInputRef.current) {
        tvFolderInputRef.current.click();
      } else if (key === 'games' && gamesFolderInputRef.current) {
        gamesFolderInputRef.current.click();
      }
    }
  };

  const handleHTMLFolderSelect = (e: React.ChangeEvent<HTMLInputElement>, key: 'movies' | 'tv' | 'games') => {
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

      dbService.saveSetting(`${key}_folder`, folderPath);
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
            <span>Settings & Integrations</span>
          </h1>
          <p className="text-sm text-rose-400/80 font-medium mt-1">
            Configure local folders using Windows File Explorer, run library scans with live feedback, configure API keys, and import Notion databases
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
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
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
            <span className="font-bold text-white">IGDB (Twitch OAuth)</span>
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
            <span className="font-bold text-white">Steam (Game Logos)</span>
            {steamApiKey ? (
              <span className="bg-emerald-950 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-semibold text-[11px] flex items-center space-x-1">
                <ShieldCheck className="w-3 h-3" />
                <span>Configured</span>
              </span>
            ) : (
              <span className="bg-amber-950 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded font-semibold text-[11px]">
                Public Store Search
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

            <div>
              <label className="text-xs text-gray-300 font-bold block mb-1">Notion Integration Token</label>
              <input
                type="password"
                value={notionToken}
                onChange={e => setNotionToken(e.target.value)}
                placeholder="secret_..."
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

      {/* Notion Integration & Column Mapper Section */}
      <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-4">
        <h2 className="text-lg font-bold text-white flex items-center space-x-2">
          <FileSpreadsheet className="w-5 h-5 text-rose-500" />
          <span>Notion Database CSV Import Wizard</span>
        </h2>
        <p className="text-xs text-gray-400">
          Upload your existing Notion database export (.csv). The importer will parse clean titles and context notes while preserving un-altered raw Notion records.
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
                    value={mapping.nameField}
                    onChange={e => setMapping({ ...mapping, nameField: e.target.value })}
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
                    value={mapping.typeField}
                    onChange={e => setMapping({ ...mapping, typeField: e.target.value })}
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
                    value={mapping.watchedOnField}
                    onChange={e => setMapping({ ...mapping, watchedOnField: e.target.value })}
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
                    value={mapping.scoreField}
                    onChange={e => setMapping({ ...mapping, scoreField: e.target.value })}
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
                    value={mapping.statusField}
                    onChange={e => setMapping({ ...mapping, statusField: e.target.value })}
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
                    value={mapping.languageField}
                    onChange={e => setMapping({ ...mapping, languageField: e.target.value })}
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
                    value={mapping.thoughtsField}
                    onChange={e => setMapping({ ...mapping, thoughtsField: e.target.value })}
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
                    value={mapping.publisherField}
                    onChange={e => setMapping({ ...mapping, publisherField: e.target.value })}
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
                  onClick={runImport}
                  disabled={isImporting}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-md transition-all flex items-center space-x-2 cursor-pointer"
                >
                  <Database className="w-4 h-4" />
                  <span>{isImporting ? 'Importing Rows...' : 'Execute Notion Import'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Import Results Banner */}
          {importResult && (
            <div className="bg-[#102419] border border-emerald-500/40 p-4 rounded-xl text-xs space-y-2">
              <h4 className="font-bold text-emerald-400 flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>Notion Import Summary</span>
              </h4>
              <p className="text-gray-300">
                Processed {importResult.totalRows} Notion rows → Created/Updated {importResult.importedMediaCount} canonical Media items & {importResult.importedHistoryCount} MediaHistory interaction records. Archived {importResult.rawRecordsSaved} raw records.
              </p>
              {importResult.errors.length > 0 && (
                <div className="text-rose-400 space-y-1">
                  <p className="font-bold flex items-center space-x-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Errors Encountered:</span>
                  </p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {importResult.errors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
