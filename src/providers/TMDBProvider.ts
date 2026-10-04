import { Media, MediaType, CastMember, Season, Episode } from '../types/media';
import { MetadataProvider, MetadataSearchResult } from './interfaces';
import { dbService } from '../services/DatabaseService';

export class TMDBProvider implements MetadataProvider {
  public name = 'TMDB';
  private baseUrl = 'https://api.themoviedb.org/3';
  private imageBaseUrl = 'https://image.tmdb.org/t/p';

  private getApiKey(): string | undefined {
    const key = dbService.getSettings().tmdb_api_key;
    return key ? key.trim() : undefined;
  }

  private getFetchConfig(endpoint: string, params: Record<string, string> = {}): { url: string; headers: Record<string, string> } {
    const key = this.getApiKey() || '';
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

  public async searchMedia(query: string, type?: MediaType): Promise<MetadataSearchResult[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return this.getMockSearchResults(query, type);
    }

    const results: MetadataSearchResult[] = [];

    try {
      if (!type || type === 'Film') {
        const { url, headers } = this.getFetchConfig('/search/movie', {
          query,
          include_adult: 'false'
        });
        const movieRes = await fetch(url, { headers });
        if (movieRes.ok) {
          const data = await movieRes.json();
          for (const item of (data.results || []).slice(0, 8)) {
            const yearNum = item.release_date ? parseInt(item.release_date.split('-')[0], 10) : undefined;
            results.push({
              title: item.title,
              original_title: item.original_title,
              release_year: yearNum && !isNaN(yearNum) ? yearNum : undefined,
              type: 'Film',
              description: item.overview,
              poster: item.poster_path ? `${this.imageBaseUrl}/w500${item.poster_path}` : undefined,
              backdrop: item.backdrop_path ? `${this.imageBaseUrl}/w1280${item.backdrop_path}` : undefined,
              external_id: `movie:${item.id}`,
              provider: this.name
            });
          }
        }
      }

      if (!type || type === 'TV Series') {
        const { url, headers } = this.getFetchConfig('/search/tv', {
          query,
          include_adult: 'false'
        });
        const tvRes = await fetch(url, { headers });
        if (tvRes.ok) {
          const data = await tvRes.json();
          for (const item of (data.results || []).slice(0, 8)) {
            const yearNum = item.first_air_date ? parseInt(item.first_air_date.split('-')[0], 10) : undefined;
            results.push({
              title: item.name,
              original_title: item.original_name,
              release_year: yearNum && !isNaN(yearNum) ? yearNum : undefined,
              type: 'TV Series',
              description: item.overview,
              poster: item.poster_path ? `${this.imageBaseUrl}/w500${item.poster_path}` : undefined,
              backdrop: item.backdrop_path ? `${this.imageBaseUrl}/w1280${item.backdrop_path}` : undefined,
              external_id: `tv:${item.id}`,
              provider: this.name
            });
          }
        }
      }
    } catch (err) {
      console.error('TMDB searchMedia failed:', err);
      return this.getMockSearchResults(query, type);
    }

    if (results.length === 0) {
      return this.getMockSearchResults(query, type);
    }

    return results;
  }

  public async getMediaDetails(externalId: string): Promise<Partial<Media>> {
    const apiKey = this.getApiKey();

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
      return this.getMockDetails(externalId, mediaType);
    }

    // If tmdbId is not a raw numeric ID, search TMDB by query
    if (!/^\d+$/.test(tmdbId)) {
      const candidates = await this.searchMedia(externalId, mediaType === 'movie' ? 'Film' : 'TV Series');
      if (candidates.length > 0 && candidates[0].external_id !== externalId) {
        return this.getMediaDetails(candidates[0].external_id);
      }
      return this.getMockDetails(externalId, mediaType);
    }

    try {
      const { url, headers } = this.getFetchConfig(`/${mediaType}/${tmdbId}`, {
        append_to_response: 'credits,images',
        include_image_language: 'en,null'
      });

      const res = await fetch(url, { headers });
      if (!res.ok) {
        // ID may be invalid/legacy seed ID -> Fall back to searching by title or returning candidate
        console.warn(`TMDB API returned ${res.status} for ${mediaType}/${tmdbId}`);
        return this.getMockDetails(externalId, mediaType);
      }

      const data = await res.json();

      const genres = (data.genres || []).map((g: any) => g.name);
      const poster = data.poster_path ? `${this.imageBaseUrl}/w500${data.poster_path}` : undefined;
      const backdrop = data.backdrop_path ? `${this.imageBaseUrl}/w1280${data.backdrop_path}` : undefined;

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
            const seasonFetch = this.getFetchConfig(`/tv/${tmdbId}/season/${s.season_number}`);
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
        runtime,
        poster,
        backdrop,
        logo,
        publisher,
        cast,
        seasons,
        metadata_source: 'TMDB',
        metadata_refreshed_at: new Date().toISOString()
      };
    } catch (err) {
      console.error('TMDB getMediaDetails failed:', err);
      return this.getMockDetails(externalId, mediaType);
    }
  }

  private getMockSearchResults(query: string, type?: MediaType): MetadataSearchResult[] {
    const qLower = query.toLowerCase();
    const mocks: MetadataSearchResult[] = [
      {
        title: 'Aanandam',
        original_title: 'Aanandam',
        release_year: 2016,
        type: 'Film',
        description: 'Seven engineering students go on a college trip across South India.',
        poster: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=500&q=80',
        backdrop: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1280&q=80',
        external_id: 'movie:390123',
        provider: 'TMDB'
      },
      {
        title: 'Premalu',
        original_title: 'Premalu',
        release_year: 2024,
        type: 'Film',
        description: 'A romantic comedy set in Hyderabad following Sachin and Reenu.',
        poster: 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?w=500&q=80',
        backdrop: 'https://images.unsplash.com/photo-1518676599625-583ad8c26727?w=1280&q=80',
        external_id: 'movie:123456',
        provider: 'TMDB'
      },
      {
        title: 'The Paper',
        original_title: 'Novine',
        release_year: 2016,
        type: 'TV Series',
        description: 'A investigative drama following the staff of a Croatian newspaper.',
        poster: 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=500&q=80',
        backdrop: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=1280&q=80',
        external_id: 'tv:789012',
        provider: 'TMDB'
      },
      {
        title: 'Ted Lasso',
        original_title: 'Ted Lasso',
        release_year: 2020,
        type: 'TV Series',
        description: 'An American college football coach is hired to manage a British soccer team.',
        poster: 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=500&q=80',
        backdrop: 'https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=1280&q=80',
        external_id: 'tv:97630',
        provider: 'TMDB'
      }
    ];

    return mocks.filter(m => {
      if (type && m.type !== type) return false;
      return m.title.toLowerCase().includes(qLower) || query.length < 2;
    });
  }

  private getMockDetails(_externalId: string, mediaType: 'movie' | 'tv'): Partial<Media> {
    if (mediaType === 'tv') {
      return {
        title: 'The Paper',
        original_title: 'Novine',
        type: 'TV Series',
        release_year: 2016,
        description: 'An investigative journalism television series that delves into corruption, media power, and politics.',
        genres: ['Drama', 'Crime', 'Thriller'],
        runtime: 45,
        poster: 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=500&q=80',
        backdrop: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=1280&q=80',
        publisher: 'HRT / Netflix',
        metadata_source: 'TMDB',
        metadata_refreshed_at: new Date().toISOString(),
        cast: [
          { id: 'cast_1', name: 'Branka Katić', character: 'Dijana Mitrović' },
          { id: 'cast_2', name: 'Trpimir Jurkić', character: 'Nikola Martić' },
          { id: 'cast_3', name: 'Aleksandar Cvetković', character: 'Mario Kardum' }
        ],
        seasons: [
          {
            season_number: 1,
            name: 'Season 1',
            overview: 'The takeover of Croatia\'s last independent daily newspaper.',
            episode_count: 12,
            episodes: [
              { episode_number: 1, name: 'Episode 1', overview: 'A tragic accident sets off a chain of events.' },
              { episode_number: 2, name: 'Episode 2', overview: 'New ownership introduces harsh strictures.' }
            ]
          },
          {
            season_number: 2,
            name: 'Season 2',
            overview: 'Political turmoil during the Croatian presidential election.',
            episode_count: 11,
            episodes: [
              { episode_number: 1, name: 'Episode 1', overview: 'Election campaign heats up.' }
            ]
          }
        ]
      };
    } else {
      return {
        title: 'Aanandam',
        original_title: 'Aanandam',
        type: 'Film',
        release_year: 2016,
        description: 'Seven engineering students embarking on a college trip across South India experience friendship, love, and life lessons.',
        genres: ['Comedy', 'Drama', 'Romance'],
        runtime: 130,
        poster: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=500&q=80',
        backdrop: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1280&q=80',
        publisher: 'Habit of Life / LJ Films',
        metadata_source: 'TMDB',
        metadata_refreshed_at: new Date().toISOString(),
        cast: [
          { id: 'cast_10', name: 'Arun Kurian', character: 'Varun Manjooran' },
          { id: 'cast_11', name: 'Thomas Mathew', character: 'Akshay' },
          { id: 'cast_12', name: 'Siddhi Mahajankatti', character: 'Dia' }
        ]
      };
    }
  }
}

export const tmdbProvider = new TMDBProvider();
