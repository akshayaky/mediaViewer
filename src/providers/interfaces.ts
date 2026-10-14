import { Media, LocalFile, Availability, Wishlist, MediaType } from '../types/media';

export interface MetadataSearchResult {
  title: string;
  original_title?: string;
  release_year?: number;
  type: MediaType;
  description?: string;
  poster?: string;
  backdrop?: string;
  external_id: string;
  provider: string;
}

export interface MetadataProvider {
  name: string;
  searchMedia(query: string, type?: MediaType): Promise<MetadataSearchResult[]>;
  getMediaDetails(externalId: string): Promise<Partial<Media>>;
  getRelatedMedia?(externalId: string): Promise<MetadataSearchResult[]>;
}

export interface ArtworkProvider {
  name: string;
  getArtwork(mediaTitle: string, type: MediaType): Promise<{ poster?: string; backdrop?: string; logo?: string }>;
}

export interface AvailabilityProvider {
  name: string;
  getAvailability(mediaTitle: string, type: MediaType, region?: string): Promise<Availability[]>;
}

export interface NotionImportRow {
  Type: string;
  Name: string;
  'Watched On/Completed Watching'?: string;
  'Score /5'?: string;
  Status?: string;
  Language?: string;
  Thoughts?: string;
  Publisher?: string;
  [key: string]: string | undefined;
}

export interface NotionColumnMapping {
  typeField: string;
  nameField: string;
  watchedOnField: string;
  scoreField: string;
  statusField: string;
  languageField: string;
  thoughtsField: string;
  publisherField: string;
}

export interface NotionImportResult {
  totalRows: number;
  importedMediaCount: number;
  importedHistoryCount: number;
  rawRecordsSaved: number;
  errors: string[];
}

export interface NotionProvider {
  parseTitle(rawTitle: string): { cleanTitle: string; contextNote?: string };
  importFromRows(rows: NotionImportRow[], mapping?: Partial<NotionColumnMapping>): Promise<NotionImportResult>;
  fetchFromApi?(integrationToken: string, databaseId: string): Promise<NotionImportRow[]>;
}

export interface LocalLibraryScanner {
  scanDirectory(path: string, mediaType: MediaType): Promise<LocalFile[]>;
}

export interface WishlistProvider {
  name: string;
  fetchWishlistItems(): Promise<Wishlist[]>;
}
