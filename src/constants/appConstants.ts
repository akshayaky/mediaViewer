import { NotionColumnMapping } from '../providers/interfaces';

/** Sidebar / Navigation responsive breakpoint in pixels */
export const SIDEBAR_BREAKPOINT = 900;

/** Storage keys for LocalStorage persistence */
export const STORAGE_KEYS = {
  SQLITE_DB: 'my_media_library_sqlite_db',
  ARTWORK_CACHE: 'my_media_library_artwork_cache_v1'
} as const;

/** Default media directory paths */
export const DEFAULT_FOLDERS = {
  MOVIES: 'C:\\Media\\Movies',
  TV_SHOWS: 'C:\\Media\\TV Shows',
  GAMES: 'D:\\Games'
} as const;

/** Default Notion CSV importer column mapping */
export const DEFAULT_NOTION_COLUMN_MAPPING: NotionColumnMapping = {
  typeField: 'Type',
  nameField: 'Name',
  watchedOnField: 'Watched On/Completed Watching',
  scoreField: 'Score /5',
  statusField: 'Status',
  languageField: 'Language',
  thoughtsField: 'Thoughts',
  publisherField: 'Publisher'
} as const;

/** Supported file extension groups */
export const FILE_EXTENSIONS = {
  VIDEO: ['mkv', 'mp4', 'avi', 'mov', 'm4v', 'webm', 'ts', 'm2ts', 'flv'],
  GAME: ['exe', 'lnk', 'iso', 'bin']
} as const;
