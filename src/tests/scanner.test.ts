import { describe, it, expect } from 'vitest';
import { LocalScannerService } from '../services/LocalScannerService';
import { Media } from '../types/media';

describe('LocalScannerService', () => {
  const service = new LocalScannerService();

  describe('parseFilePath', () => {
    it('parses movie title, year, and file type from filename', () => {
      const parsed = service.parseFilePath('C:\\Media\\Movies\\Premalu (2024)\\Premalu.2024.1080p.mp4', 'Film');
      expect(parsed.cleanTitle).toBe('Premalu');
      expect(parsed.year).toBe(2024);
      expect(parsed.fileType).toBe('movie');
    });

    it('parses TV series season and episode numbers', () => {
      const parsed = service.parseFilePath('C:\\Media\\TV\\Ted Lasso\\Season 03\\Ted.Lasso.S03E01.1080p.mkv', 'TV Series');
      expect(parsed.cleanTitle).toBe('Ted Lasso');
      expect(parsed.season).toBe(3);
      expect(parsed.episode).toBe(1);
      expect(parsed.fileType).toBe('tv_episode');
    });

    it('identifies game executable file type', () => {
      const parsed = service.parseFilePath('D:\\Games\\Assassin\'s Creed IV Black Flag.lnk', 'VideoGame');
      expect(parsed.cleanTitle).toBe("Assassin's Creed IV Black Flag");
      expect(parsed.fileType).toBe('game_executable');
    });
  });

  describe('findHighConfidenceMatch', () => {
    const existingMedia: Media[] = [
      {
        id: 'm1',
        type: 'Film',
        title: 'Premalu',
        release_year: 2024,
        genres: ['Comedy', 'Romance'],
        created_at: '2025-01-01',
        updated_at: '2025-01-01'
      },
      {
        id: 'm2',
        type: 'VideoGame',
        title: "Assassin's Creed IV Black Flag",
        release_year: 2013,
        genres: ['Action'],
        created_at: '2025-01-01',
        updated_at: '2025-01-01'
      }
    ];

    it('matches exact title and type', () => {
      const parsed = service.parseFilePath('C:\\Media\\Premalu.2024.mp4', 'Film');
      const match = service.findHighConfidenceMatch(parsed, 'Film', existingMedia);
      expect(match).not.toBeNull();
      expect(match?.id).toBe('m1');
    });

    it('does not match across different media types', () => {
      const parsed = service.parseFilePath('C:\\Media\\Premalu.2024.mp4', 'VideoGame');
      const match = service.findHighConfidenceMatch(parsed, 'VideoGame', existingMedia);
      expect(match).toBeNull();
    });
  });
});
