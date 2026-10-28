import { googleOAuthService } from './GoogleOAuthService';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  version?: string;
  headRevisionId?: string;
  size?: string;
  etag?: string;
}

export interface DriveUploadOptions {
  name: string;
  content: string | object;
  fileId?: string;
  etag?: string;
}

export interface DriveAdapterResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: 'UNAUTHORIZED' | 'CONFLICT' | 'OFFLINE' | 'NOT_FOUND' | 'UNKNOWN';
}

export class GoogleDriveAdapter {
  private baseUrl = 'https://www.googleapis.com/drive/v3';
  private uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files';

  private async httpFetch(url: string, options?: RequestInit): Promise<Response> {
    try {
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        return await tauriFetch(url, options as any);
      }
    } catch {
      // Fallback to standard fetch
    }
    return fetch(url, options);
  }

  private async getAuthHeader(): Promise<string> {
    const token = await googleOAuthService.getValidAccessToken();
    if (!token) {
      throw new Error('UNAUTHORIZED');
    }
    return `Bearer ${token}`;
  }

  /**
   * Executes a Drive API call with exponential backoff retries and automatic token refresh.
   */
  private async executeWithRetry<T>(
    fn: () => Promise<Response>,
    retries = 3
  ): Promise<DriveAdapterResult<T>> {
    let delay = 500;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fn();

        if (response.status === 401 && attempt < retries) {
          // Token expired, attempt refresh
          const token = await googleOAuthService.getValidAccessToken();
          if (!token) {
            return { success: false, error: 'Google Account unauthorized or session expired', errorCode: 'UNAUTHORIZED' };
          }
          continue;
        }

        if (response.status === 412) {
          return { success: false, error: 'Concurrency conflict: file was modified remotely (ETag mismatch)', errorCode: 'CONFLICT' };
        }

        if (response.status === 404) {
          return { success: false, error: 'File not found on Google Drive', errorCode: 'NOT_FOUND' };
        }

        if (response.ok) {
          const text = await response.text();
          let data: T | undefined = undefined;
          if (text && text.trim()) {
            try {
              data = JSON.parse(text) as T;
            } catch {
              data = text as unknown as T;
            }
          }
          return { success: true, data };
        }

        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          await new Promise(r => setTimeout(r, delay));
          delay *= 2;
          continue;
        }

        const errText = await response.text();
        return { success: false, error: `Drive API HTTP ${response.status}: ${errText}`, errorCode: 'UNKNOWN' };
      } catch (err: any) {
        if (attempt === retries) {
          return {
            success: false,
            error: err.message || 'Network connection failed while syncing with Google Drive',
            errorCode: 'OFFLINE'
          };
        }
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      }
    }

    return { success: false, error: 'Operation failed after retries', errorCode: 'UNKNOWN' };
  }

  /**
   * Lists files in the user's private Google Drive appDataFolder.
   */
  public async listAppDataFiles(): Promise<DriveAdapterResult<DriveFileMetadata[]>> {
    return this.executeWithRetry<{ files: DriveFileMetadata[] }>(async () => {
      const auth = await this.getAuthHeader();
      const params = new URLSearchParams({
        spaces: 'appDataFolder',
        fields: 'files(id, name, mimeType, modifiedTime, version, headRevisionId, size)',
        pageSize: '100'
      });
      return this.httpFetch(`${this.baseUrl}/files?${params.toString()}`, {
        headers: { Authorization: auth }
      });
    }).then(res => {
      if (res.success && res.data) {
        return { success: true, data: res.data.files || [] };
      }
      return { success: false, error: res.error, errorCode: res.errorCode };
    });
  }

  /**
   * Downloads file content from Google Drive by file ID.
   */
  public async downloadFile<T>(fileId: string): Promise<DriveAdapterResult<{ content: T; etag?: string }>> {
    try {
      const auth = await this.getAuthHeader();
      const response = await this.httpFetch(`${this.baseUrl}/files/${fileId}?alt=media`, {
        headers: { Authorization: auth }
      });

      if (!response.ok) {
        if (response.status === 401) {
          return { success: false, error: 'Unauthorized', errorCode: 'UNAUTHORIZED' };
        }
        if (response.status === 404) {
          return { success: false, error: 'File not found', errorCode: 'NOT_FOUND' };
        }
        return { success: false, error: `HTTP ${response.status}`, errorCode: 'UNKNOWN' };
      }

      const etag = response.headers.get('ETag') || undefined;
      const text = await response.text();
      let content: T;
      try {
        content = JSON.parse(text) as T;
      } catch {
        content = text as unknown as T;
      }

      return { success: true, data: { content, etag } };
    } catch (err: any) {
      return { success: false, error: err.message || 'Download failed', errorCode: 'OFFLINE' };
    }
  }

  /**
   * Uploads or updates a file in the appDataFolder with optimistic concurrency control.
   */
  public async uploadAppDataFile(options: DriveUploadOptions): Promise<DriveAdapterResult<DriveFileMetadata>> {
    const stringContent = typeof options.content === 'string' ? options.content : JSON.stringify(options.content, null, 2);

    if (options.fileId) {
      // Update existing file
      return this.executeWithRetry<DriveFileMetadata>(async () => {
        const auth = await this.getAuthHeader();
        const headers: Record<string, string> = {
          Authorization: auth,
          'Content-Type': 'application/json'
        };
        if (options.etag) {
          headers['If-Match'] = options.etag;
        }

        return this.httpFetch(`${this.uploadUrl}/${options.fileId}?uploadType=media`, {
          method: 'PATCH',
          headers,
          body: stringContent
        });
      });
    }

    // Create new file in appDataFolder
    return this.executeWithRetry<DriveFileMetadata>(async () => {
      const auth = await this.getAuthHeader();
      const metadata = {
        name: options.name,
        parents: ['appDataFolder'],
        mimeType: 'application/json'
      };

      const boundary = '-------314159265358979323846';
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const body =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        stringContent +
        closeDelimiter;

      return this.httpFetch(`${this.uploadUrl}?uploadType=multipart`, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': `multipart/related; boundary="${boundary}"`
        },
        body
      });
    });
  }

  /**
   * Deletes a file from Google Drive.
   */
  public async deleteFile(fileId: string): Promise<DriveAdapterResult<void>> {
    return this.executeWithRetry<void>(async () => {
      const auth = await this.getAuthHeader();
      return this.httpFetch(`${this.baseUrl}/files/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: auth }
      });
    });
  }
}

export const googleDriveAdapter = new GoogleDriveAdapter();
