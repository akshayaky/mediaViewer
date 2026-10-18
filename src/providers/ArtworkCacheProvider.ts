import { Media, MediaType } from '../types/media';
import { ArtworkProvider } from './interfaces';
import { tmdbProvider } from './TMDBProvider';
import { igdbProvider, fetchIGDBLogo } from './IGDBProvider';
import { STORAGE_KEYS } from '../constants/appConstants';

/**
 * Caches artwork results in memory and persists them to LocalStorage.
 * Resolves media artwork using a 3-tier priority sequence:
 * 1. Local Cache / Existing Database Artwork
 * 2. External Provider Lookup (TMDB / IGDB / Steam)
 * 3. Dynamic SVG Placeholder Artwork
 */

export interface ArtworkResult {
  poster?: string;
  backdrop?: string;
  logo?: string;
  source: 'local_cache' | 'metadata_provider' | 'placeholder';
}

export class ArtworkCacheProvider implements ArtworkProvider {
  public name = 'ArtworkCacheProvider';
  private memoryCache: Map<string, ArtworkResult> = new Map();

  constructor() {
    this.loadPersistentCache();
  }

  private loadPersistentCache() {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.ARTWORK_CACHE);
      if (stored) {
        const parsed = JSON.parse(stored);
        Object.keys(parsed).forEach(key => {
          this.memoryCache.set(key, parsed[key]);
        });
      }
    } catch (err) {
      console.warn('Failed to load artwork cache from localStorage:', err);
    }
  }

  private savePersistentCache() {
    try {
      const obj: Record<string, ArtworkResult> = {};
      this.memoryCache.forEach((val, key) => {
        if (val.source !== 'placeholder') {
          obj[key] = val;
        }
      });
      localStorage.setItem(STORAGE_KEYS.ARTWORK_CACHE, JSON.stringify(obj));
    } catch (err) {
      console.warn('Failed to save artwork cache to localStorage:', err);
    }
  }

  public getCachedArtwork(cacheKey: string): ArtworkResult | undefined {
    return this.memoryCache.get(cacheKey.toLowerCase());
  }

  public invalidateCache(cacheKey: string) {
    if (!cacheKey) return;
    this.memoryCache.delete(cacheKey.toLowerCase());
    this.savePersistentCache();
  }

  public setCachedArtwork(
    cacheKey: string,
    artwork: { poster?: string; backdrop?: string; logo?: string },
    source: 'local_cache' | 'metadata_provider' | 'placeholder' = 'local_cache'
  ) {
    if (!cacheKey) return;
    const result: ArtworkResult = {
      ...artwork,
      source
    };
    this.memoryCache.set(cacheKey.toLowerCase(), result);
    this.savePersistentCache();
  }

  public getPlaceholderArtwork(type: MediaType, title: string): ArtworkResult {
    const encodedTitle = encodeURIComponent(title);
    let color = '1e293b';
    if (type === 'Film') color = '881337';
    if (type === 'TV Series') color = '0369a1';
    if (type === 'VideoGame') color = '581c87';

    // SVG Data URI placeholder with dark theme styling
    const svgPoster = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750" viewBox="0 0 500 750"><rect width="500" height="750" fill="%23${color}"/><text x="50%" y="45%" dominant-baseline="middle" text-anchor="middle" fill="%23ffffff" font-family="sans-serif" font-size="28" font-weight="bold">${encodedTitle}</text><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="%2394a3b8" font-family="sans-serif" font-size="20">${type.toUpperCase()}</text></svg>`;

    return {
      poster: svgPoster,
      backdrop: undefined,
      logo: undefined,
      source: 'placeholder'
    };
  }

  /**
   * Resolves artwork for a media item following priority:
   * 1. Local cached artwork
   * 2. Metadata provider artwork
   * 3. Placeholder artwork
   */
  public async resolveArtworkForMedia(media: Media): Promise<ArtworkResult> {
    const cacheKey = media.id || media.title;

    // Priority 1: Check local cached artwork (excluding placeholders)
    const cached = this.getCachedArtwork(cacheKey);
    if (cached && cached.source !== 'placeholder' && (cached.poster || cached.backdrop || cached.logo)) {
      // IMPORTANT: If the media object itself has a more recent backdrop (e.g. manually changed), 
      // and it differs from the cache, prioritize the media object to avoid "stale image" bug.
      if (media.backdrop && cached.backdrop && media.backdrop !== cached.backdrop) {
        const updatedResult: ArtworkResult = {
          ...cached,
          backdrop: media.backdrop
        };
        this.setCachedArtwork(cacheKey, updatedResult, cached.source);
        return updatedResult;
      }
      return cached;
    }

    // Priority 1.5: If media object already has poster/backdrop/logo from database
    if (media.poster || media.backdrop || media.logo) {
      const dbResult: ArtworkResult = {
        poster: media.poster,
        backdrop: media.backdrop,
        logo: media.logo,
        source: 'local_cache'
      };
      this.setCachedArtwork(cacheKey, dbResult, 'local_cache');
      return dbResult;
    }

    // Priority 2: Fetch from Metadata provider
    try {
      const providerArtwork = await this.getArtwork(media.title, media.type);
      if (providerArtwork.poster || providerArtwork.backdrop || providerArtwork.logo) {
        const result: ArtworkResult = {
          ...providerArtwork,
          source: 'metadata_provider'
        };
        this.setCachedArtwork(cacheKey, result, 'metadata_provider');
        return result;
      }
    } catch (err) {
      console.warn(`Metadata provider artwork fetch failed for "${media.title}":`, err);
    }

    // Priority 3: Fallback placeholder artwork (do not persist as local_cache)
    return this.getPlaceholderArtwork(media.type, media.title);
  }

  public async getArtwork(
    mediaTitle: string,
    type: MediaType
  ): Promise<{ poster?: string; backdrop?: string; logo?: string }> {
    if (type === 'VideoGame') {
      const searchRes = await igdbProvider.searchMedia(mediaTitle, 'VideoGame');
      if (searchRes.length > 0) {
        const match = searchRes[0];
        const details = await igdbProvider.getMediaDetails(match.external_id);
        return {
          poster: details.poster || match.poster,
          backdrop: details.backdrop || match.backdrop,
          logo: details.logo
        };
      }
      const logo = await fetchIGDBLogo(mediaTitle);
      return { logo };
    } else {
      const searchRes = await tmdbProvider.searchMedia(mediaTitle, type);
      if (searchRes.length > 0) {
        const match = searchRes[0];
        const details = await tmdbProvider.getMediaDetails(match.external_id);
        return {
          poster: details.poster || match.poster,
          backdrop: details.backdrop || match.backdrop,
          logo: details.logo
        };
      }
    }

    return {};
  }
}

export const artworkCacheProvider = new ArtworkCacheProvider();
