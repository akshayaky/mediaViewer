import React, { useState, useEffect } from 'react';
import { dbService } from '../services/DatabaseService';
import { notionService } from '../services/NotionIntegrationService';
import { localScannerService, ScanResult } from '../services/LocalScannerService';
import { AppSettings, MediaType } from '../types/media';
import { NotionColumnMapping, NotionImportResult } from '../providers/interfaces';
import Papa from 'papaparse';
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
  FolderSearch
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>(dbService.getSettings());

  // Input states
  const [moviesFolder, setMoviesFolder] = useState(settings.movies_folder || 'D:\\Movies');
  const [tvFolder, setTvFolder] = useState(settings.tv_folder || 'D:\\TV');
  const [gamesFolder, setGamesFolder] = useState(settings.games_folder || 'D:\\Games');
  const [region, setRegion] = useState(settings.country_region || 'United States');
  const [tmdbKey, setTmdbKey] = useState(settings.tmdb_api_key || '');
  const [igdbKey, setIgdbKey] = useState(settings.igdb_api_key || '');
  const [notionToken, setNotionToken] = useState(settings.notion_integration_token || '');

  const [savedMessage, setSavedMessage] = useState('');

  // Local Directory Scanner state
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ type: MediaType; result: ScanResult } | null>(null);

  // Notion CSV Import Wizard state
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<any[]>([]);
  const [mapping, setMapping] = useState<NotionColumnMapping>({
    typeField: 'Type',
    nameField: 'Name',
    watchedOnField: 'Watched On/Completed Watching',
    scoreField: 'Score /5',
    statusField: 'Status',
    languageField: 'Language',
    thoughtsField: 'Thoughts',
    publisherField: 'Publisher'
  });
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<NotionImportResult | null>(null);

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

  const handleScanDirectory = async (folderPath: string, mediaType: MediaType) => {
    if (!folderPath.trim()) return;

    setIsScanning(true);
    setScanResult(null);

    try {
      const result = await localScannerService.scanFolder(folderPath, mediaType);
      setScanResult({ type: mediaType, result });
      setSavedMessage(`Scanned ${mediaType} folder: ${result.totalScanned} files processed.`);
      setTimeout(() => setSavedMessage(''), 4000);
    } catch (err: any) {
      console.error('Directory scan error:', err);
    } finally {
      setIsScanning(false);
    }
  };

  const handleSaveApiKeys = (e: React.FormEvent) => {
    e.preventDefault();
    dbService.saveSetting('tmdb_api_key', tmdbKey);
    dbService.saveSetting('igdb_api_key', igdbKey);
    dbService.saveSetting('notion_integration_token', notionToken);
    dbService.saveSetting('country_region', region);
    setSavedMessage('API integrations and preferences saved.');
    setTimeout(() => setSavedMessage(''), 3000);
  };

  const handleFolderSelect = (key: 'movies' | 'tv' | 'games') => {
    const defaultPaths = {
      movies: 'D:\\Movies',
      tv: 'D:\\TV',
      games: 'D:\\Games'
    };
    const path = prompt(`Enter path for ${key} folder:`, defaultPaths[key]);
    if (path) {
      if (key === 'movies') setMoviesFolder(path);
      if (key === 'tv') setTvFolder(path);
      if (key === 'games') setGamesFolder(path);
    }
  };

  // Handle Notion CSV Upload
  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.meta.fields) {
          setCsvHeaders(results.meta.fields);
          setCsvRows(results.data);

          const fields = results.meta.fields;
          const guessField = (keywords: string[]) =>
            fields.find(f => keywords.some(k => f.toLowerCase().includes(k))) || fields[0];

          setMapping({
            typeField: guessField(['type']),
            nameField: guessField(['name', 'title']),
            watchedOnField: guessField(['watched', 'completed', 'date']),
            scoreField: guessField(['score', 'rating', 'star']),
            statusField: guessField(['status', 'state']),
            languageField: guessField(['language', 'lang']),
            thoughtsField: guessField(['thought', 'note', 'review']),
            publisherField: guessField(['publisher', 'platform', 'developer'])
          });
        }
      }
    });
  };

  const handleRunNotionImport = async () => {
    if (csvRows.length === 0) return;
    setIsImporting(true);
    setImportResult(null);

    try {
      const result = await notionService.importFromRows(csvRows, mapping);
      setImportResult(result);
    } catch (err: any) {
      setImportResult({
        totalRows: csvRows.length,
        importedMediaCount: 0,
        importedHistoryCount: 0,
        rawRecordsSaved: 0,
        errors: [err.message || String(err)]
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="p-8 space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="border-b border-[#1f222e] pb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold text-[#ffffff] tracking-tight flex items-center space-x-3">
            <Settings className="w-8 h-8 text-rose-500" />
            <span>Settings & Integrations</span>
          </h1>
          <p className="text-sm text-rose-400/80 font-medium mt-1">
            Configure local folders, run library scans, API keys, and import Notion databases
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
          Configure root directories for media files on your Windows machine and run read-only local scans.
        </p>

        <form onSubmit={handleSaveFolders} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Movies Folder */}
            <div className="bg-[#1a1d29] p-4 rounded-xl border border-[#2d3145] space-y-2">
              <label className="text-xs text-gray-300 font-bold block">Movies Folder</label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={moviesFolder}
                  onChange={e => setMoviesFolder(e.target.value)}
                  placeholder="D:\Movies"
                  className="w-full bg-[#13151f] border border-[#2d3145] rounded-lg p-2 text-xs text-gray-100"
                />
                <button
                  type="button"
                  onClick={() => handleFolderSelect('movies')}
                  className="bg-[#242838] hover:bg-[#2d3247] text-gray-200 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                >
                  Browse
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleScanDirectory(moviesFolder, 'Film')}
                disabled={isScanning}
                className="w-full bg-rose-600/90 hover:bg-rose-500 text-white font-semibold text-xs py-2 rounded-lg flex items-center justify-center space-x-2 shadow-sm transition-all mt-2"
              >
                <FolderSearch className="w-4 h-4" />
                <span>Scan Movies Folder</span>
              </button>
            </div>

            {/* TV Shows Folder */}
            <div className="bg-[#1a1d29] p-4 rounded-xl border border-[#2d3145] space-y-2">
              <label className="text-xs text-gray-300 font-bold block">TV Shows Folder</label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={tvFolder}
                  onChange={e => setTvFolder(e.target.value)}
                  placeholder="D:\TV"
                  className="w-full bg-[#13151f] border border-[#2d3145] rounded-lg p-2 text-xs text-gray-100"
                />
                <button
                  type="button"
                  onClick={() => handleFolderSelect('tv')}
                  className="bg-[#242838] hover:bg-[#2d3247] text-gray-200 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                >
                  Browse
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleScanDirectory(tvFolder, 'TV Series')}
                disabled={isScanning}
                className="w-full bg-sky-600/90 hover:bg-sky-500 text-white font-semibold text-xs py-2 rounded-lg flex items-center justify-center space-x-2 shadow-sm transition-all mt-2"
              >
                <FolderSearch className="w-4 h-4" />
                <span>Scan TV Folder</span>
              </button>
            </div>

            {/* Games Folder */}
            <div className="bg-[#1a1d29] p-4 rounded-xl border border-[#2d3145] space-y-2">
              <label className="text-xs text-gray-300 font-bold block">Games Folder</label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={gamesFolder}
                  onChange={e => setGamesFolder(e.target.value)}
                  placeholder="D:\Games"
                  className="w-full bg-[#13151f] border border-[#2d3145] rounded-lg p-2 text-xs text-gray-100"
                />
                <button
                  type="button"
                  onClick={() => handleFolderSelect('games')}
                  className="bg-[#242838] hover:bg-[#2d3247] text-gray-200 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                >
                  Browse
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleScanDirectory(gamesFolder, 'VideoGame')}
                disabled={isScanning}
                className="w-full bg-purple-600/90 hover:bg-purple-500 text-white font-semibold text-xs py-2 rounded-lg flex items-center justify-center space-x-2 shadow-sm transition-all mt-2"
              >
                <FolderSearch className="w-4 h-4" />
                <span>Scan Games Folder</span>
              </button>
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              className="bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-md transition-all"
            >
              Save Folder Settings
            </button>
          </div>
        </form>

        {/* Real-time Scan Progress & Feedback Banner */}
        {scanResult && (
          <div className="bg-[#102419] border border-emerald-500/40 p-4 rounded-xl text-xs space-y-2 animate-fadeIn">
            <h4 className="font-bold text-emerald-400 flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>Library Scan Summary ({scanResult.type})</span>
            </h4>
            <p className="text-gray-300">
              Processed {scanResult.result.totalScanned} files → Auto-matched & linked {scanResult.result.autoMatchedCount} items to Media entries. Routed {scanResult.result.unmatchedCount} ambiguous files to Unmatched Inbox. Updated {scanResult.result.missingMarkedCount} missing files.
            </p>
          </div>
        )}
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
                  onClick={handleRunNotionImport}
                  disabled={isImporting}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-md transition-all flex items-center space-x-2"
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

      {/* External API Keys & Region Section */}
      <section className="bg-[#14161f] p-6 rounded-2xl border border-[#232736] space-y-4">
        <h2 className="text-lg font-bold text-white flex items-center space-x-2">
          <Key className="w-5 h-5 text-rose-500" />
          <span>Metadata API Keys & Region</span>
        </h2>
        <p className="text-xs text-gray-400">
          API credentials for external integrations (TMDB, IGDB, Notion API token). Secrets are stored locally in SQLite.
        </p>

        <form onSubmit={handleSaveApiKeys} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-300 font-medium block mb-1">Country / Region</label>
              <div className="flex items-center space-x-2">
                <Globe className="w-4 h-4 text-gray-400" />
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
              <label className="text-xs text-gray-300 font-medium block mb-1">TMDB API Key (Movies/TV)</label>
              <input
                type="password"
                value={tmdbKey}
                onChange={e => setTmdbKey(e.target.value)}
                placeholder="Enter TMDB v3 or v4 bearer key"
                className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2.5 text-xs text-gray-100 font-mono"
              />
            </div>

            <div>
              <label className="text-xs text-gray-300 font-medium block mb-1">IGDB Client ID / Secret (Games)</label>
              <input
                type="password"
                value={igdbKey}
                onChange={e => setIgdbKey(e.target.value)}
                placeholder="Enter IGDB credentials"
                className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2.5 text-xs text-gray-100 font-mono"
              />
            </div>

            <div>
              <label className="text-xs text-gray-300 font-medium block mb-1">Notion Integration Token</label>
              <input
                type="password"
                value={notionToken}
                onChange={e => setNotionToken(e.target.value)}
                placeholder="secret_..."
                className="w-full bg-[#1b1d2a] border border-[#2d3145] rounded-lg p-2.5 text-xs text-gray-100 font-mono"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs px-5 py-2.5 rounded-xl shadow-md transition-all"
            >
              Save API Settings
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
