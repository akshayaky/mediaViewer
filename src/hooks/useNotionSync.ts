import { useState, useEffect } from 'react';
import { dbService } from '../services/DatabaseService';
import { notionService } from '../services/NotionIntegrationService';
import { notionSyncEngine } from '../services/NotionSyncEngine';
import { notionOAuthService } from '../services/NotionOAuthService';
import { NotionDatabase, NotionPropertySchema, NotionSyncConflict, NotionSyncResult } from '../types/notion';
import { NotionColumnMapping } from '../providers/interfaces';
import { DEFAULT_NOTION_COLUMN_MAPPING } from '../constants/appConstants';

export function useNotionSync() {
  const [token, setToken] = useState<string>('');
  const [isOAuth, setIsOAuth] = useState<boolean>(false);
  const [oauthWorkspace, setOauthWorkspace] = useState<string>('');
  const [databaseId, setDatabaseId] = useState<string>('');
  const [databases, setDatabases] = useState<NotionDatabase[]>([]);
  const [schema, setSchema] = useState<Record<string, NotionPropertySchema>>({});
  const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [isCreatingDatabase, setIsCreatingDatabase] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<NotionSyncResult | null>(null);
  const [conflicts, setConflicts] = useState<NotionSyncConflict[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');
  const [syncErrors, setSyncErrors] = useState<string[]>([]);
  const [mapping, setMapping] = useState<NotionColumnMapping>(DEFAULT_NOTION_COLUMN_MAPPING);

  useEffect(() => {
    const settings = dbService.getSettings();
    const active = notionOAuthService.getActiveToken();
    const oauthData = notionOAuthService.getOAuthData();

    const savedDbId = settings.notion_database_id || '';
    const savedMapping = settings.notion_field_mapping
      ? (typeof settings.notion_field_mapping === 'string'
          ? JSON.parse(settings.notion_field_mapping)
          : settings.notion_field_mapping)
      : DEFAULT_NOTION_COLUMN_MAPPING;

    setToken(active.token);
    setIsOAuth(active.isOAuth);
    setOauthWorkspace(oauthData?.workspace_name || '');
    setDatabaseId(savedDbId);
    setMapping(savedMapping);
    setLastSyncTime(settings.notion_last_sync_time || '');
    setSyncErrors(settings.notion_sync_errors || []);

    if (active.token) {
      loadDatabases(active.token);
    }
    if (active.token && savedDbId) {
      loadSchema(active.token, savedDbId);
    }
  }, []);

  const loadDatabases = async (tok: string) => {
    if (!tok) return;
    setIsLoadingDatabases(true);
    try {
      const dbs = await notionService.fetchDatabases(tok);
      setDatabases(dbs);
    } catch (err) {
      console.warn('Could not fetch Notion databases from API:', err);
    } finally {
      setIsLoadingDatabases(false);
    }
  };

  const loadSchema = async (tok: string, dbId: string) => {
    if (!tok || !dbId) return;
    setIsLoadingSchema(true);
    try {
      const sch = await notionService.fetchDatabaseSchema(tok, dbId);
      setSchema(sch);

      const keys = Object.keys(sch);
      if (keys.length > 0) {
        const guessKey = (keywords: string[], fallback: string) =>
          keys.find(k => keywords.some(kw => k.toLowerCase().includes(kw))) || fallback;

        setMapping(prev => ({
          ...prev,
          nameField: guessKey(['name', 'title'], prev.nameField),
          typeField: guessKey(['type', 'category'], prev.typeField),
          watchedOnField: guessKey(['watched', 'completed', 'date'], prev.watchedOnField),
          scoreField: guessKey(['score', 'rating', 'star'], prev.scoreField),
          statusField: guessKey(['status', 'state'], prev.statusField),
          languageField: guessKey(['language', 'lang'], prev.languageField),
          thoughtsField: guessKey(['thought', 'note', 'review'], prev.thoughtsField),
          publisherField: guessKey(['publisher', 'platform', 'developer'], prev.publisherField)
        }));
      }
    } catch (err) {
      console.warn('Could not fetch Notion schema from API:', err);
    } finally {
      setIsLoadingSchema(false);
    }
  };

  const connectNotionOAuth = async (clientId?: string, redirectUri?: string) => {
    const targetClientId = clientId || 'notion_app_client_id';
    const targetRedirectUri = redirectUri || 'https://localhost/oauth/notion/callback';

    const { url } = notionOAuthService.generateAuthUrl(targetClientId, targetRedirectUri);

    try {
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
      } else {
        window.open(url, '_blank');
      }
    } catch (err) {
      console.warn('Failed to open Notion OAuth URL, falling back to window.open:', err);
      window.open(url, '_blank');
    }
  };

  const disconnectNotion = () => {
    notionOAuthService.disconnect();
    setToken('');
    setIsOAuth(false);
    setOauthWorkspace('');
    setDatabaseId('');
    setDatabases([]);
    setSchema({});
  };

  const createDatabaseInNotion = async () => {
    if (!token) return;
    setIsCreatingDatabase(true);
    try {
      const newDb = await notionService.createMediaDatabaseInWorkspace(token);
      setDatabases(prev => [newDb, ...prev]);
      setDatabaseId(newDb.id);
      dbService.saveSetting('notion_database_id', newDb.id);

      await loadSchema(token, newDb.id);
      window.dispatchEvent(new CustomEvent('library-scanned'));
    } catch (err: any) {
      console.error('Failed to create database in Notion:', err);
      setSyncErrors([`Failed to create database in Notion workspace: ${err.message || err}`]);
    } finally {
      setIsCreatingDatabase(false);
    }
  };

  const saveNotionConfig = (newToken: string, newDbId: string, newMapping: NotionColumnMapping) => {
    setToken(newToken);
    setDatabaseId(newDbId);
    setMapping(newMapping);

    dbService.saveSetting('notion_integration_token', newToken.trim());
    dbService.saveSetting('notion_database_id', newDbId.trim());
    dbService.saveSetting('notion_field_mapping', newMapping);

    if (newToken) loadDatabases(newToken);
    if (newToken && newDbId) loadSchema(newToken, newDbId);
  };

  const triggerImportFromApi = async () => {
    if (!token || !databaseId) return;
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const rows = await notionService.fetchFromApi(token, databaseId);
      const res = await notionService.importFromRows(rows, mapping);

      setSyncResult({
        importedCount: res.importedHistoryCount,
        pushedCount: 0,
        conflictsCount: 0,
        errors: res.errors,
        unmatchedInboxCount: 0,
        timestamp: new Date().toISOString()
      });

      setLastSyncTime(new Date().toISOString());
      setSyncErrors(res.errors);
      window.dispatchEvent(new CustomEvent('library-scanned'));
    } catch (err: any) {
      setSyncErrors([err.message || String(err)]);
    } finally {
      setIsSyncing(false);
    }
  };

  const triggerSync = async () => {
    if (!token || !databaseId) return;
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const res = await notionSyncEngine.performSync(token, databaseId, mapping);
      setSyncResult(res);
      setConflicts(notionSyncEngine.getActiveConflicts());
      setLastSyncTime(res.timestamp);
      setSyncErrors(res.errors);
      window.dispatchEvent(new CustomEvent('library-scanned'));
    } catch (err: any) {
      setSyncErrors([err.message || String(err)]);
    } finally {
      setIsSyncing(false);
    }
  };

  const resolveConflict = async (conflict: NotionSyncConflict, resolution: 'notion' | 'app') => {
    await notionSyncEngine.resolveConflict(conflict, resolution, token);
    setConflicts(notionSyncEngine.getActiveConflicts());
    window.dispatchEvent(new CustomEvent('library-scanned'));
  };

  return {
    token,
    isOAuth,
    oauthWorkspace,
    databaseId,
    databases,
    schema,
    mapping,
    setMapping,
    isLoadingDatabases,
    isLoadingSchema,
    isCreatingDatabase,
    isSyncing,
    syncResult,
    conflicts,
    lastSyncTime,
    syncErrors,
    connectNotionOAuth,
    disconnectNotion,
    createDatabaseInNotion,
    saveNotionConfig,
    loadDatabases,
    loadSchema,
    triggerImportFromApi,
    triggerSync,
    resolveConflict
  };
}
