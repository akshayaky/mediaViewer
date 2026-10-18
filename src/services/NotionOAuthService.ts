import { dbService } from './DatabaseService';
import { isTauri } from './LocalScannerService';

export interface NotionOAuthTokenResponse {
  access_token: string;
  token_type: string;
  bot_id: string;
  workspace_id: string;
  workspace_name?: string;
  workspace_icon?: string;
  duplicated_template_id?: string;
  owner?: any;
}

export interface NotionOAuthConfig {
  clientId: string;
  redirectUri: string;
  backendExchangeUrl?: string; // Optional backend proxy endpoint for client_secret exchange
}

export class NotionOAuthService {
  private static STORAGE_KEY_STATE = 'notion_oauth_state';

  /**
   * Generates a random CSRF state token and constructs the Notion OAuth Authorization URL.
   */
  public generateAuthUrl(clientId: string, redirectUri: string): { url: string; state: string } {
    if (!clientId || !clientId.trim()) {
      throw new Error('Missing Notion Client ID for OAuth authorization.');
    }
    if (!redirectUri || !redirectUri.trim()) {
      throw new Error('Missing Redirect URI for OAuth authorization.');
    }

    const state = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(NotionOAuthService.STORAGE_KEY_STATE, state);
    }
    dbService.saveSetting('notion_oauth_state' as any, state);

    const params = new URLSearchParams({
      client_id: clientId.trim(),
      response_type: 'code',
      owner: 'user',
      redirect_uri: redirectUri.trim(),
      state
    });

    const url = `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
    return { url, state };
  }

  /**
   * Validates state parameter against stored state to prevent CSRF.
   */
  public validateState(state: string): boolean {
    let savedState: string | null = null;
    if (typeof localStorage !== 'undefined') {
      savedState = localStorage.getItem(NotionOAuthService.STORAGE_KEY_STATE);
      localStorage.removeItem(NotionOAuthService.STORAGE_KEY_STATE);
    }
    if (!savedState) {
      savedState = dbService.getSettings().notion_oauth_state || null;
    }
    dbService.saveSetting('notion_oauth_state' as any, '');

    if (!savedState || !state) return false;
    return savedState === state;
  }

  /**
   * Exchanges authorization code for an access token using backend service proxy
   * or client credentials if provided in secure server/test environment.
   */
  public async exchangeCodeForToken(
    code: string,
    redirectUri: string,
    options: {
      backendExchangeUrl?: string;
      clientId?: string;
      clientSecret?: string;
    }
  ): Promise<NotionOAuthTokenResponse> {
    const { backendExchangeUrl, clientId, clientSecret } = options;

    let responseData: NotionOAuthTokenResponse;

    if (backendExchangeUrl) {
      // Production path: Client secret remains on secure backend server proxy
      const payload = { code, redirect_uri: redirectUri };
      let res: Response;
      if (isTauri()) {
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
        res = await tauriFetch(backendExchangeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch(backendExchangeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OAuth backend exchange failed (${res.status}): ${errText}`);
      }

      responseData = await res.json();
    } else if (clientId && clientSecret) {
      // Direct exchange (for testing / developer mode where clientSecret is supplied)
      const credentials = btoa(`${clientId}:${clientSecret}`);
      const headers = {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json'
      };

      const payload = {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      };

      const url = 'https://api.notion.com/v1/oauth/token';
      let res: Response;

      if (isTauri()) {
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
        res = await tauriFetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Notion OAuth token exchange error (${res.status}): ${errText}`);
      }

      responseData = await res.json();
    } else {
      throw new Error(
        'Missing OAuth backend exchange URL or client credentials for token exchange.'
      );
    }

    // Persist OAuth token data securely in DB settings
    this.saveOAuthData(responseData);
    return responseData;
  }

  /**
   * Persists OAuth token data into DB settings.
   */
  public saveOAuthData(data: NotionOAuthTokenResponse): void {
    dbService.saveSetting('notion_oauth_data' as any, data);
    if (data.access_token) {
      dbService.saveSetting('notion_integration_token', data.access_token);
    }
  }

  /**
   * Retrieves saved OAuth token response if available.
   */
  public getOAuthData(): NotionOAuthTokenResponse | null {
    const settings = dbService.getSettings();
    return (settings as any).notion_oauth_data || null;
  }

  /**
   * Disconnects OAuth connection by removing saved tokens while preserving
   * local database records, external mappings, and history entries.
   */
  public disconnect(): void {
    dbService.saveSetting('notion_oauth_data' as any, null);
    dbService.saveSetting('notion_integration_token', '');
    dbService.saveSetting('notion_database_id', '');
  }

  /**
   * Determines active token (either OAuth access token or legacy manual token fallback).
   */
  public getActiveToken(): { token: string; isOAuth: boolean } {
    const settings = dbService.getSettings();
    const oauthData = (settings as any).notion_oauth_data as NotionOAuthTokenResponse | undefined;

    if (oauthData && oauthData.access_token) {
      return { token: oauthData.access_token, isOAuth: true };
    }

    const legacyToken = settings.notion_integration_token || '';
    return { token: legacyToken, isOAuth: false };
  }
}

export const notionOAuthService = new NotionOAuthService();
