import { Media, MediaType } from '../types/media';
import { MetadataSearchOptions, MetadataSearchResult } from '../providers/interfaces';
import { igdbProvider } from '../providers/IGDBProvider';
import { tmdbProvider } from '../providers/TMDBProvider';
import { dbService } from './DatabaseService';

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

export async function addMetadataResultToLibrary(candidate: MetadataSearchResult): Promise<Media> {
  const existing = await dbService.getMediaByExternalId(candidate.provider, candidate.external_id);
  if (existing) return existing;

  const provider = candidate.type === 'VideoGame' ? igdbProvider : tmdbProvider;
  const details = await provider.getMediaDetails(candidate.external_id);
  const now = new Date().toISOString();
  const mediaId = `media_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const media: Media = {
    id: mediaId,
    type: candidate.type,
    title: details.title || candidate.title,
    original_title: details.original_title || candidate.original_title,
    release_year: details.release_year || candidate.release_year,
    description: details.description || candidate.description,
    genres: details.genres || [],
    runtime: details.runtime,
    poster: details.poster || candidate.poster,
    backdrop: details.backdrop || candidate.backdrop,
    logo: details.logo,
    publisher: details.publisher,
    developer: details.developer,
    cast: details.cast,
    seasons: details.seasons,
    language: details.language || candidate.language || undefined,
    metadata_source: details.metadata_source || candidate.provider,
    metadata_refreshed_at: now,
    created_at: now,
    updated_at: now,
    external_ids: [{
      id: `ext_${Date.now()}`,
      media_id: mediaId,
      provider: candidate.provider,
      external_id: candidate.external_id
    }]
  };

  await dbService.saveMedia(media);
  await dbService.saveHistory({
    id: `hist_${Date.now()}`,
    media_id: mediaId,
    status: 'Planned',
    source: 'Manual',
    created_at: now,
    updated_at: now
  });
  window.dispatchEvent(new CustomEvent('library-scanned'));
  return media;
}
