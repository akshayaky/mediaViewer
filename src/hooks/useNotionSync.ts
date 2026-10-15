import { useState, useEffect } from 'react';
import { dbService } from '../services/DatabaseService';
import { notionService } from '../services/NotionIntegrationService';
import { notionSyncEngine } from '../services/NotionSyncEngine';
import { NotionDatabase, NotionPropertySchema, NotionSyncConflict, NotionSyncResult } from '../types/notion';
import { NotionColumnMapping } from '../providers/interfaces';
import { DEFAULT_NOTION_COLUMN_MAPPING } from '../constants/appConstants';

export function useNotionSync() {
  const [token, setToken] = useState<string>('');
  const [databaseId, setDatabaseId] = useState<string>('');
  const [databases, setDatabases] = useState<NotionDatabase[]>([]);
  const [schema, setSchema] = useState<Record<string, NotionPropertySchema>>({});
  const [isLoadingDatabases, setIsLoadingDatabases] = useState(false);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<NotionSyncResult | null>(null);
  const [conflicts, setConflicts] = useState<NotionSyncConflict[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');
  const [syncErrors, setSyncErrors] = useState<string[]>([]);
  const [mapping, setMapping] = useState<NotionColumnMapping>(DEFAULT_NOTION_COLUMN_MAPPING);

  useEffect(() => {
    const settings = dbService.getSettings();
    const savedToken = settings.notion_integration_token || '';
    const savedDbId = settings.notion_database_id || '';
    const savedMapping = settings.notion_field_mapping
      ? (typeof settings.notion_field_mapping === 'string'
          ? JSON.parse(settings.notion_field_mapping)
          : settings.notion_field_mapping)
      : DEFAULT_NOTION_COLUMN_MAPPING;

    setToken(savedToken);
    setDatabaseId(savedDbId);
    setMapping(savedMapping);
    setLastSyncTime(settings.notion_last_sync_time || '');
    setSyncErrors(settings.notion_sync_errors || []);

    if (savedToken) {
      loadDatabases(savedToken);
    }
    if (savedToken && savedDbId) {
      loadSchema(savedToken, savedDbId);
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

      // Auto-guess column mappings based on schema keys
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

  const connectNotionOAuth = () => {
    // Standard Notion OAuth flow
    const clientId = '36248358-notion-auth';
    const redirectUri = encodeURIComponent(window.location.origin);
    const oauthUrl = `https://api.notion.com/v1/oauth/authorize?owner=user&client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code`;
    window.open(oauthUrl, '_blank');
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
    databaseId,
    databases,
    schema,
    mapping,
    setMapping,
    isLoadingDatabases,
    isLoadingSchema,
    isSyncing,
    syncResult,
    conflicts,
    lastSyncTime,
    syncErrors,
    connectNotionOAuth,
    saveNotionConfig,
    loadDatabases,
    loadSchema,
    triggerImportFromApi,
    triggerSync,
    resolveConflict
  };
}
