import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LanHttpResponse,
  LanRequestHandler,
  LanTransportAdapter,
  tryRequestAcrossCandidateIps,
} from '../sync/lanTransport';
import { SyncEngine } from '../sync/syncEngine';
import { applyDelta, exportDeltaSince, setLocalDeviceName } from '../sync/sqliteDelta';
import { SqliteExecutor, SyncDeltaPayload, SyncStatus } from '../sync/types';

/**
 * Isolated in-memory SQLite database replicating Veyview's schema for
 * multi-device sync integration testing.
 */
async function createIsolatedExecutor(): Promise<SqliteExecutor> {
  const SQL = await initSqlJs({
    locateFile: file => resolve('node_modules/sql.js/dist', file),
  });
  const db: Database = new SQL.Database();

  const statements = [
    `CREATE TABLE media (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      original_title TEXT,
      release_year INTEGER,
      language TEXT,
      description TEXT,
      genres TEXT NOT NULL,
      runtime INTEGER,
      poster TEXT,
      backdrop TEXT,
      logo TEXT,
      metadata_source TEXT,
      metadata_refreshed_at TEXT,
      publisher TEXT,
      developer TEXT,
      cast TEXT,
      seasons TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      accent_color TEXT,
      manually_matched INTEGER DEFAULT 0,
      deleted_at TEXT,
      device_id TEXT
    )`,
    `CREATE TABLE media_history (
      id TEXT PRIMARY KEY,
      media_id TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      status TEXT NOT NULL,
      score REAL,
      thoughts TEXT,
      context TEXT,
      source TEXT NOT NULL,
      original_source_record_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT,
      device_id TEXT
    )`,
    `CREATE TABLE external_ids (
      id TEXT PRIMARY KEY,
      media_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT,
      device_id TEXT
    )`,
    `CREATE TABLE playback_progress (
      id TEXT PRIMARY KEY,
      media_id TEXT NOT NULL,
      season INTEGER DEFAULT 0,
      episode INTEGER DEFAULT 0,
      position_seconds REAL NOT NULL,
      duration_seconds REAL NOT NULL,
      updated_at TEXT NOT NULL,
      is_completed INTEGER DEFAULT 0,
      deleted_at TEXT,
      device_id TEXT
    )`,
    `CREATE TABLE media_skip_segments (
      id TEXT PRIMARY KEY,
      media_id TEXT,
      external_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      media_type TEXT NOT NULL,
      season INTEGER DEFAULT 0,
      episode INTEGER DEFAULT 0,
      intro_start REAL,
      intro_end REAL,
      recap_start REAL,
      recap_end REAL,
      outro_start REAL,
      outro_end REAL,
      raw_data TEXT,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      device_id TEXT
    )`,
    `CREATE TABLE availability (
      id TEXT PRIMARY KEY,
      media_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      country TEXT,
      availability_type TEXT NOT NULL,
      url TEXT,
      last_checked TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT,
      device_id TEXT
    )`,
    `CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
    `CREATE TABLE sync_devices (
      device_id TEXT PRIMARY KEY,
      device_name TEXT NOT NULL,
      shared_secret TEXT,
      last_ip TEXT,
      last_port INTEGER,
      last_synced_at TEXT,
      peer_cursor TEXT,
      paired_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE UNIQUE INDEX idx_external_ids_provider_ext ON external_ids(provider, external_id) WHERE deleted_at IS NULL`,
    `CREATE UNIQUE INDEX idx_playback_progress_media_ep ON playback_progress(media_id, season, episode) WHERE deleted_at IS NULL`,
    `CREATE UNIQUE INDEX idx_skip_segments_lookup ON media_skip_segments(external_id, season, episode) WHERE deleted_at IS NULL`,
  ];

  for (const sql of statements) {
    db.run(sql);
  }

  return {
    execute: async (query: string, values: unknown[] = []) => {
      db.run(query, values as any[]);
      return { rowsAffected: db.getRowsModified(), lastInsertId: 0 };
    },
    select: async <T>(query: string, values: unknown[] = []): Promise<T> => {
      const stmt = db.prepare(query);
      try {
        stmt.bind(values as any[]);
        const rows: Record<string, unknown>[] = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        return rows as T;
      } finally {
        stmt.free();
      }
    },
  };
}

class MemoryLanBus {
  private endpoints = new Map<string, LanRequestHandler>();
  public offlineEndpoints = new Set<string>();

  createAdapter(ips: string[], port = 47890): LanTransportAdapter {
    let boundKeys: string[] = [];
    return {
      startServer: async (handler, preferredPort = port) => {
        boundKeys = ips.map(ip => `${ip}:${preferredPort}`);
        for (const key of boundKeys) {
          this.endpoints.set(key, handler);
        }
        return { port: preferredPort, ips };
      },
      stopServer: async () => {
        for (const key of boundKeys) {
          this.endpoints.delete(key);
        }
        boundKeys = [];
      },
      getCandidateIps: async () => ips,
      sendRequest: async (ip, targetPort, req): Promise<LanHttpResponse> => {
        const key = `${ip}:${targetPort}`;
        if (this.offlineEndpoints.has(key) || this.offlineEndpoints.has(ip)) {
          throw new Error(`Connection timed out to ${key}`);
        }
        const handler = this.endpoints.get(key);
        if (!handler) {
          throw new Error(`ECONNREFUSED ${key}`);
        }
        return handler({ ...req, remoteIp: ips[0] });
      },
    };
  }
}

async function seedMedia(
  executor: SqliteExecutor,
  id: string,
  title: string,
  updatedAt: string,
  deviceId: string,
  deletedAt: string | null = null
): Promise<void> {
  const payload: SyncDeltaPayload = {
    version: 1,
    sourceDeviceId: deviceId,
    sourceDeviceName: 'Test',
    generatedAt: updatedAt,
    since: null,
    tables: {
      media: [
        {
          id,
          type: 'Film',
          title,
          original_title: null,
          release_year: 2024,
          language: 'en',
          description: null,
          genres: '["Drama"]',
          runtime: 120,
          poster: null,
          backdrop: null,
          logo: null,
          metadata_source: 'Manual',
          metadata_refreshed_at: null,
          publisher: null,
          developer: null,
          cast: null,
          seasons: null,
          created_at: updatedAt,
          updated_at: updatedAt,
          accent_color: null,
          manually_matched: 0,
          deleted_at: deletedAt,
          device_id: deviceId,
        },
      ],
      media_history: [],
      external_ids: [],
      playback_progress: [],
      media_skip_segments: [],
      availability: [],
    },
  };
  await applyDelta(payload, executor);
}

describe('Phase 3: LAN Transport & SyncEngine', () => {
  let bus: MemoryLanBus;
  let hostDb: SqliteExecutor;
  let clientDb: SqliteExecutor;
  let hostEngine: SyncEngine;
  let clientEngine: SyncEngine;

  beforeEach(async () => {
    bus = new MemoryLanBus();
    hostDb = await createIsolatedExecutor();
    clientDb = await createIsolatedExecutor();

    await setLocalDeviceName('Desktop Host', hostDb);
    await setLocalDeviceName('Android Phone', clientDb);

    hostEngine = new SyncEngine({
      executor: hostDb,
      transport: bus.createAdapter(['192.168.1.99', '10.0.0.25'], 47890),
    });
    clientEngine = new SyncEngine({
      executor: clientDb,
      transport: bus.createAdapter(['192.168.1.44'], 47891),
    });
  });

  it('falls back across candidate IPs when primary IP is unreachable', async () => {
    bus.offlineEndpoints.add('192.168.1.99:47890');
    await hostEngine.startHosting(47890);

    const adapter = bus.createAdapter(['192.168.1.44']);
    const result = await tryRequestAcrossCandidateIps(
      adapter,
      ['192.168.1.99', '10.0.0.25'],
      47890,
      { method: 'GET', path: '/sync/ping', headers: {}, body: '' }
    );

    expect(result.ip).toBe('10.0.0.25');
    expect(result.response.status).toBe(200);
  });

  it('pairs via QR across IP fallback and performs bidirectional incremental delta sync', async () => {
    const statuses: SyncStatus[] = [];
    const unsubscribe = clientEngine.subscribe(snap => {
      statuses.push(snap.status);
    });

    // Host has 1 movie before pairing; client has 1 different movie
    const hostInfo = await hostEngine.getLocalDeviceInfo();
    const clientInfo = await clientEngine.getLocalDeviceInfo();
    const t1 = '2026-06-01T08:00:00.000Z';
    await seedMedia(hostDb, 'm_host_1', 'Dune: Part Two', t1, hostInfo.deviceId);
    await seedMedia(clientDb, 'm_client_1', 'Past Lives', t1, clientInfo.deviceId);

    // First host IP fails; client should automatically fall back to 10.0.0.25
    bus.offlineEndpoints.add('192.168.1.99:47890');
    const session = await hostEngine.startPairingSession();
    expect(hostEngine.getState().status).toBe('pairing');

    const pairedHost = await clientEngine.pairWithQrText(session.qrText);
    expect(pairedHost.device_id).toBe(hostInfo.deviceId);
    expect(pairedHost.last_ip).toBe('10.0.0.25');
    expect(hostEngine.getState().status).toBe('idle');

    // First sync exchanges both existing movies bidirectionally
    const sync1Stats = await clientEngine.syncWithDevice(hostInfo.deviceId);
    expect(sync1Stats.inserted).toBe(1);

    const hostRowsAfter1 = await exportDeltaSince(null, hostDb);
    const clientRowsAfter1 = await exportDeltaSince(null, clientDb);
    expect(hostRowsAfter1.tables.media.map(m => m.id).sort()).toEqual(['m_client_1', 'm_host_1']);
    expect(clientRowsAfter1.tables.media.map(m => m.id).sort()).toEqual(['m_client_1', 'm_host_1']);

    // Wait >1ms and apply an incremental update on host + soft-delete on client
    await new Promise(r => setTimeout(r, 15));
    const t2 = new Date().toISOString();
    await seedMedia(hostDb, 'm_host_1', 'Dune: Part Two (4K)', t2, hostInfo.deviceId);
    await seedMedia(clientDb, 'm_client_1', 'Past Lives', t2, clientInfo.deviceId, t2);

    const sync2Stats = await clientEngine.syncWithDevice(hostInfo.deviceId);
    expect(sync2Stats.updated).toBe(1);

    const hostFinal = await exportDeltaSince(null, hostDb);
    const clientFinal = await exportDeltaSince(null, clientDb);
    expect(hostFinal.tables.media.find(m => m.id === 'm_host_1')?.title).toBe('Dune: Part Two (4K)');
    expect(hostFinal.tables.media.find(m => m.id === 'm_client_1')?.deleted_at).toBe(t2);
    expect(clientFinal.tables.media.find(m => m.id === 'm_host_1')?.title).toBe('Dune: Part Two (4K)');

    expect(statuses).toContain('pairing');
    expect(statuses).toContain('syncing');
    expect(statuses[statuses.length - 1]).toBe('idle');
    unsubscribe();
  });

  it('transitions to offline when peer is unreachable and recovers on reconnect', async () => {
    const hostInfo = await hostEngine.getLocalDeviceInfo();
    const session = await hostEngine.startPairingSession();
    await clientEngine.pairWithQrText(session.qrText);

    // Take host offline
    bus.offlineEndpoints.add('192.168.1.99:47890');
    bus.offlineEndpoints.add('10.0.0.25:47890');

    await expect(clientEngine.syncWithDevice(hostInfo.deviceId)).rejects.toThrow(/unreachable/i);
    expect(clientEngine.getState().status).toBe('offline');
    expect(clientEngine.getState().error?.code).toBe('PEER_OFFLINE');

    // Bring second IP back online and seed new media on host
    bus.offlineEndpoints.delete('10.0.0.25:47890');
    await seedMedia(hostDb, 'm_reconnect', 'Recovered Film', new Date().toISOString(), hostInfo.deviceId);

    const stats = await clientEngine.syncWithDevice(hostInfo.deviceId, ['10.0.0.25']);
    expect(stats.inserted).toBe(1);
    expect(clientEngine.getState().status).toBe('idle');
    expect(clientEngine.getState().error).toBeNull();
  });

  it('rejects unauthenticated or tampered sync exchange requests with 401', async () => {
    await hostEngine.startHosting(47890);
    const transport = bus.createAdapter(['192.168.1.123']);

    const unauth = await transport.sendRequest('192.168.1.99', 47890, {
      method: 'POST',
      path: '/sync/exchange',
      headers: { 'x-veyview-device-id': 'dev_rogue' },
      body: JSON.stringify({
        version: 1,
        senderDeviceId: 'dev_rogue',
        senderDeviceName: 'Rogue',
        sinceForReceiver: null,
        delta: {
          version: 1,
          sourceDeviceId: 'dev_rogue',
          sourceDeviceName: 'Rogue',
          generatedAt: new Date().toISOString(),
          since: null,
          tables: {
            media: [],
            media_history: [],
            external_ids: [],
            playback_progress: [],
            media_skip_segments: [],
            availability: [],
          },
        },
      }),
    });

    expect(unauth.status).toBe(401);
  });
});
