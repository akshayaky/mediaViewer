import { describe, it, expect, vi } from 'vitest';
import { igdbProvider, fetchSteamLogo } from '../providers/IGDBProvider';
import { dbService } from '../services/DatabaseService';

describe('IGDBProvider', () => {
  it('cleans raw query strings for game searches', () => {
    const raw = 'Cyberpunk.2077.v1.6.FitGirl.Repack.[GOG].zip';
    const cleaned = igdbProvider.cleanQueryString(raw);
    expect(cleaned).toBe('Cyberpunk 2077');
  });

  it('returns game search results from mock provider when API keys are unconfigured', async () => {
    const results = await igdbProvider.searchMedia("Assassin's Creed", 'VideoGame');
    expect(results.length).toBeGreaterThan(0);
    const item = results[0];
    expect(item.type).toBe('VideoGame');
    expect(item.provider).toBe('IGDB');
    expect(item.title).toContain("Assassin's Creed");
    expect(item.poster).toBeDefined();
    expect(item.backdrop).toBeDefined();
  });

  it('fetches game details including developers and publishers', async () => {
    const details = await igdbProvider.getMediaDetails('igdb:1020');
    expect(details.title).toBe("Assassin's Creed IV Black Flag");
    expect(details.type).toBe('VideoGame');
    expect(details.developer).toContain('Ubisoft');
    expect(details.publisher).toBe('Ubisoft');
    expect(details.genres).toContain('Action');
    expect(details.release_year).toBe(2013);
  });

  it('returns empty results if searching non-game type in IGDBProvider', async () => {
    const results = await igdbProvider.searchMedia('Inception', 'Film');
    expect(results).toEqual([]);
  });

  it('fetches Steam game title logo using fetchSteamLogo', async () => {
    // Mock dbService.getSettings to avoid running SQLite WASM in unit test environment
    vi.spyOn(dbService, 'getSettings').mockReturnValue({
      steam_api_key: 'test_steam_key_123'
    });

    // Mock global fetch for store search API
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ id: 1091500, name: 'Cyberpunk 2077' }]
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    const logo = await fetchSteamLogo('Cyberpunk 2077');
    expect(logo).toBe('https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1091500/logo.png');
    expect(mockFetch).toHaveBeenCalled();
    const callUrl = mockFetch.mock.calls[0][0];
    expect(callUrl).toContain('key=test_steam_key_123');

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
