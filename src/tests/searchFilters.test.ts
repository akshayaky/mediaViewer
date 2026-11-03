import { afterEach, describe, expect, it, vi } from 'vitest';
import { dbService } from '../services/DatabaseService';
import { IGDBProvider } from '../providers/IGDBProvider';
import { TMDBProvider } from '../providers/TMDBProvider';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('metadata search filters', () => {
  it('sends movie year and language to TMDB and keeps only matching original languages', async () => {
    vi.spyOn(dbService, 'getSettings').mockResolvedValue({ tmdb_api_key: 'test-key' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { id: 1, title: 'Dune', original_language: 'en', release_date: '2024-03-01' },
          { id: 2, title: 'Dune', original_language: 'fr', release_date: '2024-03-01' }
        ]
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await new TMDBProvider().searchMedia('Dune', 'Film', {
      releaseYear: 2024,
      language: 'fr-FR'
    });

    const requestedUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestedUrl.searchParams.get('year')).toBe('2024');
    expect(requestedUrl.searchParams.get('language')).toBe('fr-FR');
    expect(results.map(result => result.external_id)).toEqual(['movie:2']);
  });

  it('loads TMDB languages once and reuses the cached list', async () => {
    vi.spyOn(dbService, 'getSettings').mockResolvedValue({ tmdb_api_key: 'test-key' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { iso_639_1: 'fr', english_name: 'French', name: 'Français' },
        { iso_639_1: 'en', english_name: 'English', name: 'English' }
      ]
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new TMDBProvider();

    const first = await provider.getLanguages();
    const second = await provider.getLanguages();

    expect(first.map(language => language.iso_639_1)).toEqual(['en', 'fr']);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/configuration/languages');
  });

  it('sends game release-year bounds to IGDB', async () => {
    vi.spyOn(dbService, 'getSettings').mockResolvedValue({
      twitch_client_id: 'test-client',
      twitch_client_secret: 'test-secret'
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test-token', expires_in: 3600 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{
          id: 42,
          name: 'Test Game',
          first_release_date: Date.UTC(2024, 5, 1) / 1000
        }]
      });
    vi.stubGlobal('fetch', fetchMock);

    const results = await new IGDBProvider().searchMedia('Test Game', 'VideoGame', {
      releaseYear: 2024
    });

    const gameRequest = fetchMock.mock.calls[1][1];
    const requestBody = String(gameRequest?.body);
    expect(requestBody).toContain('first_release_date >= 1704067200');
    expect(requestBody).toContain('first_release_date < 1735689600');
    expect(results[0].release_year).toBe(2024);
  });
});
