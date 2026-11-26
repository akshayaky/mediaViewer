/**
 * Shared types for serverless local Wi-Fi SQLite sync and QR pairing.
 * All sync modules depend on these contracts so transport, pairing,
 * persistence, and UI remain decoupled.
 */

export const SYNC_TABLES = [
  'media',
  'media_history',
  'external_ids',
  'playback_progress',
  'media_skip_segments',
  'availability',
] as const;

export type SyncTableName = (typeof SYNC_TABLES)[number];

export type SyncStatus = 'idle' | 'pairing' | 'syncing' | 'error' | 'offline';

export interface LocalDeviceInfo {
  deviceId: string;
  deviceName: string;
}

export interface SyncDeviceRecord {
  device_id: string;
  device_name: string;
  shared_secret: string | null;
  last_ip: string | null;
  last_port: number | null;
  last_synced_at: string | null;
  peer_cursor: string | null;
  paired_at: string;
  updated_at: string;
}

export interface SyncRowBase {
  id: string;
  updated_at: string;
  deleted_at: string | null;
  device_id: string | null;
}

export interface SyncMediaRow extends SyncRowBase {
  type: string;
  title: string;
  original_title: string | null;
  release_year: number | null;
  language: string | null;
  description: string | null;
  genres: string;
  runtime: number | null;
  poster: string | null;
  backdrop: string | null;
  logo: string | null;
  metadata_source: string | null;
  metadata_refreshed_at: string | null;
  publisher: string | null;
  developer: string | null;
  cast: string | null;
  seasons: string | null;
  created_at: string;
  accent_color: string | null;
  manually_matched: number | null;
}

export interface SyncMediaHistoryRow extends SyncRowBase {
  media_id: string;
  started_at: string | null;
  completed_at: string | null;
  status: string;
  score: number | null;
  thoughts: string | null;
  context: string | null;
  source: string;
  original_source_record_id: string | null;
  created_at: string;
}

export interface SyncExternalIdRow extends SyncRowBase {
  media_id: string;
  provider: string;
  external_id: string;
}

export interface SyncPlaybackProgressRow extends SyncRowBase {
  media_id: string;
  season: number;
  episode: number;
  position_seconds: number;
  duration_seconds: number;
  is_completed: number;
}

export interface SyncSkipSegmentsRow extends SyncRowBase {
  media_id: string | null;
  external_id: string;
  provider: string;
  media_type: string;
  season: number;
  episode: number;
  intro_start: number | null;
  intro_end: number | null;
  recap_start: number | null;
  recap_end: number | null;
  outro_start: number | null;
  outro_end: number | null;
  raw_data: string | null;
  status: string;
}

export interface SyncAvailabilityRow extends SyncRowBase {
  media_id: string;
  provider: string;
  country: string | null;
  availability_type: string;
  url: string | null;
  last_checked: string;
}

export interface SyncTableRowMap {
  media: SyncMediaRow;
  media_history: SyncMediaHistoryRow;
  external_ids: SyncExternalIdRow;
  playback_progress: SyncPlaybackProgressRow;
  media_skip_segments: SyncSkipSegmentsRow;
  availability: SyncAvailabilityRow;
}

export type SyncDeltaTables = {
  [K in SyncTableName]: SyncTableRowMap[K][];
};

export interface SyncDeltaPayload {
  version: 1;
  sourceDeviceId: string;
  sourceDeviceName: string;
  generatedAt: string;
  since: string | null;
  tables: SyncDeltaTables;
}

export interface SyncTableApplyCounts {
  inserted: number;
  updated: number;
  deleted: number;
  skipped: number;
}

export interface SyncApplyStats extends SyncTableApplyCounts {
  byTable: Record<SyncTableName, SyncTableApplyCounts>;
}

export interface QrPairingPayload {
  v: 1;
  deviceId: string;
  deviceName: string;
  ips: string[];
  port: number;
  token: string;
  expiresAt: string;
}

export interface PairingSession {
  payload: QrPairingPayload;
  qrText: string;
  createdAt: string;
  consumed: boolean;
}

export interface PairingHandshakeRequest {
  version: 1;
  clientDeviceId: string;
  clientDeviceName: string;
  clientNonce: string;
  proof: string;
  clientIp?: string;
  clientPort?: number;
}

export interface PairingHandshakeResponse {
  version: 1;
  accepted: boolean;
  hostDeviceId: string;
  hostDeviceName: string;
  hostNonce?: string;
  hostProof?: string;
  reason?: string;
}

export interface SyncError {
  code: string;
  message: string;
  cause?: unknown;
}

export interface SyncStateSnapshot {
  status: SyncStatus;
  localDevice: LocalDeviceInfo | null;
  activePeerId: string | null;
  lastSyncedAt: string | null;
  lastStats: SyncApplyStats | null;
  error: SyncError | null;
  hostingPort: number | null;
  hostingIps: string[];
  activePairingSession: PairingSession | null;
}

export interface SyncExchangeRequest {
  version: 1;
  senderDeviceId: string;
  senderDeviceName: string;
  senderIp?: string;
  senderPort?: number;
  sinceForReceiver: string | null;
  delta: SyncDeltaPayload;
}

export interface SyncExchangeResponse {
  version: 1;
  accepted: boolean;
  responderDeviceId: string;
  responderDeviceName: string;
  appliedStats: SyncApplyStats;
  delta: SyncDeltaPayload;
}

export interface SqliteExecutor {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  execute(
    query: string,
    bindValues?: unknown[]
  ): Promise<{ rowsAffected: number; lastInsertId?: number }>;
}
