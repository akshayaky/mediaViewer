import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IntroDbClient } from '../services/skip/IntroDbClient';
import { tmdbProvider } from '../providers/TMDBProvider';

describe('IntroDbClient', () => {
  let client: IntroDbClient;

  beforeEach(() => {
    client = new IntroDbClient();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseSegmentBounds', () => {
    it('parses seconds bounds correctly', () => {
      const bounds = client.parseSegmentBounds({ start_sec: 12.5, end_sec: 58 });
      expect(bounds).toEqual({ start: 12.5, end: 58 });
    });

    it('parses millisecond bounds correctly', () => {
      const bounds = client.parseSegmentBounds({ start_ms: 2500, end_ms: 60000 });
      expect(bounds).toEqual({ start: 2.5, end: 60 });
    });

    it('rejects invalid or inverted bounds', () => {
      expect(client.parseSegmentBounds({ start_sec: 50, end_sec: 20 })).toBeNull();
      expect(client.parseSegmentBounds({ start_sec: -5, end_sec: 20 })).toBeNull();
      expect(client.parseSegmentBounds({ start_sec: 20, end_sec: 20 })).toBeNull();
      expect(client.parseSegmentBounds(null)).toBeNull();
      expect(client.parseSegmentBounds(undefined)).toBeNull();
    });
  });

  describe('fetchSegments for TV shows', () => {
    it('queries TV show segments using IMDb ID, season, and episode', async () => {
      const fakeResponse = {
        imdb_id: 'tt0903747',
        season: 1,
        episode: 1,
        intro: { start_sec: 5, end_sec: 45 },
        recap: { start_sec: 60, end_sec: 75 },
        outro: { start_sec: 2800, end_sec: 2950 }
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => fakeResponse
      } as Response);

      const result = await client.fetchSegments({
        imdbId: 'tt0903747',
        mediaType: 'tv',
        season: 1,
        episode: 1
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('imdb_id=tt0903747&season=1&episode=1'),
        expect.any(Object)
      );

      expect(result.status).toBe('found');
      expect(result.intro).toEqual({ start: 5, end: 45 });
      expect(result.recap).toEqual({ start: 60, end: 75 });
      expect(result.outro).toEqual({ start: 2800, end: 2950 });
    });

    it('recognizes recap-only responses as found', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          imdb_id: 'tt0903747',
          intro: null,
          recap: { start_sec: 10, end_sec: 30 },
          outro: null
        })
      } as Response);

      const result = await client.fetchSegments({
        imdbId: 'tt0903747',
        mediaType: 'tv',
        season: 1,
        episode: 2
      });

      expect(result.status).toBe('found');
      expect(result.recap).toEqual({ start: 10, end: 30 });
    });

    it('uses the series IMDb ID instead of a linked episode IMDb ID', async () => {
      const tmdbSpy = vi.spyOn(tmdbProvider, 'getExternalIds').mockResolvedValueOnce({
        imdb_id: 'tt0903747'
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          imdb_id: 'tt0903747',
          intro: { start_sec: 10, end_sec: 50 },
          outro: null
        })
      } as Response);

      const result = await client.fetchSegments({
        imdbId: 'tt_episode',
        tmdbId: 'tv:1396',
        mediaType: 'tv',
        season: 1,
        episode: 1
      });

      expect(tmdbSpy).toHaveBeenCalledWith('tv', 'tv:1396');
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('imdb_id=tt0903747'),
        expect.any(Object)
      );
      expect(result.status).toBe('found');
      expect(result.resolvedImdbId).toBe('tt0903747');
      expect(result.intro).toEqual({ start: 10, end: 50 });
    });
  });

  describe('fetchSegments for Movies', () => {
    it('fetches movie segments using is_movie=true without assuming TV intro applies', async () => {
      const fakeMovieResponse = {
        imdb_id: 'tt0371746',
        is_movie: true,
        intro: null,
        outro: { start_sec: 7200, end_sec: 7500 },
        no_intro: true
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => fakeMovieResponse
      } as Response);

      const result = await client.fetchSegments({
        imdbId: 'tt0371746',
        mediaType: 'movie'
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('imdb_id=tt0371746&is_movie=true'),
        expect.any(Object)
      );

      expect(result.status).toBe('found');
      expect(result.intro).toBeNull(); // Did not assume TV intro applies to movies
      expect(result.outro).toEqual({ start: 7200, end: 7500 });
    });
  });

  describe('graceful error and 404 handling', () => {
    it('handles 404 response gracefully as not_found', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404
      } as Response);

      const result = await client.fetchSegments({
        imdbId: 'tt9999999',
        mediaType: 'tv',
        season: 1,
        episode: 1
      });

      expect(result.status).toBe('not_found');
      expect(result.intro).toBeNull();
      expect(result.outro).toBeNull();
    });

    it('handles unavailable segments (null intro and null outro) as not_found', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          imdb_id: 'tt1234567',
          intro: null,
          outro: null,
          no_intro: true,
          no_outro: true
        })
      } as Response);

      const result = await client.fetchSegments({
        imdbId: 'tt1234567',
        mediaType: 'tv',
        season: 1,
        episode: 1
      });

      expect(result.status).toBe('not_found');
      expect(result.intro).toBeNull();
      expect(result.outro).toBeNull();
    });

    it('handles network exceptions gracefully as error without throwing', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network offline'));

      const result = await client.fetchSegments({
        imdbId: 'tt1234567',
        mediaType: 'tv',
        season: 1,
        episode: 1
      });

      expect(result.status).toBe('error');
      expect(result.error).toContain('Network offline');
      expect(result.intro).toBeNull();
      expect(result.outro).toBeNull();
    });
  });
});
