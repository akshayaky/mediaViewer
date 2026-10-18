import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockTauriDatabase } from './tauriSqlMock';

vi.mock('@tauri-apps/plugin-sql', async () => {
  const { loadTauriSqlMock } = await import('./tauriSqlMock');
  return { default: { load: loadTauriSqlMock } };
});

import { dbService } from '../services/DatabaseService';
import { tmdbProvider } from '../providers/TMDBProvider';
import { igdbProvider } from '../providers/IGDBProvider';
import { Media } from '../types/media';

describe('Canonical Entities, Duplicates & Relationships', () => {
  beforeEach(async () => {
    await dbService.init();
    resetMockTauriDatabase();
  });

  it('resolves canonical media entity by provider and external ID', async () => {
    const mediaId = `media_test_${Date.now()}`;
    const testMedia: Media = {
      id: mediaId,
      type: 'Film',
      title: 'Dune: Part Two',
      release_year: 2024,
      genres: ['Sci-Fi', 'Adventure'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      manually_matched: true,
      external_ids: [
        {
          id: `ext_${Date.now()}`,
          media_id: mediaId,
          provider: 'TMDB',
          external_id: 'movie:693134'
        }
      ]
    };

    await dbService.saveMedia(testMedia);

    const found = await dbService.getMediaByExternalId('TMDB', 'movie:693134');
    expect(found).not.toBeNull();
    expect(found?.id).toBe(mediaId);
    expect(found?.title).toBe('Dune: Part Two');
    expect(found?.manually_matched).toBe(true);
  });

  it('detects suspected duplicate records by title and year', async () => {
    const now = new Date().toISOString();
    const media1: Media = {
      id: `m1_${Date.now()}`,
      type: 'VideoGame',
      title: 'Elden Ring',
      release_year: 2022,
      genres: ['Action', 'RPG'],
      created_at: now,
      updated_at: now
    };
    const media2: Media = {
      id: `m2_${Date.now()}`,
      type: 'VideoGame',
      title: 'elden ring',
      release_year: 2022,
      genres: ['RPG'],
      created_at: now,
      updated_at: now
    };

    await dbService.saveMedia(media1);
    await dbService.saveMedia(media2);

    const duplicates = await dbService.findSuspectedDuplicates('Elden Ring', 2022, media1.id);
    expect(duplicates.length).toBeGreaterThan(0);
    expect(duplicates.some(d => d.id === media2.id)).toBe(true);
  });

  it('safely merges duplicate entities while preserving history and local files', async () => {
    const now = new Date().toISOString();
    const survivingId = `surv_${Date.now()}`;
    const duplicateId = `dup_${Date.now()}`;

    const surviving: Media = {
      id: survivingId,
      type: 'Film',
      title: 'Premalu',
      release_year: 2024,
      genres: ['Romance', 'Comedy'],
      created_at: now,
      updated_at: now
    };

    const duplicate: Media = {
      id: duplicateId,
      type: 'Film',
      title: 'Premalu Duplicate',
      release_year: 2024,
      genres: ['Romance'],
      created_at: now,
      updated_at: now
    };

    await dbService.saveMedia(surviving);
    await dbService.saveMedia(duplicate);

    // Save history and local files for both
    await dbService.saveHistory({
      id: `h_surv_${Date.now()}`,
      media_id: survivingId,
      status: 'Finished',
      source: 'Notion',
      created_at: now
    });

    await dbService.saveHistory({
      id: `h_dup_${Date.now()}`,
      media_id: duplicateId,
      status: 'Finished',
      source: 'Manual',
      created_at: now
    });

    await dbService.saveLocalFile({
      id: `lf_dup_${Date.now()}`,
      media_id: duplicateId,
      path: 'C:\\Movies\\Premalu.mkv',
      filename: 'Premalu.mkv',
      extension: 'mkv',
      size: 1500000000,
      discovered_at: now,
      last_seen_at: now,
      exists: true,
      file_type: 'movie'
    });

    await dbService.mergeMediaEntities(survivingId, duplicateId, {
      title: 'Premalu (2024)',
      manually_matched: true
    });

    const mergedSurviving = await dbService.getMediaById(survivingId);
    const deletedDuplicate = await dbService.getMediaById(duplicateId);

    expect(deletedDuplicate).toBeNull();
    expect(mergedSurviving?.title).toBe('Premalu (2024)');

    const combinedHistory = await dbService.getHistoryForMedia(survivingId);
    expect(combinedHistory.length).toBe(2);

    const combinedFiles = await dbService.getLocalFilesForMedia(survivingId);
    expect(combinedFiles.length).toBe(1);
    expect(combinedFiles[0].path).toBe('C:\\Movies\\Premalu.mkv');
  });

  it('fetches related media relationships for TMDB and IGDB providers', async () => {
    const tmdbRelated = await tmdbProvider.getRelatedMedia('movie:123456');
    expect(Array.isArray(tmdbRelated)).toBe(true);

    const igdbRelated = await igdbProvider.getRelatedMedia('igdb:1020');
    expect(Array.isArray(igdbRelated)).toBe(true);
  });
});
