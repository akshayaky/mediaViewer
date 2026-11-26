/**
 * SQLite incremental delta export, LWW merge (with soft-delete tombstones),
 * and paired-device sync cursor persistence.
 *
 * All sync SQL queries are isolated in this module.
 */

import { dbService } from '../services/DatabaseService';
import {
  LocalDeviceInfo,
  SYNC_TABLES,
  SqliteExecutor,
  SyncApplyStats,
  SyncAvailabilityRow,
  SyncDeltaPayload,
  SyncDeltaTables,
  SyncDeviceRecord,
  SyncExternalIdRow,
  SyncMediaHistoryRow,
  SyncMediaRow,
  SyncPlaybackProgressRow,
  SyncRowBase,
  SyncSkipSegmentsRow,
  SyncTableApplyCounts,
  SyncTableName,
  SyncTableRowMap,
} from './types';

const SETTING_DEVICE_ID = 'sync_device_id';
const SETTING_DEVICE_NAME = 'sync_device_name';

function createEmptyCounts(): SyncTableApplyCounts {
  return { inserted: 0, updated: 0, deleted: 0, skipped: 0 };
}

function createEmptyStats(): SyncApplyStats {
  return {
    inserted: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
    byTable: {
      media: createEmptyCounts(),
      media_history: createEmptyCounts(),
      external_ids: createEmptyCounts(),
      playback_progress: createEmptyCounts(),
      media_skip_segments: createEmptyCounts(),
      availability: createEmptyCounts(),
    },
  };
}

function generateLocalDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `dev_${crypto.randomUUID()}`;
  }
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultDeviceName(): string {
  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    const ua = navigator.userAgent;
    if (/Android/i.test(ua)) return 'Veyview Android';
    if (/Windows/i.test(ua)) return 'Veyview Windows';
    if (/Mac/i.test(ua)) return 'Veyview Mac';
    if (/Linux/i.test(ua)) return 'Veyview Linux';
  }
  return 'Veyview Device';
}

async function resolveExecutor(executor?: SqliteExecutor): Promise<SqliteExecutor> {
  if (executor) return executor;
  return dbService.getSqliteExecutor();
}

function compareIsoTimestamps(a: string | null | undefined, b: string | null | undefined): number {
  const normA = a ?? '';
  const normB = b ?? '';
  if (normA === normB) return 0;
  const msA = normA ? Date.parse(normA) : NaN;
  const msB = normB ? Date.parse(normB) : NaN;
  if (Number.isFinite(msA) && Number.isFinite(msB)) {
    if (msA > msB) return 1;
    if (msA < msB) return -1;
    // Sub-millisecond or timezone representation difference: fall back to string comparison
  }
  return normA > normB ? 1 : -1;
}

function effectiveTimestamp(row: Pick<SyncRowBase, 'updated_at' | 'deleted_at'>): string {
  const updated = row.updated_at || '';
  const deleted = row.deleted_at || '';
  return compareIsoTimestamps(deleted, updated) >= 0 ? deleted : updated;
}

/**
 * Deterministic Last-Writer-Wins comparator.
 * Compares max(updated_at, deleted_at), breaking ties by device_id, then tombstone preference.
 */
export function shouldIncomingRowWin(
  existing: Pick<SyncRowBase, 'updated_at' | 'deleted_at' | 'device_id'>,
  incoming: Pick<SyncRowBase, 'updated_at' | 'deleted_at' | 'device_id'>
): boolean {
  const tsCmp = compareIsoTimestamps(effectiveTimestamp(incoming), effectiveTimestamp(existing));
  if (tsCmp !== 0) {
    return tsCmp > 0;
  }

  const incomingDev = incoming.device_id ?? '';
  const existingDev = existing.device_id ?? '';
  if (incomingDev !== existingDev) {
    return incomingDev > existingDev;
  }

  // Exact same timestamp and device_id: only apply if incoming transitions an active row to deleted.
  if (incoming.deleted_at !== null && existing.deleted_at === null) {
    return true;
  }
  return false;
}

function normalizeNullableString(value: unknown): string | null {
  return value === undefined || value === null || value === '' ? null : String(value);
}

function normalizeRowTimestamp(
  row: Record<string, unknown>,
  fallbackFields: string[],
  defaultIso: string
): string {
  const raw = row.updated_at;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  for (const field of fallbackFields) {
    const candidate = row[field];
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return defaultIso;
}

// ==========================================
// 1. LOCAL DEVICE IDENTITY & CURSOR STORAGE
// ==========================================

export async function getOrCreateLocalDeviceInfo(
  executor?: SqliteExecutor
): Promise<LocalDeviceInfo> {
  const db = await resolveExecutor(executor);
  const rows = await db.select<{ key: string; value: string }[]>(
    'SELECT key, value FROM settings WHERE key IN (?, ?)',
    [SETTING_DEVICE_ID, SETTING_DEVICE_NAME]
  );

  let deviceId = rows.find(r => r.key === SETTING_DEVICE_ID)?.value || '';
  let deviceName = rows.find(r => r.key === SETTING_DEVICE_NAME)?.value || '';

  if (!deviceId) {
    deviceId = generateLocalDeviceId();
    await db.execute(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [SETTING_DEVICE_ID, deviceId]
    );
  }

  if (!deviceName) {
    deviceName = defaultDeviceName();
    await db.execute(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [SETTING_DEVICE_NAME, deviceName]
    );
  }

  return { deviceId, deviceName };
}

export async function setLocalDeviceName(
  deviceName: string,
  executor?: SqliteExecutor
): Promise<void> {
  const trimmed = deviceName.trim();
  if (!trimmed) {
    throw new Error('Device name cannot be empty.');
  }
  const db = await resolveExecutor(executor);
  await db.execute(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [SETTING_DEVICE_NAME, trimmed]
  );
}

export async function getSyncDevice(
  deviceId: string,
  executor?: SqliteExecutor
): Promise<SyncDeviceRecord | null> {
  const db = await resolveExecutor(executor);
  const rows = await db.select<SyncDeviceRecord[]>(
    'SELECT * FROM sync_devices WHERE device_id = ? LIMIT 1',
    [deviceId]
  );
  return rows[0] ?? null;
}

export async function listSyncDevices(executor?: SqliteExecutor): Promise<SyncDeviceRecord[]> {
  const db = await resolveExecutor(executor);
  return db.select<SyncDeviceRecord[]>(
    'SELECT * FROM sync_devices ORDER BY updated_at DESC, device_name ASC'
  );
}

export async function upsertSyncDevice(
  device: Omit<SyncDeviceRecord, 'updated_at' | 'paired_at' | 'peer_cursor' | 'shared_secret'> & {
    shared_secret?: string | null;
    peer_cursor?: string | null;
    paired_at?: string;
    updated_at?: string;
  },
  executor?: SqliteExecutor
): Promise<SyncDeviceRecord> {
  const db = await resolveExecutor(executor);
  const now = new Date().toISOString();
  const pairedAt = device.paired_at || now;
  const updatedAt = device.updated_at || now;

  await db.execute(
    `INSERT INTO sync_devices (
      device_id, device_name, shared_secret, last_ip, last_port, last_synced_at, peer_cursor, paired_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      device_name = excluded.device_name,
      shared_secret = COALESCE(excluded.shared_secret, sync_devices.shared_secret),
      last_ip = COALESCE(excluded.last_ip, sync_devices.last_ip),
      last_port = COALESCE(excluded.last_port, sync_devices.last_port),
      last_synced_at = COALESCE(excluded.last_synced_at, sync_devices.last_synced_at),
      peer_cursor = COALESCE(excluded.peer_cursor, sync_devices.peer_cursor),
      updated_at = excluded.updated_at`,
    [
      device.device_id,
      device.device_name,
      device.shared_secret ?? null,
      device.last_ip ?? null,
      device.last_port ?? null,
      device.last_synced_at ?? null,
      device.peer_cursor ?? null,
      pairedAt,
      updatedAt,
    ]
  );

  const saved = await getSyncDevice(device.device_id, db);
  if (!saved) {
    throw new Error(`Failed to persist sync device ${device.device_id}`);
  }
  return saved;
}

export async function removeSyncDevice(
  deviceId: string,
  executor?: SqliteExecutor
): Promise<void> {
  const db = await resolveExecutor(executor);
  await db.execute('DELETE FROM sync_devices WHERE device_id = ?', [deviceId]);
}

export async function getLastSyncedAt(
  peerDeviceId: string,
  executor?: SqliteExecutor
): Promise<string | null> {
  const record = await getSyncDevice(peerDeviceId, executor);
  return record?.last_synced_at ?? null;
}

export async function updateLastSyncedAt(
  peerDeviceId: string,
  syncedAt: string,
  executor?: SqliteExecutor,
  peerCursor?: string | null
): Promise<void> {
  const db = await resolveExecutor(executor);
  const now = new Date().toISOString();
  if (peerCursor !== undefined) {
    await db.execute(
      `UPDATE sync_devices
       SET last_synced_at = ?, peer_cursor = ?, updated_at = ?
       WHERE device_id = ?`,
      [syncedAt, peerCursor, now, peerDeviceId]
    );
  } else {
    await db.execute(
      `UPDATE sync_devices
       SET last_synced_at = ?, updated_at = ?
       WHERE device_id = ?`,
      [syncedAt, now, peerDeviceId]
    );
  }
}

// ==========================================
// 2. DELTA EXPORT
// ==========================================

async function selectDeltaRows(
  db: SqliteExecutor,
  table: SyncTableName,
  sinceTimestamp: string | null
): Promise<Record<string, unknown>[]> {
  if (sinceTimestamp) {
    return db.select<Record<string, unknown>[]>(
      `SELECT * FROM ${table}
       WHERE COALESCE(updated_at, '') > ? OR COALESCE(deleted_at, '') > ?
       ORDER BY COALESCE(deleted_at, updated_at, '') ASC, id ASC`,
      [sinceTimestamp, sinceTimestamp]
    );
  }
  return db.select<Record<string, unknown>[]>(
    `SELECT * FROM ${table}
     ORDER BY COALESCE(deleted_at, updated_at, '') ASC, id ASC`
  );
}

function mapMediaExportRow(row: Record<string, unknown>, fallbackIso: string): SyncMediaRow {
  return {
    id: String(row.id),
    type: String(row.type),
    title: String(row.title),
    original_title: normalizeNullableString(row.original_title),
    release_year: row.release_year !== null && row.release_year !== undefined ? Number(row.release_year) : null,
    language: normalizeNullableString(row.language),
    description: normalizeNullableString(row.description),
    genres: typeof row.genres === 'string' ? row.genres : JSON.stringify(row.genres || []),
    runtime: row.runtime !== null && row.runtime !== undefined ? Number(row.runtime) : null,
    poster: normalizeNullableString(row.poster),
    backdrop: normalizeNullableString(row.backdrop),
    logo: normalizeNullableString(row.logo),
    metadata_source: normalizeNullableString(row.metadata_source),
    metadata_refreshed_at: normalizeNullableString(row.metadata_refreshed_at),
    publisher: normalizeNullableString(row.publisher),
    developer: normalizeNullableString(row.developer),
    cast: normalizeNullableString(row.cast),
    seasons: normalizeNullableString(row.seasons),
    created_at: String(row.created_at || fallbackIso),
    updated_at: normalizeRowTimestamp(row, ['created_at'], fallbackIso),
    accent_color: normalizeNullableString(row.accent_color),
    manually_matched: row.manually_matched !== null && row.manually_matched !== undefined ? Number(row.manually_matched) : 0,
    deleted_at: normalizeNullableString(row.deleted_at),
    device_id: normalizeNullableString(row.device_id),
  };
}

function mapHistoryExportRow(row: Record<string, unknown>, fallbackIso: string): SyncMediaHistoryRow {
  return {
    id: String(row.id),
    media_id: String(row.media_id),
    started_at: normalizeNullableString(row.started_at),
    completed_at: normalizeNullableString(row.completed_at),
    status: String(row.status),
    score: row.score !== null && row.score !== undefined ? Number(row.score) : null,
    thoughts: normalizeNullableString(row.thoughts),
    context: normalizeNullableString(row.context),
    source: String(row.source),
    original_source_record_id: normalizeNullableString(row.original_source_record_id),
    created_at: String(row.created_at || fallbackIso),
    updated_at: normalizeRowTimestamp(row, ['created_at'], fallbackIso),
    deleted_at: normalizeNullableString(row.deleted_at),
    device_id: normalizeNullableString(row.device_id),
  };
}

function mapExternalIdExportRow(row: Record<string, unknown>, fallbackIso: string): SyncExternalIdRow {
  return {
    id: String(row.id),
    media_id: String(row.media_id),
    provider: String(row.provider),
    external_id: String(row.external_id),
    updated_at: normalizeRowTimestamp(row, [], fallbackIso),
    deleted_at: normalizeNullableString(row.deleted_at),
    device_id: normalizeNullableString(row.device_id),
  };
}

function mapPlaybackExportRow(row: Record<string, unknown>, fallbackIso: string): SyncPlaybackProgressRow {
  return {
    id: String(row.id),
    media_id: String(row.media_id),
    season: Number(row.season ?? 0),
    episode: Number(row.episode ?? 0),
    position_seconds: Number(row.position_seconds ?? 0),
    duration_seconds: Number(row.duration_seconds ?? 0),
    updated_at: normalizeRowTimestamp(row, [], fallbackIso),
    is_completed: row.is_completed ? 1 : 0,
    deleted_at: normalizeNullableString(row.deleted_at),
    device_id: normalizeNullableString(row.device_id),
  };
}

function mapSkipSegmentsExportRow(row: Record<string, unknown>, fallbackIso: string): SyncSkipSegmentsRow {
  return {
    id: String(row.id),
    media_id: normalizeNullableString(row.media_id),
    external_id: String(row.external_id),
    provider: String(row.provider),
    media_type: String(row.media_type),
    season: Number(row.season ?? 0),
    episode: Number(row.episode ?? 0),
    intro_start: row.intro_start !== null && row.intro_start !== undefined ? Number(row.intro_start) : null,
    intro_end: row.intro_end !== null && row.intro_end !== undefined ? Number(row.intro_end) : null,
    recap_start: row.recap_start !== null && row.recap_start !== undefined ? Number(row.recap_start) : null,
    recap_end: row.recap_end !== null && row.recap_end !== undefined ? Number(row.recap_end) : null,
    outro_start: row.outro_start !== null && row.outro_start !== undefined ? Number(row.outro_start) : null,
    outro_end: row.outro_end !== null && row.outro_end !== undefined ? Number(row.outro_end) : null,
    raw_data: normalizeNullableString(row.raw_data),
    status: String(row.status),
    updated_at: normalizeRowTimestamp(row, [], fallbackIso),
    deleted_at: normalizeNullableString(row.deleted_at),
    device_id: normalizeNullableString(row.device_id),
  };
}

function mapAvailabilityExportRow(row: Record<string, unknown>, fallbackIso: string): SyncAvailabilityRow {
  return {
    id: String(row.id),
    media_id: String(row.media_id),
    provider: String(row.provider),
    country: normalizeNullableString(row.country),
    availability_type: String(row.availability_type),
    url: normalizeNullableString(row.url),
    last_checked: String(row.last_checked || fallbackIso),
    updated_at: normalizeRowTimestamp(row, ['last_checked'], fallbackIso),
    deleted_at: normalizeNullableString(row.deleted_at),
    device_id: normalizeNullableString(row.device_id),
  };
}

export async function exportDeltaSince(
  sinceTimestamp?: string | null,
  executor?: SqliteExecutor
): Promise<SyncDeltaPayload> {
  const db = await resolveExecutor(executor);
  const localDevice = await getOrCreateLocalDeviceInfo(db);
  const generatedAt = new Date().toISOString();
  const since = sinceTimestamp || null;

  const [
    mediaRows,
    historyRows,
    externalIdRows,
    playbackRows,
    skipRows,
    availabilityRows,
  ] = await Promise.all([
    selectDeltaRows(db, 'media', since),
    selectDeltaRows(db, 'media_history', since),
    selectDeltaRows(db, 'external_ids', since),
    selectDeltaRows(db, 'playback_progress', since),
    selectDeltaRows(db, 'media_skip_segments', since),
    selectDeltaRows(db, 'availability', since),
  ]);

  const tables: SyncDeltaTables = {
    media: mediaRows.map(r => mapMediaExportRow(r, generatedAt)),
    media_history: historyRows.map(r => mapHistoryExportRow(r, generatedAt)),
    external_ids: externalIdRows.map(r => mapExternalIdExportRow(r, generatedAt)),
    playback_progress: playbackRows.map(r => mapPlaybackExportRow(r, generatedAt)),
    media_skip_segments: skipRows.map(r => mapSkipSegmentsExportRow(r, generatedAt)),
    availability: availabilityRows.map(r => mapAvailabilityExportRow(r, generatedAt)),
  };

  return {
    version: 1,
    sourceDeviceId: localDevice.deviceId,
    sourceDeviceName: localDevice.deviceName,
    generatedAt,
    since,
    tables,
  };
}

// ==========================================
// 3. DELTA MERGE / APPLY (LWW + SOFT DELETE)
// ==========================================

interface TableConfig<K extends SyncTableName> {
  naturalKeyLookup?: {
    sql: string;
    params: (row: SyncTableRowMap[K]) => unknown[];
  };
  upsertSql: string;
  upsertParams: (row: SyncTableRowMap[K]) => unknown[];
}

const TABLE_CONFIGS: { [K in SyncTableName]: TableConfig<K> } = {
  media: {
    upsertSql: `
      INSERT INTO media (
        id, type, title, original_title, release_year, language, description,
        genres, runtime, poster, backdrop, logo, metadata_source, metadata_refreshed_at,
        publisher, developer, cast, seasons, created_at, updated_at, accent_color,
        manually_matched, deleted_at, device_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        title = excluded.title,
        original_title = excluded.original_title,
        release_year = excluded.release_year,
        language = excluded.language,
        description = excluded.description,
        genres = excluded.genres,
        runtime = excluded.runtime,
        poster = excluded.poster,
        backdrop = excluded.backdrop,
        logo = excluded.logo,
        metadata_source = excluded.metadata_source,
        metadata_refreshed_at = excluded.metadata_refreshed_at,
        publisher = excluded.publisher,
        developer = excluded.developer,
        cast = excluded.cast,
        seasons = excluded.seasons,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        accent_color = excluded.accent_color,
        manually_matched = excluded.manually_matched,
        deleted_at = excluded.deleted_at,
        device_id = excluded.device_id`,
    upsertParams: row => [
      row.id,
      row.type,
      row.title,
      row.original_title,
      row.release_year,
      row.language,
      row.description,
      row.genres,
      row.runtime,
      row.poster,
      row.backdrop,
      row.logo,
      row.metadata_source,
      row.metadata_refreshed_at,
      row.publisher,
      row.developer,
      row.cast,
      row.seasons,
      row.created_at,
      row.updated_at,
      row.accent_color,
      row.manually_matched ?? 0,
      row.deleted_at,
      row.device_id,
    ],
  },
  media_history: {
    upsertSql: `
      INSERT INTO media_history (
        id, media_id, started_at, completed_at, status, score, thoughts,
        context, source, original_source_record_id, created_at, updated_at,
        deleted_at, device_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        media_id = excluded.media_id,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        status = excluded.status,
        score = excluded.score,
        thoughts = excluded.thoughts,
        context = excluded.context,
        source = excluded.source,
        original_source_record_id = excluded.original_source_record_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        device_id = excluded.device_id`,
    upsertParams: row => [
      row.id,
      row.media_id,
      row.started_at,
      row.completed_at,
      row.status,
      row.score,
      row.thoughts,
      row.context,
      row.source,
      row.original_source_record_id,
      row.created_at,
      row.updated_at,
      row.deleted_at,
      row.device_id,
    ],
  },
  external_ids: {
    naturalKeyLookup: {
      sql: `SELECT id, updated_at, deleted_at, device_id FROM external_ids
            WHERE provider = ? AND external_id = ? AND deleted_at IS NULL LIMIT 1`,
      params: row => [row.provider, row.external_id],
    },
    upsertSql: `
      INSERT INTO external_ids (
        id, media_id, provider, external_id, updated_at, deleted_at, device_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        media_id = excluded.media_id,
        provider = excluded.provider,
        external_id = excluded.external_id,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        device_id = excluded.device_id`,
    upsertParams: row => [
      row.id,
      row.media_id,
      row.provider,
      row.external_id,
      row.updated_at,
      row.deleted_at,
      row.device_id,
    ],
  },
  playback_progress: {
    naturalKeyLookup: {
      sql: `SELECT id, updated_at, deleted_at, device_id FROM playback_progress
            WHERE media_id = ? AND season = ? AND episode = ? AND deleted_at IS NULL LIMIT 1`,
      params: row => [row.media_id, row.season ?? 0, row.episode ?? 0],
    },
    upsertSql: `
      INSERT INTO playback_progress (
        id, media_id, season, episode, position_seconds, duration_seconds,
        updated_at, is_completed, deleted_at, device_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        media_id = excluded.media_id,
        season = excluded.season,
        episode = excluded.episode,
        position_seconds = excluded.position_seconds,
        duration_seconds = excluded.duration_seconds,
        updated_at = excluded.updated_at,
        is_completed = excluded.is_completed,
        deleted_at = excluded.deleted_at,
        device_id = excluded.device_id`,
    upsertParams: row => [
      row.id,
      row.media_id,
      row.season ?? 0,
      row.episode ?? 0,
      row.position_seconds,
      row.duration_seconds,
      row.updated_at,
      row.is_completed ? 1 : 0,
      row.deleted_at,
      row.device_id,
    ],
  },
  media_skip_segments: {
    naturalKeyLookup: {
      sql: `SELECT id, updated_at, deleted_at, device_id FROM media_skip_segments
            WHERE external_id = ? AND season = ? AND episode = ? AND deleted_at IS NULL LIMIT 1`,
      params: row => [row.external_id, row.season ?? 0, row.episode ?? 0],
    },
    upsertSql: `
      INSERT INTO media_skip_segments (
        id, media_id, external_id, provider, media_type, season, episode,
        intro_start, intro_end, recap_start, recap_end, outro_start, outro_end,
        raw_data, status, updated_at, deleted_at, device_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        media_id = excluded.media_id,
        external_id = excluded.external_id,
        provider = excluded.provider,
        media_type = excluded.media_type,
        season = excluded.season,
        episode = excluded.episode,
        intro_start = excluded.intro_start,
        intro_end = excluded.intro_end,
        recap_start = excluded.recap_start,
        recap_end = excluded.recap_end,
        outro_start = excluded.outro_start,
        outro_end = excluded.outro_end,
        raw_data = excluded.raw_data,
        status = excluded.status,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        device_id = excluded.device_id`,
    upsertParams: row => [
      row.id,
      row.media_id,
      row.external_id,
      row.provider,
      row.media_type,
      row.season ?? 0,
      row.episode ?? 0,
      row.intro_start,
      row.intro_end,
      row.recap_start,
      row.recap_end,
      row.outro_start,
      row.outro_end,
      row.raw_data,
      row.status,
      row.updated_at,
      row.deleted_at,
      row.device_id,
    ],
  },
  availability: {
    upsertSql: `
      INSERT INTO availability (
        id, media_id, provider, country, availability_type, url, last_checked,
        updated_at, deleted_at, device_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        media_id = excluded.media_id,
        provider = excluded.provider,
        country = excluded.country,
        availability_type = excluded.availability_type,
        url = excluded.url,
        last_checked = excluded.last_checked,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        device_id = excluded.device_id`,
    upsertParams: row => [
      row.id,
      row.media_id,
      row.provider,
      row.country,
      row.availability_type,
      row.url,
      row.last_checked,
      row.updated_at,
      row.deleted_at,
      row.device_id,
    ],
  },
};

type ExistingSyncMeta = Pick<SyncRowBase, 'id' | 'updated_at' | 'deleted_at' | 'device_id'>;

async function applyTableRows<K extends SyncTableName>(
  db: SqliteExecutor,
  table: K,
  rows: SyncTableRowMap[K][],
  stats: SyncApplyStats
): Promise<void> {
  const config = TABLE_CONFIGS[table];
  const tableCounts = stats.byTable[table];

  for (const incoming of rows) {
    const existingByIdRows = await db.select<ExistingSyncMeta[]>(
      `SELECT id, updated_at, deleted_at, device_id FROM ${table} WHERE id = ? LIMIT 1`,
      [incoming.id]
    );
    const existingById = existingByIdRows[0];

    if (existingById && !shouldIncomingRowWin(existingById, incoming)) {
      tableCounts.skipped++;
      stats.skipped++;
      continue;
    }

    // For tables with partial unique indexes on natural keys (active rows only),
    // resolve any colliding active row that has a different primary key.
    if (incoming.deleted_at === null && config.naturalKeyLookup) {
      const naturalRows = await db.select<ExistingSyncMeta[]>(
        config.naturalKeyLookup.sql,
        config.naturalKeyLookup.params(incoming)
      );
      const naturalMatch = naturalRows[0];
      if (naturalMatch && naturalMatch.id !== incoming.id) {
        if (!shouldIncomingRowWin(naturalMatch, incoming)) {
          tableCounts.skipped++;
          stats.skipped++;
          continue;
        }
        // Incoming wins the natural key: supersede the colliding row as a soft delete
        // so the partial unique index allows inserting/reviving the winning row.
        const tombstoneTs = incoming.updated_at || new Date().toISOString();
        await db.execute(
          `UPDATE ${table} SET deleted_at = ?, updated_at = ?, device_id = ? WHERE id = ?`,
          [tombstoneTs, tombstoneTs, incoming.device_id, naturalMatch.id]
        );
      }
    }

    await db.execute(config.upsertSql, config.upsertParams(incoming));

    if (incoming.deleted_at !== null) {
      tableCounts.deleted++;
      stats.deleted++;
    } else if (existingById) {
      tableCounts.updated++;
      stats.updated++;
    } else {
      tableCounts.inserted++;
      stats.inserted++;
    }
  }
}

export async function applyDelta(
  payload: SyncDeltaPayload,
  executor?: SqliteExecutor
): Promise<SyncApplyStats> {
  if (payload.version !== 1) {
    throw new Error(`Unsupported sync payload version: ${String((payload as { version?: unknown }).version)}`);
  }

  const db = await resolveExecutor(executor);
  const stats = createEmptyStats();

  for (const table of SYNC_TABLES) {
    const rows = payload.tables[table];
    if (!rows || rows.length === 0) continue;
    await applyTableRows(db, table, rows as SyncTableRowMap[typeof table][], stats);
  }

  return stats;
}
