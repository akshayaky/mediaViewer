import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-sql', async () => {
  const { loadTauriSqlMock } = await import('./tauriSqlMock');
  return { default: { load: loadTauriSqlMock } };
});

import { dbService } from '../services/DatabaseService';

describe('Homepage rail queries', () => {
  beforeEach(async () => {
    const { resetMockTauriDatabase } = await import('./tauriSqlMock');
    await dbService.init();
    resetMockTauriDatabase();

    for (let index = 0; index < 13; index++) {
      const mediaId = `home-${index}`;
      await dbService.saveMedia({
        id: mediaId,
        type: 'Film',
        title: `Title ${index}`,
        genres: [],
        backdrop: 'https://images.example/backdrop.jpg',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z'
      });
      await dbService.saveHistory({
        id: `history-${index}`,
        media_id: mediaId,
        status: 'Finished',
        completed_at: '2024-02-01T00:00:00.000Z',
        source: 'Manual',
        created_at: `2024-02-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`
      });
    }

    await dbService.saveHistory({
      id: 'rewatch-history',
      media_id: 'home-0',
      status: 'Finished',
      context: 'Rewatch',
      source: 'Manual',
      created_at: '2025-01-01T00:00:00.000Z'
    });
    await dbService.saveHistory({
      id: 'currently-history',
      media_id: 'home-1',
      status: 'Currently',
      source: 'Manual',
      created_at: '2025-01-02T00:00:00.000Z'
    });
    await dbService.saveHistory({
      id: 'abandoned-history',
      media_id: 'home-2',
      status: 'Abandoned',
      source: 'Manual',
      created_at: '2025-01-03T00:00:00.000Z'
    });
    await dbService.saveLocalFile({
      id: 'local-file',
      media_id: 'home-3',
      path: 'C:\\media\\title.mkv',
      filename: 'title.mkv',
      extension: 'mkv',
      size: 1,
      discovered_at: '2025-01-01T00:00:00.000Z',
      last_seen_at: '2025-01-01T00:00:00.000Z',
      exists: true,
      file_type: 'movie'
    });
  });

  it('loads independent rail categories in bounded pages', async () => {
    const firstPage = await dbService.getHomeRailPage('recent', 5);
    const secondPage = await dbService.getHomeRailPage('recent', 5, 5);
    const finalPage = await dbService.getHomeRailPage('recent', 5, 10);

    expect(firstPage.entries).toHaveLength(5);
    expect(firstPage.hasMore).toBe(true);
    expect(secondPage.entries).toHaveLength(5);
    expect(secondPage.hasMore).toBe(true);
    expect(finalPage.entries).toHaveLength(3);
    expect(finalPage.hasMore).toBe(false);
    expect(new Set([...firstPage.entries, ...secondPage.entries, ...finalPage.entries].map(entry => entry.media.id)).size).toBe(13);

    expect((await dbService.getHomeRailPage('continue')).entries.map(entry => entry.media.id)).toContain('home-1');
    expect((await dbService.getHomeRailPage('rewatch')).entries.map(entry => entry.media.id)).toContain('home-0');
    expect((await dbService.getHomeRailPage('local')).entries.map(entry => entry.media.id)).toContain('home-3');
    expect((await dbService.getHomeRailPage('abandoned')).entries.map(entry => entry.media.id)).toContain('home-2');
  });

  it('bounds hero candidate data while retaining library presence', async () => {
    const heroData = await dbService.getHomeHeroData(2);
    expect(heroData.hasMedia).toBe(true);
    expect(heroData.entries).toHaveLength(2);
  });
});
