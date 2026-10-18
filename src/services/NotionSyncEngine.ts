import { dbService } from './DatabaseService';
import { notionService } from './NotionIntegrationService';
import { NotionColumnMapping } from '../providers/interfaces';
import { NotionSyncConflict, NotionSyncResult } from '../types/notion';
import { MediaHistory, Media } from '../types/media';

export class NotionSyncEngine {
  private activeConflicts: NotionSyncConflict[] = [];

  public getActiveConflicts(): NotionSyncConflict[] {
    return this.activeConflicts;
  }

  public clearConflicts(): void {
    this.activeConflicts = [];
  }

  /**
   * Main Bidirectional Synchronization Routine
   */
  public async performSync(
    token: string,
    databaseId: string,
    mapping: NotionColumnMapping
  ): Promise<NotionSyncResult> {
    if (!token || !databaseId) {
      throw new Error('Notion token and Database ID must be configured for synchronization.');
    }

    let importedCount = 0;
    let pushedCount = 0;
    let conflictsCount = 0;
    let unmatchedInboxCount = 0;
    const errors: string[] = [];

    this.activeConflicts = [];

    try {
      // 1. Fetch current Notion database schema properties
      let schema: Record<string, any> = {};
      try {
        schema = await notionService.fetchDatabaseSchema(token, databaseId);
      } catch (e) {
        console.warn('Could not fetch database schema, falling back to default mapping', e);
      }

      // 2. Fetch current Notion database pages
      const notionRows = await notionService.fetchFromApi(token, databaseId);

      // 3. Ensure all local media items have at least one history record
      const allMedia = dbService.getAllMedia();
      const syncStartTime = new Date().toISOString();
      for (const m of allMedia) {
        const histories = dbService.getHistoryForMedia(m.id);
        if (histories.length === 0) {
          dbService.saveHistory({
            id: `hist_init_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            media_id: m.id,
            status: 'Planned',
            source: 'Manual',
            created_at: syncStartTime,
            updated_at: syncStartTime
          });
        }
      }

      // 4. Fetch updated local records
      const localHistories = dbService.getAllHistory();
      const localMediaList = dbService.getAllMedia();

      // Map local history by Notion Page ID
      const historyByPageId = new Map<string, MediaHistory>();
      for (const h of localHistories) {
        if (h.original_source_record_id) {
          historyByPageId.set(h.original_source_record_id, h);
        }
      }

      // Map media by ID
      const mediaMap = new Map<string, Media>();
      for (const m of localMediaList) {
        mediaMap.set(m.id, m);
      }

      // Process Notion -> Local App Pull & Conflict Detection / Local -> Notion Push Update
      for (const row of notionRows) {
        const pageId = row['_page_id'];
        if (!pageId) continue;

        const rawName = row[mapping.nameField] || row['Name'] || row['Title'] || '';
        const rawWatchedOn = row[mapping.watchedOnField] || row['Watched On'] || '';
        const rawScore = row[mapping.scoreField] || row['Score'] || '';
        const rawStatus = row[mapping.statusField] || row['Status'] || '';
        const rawThoughts = row[mapping.thoughtsField] || row['Thoughts'] || '';

        const existingHistory = historyByPageId.get(pageId);

        if (existingHistory) {
          const targetMedia = mediaMap.get(existingHistory.media_id);
          const mediaTitle = targetMedia?.title || rawName;

          const notionEditedTime = row['_last_edited_time'] ? new Date(row['_last_edited_time']).getTime() : 0;
          const localUpdatedTime = existingHistory.updated_at
            ? new Date(existingHistory.updated_at).getTime()
            : new Date(existingHistory.created_at).getTime();

          const parsedScore = notionService.parseScore(rawScore);
          const parsedStatus = notionService.parseStatus(rawStatus);

          // Significant time difference threshold (2 seconds)
          const isNotionNewer = notionEditedTime > localUpdatedTime + 2000;
          const isLocalNewer = localUpdatedTime > notionEditedTime + 2000;

          if (isNotionNewer) {
            // Update local history from Notion
            const { startedAt, completedAt } = notionService.parseDates(rawWatchedOn, parsedStatus);
            dbService.saveHistory({
              ...existingHistory,
              score: parsedScore !== undefined ? parsedScore : existingHistory.score,
              status: parsedStatus,
              thoughts: rawThoughts || existingHistory.thoughts,
              started_at: startedAt || existingHistory.started_at,
              completed_at: completedAt || existingHistory.completed_at,
              updated_at: row['_last_edited_time'] || syncStartTime
            });
            importedCount++;
          } else if (isLocalNewer && targetMedia) {
            // Push local updates to Notion page
            try {
              const updatedProps = notionService.buildPageProperties(targetMedia, existingHistory, mapping, schema);
              await notionService.updatePageProperties(token, pageId, updatedProps);
              pushedCount++;
            } catch (updateErr: any) {
              errors.push(`Failed to update Notion page for "${mediaTitle}": ${updateErr.message}`);
            }
          } else {
            // Simultaneous edit check / Conflict check
            let hasConflict = false;

            if (parsedScore !== undefined && existingHistory.score !== undefined && parsedScore !== existingHistory.score) {
              this.activeConflicts.push({
                id: `conflict_${pageId}_score_${Date.now()}`,
                pageId,
                historyId: existingHistory.id,
                mediaId: existingHistory.media_id,
                mediaTitle,
                field: 'Score / Rating',
                notionValue: `${parsedScore} Stars`,
                appValue: `${existingHistory.score} Stars`,
                notionLastEdited: row['_last_edited_time'] || '',
                appLastEdited: existingHistory.updated_at || existingHistory.created_at
              });
              hasConflict = true;
            }

            if (parsedStatus !== existingHistory.status) {
              this.activeConflicts.push({
                id: `conflict_${pageId}_status_${Date.now()}`,
                pageId,
                historyId: existingHistory.id,
                mediaId: existingHistory.media_id,
                mediaTitle,
                field: 'Status',
                notionValue: parsedStatus,
                appValue: existingHistory.status,
                notionLastEdited: row['_last_edited_time'] || '',
                appLastEdited: existingHistory.updated_at || existingHistory.created_at
              });
              hasConflict = true;
            }

            if (rawThoughts.trim() && existingHistory.thoughts?.trim() && rawThoughts.trim() !== existingHistory.thoughts.trim()) {
              this.activeConflicts.push({
                id: `conflict_${pageId}_thoughts_${Date.now()}`,
                pageId,
                historyId: existingHistory.id,
                mediaId: existingHistory.media_id,
                mediaTitle,
                field: 'Thoughts / Review',
                notionValue: rawThoughts.trim(),
                appValue: existingHistory.thoughts.trim(),
                notionLastEdited: row['_last_edited_time'] || '',
                appLastEdited: existingHistory.updated_at || existingHistory.created_at
              });
              hasConflict = true;
            }

            if (hasConflict) {
              conflictsCount++;
            }
          }
        } else {
          // Import new record from Notion
          const importResult = await notionService.importFromRows([row], mapping);
          importedCount += importResult.importedHistoryCount;
          if (importResult.errors.length > 0) {
            errors.push(...importResult.errors);
          }
        }
      }

      // Process Local App -> Notion Push for newly logged history records lacking original_source_record_id
      const currentHistories = dbService.getAllHistory();
      const currentMediaMap = new Map<string, Media>();
      for (const m of dbService.getAllMedia()) {
        currentMediaMap.set(m.id, m);
      }

      for (const h of currentHistories) {
        if (!h.original_source_record_id) {
          const media = currentMediaMap.get(h.media_id);
          if (!media) continue;

          try {
            const pageProps = notionService.buildPageProperties(media, h, mapping, schema);
            const newPageId = await notionService.createPageInDatabase(token, databaseId, pageProps);

            // Link local history to newly created Notion Page ID
            h.original_source_record_id = newPageId;
            h.updated_at = new Date().toISOString();
            dbService.saveHistory(h);

            // Also record external ID
            dbService.saveExternalId({
              id: `ext_notion_${newPageId}`,
              media_id: media.id,
              provider: 'Notion',
              external_id: newPageId
            });

            pushedCount++;
          } catch (pushErr: any) {
            errors.push(`Failed to push local record "${media.title}" to Notion: ${pushErr.message}`);
          }
        }
      }

      // Record last sync timestamp in settings
      const syncEndTime = new Date().toISOString();
      dbService.saveSetting('notion_last_sync_time', syncEndTime);
      dbService.saveSetting('notion_sync_errors', errors);

      return {
        importedCount,
        pushedCount,
        conflictsCount,
        errors,
        unmatchedInboxCount,
        timestamp: syncEndTime
      };
    } catch (err: any) {
      console.error('Notion Sync Engine error:', err);
      throw err;
    }
  }

  /**
   * Resolves a conflict by applying chosen side's value ('notion' or 'app')
   */
  public async resolveConflict(
    conflict: NotionSyncConflict,
    resolution: 'notion' | 'app',
    token?: string,
    mapping?: NotionColumnMapping,
    schema?: Record<string, any>
  ): Promise<void> {
    if (!conflict.historyId) return;

    const history = dbService.getAllHistory().find(h => h.id === conflict.historyId);
    if (!history) return;

    const now = new Date().toISOString();

    if (resolution === 'notion') {
      // Apply Notion value to local history
      if (conflict.field === 'Score / Rating') {
        const num = parseFloat(conflict.notionValue);
        history.score = isNaN(num) ? undefined : num;
      } else if (conflict.field === 'Status') {
        history.status = conflict.notionValue as any;
      } else if (conflict.field === 'Thoughts / Review') {
        history.thoughts = conflict.notionValue;
      }
      history.updated_at = now;
      dbService.saveHistory(history);
    } else if (resolution === 'app' && token && conflict.pageId) {
      // Apply App value to Notion page via API
      try {
        const media = history.media_id ? dbService.getMediaById(history.media_id) : null;
        if (media && mapping) {
          const props = notionService.buildPageProperties(media, history, mapping, schema);
          await notionService.updatePageProperties(token, conflict.pageId, props);
        }
      } catch (err) {
        console.error('Failed to resolve conflict on Notion page:', err);
      }
    }

    // Remove from active conflicts
    this.activeConflicts = this.activeConflicts.filter(c => c.id !== conflict.id);
  }
}

export const notionSyncEngine = new NotionSyncEngine();
