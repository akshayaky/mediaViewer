import {
  NotionProvider,
  NotionImportRow,
  NotionColumnMapping,
  NotionImportResult
} from '../providers/interfaces';
import { dbService } from '../services/DatabaseService';
import { Media, MediaHistory, NotionRawRecord, MediaType, MediaStatus } from '../types/media';
import { NotionDatabase, NotionPropertySchema, NotionPage } from '../types/notion';
import { isTauri } from '../services/LocalScannerService';

export class NotionIntegrationService implements NotionProvider {
  /**
   * Helper to perform HTTP requests to Notion REST API
   */
  private async fetchNotionApi(endpoint: string, token: string, options: RequestInit = {}): Promise<any> {
    const url = `https://api.notion.com/v1${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': "2022-06-28",
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    let response: Response;
    if (isTauri()) {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
      response = await tauriFetch(url, { ...options, headers });
    } else {
      response = await fetch(url, { ...options, headers });
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Notion API Error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  /**
   * Creates a pre-configured Media Tracking Database in Notion workspace
   * (Useful when the user does not have a database yet and wants Notion for backup/sync)
   */
  public async createMediaDatabaseInWorkspace(token: string, parentPageId?: string): Promise<NotionDatabase> {
    if (!token) throw new Error('Notion token is required to create database.');

    let resolvedParentPageId = parentPageId;

    if (!resolvedParentPageId) {
      const pagesSearch = await this.fetchNotionApi('/search', token, {
        method: 'POST',
        body: JSON.stringify({
          filter: { value: 'page', property: 'object' },
          page_size: 1
        })
      });

      resolvedParentPageId = pagesSearch.results?.[0]?.id;
      if (!resolvedParentPageId) {
        throw new Error('No accessible Notion page found. Share a page with your integration, then try creating the database again.');
      }
    }

    const payload = {
      parent: { type: 'page_id', page_id: resolvedParentPageId },
      title: [
        {
          type: 'text',
          text: { content: 'My Media Library - Tracking Database' }
        }
      ],
      properties: {
        'Name': { title: {} },
        'Type': {
          select: {
            options: [
              { name: 'Film', color: 'red' },
              { name: 'TV Series', color: 'blue' },
              { name: 'VideoGame', color: 'purple' }
            ]
          }
        },
        'Watched On/Completed Watching': { date: {} },
        'Score /5': { number: { format: 'number' } },
        'Status': {
          select: {
            options: [
              { name: 'Finished', color: 'green' },
              { name: 'Currently', color: 'yellow' },
              { name: 'Abandoned', color: 'orange' },
              { name: 'Planned', color: 'gray' },
              { name: 'Paused', color: 'brown' }
            ]
          }
        },
        'Language': { rich_text: {} },
        'Thoughts': { rich_text: {} },
        'Publisher': { rich_text: {} }
      }
    };

    const db = await this.fetchNotionApi('/databases', token, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    return {
      id: db.id,
      title: db.title?.[0]?.plain_text || 'My Media Library - Tracking Database',
      url: db.url,
      properties: this.parseDatabaseProperties(db.properties)
    };
  }

  /**
   * Fetches available databases accessible to the integration token
   */
  public async fetchDatabases(token: string): Promise<NotionDatabase[]> {
    if (!token) return [];
    try {
      const data = await this.fetchNotionApi('/search', token, {
        method: 'POST',
        body: JSON.stringify({
          filter: { value: 'database', property: 'object' },
          page_size: 100
        })
      });

      return (data.results || []).map((db: any) => ({
        id: db.id,
        title: db.title?.[0]?.plain_text || db.title?.[0]?.text?.content || 'Untitled Database',
        icon: db.icon?.emoji || db.icon?.external?.url,
        description: db.description?.[0]?.plain_text || '',
        created_time: db.created_time,
        last_edited_time: db.last_edited_time,
        url: db.url,
        properties: this.parseDatabaseProperties(db.properties)
      }));
    } catch (err) {
      console.error('Failed to fetch Notion databases:', err);
      throw err;
    }
  }

  /**
   * Fetches schema for a specific Notion database
   */
  public async fetchDatabaseSchema(token: string, databaseId: string): Promise<Record<string, NotionPropertySchema>> {
    if (!token || !databaseId) return {};
    try {
      const db = await this.fetchNotionApi(`/databases/${databaseId}`, token, { method: 'GET' });
      return this.parseDatabaseProperties(db.properties);
    } catch (err) {
      console.error('Failed to fetch Notion database schema:', err);
      throw err;
    }
  }

  private parseDatabaseProperties(props: Record<string, any>): Record<string, NotionPropertySchema> {
    const result: Record<string, NotionPropertySchema> = {};
    if (!props) return result;

    for (const [key, prop] of Object.entries(props)) {
      result[key] = {
        id: (prop as any).id,
        name: key,
        type: (prop as any).type,
        select: (prop as any).select,
        status: (prop as any).status
      };
    }
    return result;
  }

  /**
   * Fetches all pages/rows from a Notion database as generic row objects
   */
  public async fetchFromApi(token: string, databaseId: string): Promise<NotionImportRow[]> {
    if (!token || !databaseId) return [];

    let hasMore = true;
    let nextCursor: string | undefined = undefined;
    const pages: NotionPage[] = [];

    while (hasMore) {
      const body: any = { page_size: 100 };
      if (nextCursor) body.start_cursor = nextCursor;

      const data = await this.fetchNotionApi(`/databases/${databaseId}/query`, token, {
        method: 'POST',
        body: JSON.stringify(body)
      });

      pages.push(...(data.results || []));
      hasMore = Boolean(data.has_more);
      nextCursor = data.next_cursor;
    }

    // Convert Notion pages into NotionImportRow records
    return pages.map(page => this.convertNotionPageToRow(page));
  }

  /**
   * Converts a raw Notion Page API object into a simple NotionImportRow key-value map
   */
  public convertNotionPageToRow(page: NotionPage): NotionImportRow {
    const row: NotionImportRow = {
      Type: '',
      Name: '',
      _page_id: page.id,
      _url: page.url,
      _last_edited_time: page.last_edited_time
    };

    for (const [propName, propVal] of Object.entries(page.properties)) {
      let strVal = '';
      if (!propVal) continue;

      switch (propVal.type) {
        case 'title':
          strVal = propVal.title?.map(t => t.plain_text).join('') || '';
          break;
        case 'rich_text':
          strVal = propVal.rich_text?.map(t => t.plain_text).join('') || '';
          break;
        case 'select':
          strVal = propVal.select?.name || '';
          break;
        case 'status':
          strVal = propVal.status?.name || '';
          break;
        case 'number':
          strVal = propVal.number !== null && propVal.number !== undefined ? String(propVal.number) : '';
          break;
        case 'date':
          if (propVal.date) {
            strVal = propVal.date.end ? `${propVal.date.start} → ${propVal.date.end}` : propVal.date.start;
          }
          break;
        default:
          strVal = '';
      }

      row[propName] = strVal;
    }

    return row;
  }

  /**
   * Parses title strings containing contextual annotations into clean canonical titles and extracted context notes.
   *
   * Annotations handled:
   * - (rewatch), (2+ Rewatch), (? rewatch), season rewatch
   * - (restart), resynced
   * - (Theater)
   * - S2, Season 2
   */
  public parseTitle(rawTitle: string): { cleanTitle: string; contextNote?: string } {
    if (!rawTitle) return { cleanTitle: '' };

    let clean = rawTitle.trim();
    let extractedContexts: string[] = [];

    // 1. Extract content inside parentheses or square brackets e.g. (2+ Rewatch), (restart), (Theater), (? rewatch)
    const bracketRegex = /[\(\[](.*?)[\)\]]/g;
    let match;
    while ((match = bracketRegex.exec(clean)) !== null) {
      if (match[1] && match[1].trim()) {
        extractedContexts.push(match[1].trim());
      }
    }
    clean = clean.replace(bracketRegex, '').trim();

    // 2. Extract trailing keywords e.g. "resynced", "restart", "re-started", "season rewatch"
    const keywordRegex = /\b(resynced|restart|re-started|season rewatch)\b/gi;
    let kwMatch;
    while ((kwMatch = keywordRegex.exec(clean)) !== null) {
      if (kwMatch[1]) {
        extractedContexts.push(kwMatch[1].trim());
      }
    }
    clean = clean.replace(keywordRegex, '').trim();

    // 3. Normalize quotes and double spaces
    clean = clean.replace(/’/g, "'").replace(/\s+/g, ' ').trim();

    // 4. Normalize known variant names
    const lower = clean.toLowerCase();
    if (
      lower.startsWith("assasin's creed 4") ||
      lower.startsWith("assasin’s creed 4") ||
      lower.startsWith("assassin's creed 4") ||
      lower.startsWith("assassin’s creed 4")
    ) {
      clean = "Assassin's Creed IV: Black Flag";
    } else if (lower.startsWith("the paper s2") || lower.startsWith("the paper season 2")) {
      clean = "The Paper";
      if (!extractedContexts.some(c => c.toLowerCase().includes('season 2') || c.toLowerCase().includes('s2'))) {
        extractedContexts.unshift("Season 2");
      }
    }

    const contextNote = extractedContexts.length > 0 ? extractedContexts.join(', ') : undefined;

    return {
      cleanTitle: clean,
      contextNote
    };
  }

  /**
   * Helper to parse scores like "⭐️⭐️⭐️⭐️", "4/5", "4", "4.5"
   */
  public parseScore(scoreRaw?: string): number | undefined {
    if (!scoreRaw) return undefined;
    const str = scoreRaw.trim();

    // Count stars
    const starCount = (str.match(/⭐️|⭐|\*/g) || []).length;
    if (starCount > 0) return starCount;

    // Parse fraction or number
    const num = parseFloat(str);
    if (!isNaN(num)) return Math.min(5, Math.max(1, num));

    return undefined;
  }

  /**
   * Helper to normalize media type
   */
  public parseType(typeRaw?: string): MediaType {
    if (!typeRaw) return 'Film';
    const lower = typeRaw.toLowerCase();
    if (lower.includes('game') || lower.includes('videogame')) return 'VideoGame';
    if (lower.includes('tv') || lower.includes('series') || lower.includes('show')) return 'TV Series';
    return 'Film';
  }

  /**
   * Helper to normalize media status
   */
  public parseStatus(statusRaw?: string): MediaStatus {
    if (!statusRaw) return 'Finished';
    const lower = statusRaw.toLowerCase();
    if (lower.includes('abandoned') || lower.includes('dropped')) return 'Abandoned';
    if (lower.includes('currently') || lower.includes('watching') || lower.includes('playing') || lower.includes('in progress')) return 'Currently';
    if (lower.includes('pause') || lower.includes('hold')) return 'Paused';
    if (lower.includes('plan') || lower.includes('want')) return 'Planned';
    return 'Finished';
  }

  /**
   * Parses date strings (single dates or ranges) into started_at & completed_at
   */
  public parseDates(watchedOnRaw?: string, status: MediaStatus = 'Finished'): { startedAt?: string; completedAt?: string } {
    if (!watchedOnRaw || !watchedOnRaw.trim()) return {};

    const raw = watchedOnRaw.trim();
    if (raw.includes('→') || raw.includes('->')) {
      const parts = raw.split(/→|->/);
      return {
        startedAt: parts[0]?.trim(),
        completedAt: parts[1]?.trim()
      };
    }

    if (status === 'Currently') {
      return { startedAt: raw };
    }

    return { completedAt: raw };
  }

  public async importFromRows(
    rows: NotionImportRow[],
    mapping?: Partial<NotionColumnMapping>
  ): Promise<NotionImportResult> {
    const defaultMapping: NotionColumnMapping = {
      typeField: mapping?.typeField || 'Type',
      nameField: mapping?.nameField || 'Name',
      watchedOnField: mapping?.watchedOnField || 'Watched On/Completed Watching',
      scoreField: mapping?.scoreField || 'Score /5',
      statusField: mapping?.statusField || 'Status',
      languageField: mapping?.languageField || 'Language',
      thoughtsField: mapping?.thoughtsField || 'Thoughts',
      publisherField: mapping?.publisherField || 'Publisher'
    };

    let importedMediaCount = 0;
    let importedHistoryCount = 0;
    let rawRecordsSaved = 0;
    const errors: string[] = [];

    const existingMediaList = dbService.getAllMedia();
    const mediaMap = new Map<string, Media>();
    for (const m of existingMediaList) {
      mediaMap.set(`${m.title.toLowerCase()}_${m.type}`, m);
    }

    const now = new Date().toISOString();

    for (const row of rows) {
      try {
        const rawName = row[defaultMapping.nameField] || row['Name'] || row['Title'] || '';
        const rawType = row[defaultMapping.typeField] || row['Type'] || 'Film';
        if (!rawName.trim()) continue;

        const pageId = row['_page_id'];
        const rawRecordId = pageId ? `notion_raw_${pageId}` : `notion_raw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const rawWatchedOn = row[defaultMapping.watchedOnField] || row['Watched On'] || row['Completed Watching'];
        const rawScore = row[defaultMapping.scoreField] || row['Score'];
        const rawStatus = row[defaultMapping.statusField] || row['Status'];
        const rawLanguage = row[defaultMapping.languageField] || row['Language'];
        const rawThoughts = row[defaultMapping.thoughtsField] || row['Thoughts'];
        const rawPublisher = row[defaultMapping.publisherField] || row['Publisher'];

        // Save raw Notion record first
        const notionRaw: NotionRawRecord = {
          id: rawRecordId,
          name_raw: rawName,
          type_raw: rawType,
          watched_on_raw: rawWatchedOn,
          score_raw: rawScore,
          status_raw: rawStatus,
          language_raw: rawLanguage,
          thoughts_raw: rawThoughts,
          publisher_raw: rawPublisher,
          imported_at: now
        };

        // Parse clean title and context note
        const { cleanTitle, contextNote } = this.parseTitle(rawName);
        const mediaType = this.parseType(rawType);
        const parsedStatus = this.parseStatus(rawStatus);
        const mediaKey = `${cleanTitle.toLowerCase()}_${mediaType}`;

        let targetMedia = mediaMap.get(mediaKey);

        // Check for suspected duplicates / uncertain matches
        const suspectedDuplicates = dbService.findSuspectedDuplicates(cleanTitle);

        if (!targetMedia && suspectedDuplicates.length > 1) {
          // Flag as uncertain match in Notion Raw Record
          notionRaw.parsed_media_id = undefined;
          dbService.saveNotionRawRecord(notionRaw);
          rawRecordsSaved++;
          continue;
        }

        if (!targetMedia) {
          const newMediaId = `media_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          targetMedia = {
            id: newMediaId,
            type: mediaType,
            title: cleanTitle,
            language: rawLanguage?.trim(),
            publisher: rawPublisher?.trim(),
            genres: [],
            created_at: now,
            updated_at: now,
            metadata_source: 'Notion Import'
          };
          dbService.saveMedia(targetMedia);
          mediaMap.set(mediaKey, targetMedia);
          importedMediaCount++;
        } else {
          // Update language or publisher if missing
          let updated = false;
          if (!targetMedia.language && rawLanguage) {
            targetMedia.language = rawLanguage.trim();
            updated = true;
          }
          if (!targetMedia.publisher && rawPublisher) {
            targetMedia.publisher = rawPublisher.trim();
            updated = true;
          }
          if (updated) {
            targetMedia.updated_at = now;
            dbService.saveMedia(targetMedia);
          }
        }

        // Link Notion External ID to target media if pageId exists
        if (pageId) {
          dbService.saveExternalId({
            id: `ext_notion_${pageId}`,
            media_id: targetMedia.id,
            provider: 'Notion',
            external_id: pageId
          });
        }

        // Parse date(s)
        const { startedAt, completedAt } = this.parseDates(rawWatchedOn, parsedStatus);

        // Create MediaHistory interaction record
        const historyId = pageId ? `history_notion_${pageId}` : `history_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const historyRecord: MediaHistory = {
          id: historyId,
          media_id: targetMedia.id,
          started_at: startedAt,
          completed_at: completedAt,
          status: parsedStatus,
          score: this.parseScore(rawScore),
          thoughts: rawThoughts?.trim(),
          context: contextNote,
          source: 'Notion',
          original_source_record_id: pageId || rawRecordId,
          created_at: row['_last_edited_time'] || now
        };

        dbService.saveHistory(historyRecord);
        importedHistoryCount++;

        // Update NotionRawRecord with parsed links
        notionRaw.parsed_media_id = targetMedia.id;
        notionRaw.parsed_history_id = historyId;
        dbService.saveNotionRawRecord(notionRaw);
        rawRecordsSaved++;

      } catch (err: any) {
        errors.push(`Failed to parse row: ${JSON.stringify(row)}. Error: ${err.message || err}`);
      }
    }

    return {
      totalRows: rows.length,
      importedMediaCount,
      importedHistoryCount,
      rawRecordsSaved,
      errors
    };
  }

  /**
   * Updates an existing Notion page using Notion API (for sync)
   */
  public async updatePageProperties(token: string, pageId: string, properties: Record<string, any>): Promise<void> {
    if (!token || !pageId) return;
    await this.fetchNotionApi(`/pages/${pageId}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ properties })
    });
  }

  /**
   * Creates a new Notion page using Notion API (for sync)
   */
  public async createPageInDatabase(token: string, databaseId: string, properties: Record<string, any>): Promise<string> {
    if (!token || !databaseId) throw new Error('Missing token or databaseId');
    const res = await this.fetchNotionApi('/pages', token, {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties
      })
    });
    return res.id;
  }
}

export const notionService = new NotionIntegrationService();
