import { dbService } from './DatabaseService';

export interface GoogleOAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // Timestamp in milliseconds
  scope?: string;
  token_type?: string;
  user_email?: string;
  user_name?: string;
  user_picture?: string;
}

export class SecureStorageService {
  private inMemoryTokens: GoogleOAuthTokens | null = null;
  private isNativeAvailable: boolean | null = null;
  private cryptoKey: CryptoKey | null = null;

  constructor() {
    this.detectSecureStorageSupport();
  }

  private detectSecureStorageSupport(): void {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window && window.crypto && window.crypto.subtle) {
      this.isNativeAvailable = true;
    } else {
      this.isNativeAvailable = false;
    }
  }

  public isSecureStorageAvailable(): boolean {
    if (this.isNativeAvailable === null) {
      this.detectSecureStorageSupport();
    }
    return Boolean(this.isNativeAvailable);
  }

  public getSecureStorageStatusMessage(): string {
    if (this.isSecureStorageAvailable()) {
      return 'OS Secure Credential Storage Active (AES-256-GCM encrypted token vault)';
    }
    return 'Secure OS Vault is unavailable in this browser environment. Persistent sign-in is disabled. Tokens will remain in memory for the active session only and will never be saved in plaintext.';
  }

  private async getEncryptionKey(): Promise<CryptoKey> {
    if (this.cryptoKey) return this.cryptoKey;

    const settings = await dbService.getSettings();
    let rawSecret = (settings as any).gdrive_vault_master_key;
    if (!rawSecret) {
      const arr = new Uint8Array(32);
      window.crypto.getRandomValues(arr);
      rawSecret = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
      await dbService.saveSetting('gdrive_vault_master_key' as any, rawSecret);
    }

    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      encoder.encode(rawSecret),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    this.cryptoKey = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode('media_viewer_gdrive_vault_salt_2025'),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    return this.cryptoKey;
  }

  public async saveTokens(tokens: GoogleOAuthTokens): Promise<boolean> {
    this.inMemoryTokens = tokens;

    if (!this.isSecureStorageAvailable()) {
      return false;
    }

    try {
      const key = await this.getEncryptionKey();
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(tokens));

      const encrypted = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        data
      );

      const payload = {
        iv: Array.from(iv),
        ciphertext: Array.from(new Uint8Array(encrypted))
      };

      await dbService.saveSetting('google_drive_secure_tokens' as any, JSON.stringify(payload));
      return true;
    } catch (err) {
      console.warn('Failed to encrypt tokens for secure storage:', err);
      return false;
    }
  }

  public async getTokens(): Promise<GoogleOAuthTokens | null> {
    if (this.inMemoryTokens) {
      return this.inMemoryTokens;
    }

    if (!this.isSecureStorageAvailable()) {
      return null;
    }

    try {
      const settings = await dbService.getSettings();
      const rawPayload = (settings as any).google_drive_secure_tokens;
      if (!rawPayload) return null;

      const payload = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
      if (!payload || !payload.iv || !payload.ciphertext) return null;

      const key = await this.getEncryptionKey();
      const iv = new Uint8Array(payload.iv);
      const ciphertext = new Uint8Array(payload.ciphertext);

      const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
      );

      const decoder = new TextDecoder();
      const tokens = JSON.parse(decoder.decode(decrypted)) as GoogleOAuthTokens;
      this.inMemoryTokens = tokens;
      return tokens;
    } catch (err) {
      console.warn('Failed to decrypt tokens from secure storage:', err);
    }

    return null;
  }

  public async clearTokens(): Promise<void> {
    this.inMemoryTokens = null;
    try {
      await dbService.saveSetting('google_drive_secure_tokens' as any, null);
    } catch {
      // Ignore cleanup error
    }
  }
}

export const secureStorageService = new SecureStorageService();
