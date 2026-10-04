import initSqlJs, { Database } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
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

const DB_STORAGE_KEY = 'my_media_library_sqlite_db';

export class DatabaseService {
  private db: Database | null = null;
  private initialized = false;

  async init(): Promise<Database> {
    if (this.db && this.initialized) {
      return this.db;
    }

    const SQL = await initSqlJs({
      locateFile: () => sqlWasmUrl
    });

    const savedDb = localStorage.getItem(DB_STORAGE_KEY);
    if (savedDb) {
      const uInt8Array = new Uint8Array(
        atob(savedDb)
          .split('')
          .map(char => char.charCodeAt(0))
      );
      this.db = new SQL.Database(uInt8Array);
    } else {
      this.db = new SQL.Database();
    }

    this.runMigrations();
    this.save();
    this.initialized = true;
    return this.db;
  }

  public save(): void {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = new Uint8Array(data);
    let binary = '';
    for (let i = 0; i < buffer.byteLength; i++) {
      binary += String.fromCharCode(buffer[i]);
    }
    const base64 = btoa(binary);
    localStorage.setItem(DB_STORAGE_KEY, base64);
  }

  private runMigrations(): void {
    if (!this.db) return;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS media (
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
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS media_history (
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
        FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS local_file (
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
      );

      CREATE TABLE IF NOT EXISTS availability (
        id TEXT PRIMARY KEY,
        media_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        country TEXT,
        availability_type TEXT NOT NULL,
        url TEXT,
        last_checked TEXT NOT NULL,
        FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS wishlist (
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
      );

      CREATE TABLE IF NOT EXISTS notion_raw_records (
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
      );

      CREATE TABLE IF NOT EXISTS external_ids (
        id TEXT PRIMARY KEY,
        media_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        external_id TEXT NOT NULL,
        FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  // --- REPOSITORY METHODS ---

  public getAllMedia(): Media[] {
    if (!this.db) return [];
    const res = this.db.exec('SELECT * FROM media ORDER BY title ASC');
    if (!res.length) return [];
    return res[0].values.map(row => this.mapMediaRow(res[0].columns, row));
  }

  public getMediaById(id: string): Media | null {
    if (!this.db) return null;
    const stmt = this.db.prepare('SELECT * FROM media WHERE id = :id');
    stmt.bind({ ':id': id });
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.mapMediaObject(row);
    }
    stmt.free();
    return null;
  }

  private mapMediaObject(row: Record<string, any>): Media {
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
      external_ids: this.getExternalIdsForMedia(row.id as string)
    };
  }

  private mapMediaRow(columns: string[], values: any[]): Media {
    const rowObj: Record<string, any> = {};
    columns.forEach((col, idx) => {
      rowObj[col] = values[idx];
    });
    return this.mapMediaObject(rowObj);
  }

  public saveMedia(media: Media): void {
    if (!this.db) return;
    this.db.run(
      `INSERT INTO media (id, type, title, original_title, release_year, language, description, genres, runtime, poster, backdrop, logo, metadata_source, metadata_refreshed_at, publisher, developer, cast, seasons, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
         updated_at=excluded.updated_at`,
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
        media.updated_at
      ]
    );

    if (media.external_ids) {
      for (const ext of media.external_ids) {
        this.saveExternalId(ext);
      }
    }
    this.save();
  }

  public getExternalIdsForMedia(media_id: string): ExternalID[] {
    if (!this.db) return [];
    const stmt = this.db.prepare('SELECT * FROM external_ids WHERE media_id = :media_id');
    stmt.bind({ ':media_id': media_id });
    const results: ExternalID[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
        id: row.id as string,
        media_id: row.media_id as string,
        provider: row.provider as string,
        external_id: row.external_id as string
      });
    }
    stmt.free();
    return results;
  }

  public saveExternalId(ext: ExternalID): void {
    if (!this.db) return;
    this.db.run(
      `INSERT INTO external_ids (id, media_id, provider, external_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET provider=excluded.provider, external_id=excluded.external_id`,
      [ext.id, ext.media_id, ext.provider, ext.external_id]
    );
  }

  public getHistoryForMedia(media_id: string): MediaHistory[] {
    if (!this.db) return [];
    const stmt = this.db.prepare('SELECT * FROM media_history WHERE media_id = :media_id ORDER BY created_at DESC');
    stmt.bind({ ':media_id': media_id });
    const results: MediaHistory[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
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
        created_at: row.created_at as string
      });
    }
    stmt.free();
    return results;
  }

  public getAllHistory(): MediaHistory[] {
    if (!this.db) return [];
    const res = this.db.exec('SELECT * FROM media_history ORDER BY created_at DESC');
    if (!res.length) return [];
    return res[0].values.map(row => ({
      id: row[0] as string,
      media_id: row[1] as string,
      started_at: (row[2] as string) || undefined,
      completed_at: (row[3] as string) || undefined,
      status: row[4] as any,
      score: row[5] ? Number(row[5]) : undefined,
      thoughts: (row[6] as string) || undefined,
      context: (row[7] as string) || undefined,
      source: row[8] as string,
      original_source_record_id: (row[9] as string) || undefined,
      created_at: row[10] as string
    }));
  }

  public saveHistory(history: MediaHistory): void {
    if (!this.db) return;
    this.db.run(
      `INSERT INTO media_history (id, media_id, started_at, completed_at, status, score, thoughts, context, source, original_source_record_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         started_at=excluded.started_at,
         completed_at=excluded.completed_at,
         status=excluded.status,
         score=excluded.score,
         thoughts=excluded.thoughts,
         context=excluded.context,
         source=excluded.source`,
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
        history.created_at
      ]
    );
    this.save();
  }

  public getMediaState(media_id: string): MediaState {
    const histories = this.getHistoryForMedia(media_id);
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

  public getLocalFilesForMedia(media_id: string): LocalFile[] {
    if (!this.db) return [];
    const stmt = this.db.prepare('SELECT * FROM local_file WHERE media_id = :media_id');
    stmt.bind({ ':media_id': media_id });
    const results: LocalFile[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
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
      });
    }
    stmt.free();
    return results;
  }

  public getAllLocalFiles(): LocalFile[] {
    if (!this.db) return [];
    const res = this.db.exec('SELECT * FROM local_file');
    if (!res.length) return [];
    return res[0].values.map(row => ({
      id: row[0] as string,
      media_id: (row[1] as string) || undefined,
      path: row[2] as string,
      filename: row[3] as string,
      extension: row[4] as string,
      size: Number(row[5]),
      discovered_at: row[6] as string,
      last_seen_at: row[7] as string,
      exists: Boolean(row[8]),
      file_type: row[9] as any,
      launch_info: (row[10] as string) || undefined
    }));
  }

  public getUnmatchedLocalFiles(): LocalFile[] {
    if (!this.db) return [];
    const stmt = this.db.prepare('SELECT * FROM local_file WHERE media_id IS NULL OR media_id = ""');
    const results: LocalFile[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
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
      });
    }
    stmt.free();
    return results;
  }

  public linkLocalFileToMedia(file_id: string, media_id: string): void {
    if (!this.db) return;
    this.db.run('UPDATE local_file SET media_id = ? WHERE id = ?', [media_id, file_id]);
    this.save();
  }

  public saveLocalFile(file: LocalFile): void {
    if (!this.db) return;
    this.db.run(
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
    this.save();
  }

  public getAvailabilityForMedia(media_id: string): Availability[] {
    if (!this.db) return [];
    const stmt = this.db.prepare('SELECT * FROM availability WHERE media_id = :media_id');
    stmt.bind({ ':media_id': media_id });
    const results: Availability[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
        id: row.id as string,
        media_id: row.media_id as string,
        provider: row.provider as string,
        country: (row.country as string) || undefined,
        availability_type: row.availability_type as any,
        url: (row.url as string) || undefined,
        last_checked: row.last_checked as string
      });
    }
    stmt.free();
    return results;
  }

  public saveAvailability(avail: Availability): void {
    if (!this.db) return;
    this.db.run(
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
    this.save();
  }

  public getAllWishlist(): Wishlist[] {
    if (!this.db) return [];
    const res = this.db.exec('SELECT * FROM wishlist ORDER BY added_at DESC');
    if (!res.length) return [];
    return res[0].values.map(row => ({
      id: row[0] as string,
      media_id: (row[1] as string) || undefined,
      title: row[2] as string,
      type: row[3] as any,
      source: row[4] as string,
      external_url: (row[5] as string) || undefined,
      notes: (row[6] as string) || undefined,
      added_at: row[7] as string,
      target_release_date: (row[8] as string) || undefined,
      poster: (row[9] as string) || undefined
    }));
  }

  public saveWishlist(item: Wishlist): void {
    if (!this.db) return;
    this.db.run(
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
    this.save();
  }

  public saveNotionRawRecord(record: NotionRawRecord): void {
    if (!this.db) return;
    this.db.run(
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
    this.save();
  }

  public getAllNotionRawRecords(): NotionRawRecord[] {
    if (!this.db) return [];
    const res = this.db.exec('SELECT * FROM notion_raw_records ORDER BY imported_at DESC');
    if (!res.length) return [];
    return res[0].values.map(row => ({
      id: row[0] as string,
      name_raw: row[1] as string,
      type_raw: row[2] as string,
      watched_on_raw: (row[3] as string) || undefined,
      score_raw: (row[4] as string) || undefined,
      status_raw: (row[5] as string) || undefined,
      language_raw: (row[6] as string) || undefined,
      thoughts_raw: (row[7] as string) || undefined,
      publisher_raw: (row[8] as string) || undefined,
      imported_at: row[9] as string,
      parsed_media_id: (row[10] as string) || undefined,
      parsed_history_id: (row[11] as string) || undefined
    }));
  }

  public getSettings(): AppSettings {
    if (!this.db) return {};
    const res = this.db.exec('SELECT key, value FROM settings');
    if (!res.length) return {};
    const settings: Record<string, any> = {};
    for (const row of res[0].values) {
      const key = row[0] as string;
      const val = row[1] as string;
      try {
        settings[key] = JSON.parse(val);
      } catch {
        settings[key] = val;
      }
    }
    return settings as AppSettings;
  }

  public saveSetting(key: keyof AppSettings, value: any): void {
    if (!this.db) return;
    const strVal = typeof value === 'string' ? value : JSON.stringify(value);
    this.db.run(
      `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      [key, strVal]
    );
    this.save();
  }
}

export const dbService = new DatabaseService();
