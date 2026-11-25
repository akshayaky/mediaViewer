import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockTauriDatabase } from './tauriSqlMock';

vi.mock('@tauri-apps/plugin-sql', async () => {
  const { loadTauriSqlMock } = await import('./tauriSqlMock');
  return { default: { load: loadTauriSqlMock } };
});

import { dbService } from '../services/DatabaseService';
import { skipSegmentCache } from '../services/skip/SkipSegmentCache';
import { introDbClient } from '../services/skip/IntroDbClient';
import { tmdbProvider } from '../providers/TMDBProvider';
import { Media, MediaSkipSegments } from '../types/media';

describe('SkipSegmentCache & Persistence', () => {
  const mockTvShow: Media = {
    id: 'media_tv_test_1',
    type: 'TV Series',
    title: 'Breaking Bad',
    genres: ['Drama', 'Crime'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    external_ids: [
      {
        id: 'ext_imdb_1',
        media_id: 'media_tv_test_1',
        provider: 'IMDb',
        external_id: 'tt0903747'
      }
    ]
  };

  const mockMovie: Media = {
    id: 'media_movie_test_1',
    type: 'Film',
    title: 'Inception',
    genres: ['Action', 'Sci-Fi'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    external_ids: [
      {
        id: 'ext_imdb_2',
        media_id: 'media_movie_test_1',
        provider: 'IMDb',
        external_id: 'tt1375666'
      }
    ]
  };

  beforeEach(async () => {
    await dbService.init();
    resetMockTauriDatabase();
    vi.restoreAllMocks();
  });

  describe('isCacheValid', () => {
    it('recognizes valid found skip segments', () => {
      const valid: MediaSkipSegments = {
        id: 'skip_1',
        media_id: 'media_tv_test_1',
        external_id: 'tt0903747',
        provider: 'IntroDB',
        media_type: 'tv',
        season: 1,
        episode: 1,
        intro: { start: 10, end: 45 },
        status: 'found',
        updated_at: new Date().toISOString()
      };
      expect(skipSegmentCache.isCacheValid(valid)).toBe(true);
    });

    it('recognizes valid not_found negative cache to avoid repeated requests', () => {
      const negativeCache: MediaSkipSegments = {
        id: 'skip_2',
        media_id: 'media_tv_test_1',
        external_id: 'tt0903747',
        provider: 'IntroDB',
        media_type: 'tv',
        season: 1,
        episode: 2,
        intro: null,
        outro: null,
        status: 'not_found',
        updated_at: new Date().toISOString()
      };
      expect(skipSegmentCache.isCacheValid(negativeCache)).toBe(true);
    });

    it('rejects corrupt bounds or error statuses as invalid', () => {
      const corrupt: MediaSkipSegments = {
        id: 'skip_3',
        media_id: 'media_tv_test_1',
        external_id: 'tt0903747',
        provider: 'IntroDB',
        media_type: 'tv',
        season: 1,
        episode: 3,
        intro: { start: 50, end: 10 }, // Inverted
        status: 'found',
        updated_at: new Date().toISOString()
      };
      expect(skipSegmentCache.isCacheValid(corrupt)).toBe(false);

      const errRecord: MediaSkipSegments = {
        id: 'skip_4',
        media_id: 'media_tv_test_1',
        external_id: 'tt0903747',
        provider: 'IntroDB',
        media_type: 'tv',
        season: 1,
        episode: 4,
        status: 'error',
        updated_at: new Date().toISOString()
      };
      expect(skipSegmentCache.isCacheValid(errRecord)).toBe(false);
      expect(skipSegmentCache.isCacheValid(null)).toBe(false);
    });
  });

  describe('getOrFetchSkipSegments', () => {
    it('replaces a stored episode IMDb ID with the show-level ID before reading the cache', async () => {
      const mediaWithEpisodeId: Media = {
        ...mockTvShow,
        external_ids: [
          {
            id: 'ext_tmdb_friends',
            media_id: mockTvShow.id,
            provider: 'TMDB',
            external_id: 'tv:1668'
          },
          {
            id: 'ext_imdb_episode',
            media_id: mockTvShow.id,
            provider: 'IMDb',
            external_id: 'tt_episode'
          }
        ]
      };
      const resolveSpy = vi.spyOn(introDbClient, 'resolveImdbId').mockResolvedValueOnce('tt_series');
      const fetchSpy = vi.spyOn(introDbClient, 'fetchSegments').mockResolvedValueOnce({
        status: 'found',
        intro: { start: 77, end: 121 },
        recap: null,
        outro: null
      });

      await dbService.saveMedia(mediaWithEpisodeId);
      await dbService.saveSkipSegments({
        id: 'skip_cached_with_episode_id',
        media_id: mockTvShow.id,
        external_id: 'tt_episode',
        provider: 'IntroDB',
        media_type: 'tv',
        season: 4,
        episode: 17,
        intro: { start: 100, end: 120 },
        status: 'found',
        updated_at: new Date().toISOString()
      });

      const result = await skipSegmentCache.getOrFetchSkipSegments({
        media: mediaWithEpisodeId,
        season: 4,
        episode: 17
      });

      expect(resolveSpy).toHaveBeenCalledWith('tv', 'tv:1668');
      expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({
        imdbId: 'tt_series',
        tmdbId: undefined,
        season: 4,
        episode: 17
      }));
      expect(await dbService.getExternalIdsForMedia(mockTvShow.id)).toContainEqual(
        expect.objectContaining({ provider: 'IMDb', external_id: 'tt_series' })
      );
      expect(await dbService.getExternalIdsForMedia(mockTvShow.id)).not.toContainEqual(
        expect.objectContaining({ external_id: 'tt_episode' })
      );
      expect(await dbService.getSkipSegmentsByExternalId('tt_episode', 4, 17)).toBeNull();
      expect(result?.external_id).toBe('tt_series');
      expect(result?.intro).toEqual({ start: 77, end: 121 });
    });

    it('links a unique exact TMDB title and year match when no external ID is stored', async () => {
      const mediaWithoutIds: Media = {
        ...mockTvShow,
        title: 'Friends',
        release_year: 1994,
        external_ids: undefined
      };
      const searchSpy = vi.spyOn(tmdbProvider, 'searchMedia').mockResolvedValueOnce([{
        title: 'Friends',
        release_year: 1994,
        type: 'TV Series',
        external_id: 'tv:1668',
        provider: 'TMDB'
      }]);
      vi.spyOn(introDbClient, 'resolveImdbId').mockResolvedValueOnce(undefined);
      const fetchSpy = vi.spyOn(introDbClient, 'fetchSegments').mockResolvedValueOnce({
        status: 'found',
        intro: { start: 77, end: 121 },
        recap: null,
        outro: null
      });

      const result = await skipSegmentCache.getOrFetchSkipSegments({
        media: mediaWithoutIds,
        season: 4,
        episode: 17
      });

      expect(searchSpy).toHaveBeenCalledWith('Friends', 'TV Series', { releaseYear: 1994 });
      expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 'tv:1668' }));
      expect(await dbService.getExternalIdsForMedia(mediaWithoutIds.id)).toContainEqual(
        expect.objectContaining({ provider: 'TMDB', external_id: 'tv:1668' })
      );
      expect(result?.intro).toEqual({ start: 77, end: 121 });
    });

    it('does not link or query IntroDB when exact TMDB matches are ambiguous', async () => {
      const mediaWithoutIds: Media = {
        ...mockTvShow,
        title: 'Friends',
        release_year: 1994,
        external_ids: undefined
      };
      vi.spyOn(tmdbProvider, 'searchMedia').mockResolvedValueOnce([
        {
          title: 'Friends',
          release_year: 1994,
          type: 'TV Series',
          external_id: 'tv:1668',
          provider: 'TMDB'
        },
        {
          title: 'Friends',
          release_year: 1994,
          type: 'TV Series',
          external_id: 'tv:9999',
          provider: 'TMDB'
        }
      ]);
      const fetchSpy = vi.spyOn(introDbClient, 'fetchSegments');

      const result = await skipSegmentCache.getOrFetchSkipSegments({
        media: mediaWithoutIds,
        season: 4,
        episode: 17
      });

      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await dbService.getExternalIdsForMedia(mediaWithoutIds.id)).toEqual([]);
    });

    it('uses external IDs stored in SQLite when the media object lacks them', async () => {
      const mediaWithoutIds = { ...mockTvShow, external_ids: undefined };
      const fetchSpy = vi.spyOn(introDbClient, 'fetchSegments').mockResolvedValueOnce({
        status: 'found',
        intro: { start: 15, end: 55 },
        recap: null,
        outro: null
      });
      await dbService.saveSkipSegments({
        id: 'skip_missing_external_id',
        media_id: mockTvShow.id,
        external_id: mockTvShow.id,
        provider: 'IntroDB',
        media_type: 'tv',
        season: 4,
        episode: 17,
        intro: null,
        outro: null,
        status: 'not_found',
        updated_at: new Date().toISOString()
      });

      const beforeLink = await skipSegmentCache.getOrFetchSkipSegments({
        media: mediaWithoutIds,
        season: 4,
        episode: 17
      });
      expect(beforeLink).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();

      await dbService.saveExternalId({
        id: 'ext_imdb_from_db',
        media_id: mockTvShow.id,
        provider: 'IMDb',
        external_id: 'tt0903747'
      });

      const result = await skipSegmentCache.getOrFetchSkipSegments({
        media: mediaWithoutIds,
        season: 4,
        episode: 17
      });

      expect(fetchSpy).toHaveBeenCalledWith(expect.objectContaining({ imdbId: 'tt0903747' }));
      expect(result?.intro).toEqual({ start: 15, end: 55 });
      expect(await dbService.getSkipSegmentsByExternalId('tt0903747', 4, 17)).toMatchObject({
        intro: { start: 15, end: 55 },
        status: 'found'
      });
    });

    it('fetches and caches segments on first lookup, avoiding repeated API requests', async () => {
      const fetchSpy = vi.spyOn(introDbClient, 'fetchSegments').mockResolvedValueOnce({
        status: 'found',
        intro: { start: 15, end: 55 },
        recap: { start: 60, end: 75 },
        outro: { start: 2900, end: 3000 }
      });

      // 1. First request -> triggers IntroDB fetch
      const first = await skipSegmentCache.getOrFetchSkipSegments({
        media: mockTvShow,
        season: 1,
        episode: 1
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(first).not.toBeNull();
      expect(first?.intro).toEqual({ start: 15, end: 55 });
      expect(first?.recap).toEqual({ start: 60, end: 75 });
      expect(first?.status).toBe('found');

      // 2. Second request -> reads from SQLite cache, DOES NOT call fetchSegments
      const second = await skipSegmentCache.getOrFetchSkipSegments({
        media: mockTvShow,
        season: 1,
        episode: 1
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1); // No repeated API request!
      expect(second?.intro).toEqual({ start: 15, end: 55 });
      expect(second?.recap).toEqual({ start: 60, end: 75 });
    });

    it('refreshes timestamps when forceRefresh is explicitly requested', async () => {
      const fetchSpy = vi.spyOn(introDbClient, 'fetchSegments')
        .mockResolvedValueOnce({
          status: 'found',
          intro: { start: 10, end: 40 },
          recap: null,
          outro: null
        })
        .mockResolvedValueOnce({
          status: 'found',
          intro: { start: 12, end: 42 },
          recap: null,
          outro: { start: 2500, end: 2600 }
        });

      await skipSegmentCache.getOrFetchSkipSegments({
        media: mockTvShow,
        season: 1,
        episode: 1
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Explicitly request refresh
      const refreshed = await skipSegmentCache.getOrFetchSkipSegments({
        media: mockTvShow,
        season: 1,
        episode: 1,
        forceRefresh: true
      });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(refreshed?.intro).toEqual({ start: 12, end: 42 });
      expect(refreshed?.outro).toEqual({ start: 2500, end: 2600 });
    });

    it('caches unavailable timestamps as not_found and avoids repeating request', async () => {
      const fetchSpy = vi.spyOn(introDbClient, 'fetchSegments').mockResolvedValueOnce({
        status: 'not_found',
        intro: null,
        recap: null,
        outro: null
      });

      const first = await skipSegmentCache.getOrFetchSkipSegments({
        media: mockMovie,
        season: 0,
        episode: 0
      });

      expect(first?.status).toBe('not_found');
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Re-query -> avoids repeated request
      const second = await skipSegmentCache.getOrFetchSkipSegments({
        media: mockMovie,
        season: 0,
        episode: 0
      });

      expect(second?.status).toBe('not_found');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('atomic database triggers', () => {
    it('atomically deletes skip segments when media is deleted', async () => {
      await dbService.saveMedia(mockTvShow);

      await skipSegmentCache.getOrFetchSkipSegments({
        media: mockTvShow,
        season: 1,
        episode: 1
      });

      // Verify cached in SQLite
      const beforeDelete = await dbService.getSkipSegments(mockTvShow.id, 1, 1);
      expect(beforeDelete).not.toBeNull();

      // Delete media
      await dbService.deleteMedia(mockTvShow.id);

      // Verify trigger cleaned up media_skip_segments
      const afterDelete = await dbService.getSkipSegments(mockTvShow.id, 1, 1);
      expect(afterDelete).toBeNull();
    });
  });
});
