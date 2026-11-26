import { Media, MediaType } from '../types/media';
import { MetadataProvider, MetadataSearchOptions, MetadataSearchResult } from './interfaces';
import { dbService } from '../services/DatabaseService';
import { searchWithProgressiveTrim } from './searchUtils';

export async function fetchIGDBLogo(gameTitle: string): Promise<string | undefined> {
  try {
    const provider = new IGDBProvider();
    const results = await provider.searchMedia(gameTitle, 'VideoGame');
    if (results.length > 0) {
      const details = await provider.getMediaDetails(results[0].external_id);
      return details.logo;
    }
  } catch (err) {
    console.warn(`Failed to fetch IGDB logo for game "${gameTitle}":`, err);
  }
  return undefined;
}

async function smartFetch(url: string, options?: RequestInit): Promise<Response> {
  const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;

  if (isTauri) {
    try {
      // Use dynamic import for tauri-plugin-http
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
      if (tauriFetch) {
        return await tauriFetch(url, options);
      }
    } catch (err) {
      console.warn('Tauri native fetch failed, falling back to browser proxy fetch:', err);
    }
  }

  // Web Browser / Vite dev mode: route requests through Vite dev server proxy to avoid CORS
  let targetUrl = url;
  if (url.startsWith('https://api.igdb.com/v4')) {
    targetUrl = url.replace('https://api.igdb.com/v4', '/igdb-api');
  } else if (url.startsWith('https://id.twitch.tv/oauth2/token')) {
    targetUrl = url.replace('https://id.twitch.tv/oauth2/token', '/twitch-oauth');
  }

  return await fetch(targetUrl, options);
}

export class IGDBProvider implements MetadataProvider {
  public name = 'IGDB';
  private twitchOAuthUrl = 'https://id.twitch.tv/oauth2/token';
  private igdbBaseUrl = 'https://api.igdb.com/v4';
  private rawgBaseUrl = 'https://api.rawg.io/api';

  private cachedAccessToken: { token: string; expiresAt: number } | null = null;

  private async getTwitchCredentials() {
    const settings = await dbService.getSettings();
    return {
      clientId: settings.twitch_client_id?.trim(),
      clientSecret: settings.twitch_client_secret?.trim(),
      rawgApiKey: settings.rawg_api_key?.trim()
    };
  }

  private async getTwitchAccessToken(clientId: string, clientSecret: string): Promise<string | null> {
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAt > Date.now()) {
      return this.cachedAccessToken.token;
    }

    try {
      const tokenUrl = `${this.twitchOAuthUrl}?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`;
      const res = await smartFetch(tokenUrl, { method: 'POST' });
      if (!res.ok) {
        console.warn(`Twitch OAuth returned status ${res.status}:`, await res.text());
        return null;
      }
      const data = await res.json();
      if (data.access_token) {
        this.cachedAccessToken = {
          token: data.access_token,
          expiresAt: Date.now() + (data.expires_in - 300) * 1000
        };
        return data.access_token;
      }
    } catch (err) {
      console.error('Failed to obtain Twitch OAuth token for IGDB:', err);
    }
    return null;
  }

  public cleanQueryString(rawQuery: string): string {
    let q = rawQuery;
    q = q.replace(/\[[^\]]*\]/g, ' ').replace(/\([^\)]*\)/g, ' ');
    q = q.replace(/\.(exe|lnk|iso|bin|zip|rar)$/i, '');
    const noiseRegex = /\b(v\d+(\.\d+)*|repack|fitgirl|dodi|crack|gog|steam|portable|multi\d*|edition|setup|installer)\b/gi;
    q = q.replace(noiseRegex, ' ');
    q = q.replace(/[\._\-]/g, ' ').replace(/\s+/g, ' ').trim();
    return q;
  }

  public async searchMedia(
    query: string,
    type?: MediaType,
    options: MetadataSearchOptions = {}
  ): Promise<MetadataSearchResult[]> {
    if (type && type !== 'VideoGame') return [];

    const { clientId, clientSecret, rawgApiKey } = await this.getTwitchCredentials();
    const cleanQuery = this.cleanQueryString(query);
    const releaseYear = options.releaseYear;
    const startOfYear = releaseYear ? Math.floor(Date.UTC(releaseYear, 0, 1) / 1000) : undefined;
    const startOfNextYear = releaseYear ? Math.floor(Date.UTC(releaseYear + 1, 0, 1) / 1000) : undefined;

    // 1. Try IGDB API with progressive word trimming
    if (clientId && clientSecret) {
      const token = await this.getTwitchAccessToken(clientId, clientSecret);
      if (token) {
        const igdbResults = await searchWithProgressiveTrim<MetadataSearchResult>(query, cleanQuery, async searchStr => {
          try {
            const dateFilter = startOfYear !== undefined && startOfNextYear !== undefined
              ? ` where first_release_date >= ${startOfYear} & first_release_date < ${startOfNextYear};`
              : '';
            const body = `search "${searchStr.replace(/"/g, '')}"; fields name, summary, first_release_date, cover.image_id, artworks.image_id, screenshots.image_id, genres.name, involved_companies.company.name, involved_companies.developer, involved_companies.publisher;${dateFilter} limit 8;`;
            const res = await smartFetch(`${this.igdbBaseUrl}/games`, {
              method: 'POST',
              headers: {
                'Client-ID': clientId,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'text/plain'
              },
              body
            });

            if (res.ok) {
              const data = await res.json();
              if (data && data.length > 0) {
                return data.map((game: any) => {
                  const coverUrl = game.cover?.image_id
                    ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg`
                    : undefined;
                  const backdropUrl = game.artworks && game.artworks.length > 0
                    ? `https://images.igdb.com/igdb/image/upload/t_1080p/${game.artworks[0].image_id}.jpg`
                    : game.screenshots && game.screenshots.length > 0
                    ? `https://images.igdb.com/igdb/image/upload/t_1080p/${game.screenshots[0].image_id}.jpg`
                    : undefined;
                  const year = game.first_release_date
                    ? new Date(game.first_release_date * 1000).getFullYear()
                    : undefined;

                  return {
                    title: game.name,
                    type: 'VideoGame' as MediaType,
                    release_year: year,
                    description: game.summary,
                    poster: coverUrl,
                    backdrop: backdropUrl,
                    external_id: `igdb:${game.id}`,
                    provider: this.name
                  };
                });
              }
            } else {
              console.warn(`IGDB search HTTP ${res.status}:`, await res.text());
            }
          } catch (err) {
            console.error('IGDB search failed:', err);
          }
          return [];
        });
        if (igdbResults.length > 0) return igdbResults;
      }
    } else {
      console.info('Twitch Client ID / Secret not set in Settings. To search live IGDB data, configure Twitch Client ID & Secret in Settings.');
    }

    // 2. Try RAWG API fallback if RAWG key is set with progressive word trimming
    if (rawgApiKey) {
      return searchWithProgressiveTrim<MetadataSearchResult>(query, cleanQuery, async searchStr => {
        try {
          const params = new URLSearchParams({
            key: rawgApiKey,
            search: searchStr,
            page_size: '8'
          });
          if (releaseYear) params.set('dates', `${releaseYear}-01-01,${releaseYear}-12-31`);
          const res = await smartFetch(`${this.rawgBaseUrl}/games?${params.toString()}`);
          if (res.ok) {
            const data = await res.json();
            if (data.results && data.results.length > 0) {
              return data.results.map((game: any) => ({
                title: game.name,
                type: 'VideoGame' as MediaType,
                release_year: game.released ? parseInt(game.released.split('-')[0], 10) : undefined,
                description: undefined,
                poster: game.background_image,
                backdrop: game.background_image,
                external_id: `rawg:${game.id}`,
                provider: 'RAWG'
              }));
            }
          }
        } catch (err) {
          console.error('RAWG search failed:', err);
        }
        return [];
      });
    }

    return [];
  }

  public async getRelatedMedia(externalId: string): Promise<MetadataSearchResult[]> {
    const { clientId, clientSecret } = await this.getTwitchCredentials();

    if (externalId.startsWith('igdb:') && clientId && clientSecret) {
      const igdbId = externalId.replace('igdb:', '');
      const token = await this.getTwitchAccessToken(clientId, clientSecret);
      if (token) {
        try {
          const body = `where id = ${igdbId}; fields name, collection.games.name, collection.games.cover.image_id, collection.games.first_release_date, collection.games.summary, franchises.games.name, franchises.games.cover.image_id, franchises.games.first_release_date, franchises.games.summary, remakes.name, remakes.cover.image_id, remakes.first_release_date, remakes.summary, dlcs.name, dlcs.cover.image_id, dlcs.first_release_date, dlcs.summary, parent_game.name, parent_game.cover.image_id, parent_game.first_release_date, parent_game.summary;`;
          const res = await smartFetch(`${this.igdbBaseUrl}/games`, {
            method: 'POST',
            headers: {
              'Client-ID': clientId,
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'text/plain'
            },
            body
          });

          if (res.ok) {
            const list = await res.json();
            if (list.length > 0) {
              const game = list[0];
              const relatedGames: any[] = [];
              const addedIds = new Set<number>([Number(igdbId)]);

              const addGame = (g: any) => {
                if (g && g.id && !addedIds.has(g.id)) {
                  addedIds.add(g.id);
                  relatedGames.push(g);
                }
              };

              if (game.collection?.games) game.collection.games.forEach(addGame);
              if (game.franchises) {
                game.franchises.forEach((f: any) => {
                  if (f.games) f.games.forEach(addGame);
                });
              }
              if (game.remakes) game.remakes.forEach(addGame);
              if (game.dlcs) game.dlcs.forEach(addGame);
              if (game.parent_game) addGame(game.parent_game);

              if (relatedGames.length > 0) {
                return relatedGames.slice(0, 8).map(g => {
                  const coverUrl = g.cover?.image_id
                    ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`
                    : undefined;
                  const year = g.first_release_date
                    ? new Date(g.first_release_date * 1000).getFullYear()
                    : undefined;

                  return {
                    title: g.name,
                    type: 'VideoGame' as MediaType,
                    release_year: year,
                    description: g.summary,
                    poster: coverUrl,
                    external_id: `igdb:${g.id}`,
                    provider: this.name
                  };
                });
              }
            }
          }
        } catch (err) {
          console.error('IGDB getRelatedMedia failed:', err);
        }
      }
    }

    return [];
  }

  public async getMediaDetails(externalId: string): Promise<Partial<Media>> {
    const { clientId, clientSecret, rawgApiKey } = await this.getTwitchCredentials();

    if (externalId.startsWith('igdb:') && clientId && clientSecret) {
      const igdbId = externalId.replace('igdb:', '');
      const token = await this.getTwitchAccessToken(clientId, clientSecret);
      if (token) {
        try {
          const body = `where id = ${igdbId}; fields name, summary, first_release_date, cover.image_id, artworks.image_id, screenshots.image_id, genres.name, keywords.name, involved_companies.company.name, involved_companies.developer, involved_companies.publisher;`;
          const res = await smartFetch(`${this.igdbBaseUrl}/games`, {
            method: 'POST',
            headers: {
              'Client-ID': clientId,
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'text/plain'
            },
            body
          });

          if (res.ok) {
            const list = await res.json();
            if (list.length > 0) {
              const game = list[0];
              const coverUrl = game.cover?.image_id
                ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg`
                : undefined;
              const backdropUrl = game.artworks && game.artworks.length > 0
                ? `https://images.igdb.com/igdb/image/upload/t_1080p/${game.artworks[0].image_id}.jpg`
                : game.screenshots && game.screenshots.length > 0
                ? `https://images.igdb.com/igdb/image/upload/t_1080p/${game.screenshots[0].image_id}.jpg`
                : undefined;
              const year = game.first_release_date
                ? new Date(game.first_release_date * 1000).getFullYear()
                : undefined;

              const genres = (game.genres || []).map((g: any) => g.name);
              const keywords: string[] = Array.isArray(game.keywords)
                ? game.keywords
                    .map((k: any) => k?.name)
                    .filter((name: unknown): name is string => typeof name === 'string' && name.trim().length > 0)
                : [];

              const developers: string[] = [];
              const publishers: string[] = [];

              if (game.involved_companies) {
                for (const ic of game.involved_companies) {
                  if (ic.developer && ic.company?.name && !developers.includes(ic.company.name)) {
                    developers.push(ic.company.name);
                  }
                  if (ic.publisher && ic.company?.name && !publishers.includes(ic.company.name)) {
                    publishers.push(ic.company.name);
                  }
                }
              }

              const developer = developers.length > 0 ? developers.join(', ') : undefined;
              const publisher = publishers.length > 0 ? publishers.join(', ') : undefined;

              // Fetch IGDB logo for video game if game.id or game_logos exists
              let logo: string | undefined = undefined;
              try {
                const logoBody = `where game = ${igdbId}; fields image_id;`;
                const logoRes = await smartFetch(`${this.igdbBaseUrl}/logos`, {
                  method: 'POST',
                  headers: {
                    'Client-ID': clientId,
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'text/plain'
                  },
                  body: logoBody  // `where game = ${igdbId}; fields image_id;` — already correct
                });
                if (logoRes.ok) {
                  const logos = await logoRes.json();
                  if (logos && logos.length > 0 && logos[0].image_id) {
                    logo = `https://images.igdb.com/igdb/image/upload/t_logo_med/${logos[0].image_id}.png`;
                  }
                }
              } catch (logoErr) {
                console.warn('Failed to fetch IGDB game_logos:', logoErr);
              }

              return {
                title: game.name,
                type: 'VideoGame',
                release_year: year,
                description: game.summary,
                genres,
                keywords,
                poster: coverUrl,
                backdrop: backdropUrl,
                logo,
                developer,
                publisher,
                metadata_source: 'IGDB',
                metadata_refreshed_at: new Date().toISOString()
              };
            }
          }
        } catch (err) {
          console.error('IGDB details fetch failed:', err);
        }
      }
    }

    if (externalId.startsWith('rawg:') && rawgApiKey) {
      const rawgId = externalId.replace('rawg:', '');
      try {
        const res = await smartFetch(`${this.rawgBaseUrl}/games/${rawgId}?key=${rawgApiKey}`);
        if (res.ok) {
          const game = await res.json();
          const genres = (game.genres || []).map((g: any) => g.name);
          const developer = game.developers && game.developers.length > 0
            ? game.developers.map((d: any) => d.name).join(', ')
            : undefined;
          const publisher = game.publishers && game.publishers.length > 0
            ? game.publishers.map((p: any) => p.name).join(', ')
            : undefined;

          return {
            title: game.name,
            type: 'VideoGame',
            release_year: game.released ? parseInt(game.released.split('-')[0], 10) : undefined,
            description: game.description_raw || game.description,
            genres,
            poster: game.background_image,
            backdrop: game.background_image_additional || game.background_image,
            developer,
            publisher,
            metadata_source: 'RAWG',
            metadata_refreshed_at: new Date().toISOString()
          };
        }
      } catch (err) {
        console.error('RAWG details fetch failed:', err);
      }
    }

    return {};
  }

  public async getBackdrops(externalId: string): Promise<{ url: string; thumbnailUrl: string; width: number; height: number }[]> {
    const { clientId, clientSecret } = await this.getTwitchCredentials();
    if (!clientId || !clientSecret) return [];

    if (externalId.startsWith('igdb:')) {
      const igdbId = externalId.replace('igdb:', '');
      const token = await this.getTwitchAccessToken(clientId, clientSecret);
      if (!token) return [];

      try {
        const body = `where game = ${igdbId}; fields image_id, width, height;`;
        const res = await smartFetch(`${this.igdbBaseUrl}/artworks`, {
          method: 'POST',
          headers: {
            'Client-ID': clientId,
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'text/plain'
          },
          body
        });

        if (res.ok) {
          const artworks = await res.json();
          const artworkUrls = (artworks || []).map((a: any) => ({
              url : `https://images.igdb.com/igdb/image/upload/t_1080p_2x/${a.image_id}.jpg`,
              thumbnailUrl: `https://images.igdb.com/igdb/image/upload/t_screenshot_med/${a.image_id}.jpg`,
              height : a.height,
              width: a.width
            })
          );

          // Also try to get screenshots to supplement the backdrops
          const screenBody = `where game = ${igdbId}; fields image_id, width, height;`;
          const screenRes = await smartFetch(`${this.igdbBaseUrl}/screenshots`, {
            method: 'POST',
            headers: {
              'Client-ID': clientId,
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'text/plain'
            },
            body: screenBody
          });

          if (screenRes.ok) {
            const screenshots = await screenRes.json();
            const screenshotUrls = (screenshots || []).map((s: any) => ({
                url : `https://images.igdb.com/igdb/image/upload/t_1080p_2x/${s.image_id}.jpg`,
                thumbnailUrl: `https://images.igdb.com/igdb/image/upload/t_screenshot_med/${s.image_id}.jpg`,
                height : s.height,
                width: s.width
              })
            );
            console.log(artworkUrls.length + screenshotUrls.length);
            return [...artworkUrls, ...screenshotUrls];
          }
          console.log("Artworks only : " + artworkUrls.length);
          return artworkUrls;
        }
      } catch (err) {
        console.error('IGDB getBackdrops failed:', err);
      }
    }

    return [];
  }
}

export const igdbProvider = new IGDBProvider();
