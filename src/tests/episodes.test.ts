import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocalScannerService } from '../services/LocalScannerService';
import { dbService } from '../services/DatabaseService';
import { LocalFile } from '../types/media';

vi.mock('@tauri-apps/plugin-sql', () => {
  return {
    default: {
      load: async () => {
        const { loadTauriSqlMock } = await import('./tauriSqlMock');
        return loadTauriSqlMock();
      }
    }
  };
});

describe('TV Show Episode Matching & Persistence', () => {
  const scanner = new LocalScannerService();

  beforeEach(async () => {
    const { resetMockTauriDatabase } = await import('./tauriSqlMock');
    resetMockTauriDatabase();
    await dbService.init();
  });

  describe('LocalScannerService parseFilePath for Episodes', () => {
    it('parses standard S01E03 format', () => {
      const parsed = scanner.parseFilePath('C:\\TV\\House of the Dragon\\Season 01\\House.of.the.Dragon.S01E03.1080p.mkv', 'TV Series');
      expect(parsed.cleanTitle).toBe('House of the Dragon');
      expect(parsed.season).toBe(1);
      expect(parsed.episode).toBe(3);
      expect(parsed.endEpisode).toBeUndefined();
    });

    it('parses multi-episode range S01E03-E04', () => {
      const parsed = scanner.parseFilePath('C:\\TV\\Ted Lasso\\Season 03\\Ted.Lasso.S03E03-E04.mkv', 'TV Series');
      expect(parsed.cleanTitle).toBe('Ted Lasso');
      expect(parsed.season).toBe(3);
      expect(parsed.episode).toBe(3);
      expect(parsed.endEpisode).toBe(4);
    });

    it('parses 1x03 and multi-episode range 1x03-04', () => {
      const parsed1 = scanner.parseFilePath('C:\\TV\\Severance\\Severance.1x03.720p.mkv', 'TV Series');
      expect(parsed1.cleanTitle).toBe('Severance');
      expect(parsed1.season).toBe(1);
      expect(parsed1.episode).toBe(3);

      const parsed2 = scanner.parseFilePath('C:\\TV\\Severance\\Severance.1x03-04.720p.mkv', 'TV Series');
      expect(parsed2.season).toBe(1);
      expect(parsed2.episode).toBe(3);
      expect(parsed2.endEpisode).toBe(4);
    });

    it('parses season from folder structure when not in filename', () => {
      const parsed = scanner.parseFilePath('C:\\TV\\The Office\\Season 02\\05 - Halloween.mkv', 'TV Series');
      expect(parsed.cleanTitle).toBe('The Office');
      expect(parsed.season).toBe(2);
      expect(parsed.episode).toBe(5);
    });
  });

  describe('Database Persistence of LocalFile Episode Metadata', () => {
    it('saves and retrieves season, episode, and end_episode columns', async () => {
      const localFile: LocalFile = {
        id: 'lf_ep1',
        media_id: 'm_tv_1',
        path: 'C:\\TV\\Show\\S01E03-E04.mkv',
        filename: 'S01E03-E04.mkv',
        extension: 'mkv',
        size: 1500000000,
        discovered_at: '2025-01-01T00:00:00Z',
        last_seen_at: '2025-01-01T00:00:00Z',
        exists: true,
        file_type: 'tv_episode',
        season: 1,
        episode: 3,
        end_episode: 4,
        parsed_title: 'Show'
      };

      await dbService.saveLocalFile(localFile);

      const files = await dbService.getLocalFilesForMedia('m_tv_1');
      expect(files).toHaveLength(1);
      expect(files[0].season).toBe(1);
      expect(files[0].episode).toBe(3);
      expect(files[0].end_episode).toBe(4);
      expect(files[0].parsed_title).toBe('Show');
    });

    it('updates file episode association via updateLocalFileAssociation', async () => {
      const localFile: LocalFile = {
        id: 'lf_ep2',
        path: 'C:\\TV\\Show\\Unmatched.mkv',
        filename: 'Unmatched.mkv',
        extension: 'mkv',
        size: 1200000000,
        discovered_at: '2025-01-01T00:00:00Z',
        last_seen_at: '2025-01-01T00:00:00Z',
        exists: true,
        file_type: 'tv_episode'
      };

      await dbService.saveLocalFile(localFile);
      await dbService.updateLocalFileAssociation('lf_ep2', 'm_tv_1', 2, 5, undefined);

      const files = await dbService.getLocalFilesForMedia('m_tv_1');
      expect(files).toHaveLength(1);
      expect(files[0].id).toBe('lf_ep2');
      expect(files[0].season).toBe(2);
      expect(files[0].episode).toBe(5);
    });

    it('deletes episode history on watch toggle', async () => {
      await dbService.saveHistory({
        id: 'h_ep1',
        media_id: 'm_tv_1',
        status: 'Finished',
        context: 'S01E03',
        source: 'Manual',
        created_at: '2025-01-01T10:00:00Z'
      });

      let history = await dbService.getHistoryForMedia('m_tv_1');
      expect(history).toHaveLength(1);

      await dbService.deleteHistoryForEpisode('m_tv_1', 1, 3);
      history = await dbService.getHistoryForMedia('m_tv_1');
      expect(history).toHaveLength(0);
    });
  });
});
