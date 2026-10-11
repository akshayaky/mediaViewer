import {
  NotionProvider,
  NotionImportRow,
  NotionColumnMapping,
  NotionImportResult
} from '../providers/interfaces';
import { dbService } from '../services/DatabaseService';
import { Media, MediaHistory, NotionRawRecord, MediaType, MediaStatus } from '../types/media';

export class NotionIntegrationService implements NotionProvider {
  /**
   * Parses title strings containing contextual brackets/parentheses into
   * clean canonical titles and extracted history context notes.
   *
   * Examples:
   * - "Aanandam(2+ Rewatch)" -> cleanTitle: "Aanandam", contextNote: "2+ Rewatch"
   * - "Premalu(Rewatch)" -> cleanTitle: "Premalu", contextNote: "Rewatch"
   * - "Overcooked(restart)" -> cleanTitle: "Overcooked", contextNote: "restart"
   * - "Assasin’s Creed 4 black flag resynced" -> cleanTitle: "Assassin's Creed IV: Black Flag", contextNote: "resynced"
   * - "Ted Lasso(Season 1-2 rewatch, 3-4 )" -> cleanTitle: "Ted Lasso", contextNote: "Season 1-2 rewatch, 3-4"
   */
  public parseTitle(rawTitle: string): { cleanTitle: string; contextNote?: string } {
    if (!rawTitle) return { cleanTitle: '' };

    let clean = rawTitle.trim();
    let extractedContext: string | undefined = undefined;

    // 1. Extract content inside parentheses or brackets
    const bracketRegex = /[\(\[](.*?)[\)\]]/;
    const match = bracketRegex.exec(clean);

    if (match) {
      extractedContext = match[1].trim();
      clean = clean.replace(bracketRegex, '').trim();
    }

    // 2. Handle trailing keywords like "resynced" or "restart" if outside parentheses
    const resyncedRegex = /\b(resynced|restart|re-started)\b/i;
    const resyncedMatch = resyncedRegex.exec(clean);
    if (resyncedMatch) {
      const keyword = resyncedMatch[1];
      clean = clean.replace(resyncedRegex, '').trim();
      extractedContext = extractedContext ? `${extractedContext}, ${keyword}` : keyword;
    }

    // Normalize spacing and clean quotes/special quotes
    clean = clean.replace(/’/g, "'").replace(/\s+/g, ' ');

    // Normalize known variant names for consistency
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
      extractedContext = extractedContext ? `Season 2, ${extractedContext}` : "Season 2";
    }

    return {
      cleanTitle: clean,
      contextNote: extractedContext
    };
  }

  /**
   * Helper to parse scores like "⭐️⭐️⭐️⭐️", "4/5", "4", "4.5"
   */
  private parseScore(scoreRaw?: string): number | undefined {
    if (!scoreRaw) return undefined;
    const str = scoreRaw.trim();

    // Count stars
    const starCount = (str.match(/⭐️|⭐|\*/g) || []).length;
    if (starCount > 0) return starCount;

    // Parse fraction or number
    const num = parseFloat(str);
    if (!isNaN(num)) return num;

    return undefined;
  }

  /**
   * Helper to normalize media type
   */
  private parseType(typeRaw?: string): MediaType {
    if (!typeRaw) return 'Film';
    const lower = typeRaw.toLowerCase();
    if (lower.includes('game') || lower.includes('videogame')) return 'VideoGame';
    if (lower.includes('tv') || lower.includes('series') || lower.includes('show')) return 'TV Series';
    return 'Film';
  }

  /**
   * Helper to normalize media status
   */
  private parseStatus(statusRaw?: string): MediaStatus {
    if (!statusRaw) return 'Finished';
    const lower = statusRaw.toLowerCase();
    if (lower.includes('abandoned') || lower.includes('dropped')) return 'Abandoned';
    if (lower.includes('currently') || lower.includes('watching') || lower.includes('playing') || lower.includes('in progress')) return 'Currently';
    if (lower.includes('pause') || lower.includes('hold')) return 'Paused';
    if (lower.includes('plan') || lower.includes('want')) return 'Planned';
    return 'Finished';
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
    // Map normalized title + type to Media ID
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

        const rawRecordId = `notion_raw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
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

        // Parse canonical title and context note
        const { cleanTitle, contextNote } = this.parseTitle(rawName);
        const mediaType = this.parseType(rawType);
        const mediaKey = `${cleanTitle.toLowerCase()}_${mediaType}`;

        let targetMedia = mediaMap.get(mediaKey);

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

        // Parse date(s)
        let startedAt: string | undefined = undefined;
        let completedAt: string | undefined = undefined;
        if (rawWatchedOn) {
          if (rawWatchedOn.includes('→') || rawWatchedOn.includes('->')) {
            const parts = rawWatchedOn.split(/→|->/);
            startedAt = parts[0]?.trim();
            completedAt = parts[1]?.trim();
          } else {
            completedAt = rawWatchedOn.trim();
          }
        }

        // Create MediaHistory
        const historyId = `history_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const historyRecord: MediaHistory = {
          id: historyId,
          media_id: targetMedia.id,
          started_at: startedAt,
          completed_at: completedAt,
          status: this.parseStatus(rawStatus),
          score: this.parseScore(rawScore),
          thoughts: rawThoughts?.trim(),
          context: contextNote,
          source: 'Notion',
          original_source_record_id: rawRecordId,
          created_at: now
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
}

export const notionService = new NotionIntegrationService();
