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
      // 1. Fetch current Notion database pages
      const notionRows = await notionService.fetchFromApi(token, databaseId);

      // 2. Fetch local records
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

      // Process Notion -> Local App Pull & Conflict Detection
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

          // Check for conflicts: if local history was updated after Notion page edited time
          const notionEditedTime = row['_last_edited_time'] ? new Date(row['_last_edited_time']).getTime() : 0;
          const localCreatedTime = new Date(existingHistory.created_at).getTime();

          const parsedScore = notionService.parseScore(rawScore);
          const parsedStatus = notionService.parseStatus(rawStatus);

          let hasConflict = false;

          // Check score conflict
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
              appLastEdited: existingHistory.created_at
            });
            hasConflict = true;
          }

          // Check status conflict
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
              appLastEdited: existingHistory.created_at
            });
            hasConflict = true;
          }

          // Check thoughts conflict
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
              appLastEdited: existingHistory.created_at
            });
            hasConflict = true;
          }

          if (hasConflict) {
            conflictsCount++;
          } else {
            // Update local history from Notion if Notion is newer
            if (notionEditedTime > localCreatedTime) {
              const { startedAt, completedAt } = notionService.parseDates(rawWatchedOn, parsedStatus);
              dbService.saveHistory({
                ...existingHistory,
                score: parsedScore !== undefined ? parsedScore : existingHistory.score,
                status: parsedStatus,
                thoughts: rawThoughts || existingHistory.thoughts,
                started_at: startedAt || existingHistory.started_at,
                completed_at: completedAt || existingHistory.completed_at
              });
              importedCount++;
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

      // Process Local App -> Notion Push for newly logged history records lacking pageId
      for (const h of localHistories) {
        if (h.source === 'Manual' && !h.original_source_record_id) {
          const media = mediaMap.get(h.media_id);
          if (!media) continue;

          try {
            const pageProps: Record<string, any> = {
              [mapping.nameField || 'Name']: {
                title: [{ text: { content: media.title } }]
              },
              [mapping.typeField || 'Type']: {
                select: { name: media.type }
              },
              [mapping.statusField || 'Status']: {
                select: { name: h.status }
              }
            };

            if (h.score) {
              pageProps[mapping.scoreField || 'Score /5'] = {
                number: h.score
              };
            }

            if (h.thoughts) {
              pageProps[mapping.thoughtsField || 'Thoughts'] = {
                rich_text: [{ text: { content: h.thoughts } }]
              };
            }

            if (h.completed_at || h.started_at) {
              pageProps[mapping.watchedOnField || 'Watched On/Completed Watching'] = {
                date: {
                  start: h.started_at || h.completed_at,
                  end: h.started_at && h.completed_at ? h.completed_at : null
                }
              };
            }

            const newPageId = await notionService.createPageInDatabase(token, databaseId, pageProps);

            // Link local history to newly created Notion Page ID
            h.original_source_record_id = newPageId;
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
      const now = new Date().toISOString();
      dbService.saveSetting('notion_last_sync_time', now);
      dbService.saveSetting('notion_sync_errors', errors);

      return {
        importedCount,
        pushedCount,
        conflictsCount,
        errors,
        unmatchedInboxCount,
        timestamp: now
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
    token?: string
  ): Promise<void> {
    if (!conflict.historyId) return;

    const history = dbService.getAllHistory().find(h => h.id === conflict.historyId);
    if (!history) return;

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
      dbService.saveHistory(history);
    } else if (resolution === 'app' && token && conflict.pageId) {
      // Apply App value to Notion page via API
      try {
        const props: Record<string, any> = {};
        if (conflict.field === 'Score / Rating' && history.score) {
          props['Score /5'] = { number: history.score };
        } else if (conflict.field === 'Status') {
          props['Status'] = { select: { name: history.status } };
        } else if (conflict.field === 'Thoughts / Review' && history.thoughts) {
          props['Thoughts'] = { rich_text: [{ text: { content: history.thoughts } }] };
        }

        if (Object.keys(props).length > 0) {
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
