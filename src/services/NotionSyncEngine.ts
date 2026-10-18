import { dbService } from './DatabaseService';
import { notionService } from './NotionIntegrationService';
import { NotionColumnMapping } from '../providers/interfaces';
import { NotionSyncConflict, NotionSyncResult, NotionSyncStateRecord } from '../types/notion';
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
   * Main Robust Bidirectional Synchronization Routine
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
    const nowSyncIso = new Date().toISOString();

    try {
      // 1. Fetch current Notion database pages
      let notionRows: any[] = [];
      try {
        notionRows = await notionService.fetchFromApi(token, databaseId);
      } catch (err: any) {
        throw new Error(`Failed to query Notion database: ${err.message || err}`);
      }

      // 2. Fetch local records and existing sync baselines
      const localHistories = dbService.getAllHistory();
      const localMediaList = dbService.getAllMedia();
      const syncStates = dbService.getAllNotionSyncStates();

      const syncStateByPageId = new Map<string, NotionSyncStateRecord>();
      for (const s of syncStates) {
        syncStateByPageId.set(s.pageId, s);
      }

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

      const remotePageIdSet = new Set<string>();

      // ----------------------------------------------------------------------
      // STEP A: Process Notion -> Local App Pull, Updates & Conflict Detection
      // ----------------------------------------------------------------------
      for (const row of notionRows) {
        const pageId = row['_page_id'];
        if (!pageId) continue;

        remotePageIdSet.add(pageId);

        const rawName = row[mapping.nameField] || row['Name'] || row['Title'] || '';
        const rawWatchedOn = row[mapping.watchedOnField] || row['Watched On'] || '';
        const rawScore = row[mapping.scoreField] || row['Score'] || '';
        const rawStatus = row[mapping.statusField] || row['Status'] || '';
        const rawThoughts = row[mapping.thoughtsField] || row['Thoughts'] || '';
        const isRemoteArchived = row['_archived'] === 'true';

        const existingHistory = historyByPageId.get(pageId);
        const baselineState = syncStateByPageId.get(pageId);

        if (existingHistory) {
          const targetMedia = mediaMap.get(existingHistory.media_id);
          const mediaTitle = targetMedia?.title || rawName;

          const remoteEditedIso = row['_last_edited_time'] || nowSyncIso;
          const remoteEditedTime = new Date(remoteEditedIso).getTime();

          const localCreatedIso = existingHistory.created_at;
          const localCreatedTime = new Date(localCreatedIso).getTime();

          const lastSyncedTime = baselineState ? new Date(baselineState.lastSyncedAt).getTime() : 0;

          const parsedScore = notionService.parseScore(rawScore);
          const parsedStatus = notionService.parseStatus(rawStatus);

          // Build canonical current snapshots
          const currentRemoteSnapshot = {
            score: parsedScore,
            status: parsedStatus,
            thoughts: rawThoughts.trim(),
            watchedOn: rawWatchedOn.trim(),
            title: rawName.trim()
          };

          const currentAppSnapshot = {
            score: existingHistory.score,
            status: existingHistory.status,
            thoughts: existingHistory.thoughts?.trim() || '',
            watchedOn: (existingHistory.completed_at || existingHistory.started_at || '').trim(),
            title: mediaTitle.trim()
          };

          // Determine modification flags relative to baseline
          let remoteChanged = false;
          let appChanged = false;

          if (baselineState) {
            const snap = baselineState.syncedFieldsSnapshot || {};
            remoteChanged =
              currentRemoteSnapshot.score !== snap.score ||
              currentRemoteSnapshot.status !== snap.status ||
              currentRemoteSnapshot.thoughts !== snap.thoughts ||
              currentRemoteSnapshot.watchedOn !== snap.watchedOn;

            appChanged =
              currentAppSnapshot.score !== snap.score ||
              currentAppSnapshot.status !== snap.status ||
              currentAppSnapshot.thoughts !== snap.thoughts ||
              currentAppSnapshot.watchedOn !== snap.watchedOn;
          } else {
            // Initial baseline setting: compare edit timestamps against baseline epoch
            remoteChanged = remoteEditedTime > localCreatedTime;
            appChanged = localCreatedTime > remoteEditedTime;
          }

          // Handle Conflict: BOTH sides changed since last sync
          if (remoteChanged && appChanged) {
            let hasConflict = false;

            if (currentRemoteSnapshot.score !== currentAppSnapshot.score) {
              this.activeConflicts.push({
                id: `conflict_${pageId}_score_${Date.now()}`,
                pageId,
                historyId: existingHistory.id,
                mediaId: existingHistory.media_id,
                mediaTitle,
                field: 'Score / Rating',
                notionValue: `${currentRemoteSnapshot.score ?? '(none)'} Stars`,
                appValue: `${currentAppSnapshot.score ?? '(none)'} Stars`,
                notionLastEdited: remoteEditedIso,
                appLastEdited: localCreatedIso
              });
              hasConflict = true;
            }

            if (currentRemoteSnapshot.status !== currentAppSnapshot.status) {
              this.activeConflicts.push({
                id: `conflict_${pageId}_status_${Date.now()}`,
                pageId,
                historyId: existingHistory.id,
                mediaId: existingHistory.media_id,
                mediaTitle,
                field: 'Status',
                notionValue: currentRemoteSnapshot.status,
                appValue: currentAppSnapshot.status,
                notionLastEdited: remoteEditedIso,
                appLastEdited: localCreatedIso
              });
              hasConflict = true;
            }

            if (currentRemoteSnapshot.thoughts !== currentAppSnapshot.thoughts) {
              this.activeConflicts.push({
                id: `conflict_${pageId}_thoughts_${Date.now()}`,
                pageId,
                historyId: existingHistory.id,
                mediaId: existingHistory.media_id,
                mediaTitle,
                field: 'Thoughts / Review',
                notionValue: currentRemoteSnapshot.thoughts,
                appValue: currentAppSnapshot.thoughts,
                notionLastEdited: remoteEditedIso,
                appLastEdited: localCreatedIso
              });
              hasConflict = true;
            }

            if (hasConflict) {
              conflictsCount++;
              continue; // Do not update baseline or DB until conflict is resolved
            }
          }

          // Handle Remote-Only Changes: Pull from Notion to App
          if (remoteChanged && !appChanged) {
            const { startedAt, completedAt } = notionService.parseDates(rawWatchedOn, parsedStatus);
            const updatedHistory: MediaHistory = {
              ...existingHistory,
              score: parsedScore !== undefined ? parsedScore : existingHistory.score,
              status: parsedStatus,
              thoughts: rawThoughts || existingHistory.thoughts,
              started_at: startedAt || existingHistory.started_at,
              completed_at: completedAt || existingHistory.completed_at
            };

            dbService.saveHistory(updatedHistory);
            importedCount++;

            // Save updated sync state baseline
            dbService.saveNotionSyncState({
              pageId,
              historyId: existingHistory.id,
              mediaId: existingHistory.media_id,
              lastSyncedAt: nowSyncIso,
              notionLastEditedAt: remoteEditedIso,
              appLastEditedAt: localCreatedIso,
              syncedFieldsSnapshot: {
                score: updatedHistory.score,
                status: updatedHistory.status,
                thoughts: (updatedHistory.thoughts || '').trim(),
                watchedOn: (updatedHistory.completed_at || updatedHistory.started_at || '').trim(),
                title: mediaTitle.trim()
              },
              archivedRemote: isRemoteArchived
            });
          }
          // Handle App-Only Changes: Push from App to Notion
          else if (appChanged && !remoteChanged) {
            try {
              const pageProps: Record<string, any> = {};

              if (existingHistory.score !== undefined) {
                pageProps[mapping.scoreField || 'Score /5'] = { number: existingHistory.score };
              }
              if (existingHistory.status) {
                pageProps[mapping.statusField || 'Status'] = { select: { name: existingHistory.status } };
              }
              if (existingHistory.thoughts) {
                pageProps[mapping.thoughtsField || 'Thoughts'] = {
                  rich_text: [{ text: { content: existingHistory.thoughts } }]
                };
              }

              if (existingHistory.started_at || existingHistory.completed_at) {
                pageProps[mapping.watchedOnField || 'Watched On/Completed Watching'] = {
                  date: {
                    start: existingHistory.started_at || existingHistory.completed_at,
                    end: existingHistory.started_at && existingHistory.completed_at ? existingHistory.completed_at : null
                  }
                };
              }

              if (Object.keys(pageProps).length > 0) {
                await notionService.updatePageProperties(token, pageId, pageProps);
                pushedCount++;
              }

              // Save updated sync state baseline
              dbService.saveNotionSyncState({
                pageId,
                historyId: existingHistory.id,
                mediaId: existingHistory.media_id,
                lastSyncedAt: nowSyncIso,
                notionLastEditedAt: nowSyncIso,
                appLastEditedAt: localCreatedIso,
                syncedFieldsSnapshot: currentAppSnapshot,
                archivedRemote: isRemoteArchived
              });
            } catch (pushErr: any) {
              errors.push(`Failed to push updates for "${mediaTitle}" to Notion: ${pushErr.message || pushErr}`);
            }
          } else {
            // Unchanged: Ensure baseline is recorded
            dbService.saveNotionSyncState({
              pageId,
              historyId: existingHistory.id,
              mediaId: existingHistory.media_id,
              lastSyncedAt: nowSyncIso,
              notionLastEditedAt: remoteEditedIso,
              appLastEditedAt: localCreatedIso,
              syncedFieldsSnapshot: currentAppSnapshot,
              archivedRemote: isRemoteArchived
            });
          }
        } else {
          // Brand New Notion Page: Import into Local Database
          const importResult = await notionService.importFromRows([row], mapping);
          importedCount += importResult.importedHistoryCount;

          if (importResult.errors.length > 0) {
            errors.push(...importResult.errors);
          }

          // Retrieve newly created history
          const newHistory = dbService.getAllHistory().find(h => h.original_source_record_id === pageId);
          if (newHistory) {
            dbService.saveNotionSyncState({
              pageId,
              historyId: newHistory.id,
              mediaId: newHistory.media_id,
              lastSyncedAt: nowSyncIso,
              notionLastEditedAt: row['_last_edited_time'] || nowSyncIso,
              appLastEditedAt: newHistory.created_at,
              syncedFieldsSnapshot: {
                score: newHistory.score,
                status: newHistory.status,
                thoughts: (newHistory.thoughts || '').trim(),
                watchedOn: (newHistory.completed_at || newHistory.started_at || '').trim(),
                title: rawName.trim()
              },
              archivedRemote: isRemoteArchived
            });
          }
        }
      }

      // ----------------------------------------------------------------------
      // STEP B: Process Local App -> Notion Push for Newly Created Local Records
      // ----------------------------------------------------------------------
      for (const h of localHistories) {
        if (!h.original_source_record_id) {
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
              pageProps[mapping.scoreField || 'Score /5'] = { number: h.score };
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

            // Save external ID mapping
            dbService.saveExternalId({
              id: `ext_notion_${newPageId}`,
              media_id: media.id,
              provider: 'Notion',
              external_id: newPageId
            });

            // Record initial sync baseline state
            dbService.saveNotionSyncState({
              pageId: newPageId,
              historyId: h.id,
              mediaId: media.id,
              lastSyncedAt: nowSyncIso,
              notionLastEditedAt: nowSyncIso,
              appLastEditedAt: h.created_at,
              syncedFieldsSnapshot: {
                score: h.score,
                status: h.status,
                thoughts: (h.thoughts || '').trim(),
                watchedOn: (h.completed_at || h.started_at || '').trim(),
                title: media.title.trim()
              },
              archivedRemote: false
            });

            pushedCount++;
          } catch (pushErr: any) {
            errors.push(`Failed to push local record "${media.title}" to Notion: ${pushErr.message || pushErr}`);
          }
        }
      }

      // ----------------------------------------------------------------------
      // STEP C: Check for Missing / Archived Remote Notion Pages
      // ----------------------------------------------------------------------
      for (const [pageId, syncState] of syncStateByPageId.entries()) {
        if (!remotePageIdSet.has(pageId)) {
          // Verify if remote page was archived or deleted
          try {
            const pageRes = await notionService.fetchNotionApi(`/pages/${pageId}`, token, { method: 'GET' });
            if (pageRes && pageRes.archived) {
              // Remote page is archived: update sync state without deleting local data
              dbService.saveNotionSyncState({
                ...syncState,
                archivedRemote: true,
                lastSyncedAt: nowSyncIso
              });
            }
          } catch (fetchErr: any) {
            if (fetchErr.status === 404 || fetchErr.message?.includes('404')) {
              // Page missing / deleted on Notion: keep local data, record missing status
              dbService.saveNotionSyncState({
                ...syncState,
                archivedRemote: true,
                lastSyncedAt: nowSyncIso
              });
            }
          }
        }
      }

      // Record overall sync status in settings
      dbService.saveSetting('notion_last_sync_time', nowSyncIso);
      dbService.saveSetting('notion_sync_errors', errors);

      return {
        importedCount,
        pushedCount,
        conflictsCount,
        errors,
        unmatchedInboxCount,
        timestamp: nowSyncIso
      };
    } catch (err: any) {
      console.error('Notion Sync Engine error:', err);
      throw err;
    }
  }

  /**
   * Resolves a conflict by explicitly applying chosen side's value ('notion' or 'app')
   * and updating the sync state baseline.
   */
  public async resolveConflict(
    conflict: NotionSyncConflict,
    resolution: 'notion' | 'app',
    token?: string
  ): Promise<void> {
    if (!conflict.historyId) return;

    const history = dbService.getAllHistory().find(h => h.id === conflict.historyId);
    if (!history) return;

    const nowIso = new Date().toISOString();

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
        throw err;
      }
    }

    // Update sync state baseline after successful resolution
    if (conflict.pageId) {
      const media = dbService.getMediaById(history.media_id);
      dbService.saveNotionSyncState({
        pageId: conflict.pageId,
        historyId: history.id,
        mediaId: history.media_id,
        lastSyncedAt: nowIso,
        notionLastEditedAt: nowIso,
        appLastEditedAt: history.created_at,
        syncedFieldsSnapshot: {
          score: history.score,
          status: history.status,
          thoughts: (history.thoughts || '').trim(),
          watchedOn: (history.completed_at || history.started_at || '').trim(),
          title: (media?.title || conflict.mediaTitle).trim()
        },
        archivedRemote: false
      });
    }

    // Remove resolved conflict from active conflicts list
    this.activeConflicts = this.activeConflicts.filter(c => c.id !== conflict.id);
  }
}

export const notionSyncEngine = new NotionSyncEngine();
