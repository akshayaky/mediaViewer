import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseService } from '../services/DatabaseService';
import {
  GoogleDriveSyncEngine,
  IDriveRepository
} from '../services/GoogleDriveSyncEngine';
import {
  DriveAdapterResult,
  DriveFileMetadata,
  DriveUploadOptions
} from '../services/GoogleDriveAdapter';
import { Media, MediaHistory, Wishlist, PlaybackProgress } from '../types/media';

class MockDriveRepository implements IDriveRepository {
  public files = new Map<
    string,
    { id: string; name: string; content: any; etag: string; modifiedTime: string }
  >();
  public isOffline = false;
  public forceConflictOnce = false;

  async listAppDataFiles(): Promise<DriveAdapterResult<DriveFileMetadata[]>> {
    if (this.isOffline) {
      return { success: false, error: 'Network offline', errorCode: 'OFFLINE' };
    }
    const list = Array.from(this.files.values()).map(f => ({
      id: f.id,
      name: f.name,
      mimeType: 'application/json',
      modifiedTime: f.modifiedTime,
      etag: f.etag
    }));
    return { success: true, data: list };
  }

  async downloadFile<T>(fileId: string): Promise<DriveAdapterResult<{ content: T; etag?: string }>> {
    if (this.isOffline) {
      return { success: false, error: 'Network offline', errorCode: 'OFFLINE' };
    }
    const file = this.files.get(fileId);
    if (!file) {
      return { success: false, error: 'File not found', errorCode: 'NOT_FOUND' };
    }
    return { success: true, data: { content: file.content as T, etag: file.etag } };
  }

  async uploadAppDataFile(options: DriveUploadOptions): Promise<DriveAdapterResult<DriveFileMetadata>> {
    if (this.isOffline) {
      return { success: false, error: 'Network offline', errorCode: 'OFFLINE' };
    }
    if (this.forceConflictOnce) {
      this.forceConflictOnce = false;
      return { success: false, error: 'Concurrency conflict', errorCode: 'CONFLICT' };
    }

    const fileId = options.fileId || `file_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const etag = `etag_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const fileData = {
      id: fileId,
      name: options.name,
      content: typeof options.content === 'string' ? JSON.parse(options.content) : options.content,
      etag,
      modifiedTime: new Date().toISOString()
    };
    this.files.set(fileId, fileData);

    return {
      success: true,
      data: {
        id: fileId,
        name: options.name,
        mimeType: 'application/json',
        etag,
        modifiedTime: fileData.modifiedTime
      }
    };
  }

  async deleteFile(fileId: string): Promise<DriveAdapterResult<void>> {
    if (this.isOffline) {
      return { success: false, error: 'Network offline', errorCode: 'OFFLINE' };
    }
    this.files.delete(fileId);
    return { success: true };
  }
}

describe('Google Drive Sync Engine & Multi-Device Simulation Tests', () => {
  let mockDriveRepo: MockDriveRepository;
  let dbDeviceA: DatabaseService;
  let dbDeviceB: DatabaseService;
  let engineA: GoogleDriveSyncEngine;
  let engineB: GoogleDriveSyncEngine;

  beforeEach(async () => {
    mockDriveRepo = new MockDriveRepository();

    dbDeviceA = new DatabaseService('devA');
    dbDeviceB = new DatabaseService('devB');

    engineA = new GoogleDriveSyncEngine(dbDeviceA, mockDriveRepo);
    engineB = new GoogleDriveSyncEngine(dbDeviceB, mockDriveRepo);

    // Explicitly seed distinct device IDs for Device A and Device B
    await dbDeviceA.saveSetting('google_sync_device_id' as any, 'DEVICE_A_123');
    await dbDeviceB.saveSetting('google_sync_device_id' as any, 'DEVICE_B_456');
  });

  it('1. Initial Sync: Device A uploads local data and Device B downloads it on first sync', async () => {
    // Device A creates media, history, and wishlist
    const media1: Media = {
      id: 'media_film_1',
      type: 'Film',
      title: 'Inception',
      release_year: 2010,
      genres: ['Sci-Fi', 'Action'],
      created_at: '2025-01-01T10:00:00.000Z',
      updated_at: '2025-01-01T10:00:00.000Z'
    };
    await dbDeviceA.saveMedia(media1);

    const history1: MediaHistory = {
      id: 'hist_1',
      media_id: 'media_film_1',
      status: 'Finished',
      score: 5,
      source: 'Manual',
      created_at: '2025-01-01T10:05:00.000Z',
      updated_at: '2025-01-01T10:05:00.000Z'
    };
    await dbDeviceA.saveHistory(history1);

    const wish1: Wishlist = {
      id: 'wish_1',
      title: 'Dune Part Two',
      type: 'Film',
      source: 'Manual',
      added_at: '2025-01-01T10:10:00.000Z',
      updated_at: '2025-01-01T10:10:00.000Z'
    };
    await dbDeviceA.saveWishlist(wish1);

    // Device A performs sync
    const resA = await engineA.performSync();
    expect(resA.success).toBe(true);

    // Verify mock Drive now holds the snapshot file
    expect(mockDriveRepo.files.size).toBe(1);

    // Device B performs initial sync
    const resB = await engineB.performSync();
    expect(resB.success).toBe(true);

    // Verify Device B database has converged to Device A records
    const bMedia = await dbDeviceB.getMediaById('media_film_1');
    expect(bMedia).not.toBeNull();
    expect(bMedia?.title).toBe('Inception');

    const bHistory = await dbDeviceB.getHistoryForMedia('media_film_1');
    expect(bHistory.length).toBe(1);
    expect(bHistory[0].score).toBe(5);

    const bWishlist = await dbDeviceB.getAllWishlist();
    expect(bWishlist.length).toBe(1);
    expect(bWishlist[0].title).toBe('Dune Part Two');
  });

  it('2. Incremental Sync: Device B updates a rating and title, Device A syncs and receives updates', async () => {
    // Initial sync setup
    const media: Media = {
      id: 'media_game_1',
      type: 'VideoGame',
      title: 'Elden Ring',
      genres: ['RPG'],
      created_at: '2025-01-01T10:00:00.000Z',
      updated_at: '2025-01-01T10:00:00.000Z'
    };
    await dbDeviceA.saveMedia(media);
    await engineA.performSync();
    await engineB.performSync();

    // Device B modifies title and updates timestamp
    const updatedMedia: Media = {
      ...media,
      title: 'Elden Ring: Shadow of the Erdtree',
      updated_at: '2025-01-02T12:00:00.000Z'
    };
    await dbDeviceB.saveMedia(updatedMedia);

    // Device B syncs to Drive
    const syncB = await engineB.performSync();
    expect(syncB.success).toBe(true);

    // Device A syncs and receives remote update
    const syncA = await engineA.performSync();
    expect(syncA.success).toBe(true);

    const aMedia = await dbDeviceA.getMediaById('media_game_1');
    expect(aMedia?.title).toBe('Elden Ring: Shadow of the Erdtree');
  });

  it('3. Deletion Propagation via Tombstones: Deleting media on Device A deletes it on Device B without resurrection', async () => {
    // Setup initial sync
    const media: Media = {
      id: 'media_to_delete',
      type: 'Film',
      title: 'Temporary Film',
      genres: ['Drama'],
      created_at: '2025-01-01T10:00:00.000Z',
      updated_at: '2025-01-01T10:00:00.000Z'
    };
    await dbDeviceA.saveMedia(media);
    await engineA.performSync();
    await engineB.performSync();

    // Device A deletes the media item (recording a tombstone)
    await dbDeviceA.deleteMedia('media_to_delete', 'DEVICE_A_123');
    await engineA.performSync();

    // Device B syncs
    await engineB.performSync();

    // Verify media is deleted on Device B
    const bMedia = await dbDeviceB.getMediaById('media_to_delete');
    expect(bMedia).toBeNull();

    // Device B re-syncs to verify no resurrection or duplicate creation
    await engineB.performSync();
    await engineA.performSync();

    expect(await dbDeviceA.getMediaById('media_to_delete')).toBeNull();
    expect(await dbDeviceB.getMediaById('media_to_delete')).toBeNull();
  });

  it('4. Playback Progress Conflict: Handles episode restart and completion accurately', async () => {
    const progA: PlaybackProgress = {
      id: 'prog_ep_1',
      media_id: 'tv_show_1',
      season: 1,
      episode: 1,
      position_seconds: 1800,
      duration_seconds: 1800,
      updated_at: '2025-01-01T10:00:00.000Z',
      is_completed: true
    };
    await dbDeviceA.savePlaybackProgress(progA);
    await engineA.performSync();

    // Device B restarts the episode later (e.g., position 30 seconds with newer timestamp)
    const progB: PlaybackProgress = {
      id: 'prog_ep_1',
      media_id: 'tv_show_1',
      season: 1,
      episode: 1,
      position_seconds: 30,
      duration_seconds: 1800,
      updated_at: '2025-01-02T10:00:00.000Z',
      is_completed: false
    };
    await dbDeviceB.savePlaybackProgress(progB);
    await engineB.performSync();

    // Device A syncs and receives restart update with newer timestamp
    await engineA.performSync();

    const aProg = await dbDeviceA.getPlaybackProgress('tv_show_1', 1, 1);
    expect(aProg).not.toBeNull();
    expect(aProg?.position_seconds).toBe(30);
    expect(aProg?.updated_at).toBe('2025-01-02T10:00:00.000Z');
  });

  it('5. Idempotency: Repeated syncs produce no duplicates or data corruption', async () => {
    const media: Media = {
      id: 'media_idempotent',
      type: 'TV Series',
      title: 'Breaking Bad',
      genres: ['Drama', 'Crime'],
      created_at: '2025-01-01T10:00:00.000Z',
      updated_at: '2025-01-01T10:00:00.000Z'
    };
    await dbDeviceA.saveMedia(media);

    // Sync 3 times in a row on Device A
    await engineA.performSync();
    await engineA.performSync();
    await engineA.performSync();

    // Sync 3 times in a row on Device B
    await engineB.performSync();
    await engineB.performSync();
    await engineB.performSync();

    const allAMedia = await dbDeviceA.getAllMedia();
    const allBMedia = await dbDeviceB.getAllMedia();

    expect(allAMedia.length).toBe(1);
    expect(allBMedia.length).toBe(1);
    expect(allAMedia[0].title).toBe('Breaking Bad');
    expect(allBMedia[0].title).toBe('Breaking Bad');
  });

  it('6. Offline resilience & Retry handling', async () => {
    const media: Media = {
      id: 'media_offline_test',
      type: 'Film',
      title: 'Interstellar',
      genres: ['Sci-Fi'],
      created_at: '2025-01-01T10:00:00.000Z',
      updated_at: '2025-01-01T10:00:00.000Z'
    };
    await dbDeviceA.saveMedia(media);

    // Simulate network offline
    mockDriveRepo.isOffline = true;
    const resOffline = await engineA.performSync();
    expect(resOffline.success).toBe(false);
    expect(engineA.getStatus().state).toBe('error');

    // Restore network online and retry sync
    mockDriveRepo.isOffline = false;
    const resRetry = await engineA.performSync();
    expect(resRetry.success).toBe(true);
    expect(engineA.getStatus().state).toBe('success');

    // Device B syncs and receives media
    await engineB.performSync();
    const bMedia = await dbDeviceB.getMediaById('media_offline_test');
    expect(bMedia?.title).toBe('Interstellar');
  });
});
