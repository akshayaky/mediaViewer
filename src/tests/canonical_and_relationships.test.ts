import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockTauriDatabase } from './tauriSqlMock';

vi.mock('@tauri-apps/plugin-sql', async () => {
  const { loadTauriSqlMock } = await import('./tauriSqlMock');
  return { default: { load: loadTauriSqlMock } };
});

import { dbService } from '../services/DatabaseService';
import { tmdbProvider } from '../providers/TMDBProvider';
import { igdbProvider } from '../providers/IGDBProvider';
import { LocalScannerService } from '../services/LocalScannerService';
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

  it('deletes a media item and all rows related to it', async () => {
    const now = new Date().toISOString();
    const mediaId = `delete_test_${Date.now()}`;
    const historyId = `delete_history_${Date.now()}`;
    const media: Media = {
      id: mediaId,
      type: 'Film',
      title: 'Delete test movie',
      genres: [],
      created_at: now,
      updated_at: now,
      external_ids: [{ id: `delete_ext_${Date.now()}`, media_id: mediaId, provider: 'TMDB', external_id: 'movie:delete-test' }]
    };
    await dbService.saveMedia(media);
    await dbService.saveHistory({
      id: historyId,
      media_id: mediaId,
      status: 'Finished',
      source: 'Manual',
      created_at: now
    });
    await dbService.saveLocalFile({
      id: `delete_file_${Date.now()}`,
      media_id: mediaId,
      path: 'C:\\Movies\\Delete test.mkv',
      filename: 'Delete test.mkv',
      extension: 'mkv',
      size: 100,
      discovered_at: now,
      last_seen_at: now,
      exists: true,
      file_type: 'movie'
    });
    await dbService.saveAvailability({
      id: `delete_availability_${Date.now()}`,
      media_id: mediaId,
      provider: 'Test',
      availability_type: 'Stream',
      last_checked: now
    });
    await dbService.saveWishlist({
      id: `delete_wishlist_${Date.now()}`,
      media_id: mediaId,
      title: media.title,
      type: media.type,
      source: 'Manual',
      added_at: now
    });
    await dbService.saveNotionRawRecord({
      id: `delete_notion_${Date.now()}`,
      name_raw: media.title,
      type_raw: 'Film',
      imported_at: now,
      parsed_media_id: mediaId,
      parsed_history_id: historyId
    });

    await dbService.deleteMedia(mediaId);

    expect(await dbService.getMediaById(mediaId)).toBeNull();
    expect(await dbService.getHistoryForMedia(mediaId)).toHaveLength(0);
    expect(await dbService.getLocalFilesForMedia(mediaId)).toHaveLength(0);
    expect(await dbService.getAvailabilityForMedia(mediaId)).toHaveLength(0);
    expect(await dbService.getExternalIdsForMedia(mediaId)).toHaveLength(0);
    expect((await dbService.getAllWishlist()).some(item => item.media_id === mediaId)).toBe(false);
    expect((await dbService.getAllNotionRawRecords()).some(record =>
      record.parsed_media_id === mediaId || record.parsed_history_id === historyId
    )).toBe(false);
  });

  it('clears only media matching the selected type and their related rows', async () => {
    const now = new Date().toISOString();
    const filmId = `clear_film_${Date.now()}`;
    const gameId = `keep_game_${Date.now()}`;
    await dbService.saveMedia({
      id: filmId,
      type: 'Film',
      title: 'Clear test movie',
      genres: [],
      created_at: now,
      updated_at: now
    });
    await dbService.saveMedia({
      id: gameId,
      type: 'VideoGame',
      title: 'Keep test game',
      genres: [],
      created_at: now,
      updated_at: now
    });

    expect(await dbService.clearMediaByType('Film')).toBe(1);
    expect(await dbService.getMediaById(filmId)).toBeNull();
    expect(await dbService.getMediaById(gameId)).not.toBeNull();
  });

  it('clears unmatched local file records without deleting matched files', async () => {
    const now = new Date().toISOString();
    const mediaId = `unmatched_keep_${Date.now()}`;
    await dbService.saveMedia({
      id: mediaId,
      type: 'Film',
      title: 'Keep matched movie',
      genres: [],
      created_at: now,
      updated_at: now
    });
    const localFile = (id: string, linkedMediaId?: string) => ({
      id,
      media_id: linkedMediaId,
      path: `C:\\Movies\\${id}.mkv`,
      filename: `${id}.mkv`,
      extension: 'mkv',
      size: 100,
      discovered_at: now,
      last_seen_at: now,
      exists: true,
      file_type: 'movie' as const
    });
    await dbService.saveLocalFile(localFile(`unmatched_${Date.now()}`));
    await dbService.saveLocalFile(localFile(`matched_${Date.now()}`, mediaId));

    expect(await dbService.clearUnmatchedLocalFiles()).toBe(1);
    expect(await dbService.getUnmatchedLocalFiles()).toHaveLength(0);
    expect(await dbService.getLocalFilesForMedia(mediaId)).toHaveLength(1);
  });

  it('removes legacy seeded demo media without deleting user media', async () => {
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
    await dbService.saveMedia({
      id: 'user_media',
      type: 'Film',
      title: 'User media',
      genres: [],
      created_at: now,
      updated_at: now
    });
    await dbService.saveHistory({
      id: 'seed_history',
      media_id: 'media_aanandam',
      status: 'Finished',
      source: 'Notion',
      created_at: now
    });

    await dbService.removeLegacySeedData();

    expect(await dbService.getMediaById('media_aanandam')).toBeNull();
    expect(await dbService.getHistoryForMedia('media_aanandam')).toHaveLength(0);
    expect(await dbService.getMediaById('user_media')).not.toBeNull();
  });

  it('does not invent sample files when a web scan has no selected files', async () => {
    const scanner = new LocalScannerService();

    const result = await scanner.scanFolder('C:\\Media\\Movies', 'Film');

    expect(result.totalScanned).toBe(0);
    expect(result.discoveredFiles).toHaveLength(0);
  });

  it('fetches related media relationships for TMDB and IGDB providers', async () => {
    const tmdbRelated = await tmdbProvider.getRelatedMedia('movie:123456');
    expect(Array.isArray(tmdbRelated)).toBe(true);

    const igdbRelated = await igdbProvider.getRelatedMedia('igdb:1020');
    expect(Array.isArray(igdbRelated)).toBe(true);
  });

  it('does not replace unmatched media with provider demo titles', async () => {
    const unknownShow = await tmdbProvider.getMediaDetails('Unmatched Imported Show');
    const unknownFilm = await tmdbProvider.getMediaDetails('Unmatched Imported Film');
    const unknownGame = await igdbProvider.getMediaDetails('Unmatched Imported Game');

    expect(unknownShow.title).toBeUndefined();
    expect(unknownFilm.title).toBeUndefined();
    expect(unknownGame.title).toBeUndefined();

    expect((await tmdbProvider.getMediaDetails('tv:97630')).title).toBeUndefined();
    expect((await igdbProvider.getMediaDetails('igdb:119133')).title).toBeUndefined();
  });
});
