import { MediaType } from '../types/media';
import { MetadataSearchOptions, MetadataSearchResult } from '../providers/interfaces';
import { igdbProvider } from '../providers/IGDBProvider';
import { tmdbProvider } from '../providers/TMDBProvider';

export async function searchMediaMetadata(
  query: string,
  type: MediaType,
  options: MetadataSearchOptions = {}
): Promise<MetadataSearchResult[]> {
  if (type === 'VideoGame') {
    return igdbProvider.searchMedia(query, type, options);
  }

  return tmdbProvider.searchMedia(query, type, options);
}

export function getMetadataSearchKey(query: string, options: MetadataSearchOptions): string {
  return JSON.stringify([query.trim(), options.releaseYear ?? null, options.language?.toLowerCase() ?? null]);
}
