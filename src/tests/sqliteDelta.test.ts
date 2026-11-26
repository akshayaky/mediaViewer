import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockTauriDatabase } from './tauriSqlMock';

vi.mock('@tauri-apps/plugin-sql', async () => {
  const { loadTauriSqlMock } = await import('./tauriSqlMock');
  return { default: { load: loadTauriSqlMock } };
});

import { dbService } from '../services/DatabaseService';
import {
  applyDelta,
  exportDeltaSince,
  getLastSyncedAt,
  getOrCreateLocalDeviceInfo,
  getSyncDevice,
  listSyncDevices,
  removeSyncDevice,
  setLocalDeviceName,
  shouldIncomingRowWin,
  updateLastSyncedAt,
  upsertSyncDevice,
} from '../sync/sqliteDelta';
import { SyncDeltaPayload } from '../sync/types';

function emptyPayload(
  sourceDeviceId: string,
  overrides?: Partial<SyncDeltaPayload>
): SyncDeltaPayload {
  return {
    version: 1,
    sourceDeviceId,
    sourceDeviceName: 'Peer Device',
    generatedAt: '2026-06-01T12:00:00.000Z',
    since: null,
    tables: {
      media: [],
      media_history: [],
      external_ids: [],
      playback_progress: [],
      media_skip_segments: [],
      availability: [],
    },
    ...overrides,
  };
}

describe('Phase 1: SQLite Delta & Sync Metadata Layer', () => {
  beforeEach(async () => {
    await dbService.init();
    resetMockTauriDatabase();
  });

  it('persists local device identity and allows renaming', async () => {
    const first = await getOrCreateLocalDeviceInfo();
    expect(first.deviceId).toMatch(/^dev_/);
    expect(first.deviceName.length).toBeGreaterThan(0);

    await setLocalDeviceName('Living Room PC');
    const second = await getOrCreateLocalDeviceInfo();
    expect(second.deviceId).toBe(first.deviceId);
    expect(second.deviceName).toBe('Living Room PC');
  });

  it('tracks paired devices and last_synced_at cursors', async () => {
    const saved = await upsertSyncDevice({
      device_id: 'dev_phone_1',
      device_name: 'Pixel 9',
      shared_secret: 'secret-abc',
      last_ip: '192.168.1.42',
      last_port: 47890,
      last_synced_at: null,
    });

    expect(saved.device_id).toBe('dev_phone_1');
    expect(await getLastSyncedAt('dev_phone_1')).toBeNull();

    await updateLastSyncedAt('dev_phone_1', '2026-06-01T10:15:00.000Z');
    expect(await getLastSyncedAt('dev_phone_1')).toBe('2026-06-01T10:15:00.000Z');

    const devices = await listSyncDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0].last_ip).toBe('192.168.1.42');

    await removeSyncDevice('dev_phone_1');
    expect(await getSyncDevice('dev_phone_1')).toBeNull();
  });

  it('exports incremental deltas since cursor and excludes device-local tables', async () => {
    const t1 = '2026-06-01T08:00:00.000Z';
    const t2 = '2026-06-01T09:00:00.000Z';
    const t3 = '2026-06-01T10:00:00.000Z';

    await dbService.saveMedia({
      id: 'm_old',
      type: 'Film',
      title: 'Old Movie',
      genres: ['Drama'],
      created_at: t1,
      updated_at: t1,
    });
    await dbService.saveMedia({
      id: 'm_new',
      type: 'Film',
      title: 'New Movie',
      genres: ['Sci-Fi'],
      created_at: t3,
      updated_at: t3,
    });
    await dbService.saveLocalFile({
      id: 'lf_only_local',
      media_id: 'm_new',
      path: 'C:\\Movies\\New.mkv',
      filename: 'New.mkv',
      extension: 'mkv',
      size: 1234,
      discovered_at: t3,
      last_seen_at: t3,
      exists: true,
      file_type: 'movie',
    });

    const fullDelta = await exportDeltaSince(null);
    expect(fullDelta.tables.media.map(m => m.id)).toEqual(['m_old', 'm_new']);
    expect(Object.keys(fullDelta.tables)).not.toContain('local_file');
    expect(Object.keys(fullDelta.tables)).not.toContain('settings');
    expect(Object.keys(fullDelta.tables)).not.toContain('notion_raw_records');

    const incDelta = await exportDeltaSince(t2);
    expect(incDelta.since).toBe(t2);
    expect(incDelta.tables.media.map(m => m.id)).toEqual(['m_new']);
  });

  it('applies incoming rows across synced tables and resolves LWW conflicts', async () => {
    const incoming = emptyPayload('dev_peer_z', {
      tables: {
        media: [
          {
            id: 'm_sync_1',
            type: 'TV Series',
            title: 'Severance',
            original_title: null,
            release_year: 2022,
            language: 'en',
            description: 'Lumon Industries',
            genres: JSON.stringify(['Sci-Fi', 'Thriller']),
            runtime: 50,
            poster: null,
            backdrop: null,
            logo: null,
            metadata_source: 'TMDB',
            metadata_refreshed_at: null,
            publisher: null,
            developer: null,
            cast: null,
            seasons: null,
            created_at: '2026-06-01T08:00:00.000Z',
            updated_at: '2026-06-01T09:00:00.000Z',
            accent_color: null,
            manually_matched: 0,
            deleted_at: null,
            device_id: 'dev_peer_z',
          },
        ],
        media_history: [
          {
            id: 'h_sync_1',
            media_id: 'm_sync_1',
            started_at: '2026-06-01',
            completed_at: null,
            status: 'Currently',
            score: 5,
            thoughts: 'Great pilot',
            context: 'S01E01',
            source: 'Manual',
            original_source_record_id: null,
            created_at: '2026-06-01T09:00:00.000Z',
            updated_at: '2026-06-01T09:00:00.000Z',
            deleted_at: null,
            device_id: 'dev_peer_z',
          },
        ],
        external_ids: [
          {
            id: 'ext_sync_1',
            media_id: 'm_sync_1',
            provider: 'TMDB',
            external_id: 'tv:95396',
            updated_at: '2026-06-01T09:00:00.000Z',
            deleted_at: null,
            device_id: 'dev_peer_z',
          },
        ],
        playback_progress: [
          {
            id: 'pb_sync_1',
            media_id: 'm_sync_1',
            season: 1,
            episode: 2,
            position_seconds: 640,
            duration_seconds: 2800,
            updated_at: '2026-06-01T09:05:00.000Z',
            is_completed: 0,
            deleted_at: null,
            device_id: 'dev_peer_z',
          },
        ],
        media_skip_segments: [
          {
            id: 'skip_sync_1',
            media_id: 'm_sync_1',
            external_id: 'tv:95396',
            provider: 'IntroDB',
            media_type: 'tv',
            season: 1,
            episode: 2,
            intro_start: 45,
            intro_end: 125,
            recap_start: null,
            recap_end: null,
            outro_start: null,
            outro_end: null,
            raw_data: null,
            status: 'found',
            updated_at: '2026-06-01T09:05:00.000Z',
            deleted_at: null,
            device_id: 'dev_peer_z',
          },
        ],
        availability: [
          {
            id: 'avail_sync_1',
            media_id: 'm_sync_1',
            provider: 'Apple TV+',
            country: 'US',
            availability_type: 'Stream',
            url: null,
            last_checked: '2026-06-01T09:00:00.000Z',
            updated_at: '2026-06-01T09:00:00.000Z',
            deleted_at: null,
            device_id: 'dev_peer_z',
          },
        ],
      },
    });

    const stats = await applyDelta(incoming);
    expect(stats.inserted).toBe(6);
    expect(stats.skipped).toBe(0);

    const media = await dbService.getMediaById('m_sync_1');
    expect(media?.title).toBe('Severance');
    expect(media?.external_ids?.[0]?.external_id).toBe('tv:95396');
    expect((await dbService.getHistoryForMedia('m_sync_1'))[0]?.score).toBe(5);
    expect((await dbService.getPlaybackProgress('m_sync_1', 1, 2))?.position_seconds).toBe(640);
    expect((await dbService.getSkipSegments('m_sync_1', 1, 2))?.intro?.end).toBe(125);
    expect((await dbService.getAvailabilityForMedia('m_sync_1'))[0]?.provider).toBe('Apple TV+');

    // Older incoming edit should be skipped
    const stalePayload = emptyPayload('dev_peer_a', {
      tables: {
        ...emptyPayload('dev_peer_a').tables,
        media: [
          {
            ...incoming.tables.media[0],
            title: 'Stale Title',
            updated_at: '2026-06-01T08:30:00.000Z',
            device_id: 'dev_peer_a',
          },
        ],
      },
    });
    const staleStats = await applyDelta(stalePayload);
    expect(staleStats.skipped).toBe(1);
    expect((await dbService.getMediaById('m_sync_1'))?.title).toBe('Severance');

    // Newer incoming edit should update
    const newerPayload = emptyPayload('dev_peer_a', {
      tables: {
        ...emptyPayload('dev_peer_a').tables,
        media: [
          {
            ...incoming.tables.media[0],
            title: 'Severance (Updated)',
            updated_at: '2026-06-01T10:00:00.000Z',
            device_id: 'dev_peer_a',
          },
        ],
      },
    });
    const newerStats = await applyDelta(newerPayload);
    expect(newerStats.updated).toBe(1);
    expect((await dbService.getMediaById('m_sync_1'))?.title).toBe('Severance (Updated)');
  });

  it('propagates soft-delete tombstones and handles revival ordering', async () => {
    const t1 = '2026-06-01T08:00:00.000Z';
    const t2 = '2026-06-01T09:00:00.000Z';
    const t3 = '2026-06-01T10:00:00.000Z';

    await dbService.saveMedia({
      id: 'm_del',
      type: 'Film',
      title: 'To Delete',
      genres: [],
      created_at: t1,
      updated_at: t1,
    });
    await dbService.deleteMedia('m_del');

    // Hidden from normal reads
    expect(await dbService.getMediaById('m_del')).toBeNull();

    // Tombstone is exported in delta
    const delta = await exportDeltaSince(t1);
    expect(delta.tables.media).toHaveLength(1);
    expect(delta.tables.media[0].deleted_at).not.toBeNull();

    // Applying a remote tombstone hides an active item locally
    await dbService.saveMedia({
      id: 'm_remote_del',
      type: 'Film',
      title: 'Remote Delete',
      genres: [],
      created_at: t1,
      updated_at: t1,
    });
    const remoteDeleteStats = await applyDelta(
      emptyPayload('dev_peer', {
        tables: {
          ...emptyPayload('dev_peer').tables,
          media: [
            {
              id: 'm_remote_del',
              type: 'Film',
              title: 'Remote Delete',
              original_title: null,
              release_year: null,
              language: null,
              description: null,
              genres: '[]',
              runtime: null,
              poster: null,
              backdrop: null,
              logo: null,
              metadata_source: null,
              metadata_refreshed_at: null,
              publisher: null,
              developer: null,
              cast: null,
              seasons: null,
              created_at: t1,
              updated_at: t2,
              accent_color: null,
              manually_matched: 0,
              deleted_at: t2,
              device_id: 'dev_peer',
            },
          ],
        },
      })
    );
    expect(remoteDeleteStats.deleted).toBe(1);
    expect(await dbService.getMediaById('m_remote_del')).toBeNull();

    // Older edit does not revive newer tombstone
    const staleRevive = await applyDelta(
      emptyPayload('dev_peer', {
        tables: {
          ...emptyPayload('dev_peer').tables,
          media: [
            {
              id: 'm_remote_del',
              type: 'Film',
              title: 'Should Stay Deleted',
              original_title: null,
              release_year: null,
              language: null,
              description: null,
              genres: '[]',
              runtime: null,
              poster: null,
              backdrop: null,
              logo: null,
              metadata_source: null,
              metadata_refreshed_at: null,
              publisher: null,
              developer: null,
              cast: null,
              seasons: null,
              created_at: t1,
              updated_at: t1,
              accent_color: null,
              manually_matched: 0,
              deleted_at: null,
              device_id: 'dev_peer',
            },
          ],
        },
      })
    );
    expect(staleRevive.skipped).toBe(1);
    expect(await dbService.getMediaById('m_remote_del')).toBeNull();

    // Newer active edit revives an older tombstone
    const newerRevive = await applyDelta(
      emptyPayload('dev_peer', {
        tables: {
          ...emptyPayload('dev_peer').tables,
          media: [
            {
              id: 'm_remote_del',
              type: 'Film',
              title: 'Revived Film',
              original_title: null,
              release_year: null,
              language: null,
              description: null,
              genres: '[]',
              runtime: null,
              poster: null,
              backdrop: null,
              logo: null,
              metadata_source: null,
              metadata_refreshed_at: null,
              publisher: null,
              developer: null,
              cast: null,
              seasons: null,
              created_at: t1,
              updated_at: t3,
              accent_color: null,
              manually_matched: 0,
              deleted_at: null,
              device_id: 'dev_peer',
            },
          ],
        },
      })
    );
    expect(newerRevive.updated).toBe(1);
    expect((await dbService.getMediaById('m_remote_del'))?.title).toBe('Revived Film');
  });

  it('resolves natural-key collisions cleanly when peer rows use different primary keys', async () => {
    const t1 = '2026-06-01T08:00:00.000Z';
    const t2 = '2026-06-01T09:00:00.000Z';

    await dbService.saveMedia({
      id: 'm_nat',
      type: 'Film',
      title: 'Natural Key Film',
      genres: [],
      created_at: t1,
      updated_at: t1,
    });
    await dbService.savePlaybackProgress({
      id: 'pb_local',
      media_id: 'm_nat',
      season: 0,
      episode: 0,
      position_seconds: 120,
      duration_seconds: 1000,
      updated_at: t1,
      is_completed: false,
    });

    const stats = await applyDelta(
      emptyPayload('dev_peer', {
        tables: {
          ...emptyPayload('dev_peer').tables,
          playback_progress: [
            {
              id: 'pb_remote',
              media_id: 'm_nat',
              season: 0,
              episode: 0,
              position_seconds: 480,
              duration_seconds: 1000,
              updated_at: t2,
              is_completed: 0,
              deleted_at: null,
              device_id: 'dev_peer',
            },
          ],
        },
      })
    );

    expect(stats.inserted).toBe(1);
    const progress = await dbService.getPlaybackProgress('m_nat', 0, 0);
    expect(progress?.id).toBe('pb_remote');
    expect(progress?.position_seconds).toBe(480);
  });

  it('breaks equal-timestamp ties deterministically by device_id', () => {
    const ts = '2026-06-01T12:00:00.000Z';
    expect(
      shouldIncomingRowWin(
        { updated_at: ts, deleted_at: null, device_id: 'dev_a' },
        { updated_at: ts, deleted_at: null, device_id: 'dev_b' }
      )
    ).toBe(true);
    expect(
      shouldIncomingRowWin(
        { updated_at: ts, deleted_at: null, device_id: 'dev_b' },
        { updated_at: ts, deleted_at: null, device_id: 'dev_a' }
      )
    ).toBe(false);
  });
});
