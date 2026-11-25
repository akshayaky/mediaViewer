import { Media, MediaSkipSegments } from '../../types/media';
import { dbService } from '../DatabaseService';
import { introDbClient, IntroDbResult } from './IntroDbClient';
import { tmdbProvider } from '../../providers/TMDBProvider';

export interface GetSkipSegmentsOptions {
  media: Media;
  season?: number;
  episode?: number;
  forceRefresh?: boolean;
}

export class SkipSegmentCache {
  private pendingTmdbIdLookups = new Map<string, Promise<string | undefined>>();

  /**
   * Resolves the primary external IDs (IMDb ID, TMDB ID, and stable key) for a media item.
   */
  public extractExternalIds(media: Media): { imdbId?: string; tmdbId?: string; stableExternalId: string } {
    let imdbId: string | undefined;
    let tmdbId: string | undefined;

    if (media.external_ids && media.external_ids.length > 0) {
      for (const ext of media.external_ids) {
        const val = ext.external_id?.trim();
        if (!val) continue;

        if (ext.provider === 'IMDb' || val.startsWith('tt')) {
          imdbId = val;
        } else if (ext.provider === 'TMDB') {
          tmdbId = val;
        }
      }
    }

    const stableExternalId = imdbId || tmdbId || media.id;
    return { imdbId, tmdbId, stableExternalId };
  }

  private normalizeTitle(title: string): string {
    return title.toLocaleLowerCase().replace(/[\W_]+/g, ' ').trim();
  }

  private async findUniqueTmdbMatch(media: Media): Promise<string | undefined> {
    const lookupKey = `${media.id}:${media.title}:${media.release_year ?? ''}`;
    const pendingLookup = this.pendingTmdbIdLookups.get(lookupKey);
    if (pendingLookup) return pendingLookup;

    const lookup = (async (): Promise<string | undefined> => {
      try {
        const results = await tmdbProvider.searchMedia(
          media.title,
          media.type,
          media.release_year ? { releaseYear: media.release_year } : {}
        );
        const expectedTitles = new Set(
          [media.title, media.original_title]
            .filter((title): title is string => Boolean(title?.trim()))
            .map(title => this.normalizeTitle(title))
            .filter(Boolean)
        );
        const matches = new Map<string, string>();

        for (const result of results) {
          const titleMatches = [result.title, result.original_title]
            .filter((title): title is string => Boolean(title?.trim()))
            .some(title => expectedTitles.has(this.normalizeTitle(title)));
          if (
            result.provider === 'TMDB' &&
            result.type === media.type &&
            result.external_id &&
            titleMatches &&
            (!media.release_year || result.release_year === media.release_year)
          ) {
            matches.set(result.external_id, result.external_id);
          }
        }

        return matches.size === 1 ? matches.keys().next().value : undefined;
      } catch (err) {
        console.warn(`TMDB lookup failed while resolving "${media.title}" for IntroDB:`, err);
        return undefined;
      }
    })();

    this.pendingTmdbIdLookups.set(lookupKey, lookup);
    try {
      return await lookup;
    } finally {
      this.pendingTmdbIdLookups.delete(lookupKey);
    }
  }

  /**
   * Evaluates whether a cached skip segment record is valid.
   * Returns true for valid 'found' segments (with positive, logical bounds)
   * and valid 'not_found' records (avoiding repeated requests for unavailable segments).
   * Returns false for corrupt data or error statuses.
   */
  public isCacheValid(cached: MediaSkipSegments | null): boolean {
    if (!cached) return false;

    if (cached.status === 'not_found') {
      return true;
    }

    if (cached.status === 'found') {
      const introValid = !cached.intro || (
        cached.intro.start >= 0 &&
        cached.intro.end > cached.intro.start &&
        Number.isFinite(cached.intro.start) &&
        Number.isFinite(cached.intro.end)
      );

      const outroValid = !cached.outro || (
        cached.outro.start >= 0 &&
        cached.outro.end > cached.outro.start &&
        Number.isFinite(cached.outro.start) &&
        Number.isFinite(cached.outro.end)
      );
      const recapValid = !cached.recap || (
        cached.recap.start >= 0 &&
        cached.recap.end > cached.recap.start &&
        Number.isFinite(cached.recap.start) &&
        Number.isFinite(cached.recap.end)
      );

      const hasAtLeastOneValidSegment = Boolean(cached.intro || cached.recap || cached.outro);

      return introValid && recapValid && outroValid && hasAtLeastOneValidSegment;
    }

    return false;
  }

  /**
   * Retrieves skip segments from local SQLite cache if available and valid.
   * If missing, invalid, or forceRefresh is true, fetches from IntroDB and caches the result in SQLite.
   */
  public async getOrFetchSkipSegments(options: GetSkipSegmentsOptions): Promise<MediaSkipSegments | null> {
    const { media, forceRefresh = false } = options;
    const mediaType: 'movie' | 'tv' = media.type === 'Film' ? 'movie' : 'tv';
    const season = mediaType === 'movie' ? 0 : (options.season ?? 1);
    const episode = mediaType === 'movie' ? 0 : (options.episode ?? 1);

    let { imdbId, tmdbId } = this.extractExternalIds(media);
    if ((!imdbId || !tmdbId) && media.id) {
      try {
        const storedIds = this.extractExternalIds({
          ...media,
          external_ids: await dbService.getExternalIdsForMedia(media.id)
        });
        imdbId = imdbId || storedIds.imdbId;
        tmdbId = tmdbId || storedIds.tmdbId;
      } catch (err) {
        console.warn('Failed reading external IDs for IntroDB lookup:', err);
      }
    }

    if (!imdbId && !tmdbId) {
      tmdbId = await this.findUniqueTmdbMatch(media);
      if (tmdbId && media.id) {
        try {
          await dbService.saveExternalId({
            id: `ext_tmdb_${media.id}`,
            media_id: media.id,
            provider: 'TMDB',
            external_id: tmdbId
          });
        } catch (err) {
          console.warn('Failed saving the resolved TMDB ID for IntroDB lookup:', err);
        }
      }
    }

    if (mediaType === 'tv' && tmdbId) {
      const previousImdbId = imdbId;
      imdbId = await introDbClient.resolveImdbId('tv', tmdbId);
      if (imdbId && imdbId !== previousImdbId && media.id) {
        try {
          await dbService.deleteSkipSegmentsForMedia(media.id);
        } catch (err) {
          console.warn('Failed clearing skip segments cached with a non-series IMDb ID:', err);
        }
      }
      if (imdbId && media.id) {
        try {
          const linkedMedia = await dbService.getMediaByExternalId('IMDb', imdbId);
          if (!linkedMedia || linkedMedia.id === media.id) {
            await dbService.replaceExternalIdsForMedia(media.id, 'IMDb', imdbId);
          }
        } catch (err) {
          console.warn('Failed updating the series IMDb ID for IntroDB lookup:', err);
        }
      }
    }

    const stableExternalId = imdbId || tmdbId;
    if (!stableExternalId) {
      console.warn(`Cannot fetch IntroDB skip segments for "${media.title}": no linked ID or unique exact TMDB match was found.`);
      return null;
    }
    const externalIds = [imdbId, tmdbId].filter((id): id is string => Boolean(id));

    // 1. Check local SQLite cache
    let cached: MediaSkipSegments | null = null;
    try {
      if (media.id) {
        cached = await dbService.getSkipSegments(media.id, season, episode);
        if (cached && !externalIds.includes(cached.external_id)) {
          cached = null;
        }
      }
      for (const externalId of externalIds) {
        if (cached) break;
        cached = await dbService.getSkipSegmentsByExternalId(externalId, season, episode);
      }
    } catch (err) {
      console.warn('Failed reading skip segments from SQLite cache:', err);
    }

    // 2. Return cache if valid and refresh not requested
    if (!forceRefresh && this.isCacheValid(cached)) {
      return cached;
    }

    // 3. Fetch from IntroDB
    let result: IntroDbResult;
    try {
      result = await introDbClient.fetchSegments({
        imdbId,
        tmdbId: mediaType === 'tv' && imdbId ? undefined : tmdbId,
        mediaType,
        season: mediaType === 'tv' ? season : undefined,
        episode: mediaType === 'tv' ? episode : undefined
      });
    } catch (err: any) {
      console.warn('Unexpected error from IntroDB client:', err);
      result = {
        status: 'error',
        intro: null,
        recap: null,
        outro: null,
        error: err?.message || 'Error fetching segments'
      };
    }

    // 4. Save resolved IMDb ID if newly discovered
    if (result.resolvedImdbId && media.id) {
      try {
        await dbService.saveExternalId({
          id: `ext_imdb_${Date.now()}`,
          media_id: media.id,
          provider: 'IMDb',
          external_id: result.resolvedImdbId
        });
      } catch (err) {
        console.warn('Failed saving resolved IMDb ID to external_ids:', err);
      }
    }

    // 5. Cache the result in SQLite
    const finalExternalId = result.resolvedImdbId || stableExternalId;
    const skipRecord: MediaSkipSegments = {
      id: cached?.id || `skip_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      media_id: media.id,
      external_id: finalExternalId,
      provider: 'IntroDB',
      media_type: mediaType,
      season,
      episode,
      intro: result.intro,
      recap: result.recap,
      outro: result.outro,
      status: result.status,
      updated_at: new Date().toISOString(),
      raw_data: result.raw ? JSON.stringify(result.raw) : undefined
    };

    try {
      await dbService.saveSkipSegments(skipRecord);
    } catch (err) {
      console.error('Failed saving skip segments to SQLite cache:', err);
    }

    return skipRecord;
  }

  /**
   * Asynchronously preloads and caches timestamps in the background without blocking execution.
   */
  public preloadSkipSegments(media: Media, season?: number, episode?: number): void {
    if (!media || media.type === 'VideoGame') return;

    this.getOrFetchSkipSegments({ media, season, episode })
      .catch(err => {
        console.warn(`Background skip segment prefetch failed for "${media.title}":`, err);
      });
  }
}

export const skipSegmentCache = new SkipSegmentCache();
