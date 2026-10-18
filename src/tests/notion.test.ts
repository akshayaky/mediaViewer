import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotionIntegrationService, notionService } from '../services/NotionIntegrationService';
import { NotionSyncEngine } from '../services/NotionSyncEngine';
import { dbService } from '../services/DatabaseService';
import { DEFAULT_NOTION_COLUMN_MAPPING } from '../constants/appConstants';

describe('NotionIntegrationService', () => {
  const service = new NotionIntegrationService();

  beforeEach(async () => {
    await dbService.init();
  });

  describe('createMediaDatabaseInWorkspace', () => {
    it('does not attempt creation without an accessible parent page', async () => {
      const testService = new NotionIntegrationService();
      const fetchNotionApi = vi.spyOn(testService as any, 'fetchNotionApi')
        .mockResolvedValue({ results: [] });

      await expect(testService.createMediaDatabaseInWorkspace('token'))
        .rejects.toThrow('No accessible Notion page found');

      expect(fetchNotionApi).toHaveBeenCalledTimes(1);
      expect(fetchNotionApi).toHaveBeenCalledWith('/search', 'token', expect.any(Object));
    });
  });

  describe('parseTitle', () => {
    it('extracts bracketed context notes from titles', () => {
      const result = service.parseTitle('Aanandam(2+ Rewatch)');
      expect(result.cleanTitle).toBe('Aanandam');
      expect(result.contextNote).toBe('2+ Rewatch');
    });

    it('handles simple rewatch tags in parentheses', () => {
      const result = service.parseTitle('Premalu(Rewatch)');
      expect(result.cleanTitle).toBe('Premalu');
      expect(result.contextNote).toBe('Rewatch');
    });

    it('extracts restart keywords', () => {
      const result = service.parseTitle('Overcooked(restart)');
      expect(result.cleanTitle).toBe('Overcooked');
      expect(result.contextNote).toBe('restart');
    });

    it('normalizes known variant titles like Assassin Creed 4', () => {
      const result = service.parseTitle('Assasin’s Creed 4 black flag resynced');
      expect(result.cleanTitle).toBe("Assassin's Creed IV: Black Flag");
      expect(result.contextNote).toBe('resynced');
    });

    it('handles season notes for shows like The Paper', () => {
      const result = service.parseTitle('The Paper S2');
      expect(result.cleanTitle).toBe('The Paper');
      expect(result.contextNote).toBe('Season 2');
    });

    it('returns empty contextNote for plain titles', () => {
      const result = service.parseTitle('Dune Part Two');
      expect(result.cleanTitle).toBe('Dune Part Two');
      expect(result.contextNote).toBeUndefined();
    });
  });

  describe('parseDates', () => {
    it('parses date ranges correctly', () => {
      const result = service.parseDates('September 26, 2026 → October 4, 2026');
      expect(result.startedAt).toBe('September 26, 2026');
      expect(result.completedAt).toBe('October 4, 2026');
    });

    it('parses single date for finished media', () => {
      const result = service.parseDates('September 3, 2026', 'Finished');
      expect(result.completedAt).toBe('September 3, 2026');
      expect(result.startedAt).toBeUndefined();
    });

    it('parses single date for currently active media', () => {
      const result = service.parseDates('August 23, 2026', 'Currently');
      expect(result.startedAt).toBe('August 23, 2026');
      expect(result.completedAt).toBeUndefined();
    });
  });

  describe('parseScore', () => {
    it('converts star emojis to numbers', () => {
      expect(service.parseScore('⭐️⭐️⭐️⭐️')).toBe(4);
      expect(service.parseScore('⭐️⭐️⭐️⭐️⭐️')).toBe(5);
      expect(service.parseScore('4/5')).toBe(4);
      expect(service.parseScore('3.5')).toBe(3.5);
    });
  });

  describe('Bidirectional Sync Engine', () => {
    it('pushes local history changes to Notion when local history is updated newer than Notion page', async () => {
      const syncEngine = new NotionSyncEngine();
      const token = 'fake-token';
      const databaseId = 'fake-db-id';

      const mediaId = 'media_test_push_1';
      const pageId = 'notion_page_123';

      const now = new Date();
      const olderTime = new Date(now.getTime() - 10000).toISOString();
      const newerTime = new Date(now.getTime()).toISOString();

      dbService.saveMedia({
        id: mediaId,
        type: 'Film',
        title: 'Inception',
        genres: ['Sci-Fi'],
        created_at: olderTime,
        updated_at: newerTime
      });

      dbService.saveHistory({
        id: 'hist_push_1',
        media_id: mediaId,
        status: 'Finished',
        score: 5,
        thoughts: 'Updated locally in app!',
        source: 'Notion',
        original_source_record_id: pageId,
        created_at: olderTime,
        updated_at: newerTime
      });

      // Mock API calls
      vi.spyOn(notionService, 'fetchDatabaseSchema').mockResolvedValue({
        'Name': { id: 'title', name: 'Name', type: 'title' },
        'Type': { id: 'select_type', name: 'Type', type: 'select' },
        'Status': { id: 'status_val', name: 'Status', type: 'status' },
        'Score /5': { id: 'num_score', name: 'Score /5', type: 'number' },
        'Thoughts': { id: 'txt_thoughts', name: 'Thoughts', type: 'rich_text' }
      });

      vi.spyOn(notionService, 'fetchFromApi').mockResolvedValue([
        {
          _page_id: pageId,
          _last_edited_time: olderTime,
          Name: 'Inception',
          Type: 'Film',
          Status: 'Currently',
          'Score /5': '4',
          Thoughts: 'Old Notion thought'
        }
      ]);

      const updatePageSpy = vi.spyOn(notionService, 'updatePageProperties').mockResolvedValue(undefined);

      const result = await syncEngine.performSync(token, databaseId, DEFAULT_NOTION_COLUMN_MAPPING);

      expect(result.pushedCount).toBe(1);
      expect(updatePageSpy).toHaveBeenCalledWith(
        token,
        pageId,
        expect.objectContaining({
          'Score /5': { number: 5 },
          'Status': { status: { name: 'Finished' } },
          'Thoughts': { rich_text: [{ text: { content: 'Updated locally in app!' } }] }
        })
      );
    });

    it('pushes newly created local media lacking original_source_record_id to Notion', async () => {
      const syncEngine = new NotionSyncEngine();
      const token = 'fake-token';
      const databaseId = 'fake-db-id';

      const mediaId = 'media_new_local_1';
      const now = new Date().toISOString();

      dbService.saveMedia({
        id: mediaId,
        type: 'VideoGame',
        title: 'Elden Ring',
        genres: ['Action', 'RPG'],
        created_at: now,
        updated_at: now
      });

      dbService.saveHistory({
        id: 'hist_new_local_1',
        media_id: mediaId,
        status: 'Currently',
        score: 5,
        thoughts: 'Masterpiece game',
        source: 'Manual',
        created_at: now,
        updated_at: now
      });

      vi.spyOn(notionService, 'fetchDatabaseSchema').mockResolvedValue({});
      vi.spyOn(notionService, 'fetchFromApi').mockResolvedValue([]);
      const createPageSpy = vi.spyOn(notionService, 'createPageInDatabase').mockResolvedValue('new_notion_page_999');

      const result = await syncEngine.performSync(token, databaseId, DEFAULT_NOTION_COLUMN_MAPPING);

      expect(result.pushedCount).toBe(1);
      expect(createPageSpy).toHaveBeenCalledWith(
        token,
        databaseId,
        expect.objectContaining({
          Name: { title: [{ text: { content: 'Elden Ring' } }] },
          Type: { select: { name: 'VideoGame' } },
          Status: { status: { name: 'Currently' } },
          'Score /5': { number: 5 }
        })
      );

      const updatedHistory = dbService.getHistoryForMedia(mediaId);
      expect(updatedHistory[0].original_source_record_id).toBe('new_notion_page_999');
    });
  });

  describe('Importing Example Notion Database Records', () => {
    it('correctly normalizes example records into canonical media and history entries', async () => {
      const exampleRows = [
        {
          Type: 'Film',
          Name: 'Aanandam(2+ Rewatch)',
          'Watched On/Completed Watching': 'September 3, 2026',
          'Score /5': '⭐️⭐️⭐️⭐️',
          Status: 'Finished',
          Language: 'Malayalam'
        },
        {
          Type: 'Film',
          Name: 'Premalu(Rewatch)',
          'Watched On/Completed Watching': 'September 3, 2026',
          'Score /5': '⭐️⭐️⭐️⭐️',
          Status: 'Finished',
          Language: 'Malayalam'
        },
        {
          Type: 'VideoGame',
          Name: 'Overcooked(restart)',
          'Watched On/Completed Watching': 'August 23, 2026',
          'Score /5': '⭐️⭐️⭐️⭐️',
          Status: 'Abandoned',
          Language: 'English'
        },
        {
          Type: 'VideoGame',
          Name: 'Assasin’s Creed 4 black flag',
          'Watched On/Completed Watching': 'August 22, 2026',
          'Score /5': '⭐️⭐️⭐️⭐️',
          Status: 'Abandoned',
          Language: 'English'
        },
        {
          Type: 'VideoGame',
          Name: 'Assasin’s Creed 4 black flag resynced',
          'Watched On/Completed Watching': 'August 23, 2026',
          'Score /5': '⭐️⭐️⭐️⭐️',
          Status: 'Currently',
          Language: 'English'
        },
        {
          Type: 'TV Series',
          Name: 'The Paper S2',
          'Watched On/Completed Watching': 'September 26, 2026 → October 4, 2026',
          'Score /5': '⭐️⭐️⭐️⭐️',
          Status: 'Finished',
          Language: 'English'
        }
      ];

      const result = await service.importFromRows(exampleRows);

      expect(result.totalRows).toBe(6);
      expect(result.importedHistoryCount).toBe(6);

      const allMedia = dbService.getAllMedia();
      const acMedia = allMedia.find(m => m.title === "Assassin's Creed IV: Black Flag");
      expect(acMedia).toBeDefined();

      if (acMedia) {
        const historyList = dbService.getHistoryForMedia(acMedia.id);
        expect(historyList.length).toBe(2);

        const state = dbService.getMediaState(acMedia.id);
        expect(state.current_status).toBe('Currently');
      }

      const paperMedia = allMedia.find(m => m.title === 'The Paper');
      expect(paperMedia).toBeDefined();
      if (paperMedia) {
        const paperHistory = dbService.getHistoryForMedia(paperMedia.id);
        expect(paperHistory[0].started_at).toBe('September 26, 2026');
        expect(paperHistory[0].completed_at).toBe('October 4, 2026');
        expect(paperHistory[0].context).toBe('Season 2');
      }
    });
  });
});
