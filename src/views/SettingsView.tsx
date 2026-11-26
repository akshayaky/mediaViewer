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
  Trash2,
  Film,
  Tv,
  Gamepad2,
  Sliders,
  PlayCircle,
  HardDrive,
  Info,
  Wifi
} from 'lucide-react';

import { useSidebarPadding } from '../hooks/useSidebarPadding';
import { SyncModal } from '../ui/sync/SyncModal';
import { SyncStatusBadge } from '../ui/sync/SyncStatusBadge';

type SettingsTab = 'general' | 'integrations' | 'advanced';

interface SettingsViewProps {
  isCollapsed?: boolean;
}

interface SettingsRowProps {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

const SettingsRow: React.FC<SettingsRowProps> = ({
  title,
  description,
  badge,
  children,
  className = ''
}) => (
  <div className={`px-5 sm:px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors hover:bg-white/[0.015] ${className}`}>
    <div className="space-y-1 max-w-xl pr-4">
      <div className="flex items-center space-x-2">
        <span className="text-sm font-semibold text-white tracking-wide">{title}</span>
        {badge}
      </div>
      {description && <p className="text-xs text-gray-400 leading-relaxed">{description}</p>}
    </div>
    <div className="flex items-center justify-start md:justify-end shrink-0">
      {children}
    </div>
  </div>
);

interface SettingsSectionProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}

const SettingsSection: React.FC<SettingsSectionProps> = ({
  title,
  description,
  icon,
  headerAction,
  children
}) => (
  <section className="bg-[#12141d] rounded-2xl border border-[#212433] shadow-lg shadow-black/20 overflow-hidden transition-all">
    <div className="px-5 sm:px-6 py-4 border-b border-[#1c1f2e] bg-[#141722]/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="space-y-0.5">
        <h2 className="text-base sm:text-lg font-bold text-white flex items-center space-x-2.5">
          {icon}
          <span>{title}</span>
        </h2>
        {description && <p className="text-xs text-gray-400">{description}</p>}
      </div>
      {headerAction && <div className="shrink-0">{headerAction}</div>}
    </div>
    <div className="divide-y divide-[#1c1f2e]">
      {children}
    </div>
  </section>
);

interface SettingsToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
  disabled?: boolean;
}

const SettingsToggle: React.FC<SettingsToggleProps> = ({
  checked,
  onChange,
  ariaLabel,
  disabled = false
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#E27D12]/40 focus:ring-offset-2 focus:ring-offset-[#12141d] disabled:opacity-50 disabled:cursor-not-allowed ${
      checked ? 'bg-[#E27D12]' : 'bg-[#252838]'
    }`}
  >
    <span
      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
        checked ? 'translate-x-5' : 'translate-x-0'
      }`}
    />
  </button>
);

interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (val: T) => void;
  options: { value: T; label: string }[];
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options
}: SegmentedControlProps<T>) {
  return (
    <div className="inline-flex rounded-lg bg-[#0c0e15] p-1 border border-[#232738] shadow-inner">
      {options.map(opt => {
        const isSelected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 text-xs rounded-md transition-all cursor-pointer whitespace-nowrap ${
              isSelected
                ? 'bg-[#E27D12]/20 text-[#E27D12] border border-[#E27D12]/40 font-semibold shadow-sm'
                : 'text-gray-400 hover:text-gray-200 border border-transparent font-medium'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export const SettingsView: React.FC<SettingsViewProps> = ({ isCollapsed }) => {
  const { isDesktop, pagePadding } = useSidebarPadding(isCollapsed);
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
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
  const [autoSkipIntro, setAutoSkipIntro] = useState<boolean>(Boolean(settings.auto_skip_intro));
  const [autoSkipRecap, setAutoSkipRecap] = useState<boolean>(Boolean(settings.auto_skip_recap));
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
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);

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
    mapping: notionApiMapping,
    saveNotionConfig,
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
      setAutoSkipIntro(Boolean(nextSettings.auto_skip_intro));
      setAutoSkipRecap(Boolean(nextSettings.auto_skip_recap));
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

  const handleSaveFolders = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
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
      dbService.saveSetting('auto_skip_intro', autoSkipIntro),
      dbService.saveSetting('auto_skip_recap', autoSkipRecap),
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

  const libraryFolders = [
    {
      key: 'movies' as const,
      type: 'Film' as const,
      label: 'Movies Folder',
      sublabel: 'Film & Feature Releases',
      path: moviesFolder,
      setPath: setMoviesFolder,
      icon: <Film className="w-4 h-4 text-[#E27D12]" />
    },
    {
      key: 'tv' as const,
      type: 'TV Series' as const,
      label: 'TV Shows Folder',
      sublabel: 'Series & Anime Seasons',
      path: tvFolder,
      setPath: setTvFolder,
      icon: <Tv className="w-4 h-4 text-[#E27D12]" />
    },
    {
      key: 'games' as const,
      type: 'VideoGame' as const,
      label: 'Games Folder',
      sublabel: 'PC & Emulated Titles',
      path: gamesFolder,
      setPath: setGamesFolder,
      icon: <Gamepad2 className="w-4 h-4 text-[#E27D12]" />
    }
  ];

  return (
    <div
      className="p-4 sm:p-6 md:p-8 pb-24 md:pb-8 space-y-8 max-w-[1400px] w-full mx-auto transition-all duration-300"
      style={{
        paddingLeft: pagePadding,
        paddingTop: isDesktop ? '' : 'calc(env(safe-area-inset-top, 0px) + 12px)'
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

      {/* Header & Navigation */}
      <header className="border-b border-[#1f222e] pb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-[11px] font-mono uppercase tracking-wider text-[#E27D12] font-bold mb-1.5">
            <span>PREFERENCE SUITE</span>
            <span className="text-gray-600">/</span>
            <span className="text-gray-400">DESKTOP NODE</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center space-x-3">
            <span>Settings & Notion Hub</span>
          </h1>
          <p className="text-xs sm:text-sm text-gray-400 mt-1 max-w-2xl leading-relaxed">
            Manage local media library directories, appearance & layout preferences, external API provider keys, and streaming playback behavior.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {savedMessage && (
            <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center space-x-2 animate-fadeIn shadow-sm">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{savedMessage}</span>
            </span>
          )}

          <button
            type="button"
            onClick={() => setIsSyncModalOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#181c28] hover:bg-[#212636] border border-[#2a2f42] text-xs font-semibold text-gray-100 transition-colors cursor-pointer"
          >
            <Wifi className="w-3.5 h-3.5 text-[#E27D12]" />
            <span>Sync / Pair Device</span>
          </button>
          <SyncStatusBadge compact onClick={() => setIsSyncModalOpen(true)} />

          {/* Settings Tabs */}
          <div className="inline-flex rounded-xl bg-[#12141d] p-1 border border-[#232736] shadow-inner">
            {(['general', 'integrations', 'advanced'] as const).map(tabKey => {
              const label = tabKey === 'general' ? 'General' : tabKey === 'integrations' ? 'Integrations' : 'Advanced';
              const isActive = activeTab === tabKey;
              return (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => setActiveTab(tabKey)}
                  className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#1e2231] text-[#E27D12] border border-[#E27D12]/40 shadow-sm'
                      : 'text-gray-400 hover:text-gray-200 border border-transparent'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* TAB CONTENT */}

      {/* 1. GENERAL TAB */}
      {activeTab === 'general' && (
        <div className="space-y-8 animate-fadeIn">
          {/* Section 1: Local Library */}
          <SettingsSection
            title="Local Library"
            description={`Root directories for media indexing and metadata matching across local storage.${isAndroid ? ' Android does not support folder selection here; use Browse to select media files instead.' : ''}`}
            icon={<Folder className="w-5 h-5 text-[#E27D12]" />}
            headerAction={
              <div className="flex items-center space-x-3">
                <span className="hidden sm:inline-block text-[11px] text-gray-400">
                  • Changes auto-save to local config
                </span>
                <button
                  type="button"
                  onClick={() => void handleSaveFolders()}
                  className="bg-[#E27D12] hover:bg-[#c96d0d] text-white font-semibold text-xs px-4 py-2 rounded-lg shadow-sm transition-all flex items-center space-x-1.5 cursor-pointer shrink-0"
                >
                  <span>Save Changes</span>
                </button>
              </div>
            }
          >
            {libraryFolders.map(row => {
              const isCurrentScanning = scanningType === row.type;
              return (
                <div
                  key={row.key}
                  className="px-5 sm:px-6 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-colors hover:bg-white/[0.015]"
                >
                  {/* Category Info */}
                  <div className="flex items-center space-x-3.5 lg:w-64 shrink-0">
                    <div className="w-10 h-10 rounded-xl bg-[#171a26] border border-[#262b3d] flex items-center justify-center shrink-0 shadow-inner">
                      {row.icon}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white tracking-wide">{row.label}</div>
                      <div className="text-xs text-gray-400">{row.sublabel}</div>
                    </div>
                  </div>

                  {/* Folder Input + Controls */}
                  <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 min-w-0">
                    <input
                      type="text"
                      value={row.path}
                      onChange={e => row.setPath(e.target.value)}
                      placeholder={row.key === 'movies' ? 'D:\\Media\\Movies' : row.key === 'tv' ? 'D:\\Media\\TV Shows' : 'D:\\Games'}
                      className="flex-1 min-w-0 bg-[#0c0e15] border border-[#232738] rounded-lg px-3.5 py-2 text-xs text-gray-100 font-mono focus:border-[#E27D12] focus:ring-1 focus:ring-[#E27D12]/30 focus:outline-none placeholder-gray-600 transition-all shadow-inner"
                    />

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => void handleFolderBrowseClick(e, row.key)}
                        className="bg-[#181a26] hover:bg-[#222536] text-gray-200 px-3.5 py-2 rounded-lg text-xs font-semibold border border-[#2b3044] hover:border-gray-500 transition-all whitespace-nowrap cursor-pointer shadow-sm"
                      >
                        Browse
                      </button>

                      <button
                        type="button"
                        onClick={(e) => void handleScanDirectory(e, row.path, row.type)}
                        disabled={scanningType !== null}
                        className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition-all whitespace-nowrap flex items-center space-x-1.5 cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${
                          isCurrentScanning
                            ? 'bg-[#E27D12]/20 text-[#E27D12] border-[#E27D12]/50 animate-pulse'
                            : 'bg-[#181a26] hover:bg-[#222536] text-gray-200 hover:text-white border-[#2b3044] hover:border-[#E27D12]/40'
                        }`}
                      >
                        {isCurrentScanning ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#E27D12]" />
                            <span>Scanning... ({scanProgressCount})</span>
                          </>
                        ) : (
                          <>
                            <FolderSearch className="w-3.5 h-3.5 text-gray-400" />
                            <span>Scan</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Scan Progress & Banners inside Local Library */}
            {scanningType && (
              <div className="mx-5 sm:mx-6 my-4 bg-[#141d2e] border border-sky-500/40 p-4 rounded-xl text-xs space-y-1.5 flex items-center space-x-3.5 animate-pulse">
                <Loader2 className="w-5 h-5 text-sky-400 animate-spin shrink-0" />
                <div>
                  <h4 className="font-bold text-sky-300">Scanning in Progress: {scanningType} Folder</h4>
                  <p className="text-gray-300 mt-0.5">
                    Traversing directory structure, analyzing files, and running title matching algorithms... ({scanProgressCount} items processed)
                  </p>
                </div>
              </div>
            )}

            {scanResult && !scanningType && (
              <div className="mx-5 sm:mx-6 my-4 bg-[#0f241a] border border-emerald-500/40 p-4 rounded-xl text-xs space-y-1.5 animate-fadeIn">
                <h4 className="font-bold text-emerald-400 flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Library Scan Completed Successfully ({scanResult.type})</span>
                </h4>
                <p className="text-gray-300 leading-relaxed">
                  Scanned & Processed <strong className="text-white">{scanResult.result.totalScanned}</strong> files → Auto-matched & linked <strong className="text-emerald-400">{scanResult.result.autoMatchedCount}</strong> items directly to Media entities. Routed <strong className="text-amber-400">{scanResult.result.unmatchedCount}</strong> unknown/ambiguous files to Unmatched Inbox. Updated <strong className="text-gray-400">{scanResult.result.missingMarkedCount}</strong> offline files.
                </p>
              </div>
            )}

            {scanError && !scanningType && (
              <div role="alert" className="mx-5 sm:mx-6 my-4 bg-[#2b1619] border border-[#E27D12]/50 p-4 rounded-xl text-xs flex items-start space-x-2.5">
                <AlertCircle className="w-4 h-4 text-[#E27D12] shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-[#E27D12]">Library Scan Failed</h4>
                  <p className="text-gray-300 mt-0.5">{scanError}</p>
                </div>
              </div>
            )}
          </SettingsSection>

          {/* Section 2: Appearance & Display */}
          <SettingsSection
            title="Appearance & Display"
            description="Configure library card presentation, viewports, and navigation behavior."
            icon={<Sliders className="w-5 h-5 text-[#E27D12]" />}
          >
            <SettingsRow
              title="Hide sidebar in Detail View"
              description="Collapse navigation rail when viewing movie or game details (reveals on left-edge cursor hover)."
            >
              <SettingsToggle
                checked={sidebarHideEnabled}
                onChange={async (enabled) => {
                  setSidebarHideEnabled(enabled);
                  document.body.classList.toggle('sidebar-hide-enabled', enabled);
                  try {
                    await dbService.saveSetting('sidebar_hide_enabled', enabled);
                    setSavedMessage(`Sidebar auto-hide ${enabled ? 'enabled' : 'disabled'}.`);
                    setTimeout(() => setSavedMessage(''), 3000);
                  } catch (error) {
                    console.error('Failed to save sidebar visibility preference:', error);
                    setSavedMessage('Could not save UI preferences.');
                  }
                }}
                ariaLabel="Toggle hide sidebar in Detail View"
              />
            </SettingsRow>

            {([
              {
                type: 'Film' as const,
                label: 'Movies Card Layout',
                description: 'Presentation aspect ratio for films across grids and catalog browse pages.'
              },
              {
                type: 'TV Series' as const,
                label: 'TV Shows Card Layout',
                description: 'Presentation aspect ratio for serialized broadcasts, anime, and docuseries.'
              },
              {
                type: 'VideoGame' as const,
                label: 'Games Card Layout',
                description: 'Presentation aspect ratio for game library collections and launcher covers.'
              }
            ]).map(item => (
              <SettingsRow
                key={item.type}
                title={item.label}
                description={item.description}
              >
                <SegmentedControl
                  value={uiPreferences.card_orientation_by_type[item.type] || 'portrait'}
                  onChange={(val) => void handleCardOrientationChange(item.type, val as MediaCardOrientation)}
                  options={[
                    { value: 'landscape', label: 'Landscape (Backdrop)' },
                    { value: 'portrait', label: 'Portrait (Poster)' }
                  ]}
                />
              </SettingsRow>
            ))}
          </SettingsSection>

          {/* Section 3: Playback */}
          <SettingsSection
            title="Playback"
            description="Choose default playback engines, autoplay triggers, and automated stream skipping."
            icon={<PlayCircle className="w-5 h-5 text-[#E27D12]" />}
          >
            {/* Video Player Engine */}
            <div className="px-5 sm:px-6 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-colors hover:bg-white/[0.015]">
              <div className="space-y-1 max-w-xl pr-4">
                <span className="text-sm font-semibold text-white tracking-wide">Video Player Engine</span>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Decide whether media streams launch internally or pass straight to native system handlers.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full lg:max-w-2xl shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setPlayerMode('builtin');
                    void dbService.saveSetting('player_mode', 'builtin');
                    setSavedMessage('Player mode set to Built-in HTML5 Video Player.');
                    setTimeout(() => setSavedMessage(''), 3000);
                  }}
                  className={`p-3.5 rounded-xl border text-left transition-all flex items-start space-x-3 cursor-pointer ${
                    playerMode === 'builtin'
                      ? 'border-[#E27D12] bg-[#E27D12]/10 shadow-sm'
                      : 'border-[#242838] bg-[#0d0f16] hover:border-[#33384e]'
                  }`}
                >
                  <div className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                    playerMode === 'builtin' ? 'border-[#E27D12]' : 'border-gray-500'
                  }`}>
                    {playerMode === 'builtin' && <div className="w-2 h-2 rounded-full bg-[#E27D12]" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white flex items-center space-x-1.5">
                      <span>Built-in Video Player</span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">
                      Resume points, progress sync & styled subtitle engine
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPlayerMode('os_default');
                    void dbService.saveSetting('player_mode', 'os_default');
                    setSavedMessage('Player mode set to OS System Default App.');
                    setTimeout(() => setSavedMessage(''), 3000);
                  }}
                  className={`p-3.5 rounded-xl border text-left transition-all flex items-start space-x-3 cursor-pointer ${
                    playerMode === 'os_default'
                      ? 'border-[#E27D12] bg-[#E27D12]/10 shadow-sm'
                      : 'border-[#242838] bg-[#0d0f16] hover:border-[#33384e]'
                  }`}
                >
                  <div className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                    playerMode === 'os_default' ? 'border-[#E27D12]' : 'border-gray-500'
                  }`}>
                    {playerMode === 'os_default' && <div className="w-2 h-2 rounded-full bg-[#E27D12]" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white flex items-center space-x-1.5">
                      <span>OS System Default App</span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">
                      External binary handlers (VLC, MPC-HC, mpv)
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {/* TV Series Autoplay */}
            <SettingsRow
              title="TV Series Autoplay"
              description="Automatically play next episode on completion with a 10-second countdown timer."
            >
              <SettingsToggle
                checked={autoplayNext}
                onChange={(val) => {
                  setAutoplayNext(val);
                  void dbService.saveSetting('autoplay_next_episode', val);
                  setSavedMessage(`Autoplay next episode ${val ? 'enabled' : 'disabled'}.`);
                  setTimeout(() => setSavedMessage(''), 3000);
                }}
                ariaLabel="Toggle TV Series Autoplay"
              />
            </SettingsRow>

            {/* Automated Skip (IntroDB) */}
            <SettingsRow
              title="Automated Skip (IntroDB)"
              description="Automatically advance past community-flagged intros and recaps during stream playback. Manual skip buttons remain available regardless of these settings."
            >
              <div className="flex flex-wrap items-center gap-5">
                <label className="flex items-center space-x-2 text-xs font-medium text-gray-300 hover:text-white cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoSkipIntro}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setAutoSkipIntro(val);
                      void dbService.saveSetting('auto_skip_intro', val);
                      setSavedMessage(`Intro auto-skip ${val ? 'enabled' : 'disabled'}.`);
                      setTimeout(() => setSavedMessage(''), 3000);
                    }}
                    className="w-4 h-4 rounded bg-[#0d0f16] border-[#2d3145] text-[#E27D12] focus:ring-[#E27D12]/40 focus:ring-offset-0 focus:ring-1 cursor-pointer"
                  />
                  <span>Skip intros</span>
                </label>

                <label className="flex items-center space-x-2 text-xs font-medium text-gray-300 hover:text-white cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoSkipRecap}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setAutoSkipRecap(val);
                      void dbService.saveSetting('auto_skip_recap', val);
                      setSavedMessage(`Recap auto-skip ${val ? 'enabled' : 'disabled'}.`);
                      setTimeout(() => setSavedMessage(''), 3000);
                    }}
                    className="w-4 h-4 rounded bg-[#0d0f16] border-[#2d3145] text-[#E27D12] focus:ring-[#E27D12]/40 focus:ring-offset-0 focus:ring-1 cursor-pointer"
                  />
                  <span>Skip recaps</span>
                </label>
              </div>
            </SettingsRow>
          </SettingsSection>
        </div>
      )}

      {/* 2. INTEGRATIONS TAB */}
      {activeTab === 'integrations' && (
        <div className="space-y-8 animate-fadeIn">
          {/* External Metadata API Credentials */}
          <SettingsSection
            title="Metadata API Keys & Providers"
            description="API credentials enable live metadata and artwork fetching from TMDB and IGDB."
            icon={<Key className="w-5 h-5 text-[#E27D12]" />}
            headerAction={
              <span className="text-xs text-gray-400 flex items-center space-x-1.5 bg-[#171a26] px-3 py-1.5 rounded-lg border border-[#272b3c]">
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
                <span>Stored Locally in SQLite</span>
              </span>
            }
          >
            {/* Status Badges */}
            <div className="px-5 sm:px-6 py-4 bg-[#141724]/40 flex flex-wrap items-center gap-3">
              <div className="bg-[#181a26] px-3.5 py-2 rounded-xl border border-[#272b3d] flex items-center space-x-3 text-xs">
                <span className="font-semibold text-white">TMDB (Movies/TV):</span>
                {tmdbKey ? (
                  <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-semibold text-[11px] flex items-center space-x-1">
                    <ShieldCheck className="w-3 h-3" />
                    <span>Configured</span>
                  </span>
                ) : (
                  <span className="bg-amber-950/80 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded font-semibold text-[11px]">
                    Demo Fallback
                  </span>
                )}
              </div>

              <div className="bg-[#181a26] px-3.5 py-2 rounded-xl border border-[#272b3d] flex items-center space-x-3 text-xs">
                <span className="font-semibold text-white">IGDB (Twitch OAuth & Logos):</span>
                {twitchClientId && twitchClientSecret ? (
                  <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-semibold text-[11px] flex items-center space-x-1">
                    <ShieldCheck className="w-3 h-3" />
                    <span>Configured</span>
                  </span>
                ) : (
                  <span className="bg-amber-950/80 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded font-semibold text-[11px]">
                    Demo Fallback
                  </span>
                )}
              </div>
            </div>

            <form onSubmit={handleSaveApiKeys}>
              <SettingsRow
                title="Country / Streaming Region"
                description="Preferred regional release dates, certifications, and localized provider availability."
              >
                <div className="flex items-center space-x-2 w-full md:w-80">
                  <Globe className="w-4 h-4 text-[#E27D12] shrink-0" />
                  <input
                    type="text"
                    value={region}
                    onChange={e => setRegion(e.target.value)}
                    placeholder="e.g. United States, India"
                    className="w-full bg-[#0c0e15] border border-[#232738] rounded-lg px-3 py-2 text-xs text-gray-100 focus:border-[#E27D12] focus:outline-none"
                  />
                </div>
              </SettingsRow>

              <SettingsRow
                title="TMDB API Key (v3)"
                description="Powers movie and series posters, backdrops, cast directories, and episode data."
              >
                <input
                  type="password"
                  value={tmdbKey}
                  onChange={e => setTmdbKey(e.target.value)}
                  placeholder="TMDB v3 API Key"
                  className="w-full md:w-80 bg-[#0c0e15] border border-[#232738] rounded-lg px-3 py-2 text-xs text-gray-100 font-mono focus:border-[#E27D12] focus:outline-none"
                />
              </SettingsRow>

              <SettingsRow
                title="Twitch Client ID (IGDB)"
                description="Twitch Developer application Client ID for high-resolution game box art & metadata."
              >
                <input
                  type="password"
                  value={twitchClientId}
                  onChange={e => setTwitchClientId(e.target.value)}
                  placeholder="Twitch Developer Client ID"
                  className="w-full md:w-80 bg-[#0c0e15] border border-[#232738] rounded-lg px-3 py-2 text-xs text-gray-100 font-mono focus:border-[#E27D12] focus:outline-none"
                />
              </SettingsRow>

              <SettingsRow
                title="Twitch Client Secret (IGDB)"
                description="Twitch Developer application Client Secret for OAuth token generation."
              >
                <input
                  type="password"
                  value={twitchClientSecret}
                  onChange={e => setTwitchClientSecret(e.target.value)}
                  placeholder="Twitch Developer Client Secret"
                  className="w-full md:w-80 bg-[#0c0e15] border border-[#232738] rounded-lg px-3 py-2 text-xs text-gray-100 font-mono focus:border-[#E27D12] focus:outline-none"
                />
              </SettingsRow>

              <div className="px-5 sm:px-6 py-4 bg-[#141724]/30 flex justify-end">
                <button
                  type="submit"
                  className="bg-[#E27D12] hover:bg-[#c96d0d] text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-md transition-all cursor-pointer"
                >
                  Save API Settings
                </button>
              </div>
            </form>
          </SettingsSection>

          {/* Notion Database CSV Export Import Wizard */}
          <SettingsSection
            title="Notion Database CSV Import Wizard"
            description="Upload a local Notion database export (.csv). The importer will parse clean titles and context notes while preserving un-altered raw Notion records."
            icon={<FileSpreadsheet className="w-5 h-5 text-[#E27D12]" />}
          >
            <div className="p-5 sm:p-6 space-y-5">
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center space-x-2 bg-[#E27D12] hover:bg-[#c96d0d] text-white font-semibold text-xs px-4 py-2.5 rounded-xl cursor-pointer transition-all shadow-md">
                  <Upload className="w-4 h-4" />
                  <span>Select Notion CSV File</span>
                  <input type="file" accept=".csv" onChange={handleCsvFileUpload} className="hidden" />
                </label>
                {csvRows.length > 0 && (
                  <span className="text-xs text-emerald-400 font-medium flex items-center space-x-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Loaded {csvRows.length} database rows</span>
                  </span>
                )}
              </div>

              {/* Column Mapping UI */}
              {csvHeaders.length > 0 && (
                <div className="bg-[#171a26] p-5 rounded-xl border border-[#262b3d] space-y-4">
                  <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                    <Sparkles className="w-4 h-4 text-[#E27D12]" />
                    <span>Configure Column Mapping</span>
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div>
                      <label className="text-gray-400 font-medium block mb-1">Title / Name Field</label>
                      <select
                        value={csvMapping.nameField}
                        onChange={e => setCsvMapping({ ...csvMapping, nameField: e.target.value })}
                        className="w-full bg-[#0c0e15] border border-[#272b3c] rounded p-2 text-gray-200"
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
                        className="w-full bg-[#0c0e15] border border-[#272b3c] rounded p-2 text-gray-200"
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
                        className="w-full bg-[#0c0e15] border border-[#272b3c] rounded p-2 text-gray-200"
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
                        className="w-full bg-[#0c0e15] border border-[#272b3c] rounded p-2 text-gray-200"
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
                        className="w-full bg-[#0c0e15] border border-[#272b3c] rounded p-2 text-gray-200"
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
                        className="w-full bg-[#0c0e15] border border-[#272b3c] rounded p-2 text-gray-200"
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
                        className="w-full bg-[#0c0e15] border border-[#272b3c] rounded p-2 text-gray-200"
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
                        className="w-full bg-[#0c0e15] border border-[#272b3c] rounded p-2 text-gray-200"
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
                          className="w-full bg-[#0c0e15] border border-[#272b3c] rounded p-2 text-gray-200"
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
                <div className="bg-[#102419] border border-emerald-500/40 p-4 rounded-xl text-xs space-y-1.5 animate-fadeIn">
                  <h4 className="font-bold text-emerald-400 flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Notion CSV Import Summary</span>
                  </h4>
                  <p className="text-gray-300 leading-relaxed">
                    Processed {csvImportResult.totalRows} Notion rows → Created/Updated {csvImportResult.importedMediaCount} canonical Media items & {csvImportResult.importedHistoryCount} MediaHistory interaction records. Archived {csvImportResult.rawRecordsSaved} raw records.
                  </p>
                </div>
              )}
            </div>
          </SettingsSection>
        </div>
      )}

      {/* 3. ADVANCED TAB */}
      {activeTab === 'advanced' && (
        <div className="space-y-8 animate-fadeIn">
          {/* Section 1: Clear Library Sections */}
          <SettingsSection
            title="Clear Library Sections"
            description="Permanently remove a media section and its associated history, file records, availability, and metadata links. Files on disk are never deleted."
            icon={<Trash2 className="w-5 h-5 text-[#E27D12]" />}
          >
            <div className="p-5 sm:p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {([
                  { type: 'Film' as const, label: 'Movies' },
                  { type: 'TV Series' as const, label: 'TV Shows' },
                  { type: 'VideoGame' as const, label: 'Games' }
                ]).map(section => (
                  <button
                    key={section.type}
                    type="button"
                    onClick={() => void handleClearMediaType(section.type, section.label)}
                    className="bg-[#171a26] hover:bg-red-950/30 text-gray-200 hover:text-red-400 border border-[#272b3d] hover:border-red-500/40 rounded-xl px-4 py-3 text-xs font-semibold transition-all cursor-pointer text-left flex items-center justify-between"
                  >
                    <span>Clear {section.label}</span>
                    <Trash2 className="w-4 h-4 opacity-70" />
                  </button>
                ))}
              </div>
              {deleteError && <p role="alert" className="text-xs text-[#E27D12]">{deleteError}</p>}
            </div>
          </SettingsSection>

          {/* Section 2: Database Architecture & Integrity Status */}
          <SettingsSection
            title="Database & Storage Architecture"
            description="Overview of SQLite persistence and atomic cascade trigger constraints."
            icon={<HardDrive className="w-5 h-5 text-[#E27D12]" />}
          >
            <div className="p-5 sm:p-6 space-y-4 text-xs text-gray-400 leading-relaxed">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#171a26] p-4 rounded-xl border border-[#262b3d] space-y-2">
                  <div className="font-semibold text-white flex items-center space-x-2">
                    <Info className="w-4 h-4 text-[#E27D12]" />
                    <span>Decoupled Canonical & Session History</span>
                  </div>
                  <p>
                    The <code className="text-gray-200 bg-[#0c0e15] px-1 py-0.5 rounded">media</code> table stores canonical entity metadata once. Each interaction session (watch, replay, abandon) appends a new record to <code className="text-gray-200 bg-[#0c0e15] px-1 py-0.5 rounded">media_history</code>.
                  </p>
                </div>

                <div className="bg-[#171a26] p-4 rounded-xl border border-[#262b3d] space-y-2">
                  <div className="font-semibold text-white flex items-center space-x-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Read-Only Local Scanner Operations</span>
                  </div>
                  <p>
                    The local directory scanner only indexes file references and extracts embedded metadata. It never modifies, moves, renames, or deletes files on disk.
                  </p>
                </div>
              </div>
            </div>
          </SettingsSection>
        </div>
      )}

      {/* Bottom Status Bar */}
      <footer className="border-t border-[#1f222e] pt-4 mt-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-400">
        <div className="flex items-center space-x-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="font-medium text-gray-300">SQLite Engine Ready</span>
          <span className="text-gray-600">|</span>
          <span>Local Index: Up to date</span>
        </div>
        <div className="font-mono text-[11px] text-gray-400">
          Schema v4.12 <span className="text-gray-600 mx-1">/</span> v1.0.0
        </div>
      </footer>

      <SyncModal
        isOpen={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
      />
    </div>
  );
};
