import { Media, MediaType, CastMember, Season, Episode } from '../types/media';
import { MetadataProvider, MetadataSearchOptions, MetadataSearchResult } from './interfaces';
import { dbService } from '../services/DatabaseService';
import { searchWithProgressiveTrim } from './searchUtils';

export interface TMDBLanguage {
  iso_639_1: string;
  english_name: string;
  name: string;
}

export class TMDBProvider implements MetadataProvider {
  public name = 'TMDB';
  private baseUrl = 'https://api.themoviedb.org/3';
  private imageBaseUrl = 'https://image.tmdb.org/t/p';
  private languageMap: Record<string, string> = {};
  private languages: TMDBLanguage[] | null = null;
  private languagesRequest: Promise<TMDBLanguage[]> | null = null;

  private async initLanguages(): Promise<void> {
    if (this.languages) return;

    try {
      await this.getLanguages();
    } catch (err) {
      console.warn('TMDB failed to load language configuration:', err);
    }
  }

  public async getLanguages(): Promise<TMDBLanguage[]> {
    if (this.languages) return this.languages;
    if (this.languagesRequest) return this.languagesRequest;

    this.languagesRequest = (async () => {
      const { url, headers } = await this.getFetchConfig('/configuration/languages');
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`TMDB language configuration returned ${response.status}`);
      }

      const languages = await response.json() as TMDBLanguage[];
      this.languages = languages
        .filter(language => language.iso_639_1 && language.english_name)
        .sort((a, b) => a.english_name.localeCompare(b.english_name));
      this.languageMap = Object.fromEntries(
        this.languages.map(language => [language.iso_639_1.toLowerCase(), language.english_name])
      );
      return this.languages;
    })();

    try {
      return await this.languagesRequest;
    } finally {
      this.languagesRequest = null;
    }
  }

  private async getApiKey(): Promise<string | undefined> {
    const key = (await dbService.getSettings()).tmdb_api_key;
    return key ? key.trim() : undefined;
  }

  private async getFetchConfig(endpoint: string, params: Record<string, string> = {}): Promise<{ url: string; headers: Record<string, string> }> {
    const key = (await this.getApiKey()) || '';
    const urlParams = new URLSearchParams(params);
    const headers: Record<string, string> = {
      'Accept': 'application/json'
    };

    if (key.startsWith('eyJ')) {
      // TMDB v4 Bearer Read Access Token
      headers['Authorization'] = `Bearer ${key}`;
    } else if (key) {
      // TMDB v3 API Key
      urlParams.set('api_key', key);
    }

    const queryString = urlParams.toString();
    const url = `${this.baseUrl}${endpoint}${queryString ? '?' + queryString : ''}`;
    return { url, headers };
  }

  private getLanguageName(isoCode: string): string {
    return this.languageMap[isoCode.toLowerCase()] || isoCode.toUpperCase();
  }

  private cleanQueryString(rawQuery: string): string {
    let q = rawQuery;
    // Strip brackets and parentheses
    q = q.replace(/\[[^\]]*\]/g, ' ').replace(/\([^\)]*\)/g, ' ');
    // Strip file extension if present
    q = q.replace(/\.(mkv|mp4|avi|mov|m4v|webm|ts|flv)$/i, '');
    // Strip common release noise
    const noiseRegex = /\b(1080p|720p|480p|2160p|4k|uhd|webrip|web-dl|webdl|bluray|blu-ray|remux|x264|x265|hevc|h264|h265|av1|10bit|hdr|hdr10|dv|aac|dts|dd5\.1|5\.1|dvdrip|hdrip|hdtv|proper|repack|yify|rarbg|eztv|sva|fleet|shortcut|game|dual|multi|audio|subbed|dubbed|esub|eng|sub|directors|director|cut|uncut|extended|edition|version)\b/gi;
    q = q.replace(noiseRegex, ' ');
    q = q.replace(/[\._\-]/g, ' ').replace(/\s+/g, ' ').trim();
    return q;
  }

  private async searchSingleTypeWithProgressiveTrim(
    rawQuery: string,
    endpoint: '/search/movie' | '/search/tv',
    mediaType: 'Film' | 'TV Series',
    options: MetadataSearchOptions
  ): Promise<MetadataSearchResult[]> {
    const initialClean = this.cleanQueryString(rawQuery);
    if (!initialClean) return [];

    const languageCode = (options.originalLanguage || options.language?.split('-')[0])?.toLowerCase();
    const locale = options.language;
    const releaseYear = options.releaseYear;

    return searchWithProgressiveTrim(rawQuery, initialClean, async currentQuery => {
      const params: Record<string, string> = {
        query: currentQuery,
        include_adult: 'false'
      };
      if (locale) params.language = locale;
      if (releaseYear) {
        params[endpoint === '/search/movie' ? 'year' : 'first_air_date_year'] = String(releaseYear);
      }

      const { url, headers } = await this.getFetchConfig(endpoint, params);

      try {
        const res = await fetch(url, { headers });
        if (res.ok) {
          const data = await res.json();
          const items = data.results || [];
          if (items.length > 0) {
            return items
              .filter((item: any) => !languageCode || item.original_language === languageCode)
              .slice(0, 8)
              .map((item: any) => {
                const yearStr = endpoint === '/search/movie' ? item.release_date : item.first_air_date;
                const yearNum = yearStr ? parseInt(yearStr.split('-')[0], 10) : undefined;
                return {
                  title: endpoint === '/search/movie' ? item.title : item.name,
                  original_title: endpoint === '/search/movie' ? item.original_title : item.original_name,
                  release_year: yearNum && !isNaN(yearNum) ? yearNum : undefined,
                  language: item.original_language,
                  type: mediaType,
                  description: item.overview,
                  poster: item.poster_path ? `${this.imageBaseUrl}/w500${item.poster_path}` : undefined,
                  backdrop: item.backdrop_path ? `${this.imageBaseUrl}/w1280${item.backdrop_path}` : undefined,
                  external_id: `${endpoint === '/search/movie' ? 'movie' : 'tv'}:${item.id}`,
                  provider: this.name
                };
              });
          }
        }
      } catch (err) {
        console.warn(`TMDB progressive search failed for query '${currentQuery}':`, err);
      }
      return [];
    });
  }

  public async searchMedia(
    query: string,
    type?: MediaType,
    options: MetadataSearchOptions = {}
  ): Promise<MetadataSearchResult[]> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return [];

    const results: MetadataSearchResult[] = [];

    try {
      if (options.cast) {
        return await this.searchMediaByCast(query, type, options);
      }

      if (!type || type === 'Film') {
        const movieResults = await this.searchSingleTypeWithProgressiveTrim(query, '/search/movie', 'Film', options);
        results.push(...movieResults);
      }

      if (!type || type === 'TV Series') {
        const tvResults = await this.searchSingleTypeWithProgressiveTrim(query, '/search/tv', 'TV Series', options);
        results.push(...tvResults);
      }
    } catch (err) {
      console.error('TMDB searchMedia failed:', err);
      return [];
    }

    return results;
  }

  private async searchMediaByCast(
    query: string,
    type: MediaType | undefined,
    options: MetadataSearchOptions
  ): Promise<MetadataSearchResult[]> {
    if (type === 'VideoGame') return [];

    const { url, headers } = await this.getFetchConfig('/search/person', {
      query: options.cast || '',
      include_adult: 'false'
    });
    const personResponse = await fetch(url, { headers });
    if (!personResponse.ok) {
      throw new Error(`TMDB person search returned ${personResponse.status}`);
    }

    const people = await personResponse.json() as { results?: Array<{ id: number; name: string }> };
    const matchingPeople = (people.results || [])
      .filter(person => person.name.toLocaleLowerCase().includes((options.cast || '').toLocaleLowerCase()))
      .slice(0, 5);
    const queryText = query.trim().toLocaleLowerCase();
    const languageCode = (options.originalLanguage || options.language?.split('-')[0])?.toLowerCase();
    const results: MetadataSearchResult[] = [];

    for (const person of matchingPeople) {
      const mediaTypes: MediaType[] = [];
      if (!type || type === 'Film') mediaTypes.push('Film');
      if (!type || type === 'TV Series') mediaTypes.push('TV Series');

      for (const mediaType of mediaTypes) {
        const creditType = mediaType === 'Film' ? 'movie_credits' : 'tv_credits';
        const creditConfig = await this.getFetchConfig(`/person/${person.id}/${creditType}`);
        const creditResponse = await fetch(creditConfig.url, { headers: creditConfig.headers });
        if (!creditResponse.ok) {
          throw new Error(`TMDB cast credits returned ${creditResponse.status}`);
        }

        const credits = await creditResponse.json() as { cast?: Array<Record<string, any>> };
        for (const credit of credits.cast || []) {
          const title = String(mediaType === 'Film' ? credit.title || '' : credit.name || '');
          const originalTitle = String(mediaType === 'Film'
            ? credit.original_title || ''
            : credit.original_name || '');
          if (queryText && !`${title} ${originalTitle}`.toLocaleLowerCase().includes(queryText)) continue;
          if (languageCode && String(credit.original_language || '').toLowerCase() !== languageCode) continue;

          const externalId = `${mediaType === 'Film' ? 'movie' : 'tv'}:${credit.id}`;
          if (results.some(result => result.external_id === externalId)) continue;
          const date = mediaType === 'Film' ? credit.release_date : credit.first_air_date;
          const year = date ? Number.parseInt(String(date).split('-')[0], 10) : undefined;
          if (options.releaseYear && year !== options.releaseYear) continue;
          results.push({
            title,
            original_title: originalTitle,
            release_year: year && !Number.isNaN(year) ? year : undefined,
            language: credit.original_language,
            type: mediaType,
            description: credit.overview,
            poster: credit.poster_path ? `${this.imageBaseUrl}/w500${credit.poster_path}` : undefined,
            backdrop: credit.backdrop_path ? `${this.imageBaseUrl}/w1280${credit.backdrop_path}` : undefined,
            external_id: externalId,
            provider: this.name,
            cast: [{ id: `cast_${person.id}`, name: person.name }]
          });
        }
      }
    }

    return results.slice(0, 30);
  }

  public async getRelatedMedia(externalId: string): Promise<MetadataSearchResult[]> {
    const apiKey = await this.getApiKey();

    let mediaType: 'movie' | 'tv' = 'movie';
    let tmdbId = externalId;

    if (externalId.startsWith('movie:')) {
      mediaType = 'movie';
      tmdbId = externalId.replace('movie:', '');
    } else if (externalId.startsWith('tv:')) {
      mediaType = 'tv';
      tmdbId = externalId.replace('tv:', '');
    }

    if (!apiKey || !/^\d+$/.test(tmdbId)) {
      return [];
    }

    try {
      const results: MetadataSearchResult[] = [];

      if (mediaType === 'movie') {
        const { url, headers } = await this.getFetchConfig(`/movie/${tmdbId}`, {
          append_to_response: 'belongs_to_collection,recommendations'
        });
        const res = await fetch(url, { headers });
        if (res.ok) {
          const data = await res.json();

          if (data.belongs_to_collection && data.belongs_to_collection.id) {
            const collectionFetch = await this.getFetchConfig(`/collection/${data.belongs_to_collection.id}`);
            const colRes = await fetch(collectionFetch.url, { headers: collectionFetch.headers });
            if (colRes.ok) {
              const colData = await colRes.json();
              if (colData.parts && colData.parts.length > 0) {
                colData.parts.forEach((p: any) => {
                  if (String(p.id) !== tmdbId) {
                    const releaseYear = p.release_date ? parseInt(p.release_date.split('-')[0], 10) : undefined;
                    results.push({
                      title: p.title,
                      original_title: p.original_title,
                      release_year: releaseYear && !isNaN(releaseYear) ? releaseYear : undefined,
                      type: 'Film',
                      description: p.overview,
                      poster: p.poster_path ? `${this.imageBaseUrl}/w500${p.poster_path}` : undefined,
                      backdrop: p.backdrop_path ? `${this.imageBaseUrl}/w1280${p.backdrop_path}` : undefined,
                      external_id: `movie:${p.id}`,
                      provider: this.name
                    });
                  }
                });
              }
            }
          }

          if (results.length === 0 && data.recommendations && data.recommendations.results) {
            data.recommendations.results.slice(0, 6).forEach((rec: any) => {
              if (String(rec.id) !== tmdbId) {
                const releaseYear = rec.release_date ? parseInt(rec.release_date.split('-')[0], 10) : undefined;
                results.push({
                  title: rec.title,
                  original_title: rec.original_title,
                  release_year: releaseYear && !isNaN(releaseYear) ? releaseYear : undefined,
                  type: 'Film',
                  description: rec.overview,
                  poster: rec.poster_path ? `${this.imageBaseUrl}/w500${rec.poster_path}` : undefined,
                  backdrop: rec.backdrop_path ? `${this.imageBaseUrl}/w1280${rec.backdrop_path}` : undefined,
                  external_id: `movie:${rec.id}`,
                  provider: this.name
                });
              }
            });
          }
        }
      } else {
        const { url, headers } = await this.getFetchConfig(`/tv/${tmdbId}/recommendations`);
        const res = await fetch(url, { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.results && data.results.length > 0) {
            data.results.slice(0, 6).forEach((rec: any) => {
              if (String(rec.id) !== tmdbId) {
                const releaseYear = rec.first_air_date ? parseInt(rec.first_air_date.split('-')[0], 10) : undefined;
                results.push({
                  title: rec.name,
                  original_title: rec.original_name,
                  release_year: releaseYear && !isNaN(releaseYear) ? releaseYear : undefined,
                  type: 'TV Series',
                  description: rec.overview,
                  poster: rec.poster_path ? `${this.imageBaseUrl}/w500${rec.poster_path}` : undefined,
                  backdrop: rec.backdrop_path ? `${this.imageBaseUrl}/w1280${rec.backdrop_path}` : undefined,
                  external_id: `tv:${rec.id}`,
                  provider: this.name
                });
              }
            });
          }
        }
      }

      if (results.length > 0) {
        return results;
      }
    } catch (err) {
      console.warn('TMDB getRelatedMedia failed:', err);
    }

    return [];
  }

  public async getBackdrops(externalId: string): Promise<{ url: string; thumbnailUrl: string; width: number; height: number }[]> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return [];

    let mediaType: 'movie' | 'tv' = 'movie';
    let tmdbId = externalId;

    if (externalId.startsWith('movie:')) {
      mediaType = 'movie';
      tmdbId = externalId.replace('movie:', '');
    } else if (externalId.startsWith('tv:')) {
      mediaType = 'tv';
      tmdbId = externalId.replace('tv:', '');
    }
    console.log(externalId);
    try {
      const { url, headers } = await this.getFetchConfig(`/${mediaType}/${tmdbId}/images`, {
        include_image_language: 'en,null'
      });
      const res = await fetch(url, { headers });
      if (!res.ok) return [];

      const data = await res.json();
      return (data.backdrops || []).map((b: any) => ({
        url: `${this.imageBaseUrl}/original${b.file_path}`,
        thumbnailUrl: `${this.imageBaseUrl}/w500${b.file_path}`,
        width: b.width,
        height: b.height
      }));
    } catch (err) {
      console.error('TMDB getBackdrops failed:', err);
      return [];
    }
  }

  public async getMediaDetails(externalId: string): Promise<Partial<Media>> {
    const apiKey = await this.getApiKey();

    let mediaType: 'movie' | 'tv' = 'movie';
    let tmdbId = externalId;

    if (externalId.startsWith('movie:')) {
      mediaType = 'movie';
      tmdbId = externalId.replace('movie:', '');
    } else if (externalId.startsWith('tv:')) {
      mediaType = 'tv';
      tmdbId = externalId.replace('tv:', '');
    }

    if (!apiKey) {
      return {};
    }

    await this.initLanguages();

    if (!/^\d+$/.test(tmdbId)) return {};

    try {
      const { url, headers } = await this.getFetchConfig(`/${mediaType}/${tmdbId}`, {
        append_to_response: 'credits,images,keywords',
        include_image_language: 'en,null'
      });

      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.warn(`TMDB API returned ${res.status} for ${mediaType}/${tmdbId}`);
        return {};
      }

      const data = await res.json();

      const genres = (data.genres || []).map((g: any) => g.name);
      const rawKeywords = mediaType === 'movie' ? data.keywords?.keywords : data.keywords?.results;
      const keywords: string[] = Array.isArray(rawKeywords)
        ? rawKeywords
            .map((k: any) => k?.name)
            .filter((name: unknown): name is string => typeof name === 'string' && name.trim().length > 0)
        : [];
      const poster = data.poster_path ? `${this.imageBaseUrl}/w500${data.poster_path}` : undefined;
      const backdrop = data.backdrop_path ? `${this.imageBaseUrl}/w1280${data.backdrop_path}` : undefined;
      const language = this.getLanguageName(data.original_language || '');
      console.log("language: " + language);

      let logo: string | undefined = undefined;
      if (data.images && data.images.logos && data.images.logos.length > 0) {
        const bestLogo = data.images.logos.find((l: any) => l.iso_639_1 === 'en') || data.images.logos[0];
        if (bestLogo) {
          logo = `${this.imageBaseUrl}/w500${bestLogo.file_path}`;
        }
      }

      const cast: CastMember[] = (data.credits?.cast || []).slice(0, 12).map((c: any) => ({
        id: `cast_${c.id}`,
        name: c.name,
        character: c.character,
        profile_path: c.profile_path ? `${this.imageBaseUrl}/w185${c.profile_path}` : undefined
      }));

      let seasons: Season[] | undefined = undefined;

      if (mediaType === 'tv' && data.seasons) {
        seasons = [];
        for (const s of data.seasons) {
          if (s.season_number === 0 && (!s.episodes || s.episodes.length === 0)) continue;

          let seasonEpisodes: Episode[] = [];
          try {
            const seasonFetch = await this.getFetchConfig(`/tv/${tmdbId}/season/${s.season_number}`);
            const seasonRes = await fetch(seasonFetch.url, { headers: seasonFetch.headers });
            if (seasonRes.ok) {
              const seasonData = await seasonRes.json();
              seasonEpisodes = (seasonData.episodes || []).map((e: any) => ({
                episode_number: e.episode_number,
                name: e.name,
                overview: e.overview,
                air_date: e.air_date,
                still_path: e.still_path ? `${this.imageBaseUrl}/w300${e.still_path}` : undefined,
                vote_average: e.vote_average
              }));
            }
          } catch {
            // fallback if individual season fetch fails
          }

          seasons.push({
            season_number: s.season_number,
            name: s.name,
            overview: s.overview,
            poster_path: s.poster_path ? `${this.imageBaseUrl}/w300${s.poster_path}` : undefined,
            episode_count: s.episode_count,
            episodes: seasonEpisodes
          });
        }
      }

      const rawYear = mediaType === 'movie'
        ? (data.release_date ? parseInt(data.release_date.split('-')[0], 10) : undefined)
        : (data.first_air_date ? parseInt(data.first_air_date.split('-')[0], 10) : undefined);

      const releaseYear = rawYear && !isNaN(rawYear) ? rawYear : undefined;

      const rawRuntime = mediaType === 'movie'
        ? data.runtime
        : (data.episode_run_time && data.episode_run_time.length > 0 ? data.episode_run_time[0] : undefined);

      const runtime = rawRuntime && !isNaN(rawRuntime) ? rawRuntime : undefined;

      const publisher = mediaType === 'tv' && data.networks && data.networks.length > 0
        ? data.networks[0].name
        : (data.production_companies && data.production_companies.length > 0 ? data.production_companies[0].name : undefined);

      return {
        title: mediaType === 'movie' ? data.title : data.name,
        original_title: mediaType === 'movie' ? data.original_title : data.original_name,
        type: mediaType === 'movie' ? 'Film' : 'TV Series',
        release_year: releaseYear,
        description: data.overview,
        genres,
        keywords,
        runtime,
        poster,
        backdrop,
        logo,
        publisher,
        cast,
        seasons,
        metadata_source: 'TMDB',
        metadata_refreshed_at: new Date().toISOString(),
        language
      };
    } catch (err) {
      console.error('TMDB getMediaDetails failed:', err);
      return {};
    }
  }

  public async getExternalIds(
    mediaType: 'movie' | 'tv',
    tmdbId: string,
    season?: number,
    episode?: number
  ): Promise<{ imdb_id?: string; tvdb_id?: number }> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return {};

    const cleanId = tmdbId.replace(/^(movie|tv):/, '');
    if (!/^\d+$/.test(cleanId)) return {};

    try {
      let endpoint = `/${mediaType}/${cleanId}/external_ids`;
      if (mediaType === 'tv' && typeof season === 'number' && typeof episode === 'number' && season > 0 && episode > 0) {
        endpoint = `/tv/${cleanId}/season/${season}/episode/${episode}/external_ids`;
      }
      const { url, headers } = await this.getFetchConfig(endpoint);
      const res = await fetch(url, { headers });
      if (!res.ok) {
        // If episode-specific external_ids fails, try show-level external_ids
        if (mediaType === 'tv' && endpoint !== `/tv/${cleanId}/external_ids`) {
          const showConfig = await this.getFetchConfig(`/tv/${cleanId}/external_ids`);
          const showRes = await fetch(showConfig.url, { headers: showConfig.headers });
          if (showRes.ok) {
            const showData = await showRes.json();
            return {
              imdb_id: showData.imdb_id || undefined,
              tvdb_id: showData.tvdb_id ? Number(showData.tvdb_id) : undefined
            };
          }
        }
        return {};
      }
      const data = await res.json();
      return {
        imdb_id: data.imdb_id || undefined,
        tvdb_id: data.tvdb_id ? Number(data.tvdb_id) : undefined
      };
    } catch (err) {
      console.warn('TMDB getExternalIds failed:', err);
      return {};
    }
  }
}

export const tmdbProvider = new TMDBProvider();
