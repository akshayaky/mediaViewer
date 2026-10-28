import { DatabaseService, dbService } from './DatabaseService';
import { googleDriveAdapter, DriveAdapterResult, DriveFileMetadata, DriveUploadOptions } from './GoogleDriveAdapter';
import {
  Media,
  MediaHistory,
  Wishlist,
  PlaybackProgress,
  ExternalID,
  Availability,
  SyncTombstone
} from '../types/media';

export const CURRENT_SYNC_SCHEMA_VERSION = 1;
export const SYNC_SNAPSHOT_FILENAME = 'media_sync_snapshot.json';

export interface SyncPayload {
  schema_version: number;
  sync_version: number;
  device_id: string;
  timestamp: string;
  media: Media[];
  media_history: MediaHistory[];
  wishlist: Wishlist[];
  playback_progress: PlaybackProgress[];
  external_ids: ExternalID[];
  availability: Availability[];
  tombstones: SyncTombstone[];
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'success' | 'error';
  last_sync_time?: string;
  error_message?: string;
  device_id: string;
}

export interface IDriveRepository {
  listAppDataFiles(): Promise<DriveAdapterResult<DriveFileMetadata[]>>;
  downloadFile<T>(fileId: string): Promise<DriveAdapterResult<{ content: T; etag?: string }>>;
  uploadAppDataFile(options: DriveUploadOptions): Promise<DriveAdapterResult<DriveFileMetadata>>;
  deleteFile(fileId: string): Promise<DriveAdapterResult<void>>;
}

export class GoogleDriveSyncEngine {
  private db: DatabaseService;
  private driveRepo: IDriveRepository;
  private deviceId: string = '';
  private isSyncing: boolean = false;
  private isApplyingRemoteSync: boolean = false;
  private statusListeners: Array<(status: SyncStatus) => void> = [];
  private currentStatus: SyncStatus = {
    state: 'idle',
    device_id: ''
  };

  constructor(db: DatabaseService = dbService, driveRepo: IDriveRepository = googleDriveAdapter) {
    this.db = db;
    this.driveRepo = driveRepo;
    this.initNetworkListeners();
  }

  public setDriveRepository(repo: IDriveRepository): void {
    this.driveRepo = repo;
  }

  private initNetworkListeners(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.performAutoSync();
      });
    }
  }

  public async getDeviceId(): Promise<string> {
    if (this.deviceId) return this.deviceId;

    const settings = await this.db.getSettings();
    if ((settings as any).google_sync_device_id) {
      this.deviceId = (settings as any).google_sync_device_id;
    } else {
      this.deviceId = `dev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      await this.db.saveSetting('google_sync_device_id' as any, this.deviceId);
    }
    this.currentStatus.device_id = this.deviceId;
    return this.deviceId;
  }

  public subscribeStatus(listener: (status: SyncStatus) => void): () => void {
    this.statusListeners.push(listener);
    listener(this.currentStatus);
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== listener);
    };
  }

  private updateStatus(newStatus: Partial<SyncStatus>): void {
    this.currentStatus = {
      ...this.currentStatus,
      ...newStatus
    };
    for (const listener of this.statusListeners) {
      listener(this.currentStatus);
    }
  }

  public getStatus(): SyncStatus {
    return this.currentStatus;
  }

  public isApplyingRemoteChanges(): boolean {
    return this.isApplyingRemoteSync;
  }

  /**
   * Generates a local snapshot sync payload representing current local state.
   */
  public async generateLocalSnapshot(): Promise<SyncPayload> {
    const device_id = await this.getDeviceId();
    const media = await this.db.getAllMedia();
    const media_history = await this.db.getAllHistory();
    const wishlist = await this.db.getAllWishlist();
    const playback_progress = await this.db.getAllPlaybackProgress();
    const external_ids = await this.db.getAllExternalIds();
    const availability = await this.db.getAllAvailability();
    const tombstones = await this.db.getSyncTombstones();

    return {
      schema_version: CURRENT_SYNC_SCHEMA_VERSION,
      sync_version: Date.now(),
      device_id,
      timestamp: new Date().toISOString(),
      media,
      media_history,
      wishlist,
      playback_progress,
      external_ids,
      availability,
      tombstones
    };
  }

  /**
   * Executes full sync cycle: Download remote snapshot -> Merge -> Upload local state.
   */
  public async performSync(): Promise<{ success: boolean; message?: string }> {
    if (this.isSyncing) {
      return { success: false, message: 'Sync already in progress' };
    }

    this.isSyncing = true;
    const deviceId = await this.getDeviceId();
    this.updateStatus({ state: 'syncing', error_message: undefined, device_id: deviceId });

    try {
      // 1. Find remote sync file in appDataFolder
      const listRes = await this.driveRepo.listAppDataFiles();
      if (!listRes.success) {
        throw new Error(listRes.error || 'Failed to list Google Drive files');
      }

      const snapshotFile = listRes.data?.find(f => f.name === SYNC_SNAPSHOT_FILENAME);

      let remotePayload: SyncPayload | null = null;
      let remoteEtag: string | undefined = undefined;

      if (snapshotFile) {
        const downloadRes = await this.driveRepo.downloadFile<SyncPayload>(snapshotFile.id);
        if (downloadRes.success && downloadRes.data) {
          remotePayload = downloadRes.data.content;
          remoteEtag = downloadRes.data.etag;
        } else {
          console.warn('Failed to download remote snapshot, proceeding with initial upload:', downloadRes.error);
        }
      }

      // 2. Merge remote payload with local database
      if (remotePayload) {
        await this.mergeRemotePayload(remotePayload);
      }

      // 3. Clean up expired tombstones
      await this.db.cleanupOldTombstones(30);

      // 4. Generate merged local snapshot and upload to Drive
      const updatedLocalSnapshot = await this.generateLocalSnapshot();

      const uploadRes = await this.driveRepo.uploadAppDataFile({
        name: SYNC_SNAPSHOT_FILENAME,
        content: updatedLocalSnapshot,
        fileId: snapshotFile?.id,
        etag: remoteEtag
      });

      if (!uploadRes.success) {
        if (uploadRes.errorCode === 'CONFLICT') {
          // Retry merge once if remote file was updated concurrently
          console.warn('Concurrency conflict during snapshot upload. Retrying merge...');
          this.isSyncing = false;
          return this.performSync();
        }
        throw new Error(uploadRes.error || 'Failed to upload sync snapshot to Google Drive');
      }

      const now = new Date().toISOString();
      await this.db.saveSetting('google_drive_last_sync' as any, now);
      this.updateStatus({ state: 'success', last_sync_time: now });

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('library-scanned'));
      }

      return { success: true };
    } catch (err: any) {
      const errMsg = err.message || 'Synchronization failed';
      this.updateStatus({ state: 'error', error_message: errMsg });
      return { success: false, message: errMsg };
    } finally {
      this.isSyncing = false;
    }
  }

  public async performAutoSync(): Promise<void> {
    if (this.isSyncing) return;
    await this.performSync();
  }

  /**
   * Deterministically merges remote sync payload into local database.
   */
  public async mergeRemotePayload(remote: SyncPayload): Promise<void> {
    this.isApplyingRemoteSync = true;
    try {
      const localDeviceId = await this.getDeviceId();

      // Collect all tombstones (local + remote)
      const localTombstones = await this.db.getSyncTombstones();
      const allTombstones = [...localTombstones, ...(remote.tombstones || [])];

      const tombstoneMap = new Map<string, string>(); // entity_type:entity_id -> latest deleted_at
      for (const t of allTombstones) {
        const key = `${t.entity_type}:${t.entity_id}`;
        const existing = tombstoneMap.get(key);
        if (!existing || t.deleted_at > existing) {
          tombstoneMap.set(key, t.deleted_at);
        }
      }

      // Save remote tombstones locally
      if (remote.tombstones) {
        for (const t of remote.tombstones) {
          await this.db.recordTombstone(t.entity_type, t.entity_id, t.device_id, t.deleted_at);
        }
      }

      // Enforce tombstones on existing local records
      for (const [key, tombstoneDate] of tombstoneMap.entries()) {
        const [entityType, entityId] = key.split(':');
        if (entityType === 'media') {
          const lMedia = await this.db.getMediaById(entityId);
          if (lMedia && tombstoneDate >= lMedia.updated_at) {
            await this.db.deleteMedia(entityId, localDeviceId);
          }
        } else if (entityType === 'media_history') {
          const localHistories = await this.db.getAllHistory();
          const lHist = localHistories.find(h => h.id === entityId);
          if (lHist && tombstoneDate >= (lHist.updated_at || lHist.created_at)) {
            await this.db.deleteHistory(entityId, localDeviceId);
          }
        } else if (entityType === 'wishlist') {
          const localWish = await this.db.getAllWishlist();
          const lWish = localWish.find(w => w.id === entityId);
          if (lWish && tombstoneDate >= (lWish.updated_at || lWish.added_at)) {
            await this.db.deleteWishlist(entityId, localDeviceId);
          }
        } else if (entityType === 'availability') {
          const localAvail = await this.db.getAllAvailability();
          const lAvail = localAvail.find(a => a.id === entityId);
          if (lAvail && tombstoneDate >= (lAvail.updated_at || lAvail.last_checked)) {
            await this.db.deleteAvailability(entityId, localDeviceId);
          }
        } else if (entityType === 'external_ids') {
          const localExt = await this.db.getAllExternalIds();
          const lExt = localExt.find(e => e.id === entityId);
          if (lExt && tombstoneDate >= (lExt.updated_at || new Date().toISOString())) {
            await this.db.deleteExternalId(entityId, localDeviceId);
          }
        }
      }

      // 1. MERGE MEDIA ENTITIES
      const localMedia = await this.db.getAllMedia();
      const localMediaMap = new Map(localMedia.map(m => [m.id, m]));

      for (const rMedia of remote.media || []) {
        const tombstoneDate = tombstoneMap.get(`media:${rMedia.id}`);
        if (tombstoneDate && tombstoneDate >= rMedia.updated_at) {
          // Entity was deleted, enforce tombstone
          if (localMediaMap.has(rMedia.id)) {
            await this.db.deleteMedia(rMedia.id, localDeviceId);
          }
          continue;
        }

        const lMedia = localMediaMap.get(rMedia.id);
        if (!lMedia) {
          await this.db.saveMedia(rMedia);
        } else {
          // Compare LWW timestamps with device ID tie breaker
          if (this.isRemoteNewer(rMedia.updated_at, lMedia.updated_at, remote.device_id, localDeviceId)) {
            await this.db.saveMedia({
              ...rMedia,
              // Preserve local file references and device specific state
            });
          }
        }
      }

      // 2. MERGE MEDIA HISTORY (Event-based merge by stable record ID)
      const localHistory = await this.db.getAllHistory();
      const localHistoryMap = new Map(localHistory.map(h => [h.id, h]));

      for (const rHist of remote.media_history || []) {
        const tombstoneDate = tombstoneMap.get(`media_history:${rHist.id}`);
        const rUpdated = rHist.updated_at || rHist.created_at;
        if (tombstoneDate && tombstoneDate >= rUpdated) {
          if (localHistoryMap.has(rHist.id)) {
            await this.db.deleteHistory(rHist.id, localDeviceId);
          }
          continue;
        }

        const lHist = localHistoryMap.get(rHist.id);
        if (!lHist) {
          await this.db.saveHistory(rHist);
        } else {
          const lUpdated = lHist.updated_at || lHist.created_at;
          if (this.isRemoteNewer(rUpdated, lUpdated, remote.device_id, localDeviceId)) {
            await this.db.saveHistory(rHist);
          }
        }
      }

      // 3. MERGE WISHLIST
      const localWishlist = await this.db.getAllWishlist();
      const localWishlistMap = new Map(localWishlist.map(w => [w.id, w]));

      for (const rWish of remote.wishlist || []) {
        const tombstoneDate = tombstoneMap.get(`wishlist:${rWish.id}`);
        const rUpdated = rWish.updated_at || rWish.added_at;
        if (tombstoneDate && tombstoneDate >= rUpdated) {
          if (localWishlistMap.has(rWish.id)) {
            await this.db.deleteWishlist(rWish.id, localDeviceId);
          }
          continue;
        }

        const lWish = localWishlistMap.get(rWish.id);
        if (!lWish) {
          await this.db.saveWishlist(rWish);
        } else {
          const lUpdated = lWish.updated_at || lWish.added_at;
          if (this.isRemoteNewer(rUpdated, lUpdated, remote.device_id, localDeviceId)) {
            await this.db.saveWishlist(rWish);
          }
        }
      }

      // 4. MERGE PLAYBACK PROGRESS
      const localProgress = await this.db.getAllPlaybackProgress();
      const localProgressMap = new Map(localProgress.map(p => [`${p.media_id}:${p.season}:${p.episode}`, p]));

      for (const rProg of remote.playback_progress || []) {
        const tombstoneDate = tombstoneMap.get(`playback_progress:${rProg.id}`);
        if (tombstoneDate && tombstoneDate >= rProg.updated_at) {
          await this.db.deletePlaybackProgress(rProg.media_id, rProg.season, rProg.episode, localDeviceId);
          continue;
        }

        const key = `${rProg.media_id}:${rProg.season}:${rProg.episode}`;
        const lProg = localProgressMap.get(key);

        if (!lProg) {
          await this.db.savePlaybackProgress(rProg);
        } else {
          // Playback progress conflict logic:
          // Honor newer updated_at timestamp.
          // Handle intentional restarts (e.g. position reset to 0 with newer updated_at)
          // and preserve completion flags when valid.
          const isRemoteNewer = this.isRemoteNewer(rProg.updated_at, lProg.updated_at, remote.device_id, localDeviceId);

          if (isRemoteNewer) {
            await this.db.savePlaybackProgress(rProg);
          } else if (rProg.is_completed && !lProg.is_completed) {
            // Remote completed episode/movie, retain completion flag without regressing timestamp
            await this.db.savePlaybackProgress({
              ...lProg,
              is_completed: true
            });
          }
        }
      }

      // 5. MERGE EXTERNAL IDS
      const localExternalIds = await this.db.getAllExternalIds();
      const localExtMap = new Map(localExternalIds.map(e => [e.id, e]));

      for (const rExt of remote.external_ids || []) {
        const tombstoneDate = tombstoneMap.get(`external_ids:${rExt.id}`);
        const rUpdated = rExt.updated_at || new Date().toISOString();
        if (tombstoneDate && tombstoneDate >= rUpdated) {
          if (localExtMap.has(rExt.id)) {
            await this.db.deleteExternalId(rExt.id, localDeviceId);
          }
          continue;
        }

        const lExt = localExtMap.get(rExt.id);
        if (!lExt) {
          await this.db.saveExternalId(rExt);
        } else {
          const lUpdated = lExt.updated_at || new Date().toISOString();
          if (this.isRemoteNewer(rUpdated, lUpdated, remote.device_id, localDeviceId)) {
            await this.db.saveExternalId(rExt);
          }
        }
      }

      // 6. MERGE AVAILABILITY
      const localAvailability = await this.db.getAllAvailability();
      const localAvailMap = new Map(localAvailability.map(a => [a.id, a]));

      for (const rAvail of remote.availability || []) {
        const tombstoneDate = tombstoneMap.get(`availability:${rAvail.id}`);
        const rUpdated = rAvail.updated_at || rAvail.last_checked;
        if (tombstoneDate && tombstoneDate >= rUpdated) {
          if (localAvailMap.has(rAvail.id)) {
            await this.db.deleteAvailability(rAvail.id, localDeviceId);
          }
          continue;
        }

        const lAvail = localAvailMap.get(rAvail.id);
        if (!lAvail) {
          await this.db.saveAvailability(rAvail);
        } else {
          const lUpdated = lAvail.updated_at || lAvail.last_checked;
          if (this.isRemoteNewer(rUpdated, lUpdated, remote.device_id, localDeviceId)) {
            await this.db.saveAvailability(rAvail);
          }
        }
      }
    } finally {
      this.isApplyingRemoteSync = false;
    }
  }

  /**
   * Deterministic timestamp comparison with device_id string tie-breaker.
   */
  private isRemoteNewer(
    remoteTime: string,
    localTime: string,
    remoteDeviceId: string,
    localDeviceId: string
  ): boolean {
    const remoteMs = new Date(remoteTime).getTime();
    const localMs = new Date(localTime).getTime();

    if (remoteMs > localMs) return true;
    if (remoteMs < localMs) return false;

    // Tie breaker if timestamps match down to the millisecond
    return remoteDeviceId > localDeviceId;
  }
}

export const googleDriveSyncEngine = new GoogleDriveSyncEngine();
