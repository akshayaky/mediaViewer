import { secureStorageService, GoogleOAuthTokens } from './SecureStorageService';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export const DEFAULT_GOOGLE_CLIENT_ID = '1084295847391-mediaviewer.apps.googleusercontent.com';
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

export interface OAuthState {
  codeVerifier: string;
  state: string;
  redirectUri: string;
}

export class GoogleOAuthService {
  private clientId: string = DEFAULT_GOOGLE_CLIENT_ID;
  private pendingOAuthState: OAuthState | null = null;

  constructor(clientId?: string) {
    if (clientId) {
      this.clientId = clientId;
    }
  }

  public setClientId(id: string): void {
    if (id && id.trim()) {
      this.clientId = id.trim();
    }
  }

  public getClientId(): string {
    return this.clientId;
  }

  /**
   * Helper cross-environment HTTP fetch routing through Tauri HTTP plugin when available.
   */
  private async httpFetch(url: string, options?: RequestInit): Promise<Response> {
    try {
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        return await tauriFetch(url, options as any);
      }
    } catch {
      // Fallback to standard window fetch
    }
    return fetch(url, options);
  }

  /**
   * Generates a random crypto string for PKCE code_verifier.
   */
  public generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    if (typeof window !== 'undefined' && window.crypto) {
      window.crypto.getRandomValues(array);
    } else {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
    }
    return this.base64UrlEncode(array);
  }

  /**
   * Generates SHA-256 code_challenge from code_verifier using Web Crypto API.
   */
  public async generateCodeChallenge(verifier: string): Promise<string> {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(verifier);
      const digest = await window.crypto.subtle.digest('SHA-256', data);
      return this.base64UrlEncode(new Uint8Array(digest));
    }
    // Fallback for non-subtle crypto environments
    return this.simpleHashFallback(verifier);
  }

  private base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
    return base64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  private simpleHashFallback(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return btoa(String(hash)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /**
   * Initializes the PKCE OAuth flow and builds authorization URL.
   */
  public async prepareAuthUrl(redirectUri?: string): Promise<{ authUrl: string; oauthState: OAuthState }> {
    const effectiveRedirectUri = redirectUri || (typeof window !== 'undefined' ? `${window.location.origin}/oauth2callback` : 'http://127.0.0.1:1420/oauth2callback');
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    const state = Math.random().toString(36).substring(2, 15);

    const oauthState: OAuthState = {
      codeVerifier,
      state,
      redirectUri: effectiveRedirectUri
    };
    this.pendingOAuthState = oauthState;

    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        window.sessionStorage.setItem('__gdrive_oauth_state__', JSON.stringify(oauthState));
      } catch {
        // Ignore session storage error
      }
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: effectiveRedirectUri,
      response_type: 'code',
      scope: `${GOOGLE_DRIVE_SCOPE} https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile`,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      access_type: 'offline',
      prompt: 'consent'
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    return { authUrl, oauthState };
  }

  /**
   * Starts seamless 1-click Google Sign-In flow in browser/window popup.
   */
  public async startOneClickSignIn(): Promise<GoogleOAuthTokens> {
    const { authUrl } = await this.prepareAuthUrl();

    return new Promise<GoogleOAuthTokens>((resolve, reject) => {
      const width = 500;
      const height = 650;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;

      const popup = window.open(
        authUrl,
        'GoogleSignIn',
        `width=${width},height=${height},top=${top},left=${left},scrollbars=yes`
      );

      const handleMessage = async (event: MessageEvent) => {
        if (event.data && event.data.type === 'GOOGLE_OAUTH_REDIRECT') {
          window.removeEventListener('message', handleMessage);
          if (popup && !popup.closed) popup.close();

          try {
            const url = new URL(event.data.url);
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');

            if (!code) {
              reject(new Error('OAuth failed: No authorization code received from Google'));
              return;
            }

            const tokens = await this.exchangeCodeForTokens(code, state || undefined);
            window.dispatchEvent(new Event('google-oauth-connected'));
            resolve(tokens);
          } catch (err) {
            reject(err);
          }
        }
      };

      window.addEventListener('message', handleMessage);

      // Interval fallback for popup closing
      const timer = setInterval(async () => {
        if (!popup || popup.closed) {
          clearInterval(timer);
          window.removeEventListener('message', handleMessage);

          // Check if tokens were exchanged in background
          const activeToken = await this.getValidAccessToken();
          if (activeToken) {
            const tokens = await secureStorageService.getTokens();
            if (tokens) resolve(tokens);
          } else {
            reject(new Error('Sign-in window closed before completion'));
          }
        }
      }, 1000);
    });
  }

  /**
   * Exchanges authorization code for access and refresh tokens via PKCE.
   */
  public async exchangeCodeForTokens(
    code: string,
    state?: string,
    savedState?: OAuthState
  ): Promise<GoogleOAuthTokens> {
    const effectiveState = savedState || this.pendingOAuthState;
    if (!effectiveState) {
      throw new Error('OAuth state is missing or expired. Please restart the sign-in flow.');
    }
    if (state && effectiveState.state !== state) {
      throw new Error('Invalid OAuth state parameter. Request rejected to prevent CSRF.');
    }

    const body = new URLSearchParams({
      client_id: this.clientId,
      code,
      code_verifier: effectiveState.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: effectiveState.redirectUri
    });

    const res = await this.httpFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${errorText}`);
    }

    const json = await res.json();
    const expiresAt = Date.now() + (json.expires_in || 3600) * 1000;

    const tokens: GoogleOAuthTokens = {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: expiresAt,
      scope: json.scope,
      token_type: json.token_type
    };

    // Fetch user profile info to display connection details
    try {
      const profile = await this.fetchUserProfile(tokens.access_token);
      tokens.user_email = profile.email;
      tokens.user_name = profile.name;
      tokens.user_picture = profile.picture;
    } catch (err) {
      console.warn('Failed to fetch Google profile info:', err);
    }

    await secureStorageService.saveTokens(tokens);
    this.pendingOAuthState = null;
    return tokens;
  }

  /**
   * Refreshes access token using stored refresh_token.
   */
  public async refreshAccessToken(existingTokens?: GoogleOAuthTokens): Promise<GoogleOAuthTokens> {
    const tokens = existingTokens || (await secureStorageService.getTokens());
    if (!tokens || !tokens.refresh_token) {
      throw new Error('No refresh token available. User must reconnect Google Account.');
    }

    const body = new URLSearchParams({
      client_id: this.clientId,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token'
    });

    const res = await this.httpFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Token refresh failed (${res.status}): ${errorText}`);
    }

    const json = await res.json();
    const expiresAt = Date.now() + (json.expires_in || 3600) * 1000;

    const updatedTokens: GoogleOAuthTokens = {
      ...tokens,
      access_token: json.access_token,
      expires_at: expiresAt,
      refresh_token: json.refresh_token || tokens.refresh_token
    };

    await secureStorageService.saveTokens(updatedTokens);
    return updatedTokens;
  }

  /**
   * Retrieves a valid access token, automatically refreshing if expired or expiring within 5 minutes.
   */
  public async getValidAccessToken(): Promise<string | null> {
    const tokens = await secureStorageService.getTokens();
    if (!tokens || !tokens.access_token) {
      return null;
    }

    const bufferMs = 5 * 60 * 1000; // 5 minute buffer
    if (Date.now() + bufferMs >= tokens.expires_at) {
      if (tokens.refresh_token) {
        try {
          const refreshed = await this.refreshAccessToken(tokens);
          return refreshed.access_token;
        } catch (err) {
          console.error('Failed to auto-refresh access token:', err);
          return null;
        }
      }
      return null;
    }

    return tokens.access_token;
  }

  /**
   * Fetches Google User Profile information.
   */
  public async fetchUserProfile(accessToken: string): Promise<{ email?: string; name?: string; picture?: string }> {
    const res = await this.httpFetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch Google profile: ${res.statusText}`);
    }

    const json = await res.json();
    return {
      email: json.email,
      name: json.name,
      picture: json.picture
    };
  }

  /**
   * Disconnects Google Account, revokes token, and clears secure storage.
   */
  public async signOut(): Promise<void> {
    const tokens = await secureStorageService.getTokens();
    if (tokens && tokens.access_token) {
      try {
        await this.httpFetch(`https://oauth2.googleapis.com/revoke?token=${tokens.access_token}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });
      } catch {
        // Ignore revocation error on client sign out
      }
    }
    await secureStorageService.clearTokens();
  }
}

export const googleOAuthService = new GoogleOAuthService();
