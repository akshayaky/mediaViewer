import { describe, it, expect } from 'vitest';
import { igdbProvider, fetchIGDBLogo } from '../providers/IGDBProvider';

describe('IGDBProvider', () => {
  it('cleans raw query strings for game searches', () => {
    const raw = 'Cyberpunk.2077.v1.6.FitGirl.Repack.[GOG].zip';
    const cleaned = igdbProvider.cleanQueryString(raw);
    expect(cleaned).toBe('Cyberpunk 2077');
  });

  it('returns no fabricated game search results when API keys are unconfigured', async () => {
    const results = await igdbProvider.searchMedia("Assassin's Creed", 'VideoGame');
    expect(results).toEqual([]);
  });

  it('does not fabricate game details when API keys are unconfigured', async () => {
    const details = await igdbProvider.getMediaDetails('igdb:1020');
    expect(details).toEqual({});
  });

  it('returns empty results if searching non-game type in IGDBProvider', async () => {
    const results = await igdbProvider.searchMedia('Inception', 'Film');
    expect(results).toEqual([]);
  });

  it('does not return a fabricated IGDB logo when API keys are unconfigured', async () => {
    const logo = await fetchIGDBLogo('Cyberpunk 2077');
    expect(logo).toBeUndefined();
  });
});
