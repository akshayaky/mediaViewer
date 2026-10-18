import { describe, it, expect, beforeEach, vi } from 'vitest';
import { notionOAuthService } from '../services/NotionOAuthService';
import { notionSyncEngine } from '../services/NotionSyncEngine';
import { notionService } from '../services/NotionIntegrationService';
import { dbService } from '../services/DatabaseService';

describe('Notion OAuth Service & Robust Bidirectional Sync Engine', () => {
  beforeEach(async () => {
    await dbService.init();
    // Clear test tables
    if ((dbService as any).db) {
      (dbService as any).db.run('DELETE FROM media;');
      (dbService as any).db.run('DELETE FROM media_history;');
      (dbService as any).db.run('DELETE FROM external_ids;');
      (dbService as any).db.run('DELETE FROM notion_sync_state;');
      (dbService as any).db.run('DELETE FROM settings;');
    }
  });

  describe('OAuth Flow & Token Persistence', () => {
    it('generates valid OAuth authorization URL with CSRF state token', () => {
      const { url, state } = notionOAuthService.generateAuthUrl('test_client_id', 'https://localhost/callback');
      expect(url).toContain('https://api.notion.com/v1/oauth/authorize');
      expect(url).toContain('client_id=test_client_id');
      expect(url).toContain(`state=${state}`);
      expect(state.length).toBeGreaterThan(10);
    });

    it('validates matching OAuth CSRF state parameter', () => {
      const { state } = notionOAuthService.generateAuthUrl('test_client_id', 'https://localhost/callback');
      expect(notionOAuthService.validateState(state)).toBe(true);
      // Second check fails because state was consumed
      expect(notionOAuthService.validateState(state)).toBe(false);
    });

    it('persists OAuth token response and retrieves active token', () => {
      notionOAuthService.saveOAuthData({
        access_token: 'oauth_token_123',
        token_type: 'bearer',
        bot_id: 'bot_999',
        workspace_id: 'ws_777',
        workspace_name: 'Test Workspace'
      });

      const active = notionOAuthService.getActiveToken();
      expect(active.token).toBe('oauth_token_123');
      expect(active.isOAuth).toBe(true);

      const oauthData = notionOAuthService.getOAuthData();
      expect(oauthData?.workspace_name).toBe('Test Workspace');
    });

    it('disconnects OAuth connection without wiping local media records', () => {
      // Save local media
      dbService.saveMedia({
        id: 'media_keep_1',
        type: 'Film',
        title: 'Inception',
        genres: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

      notionOAuthService.saveOAuthData({
        access_token: 'oauth_token_123',
        token_type: 'bearer',
        bot_id: 'bot_999',
        workspace_id: 'ws_777'
      });

      notionOAuthService.disconnect();

      const active = notionOAuthService.getActiveToken();
      expect(active.token).toBe('');
      expect(dbService.getMediaById('media_keep_1')).not.toBeNull();
    });
  });

  describe('Bidirectional Sync Engine & Idempotency', () => {
    it('performs initial import and establishes sync state baseline', async () => {
      vi.spyOn(notionService, 'fetchFromApi').mockResolvedValue([
        {
          _page_id: 'page_notion_001',
          _last_edited_time: '2026-03-01T10:00:00.000Z',
          _url: 'https://notion.so/page_001',
          Name: 'Dune Part Two',
          Type: 'Film',
          'Watched On/Completed Watching': 'March 1, 2026',
          'Score /5': '⭐️⭐️⭐️⭐️⭐️',
          Status: 'Finished',
          Thoughts: 'Epic masterpiece!'
        }
      ]);

      const mapping = {
        nameField: 'Name',
        typeField: 'Type',
        watchedOnField: 'Watched On/Completed Watching',
        scoreField: 'Score /5',
        statusField: 'Status',
        languageField: 'Language',
        thoughtsField: 'Thoughts',
        publisherField: 'Publisher'
      };

      const result = await notionSyncEngine.performSync('fake_token', 'db_123', mapping);

      expect(result.importedCount).toBe(1);
      expect(result.pushedCount).toBe(0);
      expect(result.conflictsCount).toBe(0);

      const allMedia = dbService.getAllMedia();
      expect(allMedia.length).toBe(1);
      expect(allMedia[0].title).toBe('Dune Part Two');

      const syncState = dbService.getNotionSyncState('page_notion_001');
      expect(syncState).not.toBeNull();
      expect(syncState?.syncedFieldsSnapshot.score).toBe(5);
    });

    it('prevents duplicates on repeated syncs', async () => {
      vi.spyOn(notionService, 'fetchFromApi').mockResolvedValue([
        {
          _page_id: 'page_notion_001',
          _last_edited_time: '2026-03-01T10:00:00.000Z',
          _url: 'https://notion.so/page_001',
          Name: 'Dune Part Two',
          Type: 'Film',
          'Watched On/Completed Watching': 'March 1, 2026',
          'Score /5': '⭐️⭐️⭐️⭐️⭐️',
          Status: 'Finished',
          Thoughts: 'Epic masterpiece!'
        }
      ]);

      const mapping = {
        nameField: 'Name',
        typeField: 'Type',
        watchedOnField: 'Watched On/Completed Watching',
        scoreField: 'Score /5',
        statusField: 'Status',
        languageField: 'Language',
        thoughtsField: 'Thoughts',
        publisherField: 'Publisher'
      };

      // Run sync twice
      await notionSyncEngine.performSync('fake_token', 'db_123', mapping);
      const secondResult = await notionSyncEngine.performSync('fake_token', 'db_123', mapping);

      expect(secondResult.importedCount).toBe(0);
      expect(secondResult.pushedCount).toBe(0);
      expect(secondResult.conflictsCount).toBe(0);

      const allMedia = dbService.getAllMedia();
      expect(allMedia.length).toBe(1);
    });

    it('pushes local edits to Notion when only local record changes', async () => {
      // Setup initial synced media & history
      const mediaId = 'media_local_01';
      const historyId = 'hist_local_01';
      const pageId = 'page_notion_002';

      dbService.saveMedia({
        id: mediaId,
        type: 'Film',
        title: 'Interstellar',
        genres: [],
        created_at: '2026-03-01T10:00:00.000Z',
        updated_at: '2026-03-01T10:00:00.000Z'
      });

      dbService.saveHistory({
        id: historyId,
        media_id: mediaId,
        status: 'Finished',
        score: 5,
        thoughts: 'Updated local thoughts',
        source: 'Notion',
        original_source_record_id: pageId,
        created_at: '2026-03-02T12:00:00.000Z'
      });

      // Establish baseline state
      dbService.saveNotionSyncState({
        pageId,
        historyId,
        mediaId,
        lastSyncedAt: '2026-03-01T10:00:00.000Z',
        notionLastEditedAt: '2026-03-01T10:00:00.000Z',
        appLastEditedAt: '2026-03-01T10:00:00.000Z',
        syncedFieldsSnapshot: {
          score: 5,
          status: 'Finished',
          thoughts: 'Initial thoughts',
          watchedOn: '',
          title: 'Interstellar'
        }
      });

      vi.spyOn(notionService, 'fetchFromApi').mockResolvedValue([
        {
          _page_id: pageId,
          _last_edited_time: '2026-03-01T10:00:00.000Z',
          Name: 'Interstellar',
          Type: 'Film',
          'Score /5': '⭐️⭐️⭐️⭐️⭐️',
          Status: 'Finished',
          Thoughts: 'Initial thoughts'
        }
      ]);

      const updateSpy = vi.spyOn(notionService, 'updatePageProperties').mockResolvedValue({ id: pageId });

      const mapping = {
        nameField: 'Name',
        typeField: 'Type',
        watchedOnField: 'Watched On/Completed Watching',
        scoreField: 'Score /5',
        statusField: 'Status',
        languageField: 'Language',
        thoughtsField: 'Thoughts',
        publisherField: 'Publisher'
      };

      const result = await notionSyncEngine.performSync('fake_token', 'db_123', mapping);

      expect(result.pushedCount).toBe(1);
      expect(updateSpy).toHaveBeenCalledWith('fake_token', pageId, expect.objectContaining({
        Thoughts: { rich_text: [{ text: { content: 'Updated local thoughts' } }] }
      }));
    });

    it('detects concurrent edits and registers conflict for user resolution', async () => {
      const mediaId = 'media_local_02';
      const historyId = 'hist_local_02';
      const pageId = 'page_notion_003';

      dbService.saveMedia({
        id: mediaId,
        type: 'Film',
        title: 'Oppenheimer',
        genres: [],
        created_at: '2026-03-01T10:00:00.000Z',
        updated_at: '2026-03-01T10:00:00.000Z'
      });

      // Local score changed to 4
      dbService.saveHistory({
        id: historyId,
        media_id: mediaId,
        status: 'Finished',
        score: 4,
        source: 'Notion',
        original_source_record_id: pageId,
        created_at: '2026-03-02T12:00:00.000Z'
      });

      // Baseline snapshot had score 3
      dbService.saveNotionSyncState({
        pageId,
        historyId,
        mediaId,
        lastSyncedAt: '2026-03-01T10:00:00.000Z',
        notionLastEditedAt: '2026-03-01T10:00:00.000Z',
        appLastEditedAt: '2026-03-01T10:00:00.000Z',
        syncedFieldsSnapshot: {
          score: 3,
          status: 'Finished',
          thoughts: '',
          watchedOn: '',
          title: 'Oppenheimer'
        }
      });

      // Remote score changed to 5
      vi.spyOn(notionService, 'fetchFromApi').mockResolvedValue([
        {
          _page_id: pageId,
          _last_edited_time: '2026-03-02T15:00:00.000Z',
          Name: 'Oppenheimer',
          Type: 'Film',
          'Score /5': '⭐️⭐️⭐️⭐️⭐️',
          Status: 'Finished'
        }
      ]);

      const mapping = {
        nameField: 'Name',
        typeField: 'Type',
        watchedOnField: 'Watched On/Completed Watching',
        scoreField: 'Score /5',
        statusField: 'Status',
        languageField: 'Language',
        thoughtsField: 'Thoughts',
        publisherField: 'Publisher'
      };

      const result = await notionSyncEngine.performSync('fake_token', 'db_123', mapping);

      expect(result.conflictsCount).toBe(1);
      const conflicts = notionSyncEngine.getActiveConflicts();
      expect(conflicts.length).toBe(1);
      expect(conflicts[0].field).toBe('Score / Rating');

      // Resolve conflict by keeping App value
      const updateSpy = vi.spyOn(notionService, 'updatePageProperties').mockResolvedValue({ id: pageId });
      await notionSyncEngine.resolveConflict(conflicts[0], 'app', 'fake_token');

      expect(updateSpy).toHaveBeenCalledWith('fake_token', pageId, expect.objectContaining({
        'Score /5': { number: 4 }
      }));

      expect(notionSyncEngine.getActiveConflicts().length).toBe(0);
    });

    it('handles HTTP 429 rate limit retries with exponential backoff', async () => {
      vi.restoreAllMocks();
      let attempts = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        attempts++;
        if (attempts < 2) {
          return new Response('Rate limited', { status: 429, headers: { 'Retry-After': '0.01' } });
        }
        return new Response(JSON.stringify({ results: [], has_more: false }), { status: 200 });
      });

      const rows = await notionService.fetchFromApi('fake_token', 'db_retry_test');
      expect(rows).toEqual([]);
      expect(attempts).toBe(2);

      fetchSpy.mockRestore();
    });
  });
});
