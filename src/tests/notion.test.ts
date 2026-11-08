import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetMockTauriDatabase } from './tauriSqlMock';

vi.mock('@tauri-apps/plugin-sql', async () => {
  const { loadTauriSqlMock } = await import('./tauriSqlMock');
  return { default: { load: loadTauriSqlMock } };
});

import { NotionIntegrationService, notionService } from '../services/NotionIntegrationService';
import { NotionSyncEngine } from '../services/NotionSyncEngine';
import { dbService } from '../services/DatabaseService';
import { DEFAULT_NOTION_COLUMN_MAPPING } from '../constants/appConstants';
import { tmdbProvider } from '../providers/TMDBProvider';
import { igdbProvider } from '../providers/IGDBProvider';
import * as mediaSearchService from '../services/MediaSearchService';

describe('NotionIntegrationService', () => {
  const service = new NotionIntegrationService();

  beforeEach(async () => {
    vi.restoreAllMocks();
    await dbService.init();
    resetMockTauriDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

      await dbService.saveMedia({
        id: mediaId,
        type: 'Film',
        title: 'Inception',
        genres: ['Sci-Fi'],
        created_at: olderTime,
        updated_at: newerTime
      });

      await dbService.saveHistory({
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

      await dbService.saveMedia({
        id: mediaId,
        type: 'VideoGame',
        title: 'Elden Ring',
        genres: ['Action', 'RPG'],
        created_at: now,
        updated_at: now
      });

      await dbService.saveHistory({
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

      const updatedHistory = await dbService.getHistoryForMedia(mediaId);
      expect(updatedHistory[0].original_source_record_id).toBe('new_notion_page_999');
    });

    describe('CSV metadata import', () => {
      it('refreshes metadata from TMDB during import and retains the original Notion name', async () => {
        const getDetails = vi.spyOn(tmdbProvider, 'getMediaDetails').mockResolvedValue({
          title: 'The Paper',
          original_title: 'The Paper',
          release_year: 2025,
          description: 'Provider description',
          genres: ['Comedy', 'Drama'],
          runtime: 30,
          publisher: 'Provider Network',
          cast: [{ id: 'actor_1', name: 'Provider Actor' }],
          seasons: [{ season_number: 2, name: 'Season 2' }],
          poster: 'provider-poster',
          backdrop: 'provider-backdrop',
          metadata_source: 'TMDB'
        });
        const result = await service.importFromRows([{
          Type: 'TV Series',
          Name: 'The Paper S2',
          'TMDB ID': 'tv:12345',
          Genres: 'CSV genre should not be used',
          Cast: 'CSV cast should not be used'
        }]);

        expect(result.importedMediaCount).toBe(1);
        const media = (await dbService.getAllMedia())[0];
        expect(getDetails).toHaveBeenCalledWith('tv:12345');
        expect(media.title).toBe('The Paper');
        expect(media.original_title).toBe('The Paper');
        expect((await dbService.getAllNotionRawRecords())[0].name_raw).toBe('The Paper S2');
        expect(media.release_year).toBe(2025);
        expect(media.description).toBe('Provider description');
        expect(media.genres).toEqual(['Comedy', 'Drama']);
        expect(media.runtime).toBe(30);
        expect(media.publisher).toBe('Provider Network');
        expect(media.cast?.map(member => member.name)).toEqual(['Provider Actor']);
        expect(media.seasons).toEqual([{ season_number: 2, name: 'Season 2' }]);
        expect(media.poster).toBe('provider-poster');
        expect(media.backdrop).toBe('provider-backdrop');
        expect(media.external_ids?.some(item =>
          item.provider === 'TMDB' && item.external_id === 'tv:12345'
        )).toBe(true);
      });

      it('does not add the same Notion history log more than once for the same import date', async () => {
        const row = {
          Type: 'Film',
          Name: 'Arrival',
          'Watched On/Completed Watching': 'November 8, 2026',
          'Score /5': '4',
          Status: 'Finished',
          Thoughts: 'Great film'
        };

        await service.importFromRows([row]);
        const secondImport = await service.importFromRows([row]);

        const media = (await dbService.getAllMedia()).find(item => item.title === 'Arrival');
        expect(media).toBeDefined();
        const history = media ? await dbService.getHistoryForMedia(media.id) : [];
        expect(history).toHaveLength(1);
        expect(secondImport.importedHistoryCount).toBe(0);
      });

      it('merges imported metadata into existing media without replacing artwork or linked history', async () => {
        vi.spyOn(tmdbProvider, 'getMediaDetails').mockResolvedValue({
          title: 'Arrival',
          genres: ['Drama', 'Science Fiction'],
          publisher: 'Provider Studio',
          cast: [{ id: 'actor_1', name: 'Provider Actor' }],
          description: 'Provider description',
          metadata_source: 'TMDB'
        });
        const now = new Date().toISOString();
        await dbService.saveMedia({
          id: 'media_arrival_existing',
          type: 'Film',
          title: 'Arrival',
          genres: ['Drama'],
          cast: [{ id: 'existing_actor', name: 'Actor One' }],
          external_ids: [{
            id: 'ext_arrival_tmdb',
            media_id: 'media_arrival_existing',
            provider: 'TMDB',
            external_id: 'movie:999'
          }],
          poster: 'existing-poster',
          backdrop: 'existing-backdrop',
          created_at: now,
          updated_at: now
        });
        await dbService.saveHistory({
          id: 'history_arrival_existing',
          media_id: 'media_arrival_existing',
          status: 'Finished',
          source: 'Manual',
          created_at: now
        });

        const result = await service.importFromRows([{
          Type: 'Film',
          Name: 'Arrival',
          'TMDB ID': 'movie:999',
          Genres: 'CSV metadata should not be used'
        }]);

        const media = await dbService.getMediaById('media_arrival_existing');
        expect(result.importedMediaCount).toBe(0);
        expect(media?.genres).toEqual(['Drama', 'Science Fiction']);
        expect(media?.publisher).toBe('Provider Studio');
        expect(media?.description).toBe('Provider description');
        expect(media?.cast?.map(member => member.name)).toEqual(['Provider Actor']);
        expect(media?.poster).toBe('existing-poster');
        expect(media?.backdrop).toBe('existing-backdrop');
        expect(await dbService.getAllMedia()).toHaveLength(1);
        expect(await dbService.getHistoryForMedia('media_arrival_existing')).toHaveLength(2);
      });

      it('matches existing media by its connected TMDB or IGDB ID instead of the CSV title', async () => {
        const tmdbDetails = vi.spyOn(tmdbProvider, 'getMediaDetails').mockResolvedValue({
          title: 'The Existing Film Title',
          genres: ['Provider Genre'],
          metadata_source: 'TMDB'
        });
        const igdbDetails = vi.spyOn(igdbProvider, 'getMediaDetails').mockResolvedValue({
          title: 'The Existing Game Title',
          genres: ['Provider Genre'],
          metadata_source: 'IGDB'
        });
        const now = new Date().toISOString();
        await dbService.saveMedia({
          id: 'media_tmdb_existing',
          type: 'Film',
          title: 'The Existing Film Title',
          genres: ['Drama'],
          created_at: now,
          updated_at: now,
          external_ids: [{
            id: 'ext_test_tmdb',
            media_id: 'media_tmdb_existing',
            provider: 'TMDB',
            external_id: 'movie:12345'
          }]
        });
        await dbService.saveMedia({
          id: 'media_igdb_existing',
          type: 'VideoGame',
          title: 'The Existing Game Title',
          genres: ['Action'],
          created_at: now,
          updated_at: now,
          external_ids: [{
            id: 'ext_test_igdb',
            media_id: 'media_igdb_existing',
            provider: 'IGDB',
            external_id: 'igdb:67890'
          }]
        });

        const result = await service.importFromRows([
          {
            Type: 'Film',
            Name: 'Completely Different CSV Film Name',
            TMDB: '12345',
            Genres: 'Drama, Mystery'
          },
          {
            Type: 'VideoGame',
            Name: 'Completely Different CSV Game Name',
            'IGDB ID': 'igdb:67890',
            Genres: 'Action, Adventure'
          }
        ]);

        expect(result.importedMediaCount).toBe(0);
        expect(tmdbDetails).toHaveBeenCalledWith('movie:12345');
        expect(igdbDetails).toHaveBeenCalledWith('igdb:67890');
        expect((await dbService.getAllMedia()).map(media => media.id).sort()).toEqual([
          'media_igdb_existing',
          'media_tmdb_existing'
        ]);
        expect((await dbService.getMediaById('media_tmdb_existing'))?.genres).toEqual(['Provider Genre']);
        expect((await dbService.getMediaById('media_igdb_existing'))?.genres).toEqual(['Provider Genre']);
        expect(await dbService.getHistoryForMedia('media_tmdb_existing')).toHaveLength(1);
        expect(await dbService.getHistoryForMedia('media_igdb_existing')).toHaveLength(1);
      });

      it('resolves a provider search result to its already-connected media before creating an import', async () => {
        vi.spyOn(mediaSearchService, 'searchMediaMetadata').mockResolvedValue([{
          title: 'Canonical TMDB Title',
          type: 'Film',
          external_id: 'movie:24680',
          provider: 'TMDB'
        }]);
        const getDetails = vi.spyOn(tmdbProvider, 'getMediaDetails').mockResolvedValue({
          title: 'Canonical TMDB Title',
          genres: ['Science Fiction'],
          cast: [{ id: 'actor_24680', name: 'Provider Cast Member' }],
          metadata_source: 'TMDB'
        });
        const now = new Date().toISOString();
        await dbService.saveMedia({
          id: 'media_connected_by_tmdb',
          type: 'Film',
          title: 'Previously Matched Movie',
          genres: ['Drama'],
          created_at: now,
          updated_at: now,
          external_ids: [{
            id: 'ext_connected_tmdb',
            media_id: 'media_connected_by_tmdb',
            provider: 'TMDB',
            external_id: 'movie:24680'
          }]
        });

        const result = await service.importFromRows([{
          Type: 'Film',
          Name: 'A Name That Does Not Match the Library Title',
          Status: 'Finished'
        }]);

        expect(result.importedMediaCount).toBe(0);
        expect(getDetails).toHaveBeenCalledWith('movie:24680');
        expect(await dbService.getAllMedia()).toHaveLength(1);
        const importedMedia = await dbService.getMediaById('media_connected_by_tmdb');
        expect(importedMedia?.title).toBe('Canonical TMDB Title');
        expect(importedMedia?.genres).toEqual(['Science Fiction']);
        expect(importedMedia?.cast?.[0]?.name).toBe('Provider Cast Member');
        expect(await dbService.getHistoryForMedia('media_connected_by_tmdb')).toHaveLength(1);
      });
    });
  });

  describe('Importing Example Notion Database Records', () => {
    it('keeps unmatched imports separate from legacy mock media', async () => {
      const now = new Date().toISOString();
      await dbService.saveMedia({
        id: 'media_aanandam',
        type: 'Film',
        title: 'Aanandam',
        genres: [],
        metadata_source: 'Initial Seed',
        created_at: now,
        updated_at: now
      });

      const result = await service.importFromRows([{
        Type: 'Film',
        Name: 'Unmatched imported film',
        _page_id: 'notion_unmatched_film'
      }]);

      expect(result.importedMediaCount).toBe(1);
      const importedMedia = (await dbService.getAllMedia()).find(
        media => media.title === 'Unmatched imported film'
      );
      expect(importedMedia).toBeDefined();
      expect(importedMedia?.id).not.toBe('media_aanandam');
    });

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

      const allMedia = await dbService.getAllMedia();
      const acMedia = allMedia.find(m => m.title === "Assassin's Creed IV: Black Flag");
      expect(acMedia).toBeDefined();

      if (acMedia) {
        const historyList = await dbService.getHistoryForMedia(acMedia.id);
        expect(historyList.length).toBe(2);

        const state = await dbService.getMediaState(acMedia.id);
        expect(state.current_status).toBe('Currently');
      }

      const paperMedia = allMedia.find(m => m.title === 'The Paper');
      expect(paperMedia).toBeDefined();
      if (paperMedia) {
        const paperHistory = await dbService.getHistoryForMedia(paperMedia.id);
        expect(paperHistory[0].started_at).toBe('September 26, 2026');
        expect(paperHistory[0].completed_at).toBe('October 4, 2026');
        expect(paperHistory[0].context).toBe('Season 2');
      }
    });
  });
});
