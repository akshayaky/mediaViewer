import { SkipSegmentBounds } from '../../types/media';
import { tmdbProvider } from '../../providers/TMDBProvider';

export interface IntroDbRequestParams {
  imdbId?: string;
  tmdbId?: string;
  mediaType: 'movie' | 'tv';
  season?: number;
  episode?: number;
}

export interface IntroDbResult {
  status: 'found' | 'not_found' | 'error';
  intro: SkipSegmentBounds | null;
  recap: SkipSegmentBounds | null;
  outro: SkipSegmentBounds | null;
  raw?: any;
  error?: string;
  resolvedImdbId?: string;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

async function smartFetch(url: string, init?: RequestInit): Promise<Response> {
  if (isTauri()) {
    try {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
      if (tauriFetch) {
        return await tauriFetch(url, init);
      }
    } catch {
      // Fall through to browser proxy fetch if plugin-http is unavailable
    }
  }

  // Web Browser / Vite dev mode: route requests through Vite dev server proxy to avoid CORS
  let targetUrl = url;
  if (url.startsWith('https://api.introdb.app')) {
    targetUrl = url.replace('https://api.introdb.app', '/introdb-api');
  }

  return await fetch(targetUrl, init);
}

export class IntroDbClient {
  private baseUrl = 'https://api.introdb.app';

  public async resolveImdbId(mediaType: 'movie' | 'tv', tmdbId: string): Promise<string | undefined> {
    try {
      const externalIds = await tmdbProvider.getExternalIds(mediaType, tmdbId);
      return externalIds.imdb_id || undefined;
    } catch (err) {
      console.warn('Could not resolve IMDb ID from TMDB for IntroDB lookup:', err);
      return undefined;
    }
  }

  /**
   * Helper to parse and validate start and end seconds from an IntroDB segment object.
   * IntroDB can supply start_sec/end_sec (seconds) or start_ms/end_ms (milliseconds).
   */
  public parseSegmentBounds(segment: any): SkipSegmentBounds | null {
    if (!segment || typeof segment !== 'object') return null;

    let start: number | undefined;
    let end: number | undefined;

    if (typeof segment.start_sec === 'number') {
      start = segment.start_sec;
    } else if (typeof segment.start_ms === 'number') {
      start = segment.start_ms / 1000;
    }

    if (typeof segment.end_sec === 'number') {
      end = segment.end_sec;
    } else if (typeof segment.end_ms === 'number') {
      end = segment.end_ms / 1000;
    }

    if (
      start !== undefined &&
      end !== undefined &&
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start >= 0 &&
      end > start
    ) {
      return { start, end };
    }

    return null;
  }

  /**
   * Fetches intro/outro timestamps from IntroDB.
   * Handles TV Shows (season/episode) and Movies (is_movie=true).
   * Does not assume TV intro timestamps apply to movies.
   */
  public async fetchSegments(params: IntroDbRequestParams): Promise<IntroDbResult> {
    const { mediaType, season = 1, episode = 1 } = params;
    let imdbId = params.imdbId?.trim();
    const tmdbId = params.tmdbId?.trim();

    // IntroDB TV lookups must use the series IMDb ID, never an episode IMDb ID.
    let resolvedImdbId: string | undefined = undefined;
    if (tmdbId && mediaType === 'tv') {
      imdbId = await this.resolveImdbId(mediaType, tmdbId);
      resolvedImdbId = imdbId;
    } else if (!imdbId && tmdbId) {
      imdbId = await this.resolveImdbId(mediaType, tmdbId);
      resolvedImdbId = imdbId;
    }

    // Build URL parameters
    const urlParams = new URLSearchParams();
    if (imdbId) {
      urlParams.set('imdb_id', imdbId);
    } else if (tmdbId) {
      // Fallback to passing tmdb_id if supported by the provider
      urlParams.set('tmdb_id', tmdbId.replace(/^(movie|tv):/, ''));
    } else {
      return {
        status: 'not_found',
        intro: null,
        recap: null,
        outro: null,
        error: 'No valid external ID (IMDb or TMDB) provided for IntroDB lookup.'
      };
    }

    if (mediaType === 'movie') {
      urlParams.set('is_movie', 'true');
    } else {
      urlParams.set('season', String(season));
      urlParams.set('episode', String(episode));
    }

    const requestUrl = `${this.baseUrl}/segments?${urlParams.toString()}`;

    try {
      const response = await smartFetch(requestUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      });

      if (response.status === 404) {
        return {
          status: 'not_found',
          intro: null,
          recap: null,
          outro: null,
          resolvedImdbId
        };
      }

      if (!response.ok) {
        return {
          status: 'error',
          intro: null,
          recap: null,
          outro: null,
          error: `IntroDB responded with status ${response.status}`,
          resolvedImdbId
        };
      }

      const data = await response.json();

      let introBounds: SkipSegmentBounds | null = null;
      const recapBounds = mediaType === 'tv' ? this.parseSegmentBounds(data.recap) : null;
      let outroBounds: SkipSegmentBounds | null = null;

      if (mediaType === 'tv') {
        introBounds = this.parseSegmentBounds(data.intro);
        outroBounds = this.parseSegmentBounds(data.outro);
      } else {
        // Movies: check whether IntroDB supports applicable movie segments (e.g. outro / credits).
        // Don't assume TV intro timestamps apply to movies.
        outroBounds = this.parseSegmentBounds(data.outro);
        // If IntroDB specifically returned an intro segment for the movie, parse it,
        // but default to null since movies generally do not have opening theme intros.
        if (data.intro && data.is_movie !== false) {
          introBounds = this.parseSegmentBounds(data.intro);
        }
      }

      const hasAnySegment = Boolean(introBounds || recapBounds || outroBounds);

      return {
        status: hasAnySegment ? 'found' : 'not_found',
        intro: introBounds,
        recap: recapBounds,
        outro: outroBounds,
        raw: data,
        resolvedImdbId
      };
    } catch (err: any) {
      console.warn(`IntroDB request failed for ${requestUrl}:`, err);
      return {
        status: 'error',
        intro: null,
        recap: null,
        outro: null,
        error: err?.message || 'Network error fetching from IntroDB',
        resolvedImdbId
      };
    }
  }
}

export const introDbClient = new IntroDbClient();
