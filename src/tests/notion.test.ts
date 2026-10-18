import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotionIntegrationService } from '../services/NotionIntegrationService';
import { dbService } from '../services/DatabaseService';

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
