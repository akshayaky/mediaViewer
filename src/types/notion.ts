export interface NotionDatabase {
  id: string;
  title: string;
  icon?: string;
  description?: string;
  created_time?: string;
  last_edited_time?: string;
  url?: string;
  properties: Record<string, NotionPropertySchema>;
}

export interface NotionPropertySchema {
  id: string;
  name: string;
  type: 'title' | 'rich_text' | 'number' | 'select' | 'multi_select' | 'date' | 'status' | 'url' | 'checkbox' | 'people' | 'files' | string;
  select?: { options: { id: string; name: string; color?: string }[] };
  status?: { options: { id: string; name: string; color?: string }[] };
}

export interface NotionPagePropertyValue {
  type: string;
  title?: Array<{ plain_text: string }>;
  rich_text?: Array<{ plain_text: string }>;
  select?: { name: string } | null;
  status?: { name: string } | null;
  number?: number | null;
  date?: { start: string; end?: string | null } | null;
}

export interface NotionPage {
  id: string;
  created_time: string;
  last_edited_time: string;
  url: string;
  archived: boolean;
  properties: Record<string, NotionPagePropertyValue>;
}

export interface NotionSyncStateRecord {
  pageId: string;
  historyId: string;
  mediaId: string;
  lastSyncedAt: string;
  notionLastEditedAt: string;
  appLastEditedAt: string;
  syncedFieldsSnapshot: Record<string, any>;
  archivedRemote?: boolean;
}

export interface NotionSyncConflict {
  id: string;
  pageId: string;
  historyId?: string;
  mediaId?: string;
  mediaTitle: string;
  field: string;
  notionValue: string;
  appValue: string;
  notionLastEdited: string;
  appLastEdited: string;
}

export interface NotionSyncResult {
  importedCount: number;
  pushedCount: number;
  conflictsCount: number;
  errors: string[];
  unmatchedInboxCount: number;
  timestamp: string;
}
