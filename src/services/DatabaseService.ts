import DatabaseTauri from '@tauri-apps/plugin-sql';
import {
  Media,
  MediaHistory,
  MediaState,
  LocalFile,
  Availability,
  Wishlist,
  NotionRawRecord,
  AppSettings,
  ExternalID
} from '../types/media';

export class DatabaseService {
  private db: DatabaseTauri | null = null;
  private initialized = false;

  async init(): Promise<DatabaseTauri> {
    if (this.db && this.initialized) {
      return this.db;
    }

    this.db = await DatabaseTauri.load('sqlite:test.db');
    await this.runMigrations();
    this.initialized = true;
    return this.db;
  }

  private async addColumnIfNotExists(table: string, column: string, type: string): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
    } catch {
      console.warn("Column already exists");
    }
  }

  private async runMigrations(): Promise<void> {
    if (!this.db) return;

    const schema = [
      `CREATE TABLE IF NOT EXISTS media (
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
        accent_color TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS media_history (
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
        FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS local_file (
        id TEXT PRIMARY KEY,
        media_id TEXT,
        path TEXT NOT NULL,
        filename TEXT NOT NULL,
        extension TEXT NOT NULL,
        size INTEGER NOT NULL,
        discovered_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        file_exists INTEGER NOT NULL,
        file_type TEXT NOT NULL,
        launch_info TEXT,
        FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS availability (
        id TEXT PRIMARY KEY,
        media_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        country TEXT,
        availability_type TEXT NOT NULL,
        url TEXT,
        last_checked TEXT NOT NULL,
        FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS wishlist (
        id TEXT PRIMARY KEY,
        media_id TEXT,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        external_url TEXT,
        notes TEXT,
        added_at TEXT NOT NULL,
        target_release_date TEXT,
        poster TEXT,
        FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE SET NULL
      )`,
      `CREATE TABLE IF NOT EXISTS notion_raw_records (
        id TEXT PRIMARY KEY,
        name_raw TEXT NOT NULL,
        type_raw TEXT NOT NULL,
        watched_on_raw TEXT,
        score_raw TEXT,
        status_raw TEXT,
        language_raw TEXT,
        thoughts_raw TEXT,
        publisher_raw TEXT,
        imported_at TEXT NOT NULL,
        parsed_media_id TEXT,
        parsed_history_id TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS external_ids (
        id TEXT PRIMARY KEY,
        media_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        external_id TEXT NOT NULL,
        FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`
    ];

    for (const statement of schema) {
      await this.db.execute(statement);
    }

    // Migrations for pre-existing SQLite databases
    await this.addColumnIfNotExists('media', 'metadata_refreshed_at', 'TEXT');
    await this.addColumnIfNotExists('media', 'developer', 'TEXT');
    await this.addColumnIfNotExists('media', 'cast', 'TEXT');
    await this.addColumnIfNotExists('media', 'seasons', 'TEXT');
    await this.addColumnIfNotExists('media', 'accent_color', 'TEXT');
    await this.addColumnIfNotExists('media', 'manually_matched', 'INTEGER DEFAULT 0');
    await this.addColumnIfNotExists('media_history', 'updated_at', 'TEXT');

    try {
      await this.db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_external_ids_provider_ext ON external_ids(provider, external_id);');
    } catch {
      // Index already exists
    }

  }

  // ==========================================
  // 1. MEDIA REPOSITORY
  // ==========================================

  /** Retrieves all media items sorted alphabetically by title. */
  public async getAllMedia(): Promise<Media[]> {
    if (!this.db) return [];
    const res = await this.db.select<Media[]>('SELECT * FROM media ORDER BY title ASC');
    return Promise.all(res.map(row => this.mapMediaObject(row)));
  }

  public async getMediaById(id: string): Promise<Media | null> {
    if (!this.db) return null;
    const res = await this.db.select<Record<string, unknown>[]>('SELECT * FROM media WHERE id = ?', [id]);
    
    if (res.length > 0) {
      return this.mapMediaObject(res[0]);
    }
    return null;
  }

  private async mapMediaObject(row: Record<string, any>): Promise<Media> {
    let genres: string[] = [];
    try {
      genres = typeof row.genres === 'string' ? JSON.parse(row.genres) : row.genres || [];
    } catch {
      genres = [];
    }

    let cast: any[] | undefined = undefined;
    if (row.cast) {
      try {
        cast = typeof row.cast === 'string' ? JSON.parse(row.cast) : row.cast;
      } catch {
        cast = undefined;
      }
    }

    let seasons: any[] | undefined = undefined;
    if (row.seasons) {
      try {
        seasons = typeof row.seasons === 'string' ? JSON.parse(row.seasons) : row.seasons;
      } catch {
        seasons = undefined;
      }
    }

    return {
      id: row.id as string,
      type: row.type as any,
      title: row.title as string,
      original_title: (row.original_title as string) || undefined,
      release_year: row.release_year ? Number(row.release_year) : undefined,
      language: (row.language as string) || undefined,
      description: (row.description as string) || undefined,
      genres,
      runtime: row.runtime ? Number(row.runtime) : undefined,
      poster: (row.poster as string) || undefined,
      backdrop: (row.backdrop as string) || undefined,
      logo: (row.logo as string) || undefined,
      metadata_source: (row.metadata_source as string) || undefined,
      metadata_refreshed_at: (row.metadata_refreshed_at as string) || undefined,
      publisher: (row.publisher as string) || undefined,
      developer: (row.developer as string) || undefined,
      cast,
      seasons,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      accent_color: (row.accent_color as string) || undefined,
      manually_matched: Boolean(row.manually_matched),
      external_ids: await this.getExternalIdsForMedia(row.id as string)
    };
  }

  public async saveMedia(media: Media): Promise<void> {
    if (!this.db) return;
    await this.db.execute(
      `INSERT INTO media (id, type, title, original_title, release_year, language, description, genres, runtime, poster, backdrop, logo, metadata_source, metadata_refreshed_at, publisher, developer, cast, seasons, created_at, updated_at, accent_color, manually_matched)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type=excluded.type,
         title=excluded.title,
         original_title=excluded.original_title,
         release_year=excluded.release_year,
         language=excluded.language,
         description=excluded.description,
         genres=excluded.genres,
         runtime=excluded.runtime,
         poster=excluded.poster,
         backdrop=excluded.backdrop,
         logo=excluded.logo,
         metadata_source=excluded.metadata_source,
         metadata_refreshed_at=excluded.metadata_refreshed_at,
         publisher=excluded.publisher,
         developer=excluded.developer,
         cast=excluded.cast,
         seasons=excluded.seasons,
         updated_at=excluded.updated_at,
         accent_color=excluded.accent_color,
         manually_matched=excluded.manually_matched`,
      [
        media.id,
        media.type,
        media.title,
        media.original_title || null,
        media.release_year || null,
        media.language || null,
        media.description || null,
        JSON.stringify(media.genres || []),
        media.runtime || null,
        media.poster || null,
        media.backdrop || null,
        media.logo || null,
        media.metadata_source || null,
        media.metadata_refreshed_at || null,
        media.publisher || null,
        media.developer || null,
        media.cast ? JSON.stringify(media.cast) : null,
        media.seasons ? JSON.stringify(media.seasons) : null,
        media.created_at,
        media.updated_at,
        media.accent_color || null,
        media.manually_matched ? 1 : 0
      ]
    );

    if (media.external_ids) {
      await this.db.execute('DELETE FROM external_ids WHERE media_id = ?', [media.id]);
      for (const ext of media.external_ids) {
        await this.saveExternalId(ext);
      }
    }
  }

  public async getMediaByExternalId(provider: string, external_id: string): Promise<Media | null> {
    if (!this.db) return null;
    const res = await this.db.select<Pick<ExternalID, 'media_id'>[]>('SELECT media_id FROM external_ids WHERE provider = ? AND external_id = ?', [provider, external_id]);
    
    if (res.length > 0) {
      const row = res[0];
      if (row.media_id) {
        return this.getMediaById(row.media_id);
      }
    }
    return null;
  }

  public async findSuspectedDuplicates(title: string, release_year?: number, excludeMediaId?: string): Promise<Media[]> {
    const allMedia = await this.getAllMedia();
    const cleanTitle = title.toLowerCase().replace(/[\W_]+/g, ' ').trim();

    return allMedia.filter(m => {
      if (excludeMediaId && m.id === excludeMediaId) return false;
      const mClean = m.title.toLowerCase().replace(/[\W_]+/g, ' ').trim();
      if (mClean === cleanTitle) return true;

      // If title is almost identical and release year matches
      if (release_year && m.release_year && release_year === m.release_year) {
        if (mClean.includes(cleanTitle) || cleanTitle.includes(mClean)) {
          return true;
        }
      }
      return false;
    });
  }

  public async mergeMediaEntities(survivingId: string, duplicateId: string, overrides?: Partial<Media>): Promise<void> {
    if (!this.db || survivingId === duplicateId) return;

    await this.db.execute('BEGIN TRANSACTION;');
    try {
      // 1. Relink local files
      await this.db.execute('UPDATE local_file SET media_id = ? WHERE media_id = ?', [survivingId, duplicateId]);

      // 2. Relink history
      await this.db.execute('UPDATE media_history SET media_id = ? WHERE media_id = ?', [survivingId, duplicateId]);

      // 3. Relink availability
      await this.db.execute('UPDATE availability SET media_id = ? WHERE media_id = ?', [survivingId, duplicateId]);

      // 4. Relink wishlist
      await this.db.execute('UPDATE wishlist SET media_id = ? WHERE media_id = ?', [survivingId, duplicateId]);

      // 5. Relink notion raw records
      await this.db.execute('UPDATE notion_raw_records SET parsed_media_id = ? WHERE parsed_media_id = ?', [survivingId, duplicateId]);

      // 6. Handle external_ids reassignments without duplicate provider/external_id conflicts
      await this.db.execute(
        `DELETE FROM external_ids
         WHERE media_id = ?
         AND provider || ':' || external_id IN (
           SELECT provider || ':' || external_id FROM external_ids WHERE media_id = ?
         )`,
        [duplicateId, survivingId]
      );
      await this.db.execute('UPDATE external_ids SET media_id = ? WHERE media_id = ?', [survivingId, duplicateId]);

      // 7. Delete duplicate media row
      await this.db.execute('DELETE FROM media WHERE id = ?', [duplicateId]);

      await this.db.execute('COMMIT;');
    } catch (err) {
      await this.db.execute('ROLLBACK;');
      console.error('Failed to merge media entities:', err);
      throw err;
    }

    // Update surviving media with overrides if provided
    if (overrides) {
      const survivingMedia = await this.getMediaById(survivingId);
      if (survivingMedia) {
        await this.saveMedia({
          ...survivingMedia,
          ...overrides,
          updated_at: new Date().toISOString()
        });
      }
    }
  }

  public async deleteMedia(id: string): Promise<void> {
    if (!this.db) return;
    await this.db.execute('DELETE FROM media WHERE id = ?', [id]);
    await this.db.execute('DELETE FROM external_ids WHERE media_id = ?', [id]);
    await this.db.execute('DELETE FROM media_history WHERE media_id = ?', [id]);
    await this.db.execute('UPDATE local_file SET media_id = NULL WHERE media_id = ?', [id]);
  }

  public async updateMediaArtwork(media_id: string, artwork: {poster?: string; backdrop?:
    string; logo?: string}): Promise<void>{
      if(!this.db) return;
      const now = new Date().toISOString();
      await this.db.execute(
        `UPDATE media SET
          poster = COALESCE(?, poster),
          backdrop = COALESCE(?, backdrop),
          logo = COALESCE(?, logo),
          updated_at = ?
        WHERE id = ?`,
         [artwork.poster || null, artwork.backdrop ||
           null, artwork.logo || null, now, media_id]
      )
      
  }

  // ==========================================
  // 2. EXTERNAL IDS REPOSITORY
  // ==========================================

  /** Retrieves linked provider external IDs for a media item. */
  public async getExternalIdsForMedia(media_id: string): Promise<ExternalID[]> {
    if (!this.db) return [];
    const res = await this.db.select<ExternalID[]>('SELECT * FROM external_ids WHERE media_id = ?', [media_id]);
    const results: ExternalID[] = [];
    for (const row of res) {
      results.push({
        id: row.id as string,
        media_id: row.media_id as string,
        provider: row.provider as string,
        external_id: row.external_id as string
      });
    }
    return results;
  }

  public async saveExternalId(ext: ExternalID): Promise<void> {
    if (!this.db) return;
    await this.db.execute(
      `INSERT INTO external_ids (id, media_id, provider, external_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, external_id=excluded.external_id`,
      [ext.id, ext.media_id, ext.provider, ext.external_id]
    );
  }

  // ==========================================
  // 3. MEDIA HISTORY & DERIVED STATE REPOSITORY
  // ==========================================

  /** Retrieves interaction logs for a specific media item sorted newest first. */
  public async getHistoryForMedia(media_id: string): Promise<MediaHistory[]> {
    if (!this.db) return [];
    const res = await this.db.select<MediaHistory[]>('SELECT * FROM media_history WHERE media_id = ? ORDER BY created_at DESC', [media_id]);
    const results: MediaHistory[] = [];
    for (const row of res) {
      results.push({
        id: row.id as string,
        media_id: row.media_id as string,
        started_at: (row.started_at as string) || undefined,
        completed_at: (row.completed_at as string) || undefined,
        status: row.status as any,
        score: row.score ? Number(row.score) : undefined,
        thoughts: (row.thoughts as string) || undefined,
        context: (row.context as string) || undefined,
        source: row.source as string,
        original_source_record_id: (row.original_source_record_id as string) || undefined,
        created_at: row.created_at as string,
        updated_at: (row.updated_at as string) || (row.created_at as string)
      });

    }
    return results;
  }

  public async getAllHistory(): Promise<MediaHistory[]> {
    if (!this.db) return [];
    const rows = await this.db.select<Record<string, any>[]>('SELECT * FROM media_history ORDER BY created_at DESC');
    return rows.map(row => ({
      id: row.id,
      media_id: row.media_id,
      started_at: row.started_at || undefined,
      completed_at: row.completed_at || undefined,
      status: row.status,
      score: row.score ? Number(row.score) : undefined,
      thoughts: row.thoughts || undefined,
      context: row.context || undefined,
      source: row.source,
      original_source_record_id: row.original_source_record_id || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at || row.created_at
    }));
  }

  public async saveHistory(history: MediaHistory): Promise<void> {
    if (!this.db) return;
    const updatedAt = history.updated_at || new Date().toISOString();
    await this.db.execute(
      `INSERT INTO media_history (id, media_id, started_at, completed_at, status, score, thoughts, context, source, original_source_record_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         started_at=excluded.started_at,
         completed_at=excluded.completed_at,
         status=excluded.status,
         score=excluded.score,
         thoughts=excluded.thoughts,
         context=excluded.context,
         source=excluded.source,
         original_source_record_id=excluded.original_source_record_id,
         updated_at=excluded.updated_at`,
      [
        history.id,
        history.media_id,
        history.started_at || null,
        history.completed_at || null,
        history.status,
        history.score !== undefined ? history.score : null,
        history.thoughts || null,
        history.context || null,
        history.source,
        history.original_source_record_id || null,
        history.created_at,
        updatedAt
      ]
    );
  }

  public async getMediaState(media_id: string): Promise<MediaState> {
    const histories = await this.getHistoryForMedia(media_id);
    if (!histories.length) {
      return {
        media_id,
        current_status: 'Planned',
        total_watch_play_count: 0,
        rewatch_count: 0,
        abandoned_count: 0,
        currently_watching_playing: false
      };
    }

    const sorted = [...histories].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const latest = sorted[sorted.length - 1];

    let totalCount = 0;
    let rewatchCount = 0;
    let abandonedCount = 0;
    let firstDate: string | undefined = undefined;
    let recentCompletion: string | undefined = undefined;

    for (const h of sorted) {
      const date = h.completed_at || h.started_at || h.created_at;
      if (!firstDate || (date && new Date(date).getTime() < new Date(firstDate).getTime())) {
        firstDate = date;
      }

      if (h.status === 'Finished') {
        totalCount++;
        if (totalCount > 1 || (h.context && h.context.toLowerCase().includes('rewatch'))) {
          rewatchCount++;
        }
        if (h.completed_at) {
          if (!recentCompletion || new Date(h.completed_at).getTime() > new Date(recentCompletion).getTime()) {
            recentCompletion = h.completed_at;
          }
        }
      } else if (h.status === 'Abandoned') {
        abandonedCount++;
      }
    }

    const lastWatchedPlayed = latest.completed_at || latest.started_at || latest.created_at;

    return {
      media_id,
      current_status: latest.status,
      last_watched_played: lastWatchedPlayed,
      total_watch_play_count: totalCount,
      rewatch_count: rewatchCount,
      abandoned_count: abandonedCount,
      currently_watching_playing: latest.status === 'Currently',
      first_watched_played: firstDate,
      most_recent_completion: recentCompletion
    };
  }

  // ==========================================
  // 4. LOCAL FILES REPOSITORY
  // ==========================================

  /** Retrieves local system files linked to a specific media item. */
  public async getLocalFilesForMedia(media_id: string): Promise<LocalFile[]> {
    if (!this.db) return [];
    const rows = await this.db.select<Record<string, any>[]>('SELECT * FROM local_file WHERE media_id = ?', [media_id]);
    return rows.map(row => ({
        id: row.id as string,
        media_id: row.media_id as string,
        path: row.path as string,
        filename: row.filename as string,
        extension: row.extension as string,
        size: Number(row.size),
        discovered_at: row.discovered_at as string,
        last_seen_at: row.last_seen_at as string,
        exists: Boolean(row.file_exists),
        file_type: row.file_type as any,
        launch_info: (row.launch_info as string) || undefined
      }));
  }

  public async getAllLocalFiles(): Promise<LocalFile[]> {
    if (!this.db) return [];
    const rows = await this.db.select<Record<string, any>[]>('SELECT * FROM local_file');
    return rows.map(row => ({
      id: row.id,
      media_id: row.media_id || undefined,
      path: row.path,
      filename: row.filename,
      extension: row.extension,
      size: Number(row.size),
      discovered_at: row.discovered_at,
      last_seen_at: row.last_seen_at,
      exists: Boolean(row.file_exists),
      file_type: row.file_type,
      launch_info: row.launch_info || undefined
    }));
  }

  public async getUnmatchedLocalFiles(): Promise<LocalFile[]> {
    if (!this.db) return [];
    const rows = await this.db.select<Record<string, any>[]>('SELECT * FROM local_file WHERE media_id IS NULL OR media_id = ""');
    return rows.map(row => ({
        id: row.id as string,
        media_id: undefined,
        path: row.path as string,
        filename: row.filename as string,
        extension: row.extension as string,
        size: Number(row.size),
        discovered_at: row.discovered_at as string,
        last_seen_at: row.last_seen_at as string,
        exists: Boolean(row.file_exists),
        file_type: row.file_type as any,
        launch_info: (row.launch_info as string) || undefined
      }));
  }

  public async linkLocalFileToMedia(file_id: string, media_id: string): Promise<void> {
    if (!this.db) return;
    await this.db.execute('UPDATE local_file SET media_id = ? WHERE id = ?', [media_id, file_id]);
  }

  public async saveLocalFile(file: LocalFile): Promise<void> {
    if (!this.db) return;
    await this.db.execute(
      `INSERT INTO local_file (id, media_id, path, filename, extension, size, discovered_at, last_seen_at, file_exists, file_type, launch_info)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         media_id=excluded.media_id,
         path=excluded.path,
         last_seen_at=excluded.last_seen_at,
         file_exists=excluded.file_exists,
         launch_info=excluded.launch_info`,
      [
        file.id,
        file.media_id || '',
        file.path,
        file.filename,
        file.extension,
        file.size,
        file.discovered_at,
        file.last_seen_at,
        file.exists ? 1 : 0,
        file.file_type,
        file.launch_info || null
      ]
    );
  }

  // ==========================================
  // 5. STREAMING AVAILABILITY REPOSITORY
  // ==========================================

  /** Retrieves streaming availability entries for a specific media item. */
  public async getAvailabilityForMedia(media_id: string): Promise<Availability[]> {
    if (!this.db) return [];
    const rows = await this.db.select<Record<string, any>[]>('SELECT * FROM availability WHERE media_id = ?', [media_id]);
    return rows.map(row => ({
        id: row.id as string,
        media_id: row.media_id as string,
        provider: row.provider as string,
        country: (row.country as string) || undefined,
        availability_type: row.availability_type as any,
        url: (row.url as string) || undefined,
        last_checked: row.last_checked as string
      }));
  }

  public async saveAvailability(avail: Availability): Promise<void> {
    if (!this.db) return;
    await this.db.execute(
      `INSERT INTO availability (id, media_id, provider, country, availability_type, url, last_checked)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         provider=excluded.provider,
         country=excluded.country,
         availability_type=excluded.availability_type,
         url=excluded.url,
         last_checked=excluded.last_checked`,
      [
        avail.id,
        avail.media_id,
        avail.provider,
        avail.country || null,
        avail.availability_type,
        avail.url || null,
        avail.last_checked
      ]
    );
  }

  // ==========================================
  // 6. WISHLIST REPOSITORY
  // ==========================================

  /** Retrieves all wishlist items sorted newest first. */
  public async getAllWishlist(): Promise<Wishlist[]> {
    if (!this.db) return [];
    const rows = await this.db.select<Record<string, any>[]>('SELECT * FROM wishlist ORDER BY added_at DESC');
    return rows.map(row => ({
      id: row.id,
      media_id: row.media_id || undefined,
      title: row.title,
      type: row.type,
      source: row.source,
      external_url: row.external_url || undefined,
      notes: row.notes || undefined,
      added_at: row.added_at,
      target_release_date: row.target_release_date || undefined,
      poster: row.poster || undefined
    }));
  }

  public async saveWishlist(item: Wishlist): Promise<void> {
    if (!this.db) return;
    await this.db.execute(
      `INSERT INTO wishlist (id, media_id, title, type, source, external_url, notes, added_at, target_release_date, poster)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         media_id=excluded.media_id,
         title=excluded.title,
         type=excluded.type,
         source=excluded.source,
         external_url=excluded.external_url,
         notes=excluded.notes,
         poster=excluded.poster`,
      [
        item.id,
        item.media_id || null,
        item.title,
        item.type,
        item.source,
        item.external_url || null,
        item.notes || null,
        item.added_at,
        item.target_release_date || null,
        item.poster || null
      ]
    );
  }

  // ==========================================
  // 7. NOTION RAW RECORDS REPOSITORY
  // ==========================================

  /** Persists original un-altered Notion CSV row records. */
  public async saveNotionRawRecord(record: NotionRawRecord): Promise<void> {
    if (!this.db) return;
    await this.db.execute(
      `INSERT INTO notion_raw_records (id, name_raw, type_raw, watched_on_raw, score_raw, status_raw, language_raw, thoughts_raw, publisher_raw, imported_at, parsed_media_id, parsed_history_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         parsed_media_id=excluded.parsed_media_id,
         parsed_history_id=excluded.parsed_history_id`,
      [
        record.id,
        record.name_raw,
        record.type_raw,
        record.watched_on_raw || null,
        record.score_raw || null,
        record.status_raw || null,
        record.language_raw || null,
        record.thoughts_raw || null,
        record.publisher_raw || null,
        record.imported_at,
        record.parsed_media_id || null,
        record.parsed_history_id || null
      ]
    );
  }

  public async getAllNotionRawRecords(): Promise<NotionRawRecord[]> {
    if (!this.db) return [];
    const rows = await this.db.select<Record<string, any>[]>('SELECT * FROM notion_raw_records ORDER BY imported_at DESC');
    return rows.map(row => ({
      id: row.id,
      name_raw: row.name_raw,
      type_raw: row.type_raw,
      watched_on_raw: row.watched_on_raw || undefined,
      score_raw: row.score_raw || undefined,
      status_raw: row.status_raw || undefined,
      language_raw: row.language_raw || undefined,
      thoughts_raw: row.thoughts_raw || undefined,
      publisher_raw: row.publisher_raw || undefined,
      imported_at: row.imported_at,
      parsed_media_id: row.parsed_media_id || undefined,
      parsed_history_id: row.parsed_history_id || undefined
    }));
  }

  // ==========================================
  // 8. SETTINGS REPOSITORY
  // ==========================================

  /** Retrieves application settings key-value object. */
  public async getSettings(): Promise<AppSettings> {
    if (!this.db) return {};
    const rows = await this.db.select<{ key: string; value: string }[]>('SELECT key, value FROM settings');
    const settings: Record<string, any> = {};
    for (const row of rows) {
      const key = row.key;
      const val = row.value;
      try {
        settings[key] = JSON.parse(val);
      } catch {
        settings[key] = val;
      }
    }
    return settings as AppSettings;
  }

  public async saveSetting(key: keyof AppSettings, value: any): Promise<void> {
    if (!this.db) return;
    const strVal = typeof value === 'string' ? value : JSON.stringify(value);
    await this.db.execute(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      [key, strVal]
    );
  }
}

export const dbService = new DatabaseService();
