/**
 * Local Area Network (LAN) HTTP transport for peer-to-peer sync.
 *
 * Handles host listener lifecycle, incoming request dispatching, candidate
 * local IPv4 discovery, and multi-IP fallback requests. Contains zero UI or SQL.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { normalizeCandidateIps } from './qrPairing';

export const DEFAULT_SYNC_PORT = 47890;
export const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

export interface LanHttpRequest {
  method: 'GET' | 'POST';
  path: string;
  headers: Record<string, string>;
  body: string;
  remoteIp?: string;
}

export interface LanHttpResponse {
  status: number;
  headers?: Record<string, string>;
  body: string;
}

export type LanRequestHandler = (req: LanHttpRequest) => Promise<LanHttpResponse>;

export interface LanTransportAdapter {
  startServer(
    handler: LanRequestHandler,
    preferredPort?: number
  ): Promise<{ port: number; ips: string[] }>;
  stopServer(): Promise<void>;
  getCandidateIps(): Promise<string[]>;
  sendRequest(
    ip: string,
    port: number,
    req: LanHttpRequest,
    timeoutMs?: number
  ): Promise<LanHttpResponse>;
}

export interface LanAttemptFailure {
  ip: string;
  port: number;
  reason: string;
}

export class LanUnreachableError extends Error {
  public readonly attempts: LanAttemptFailure[];

  constructor(message: string, attempts: LanAttemptFailure[]) {
    super(message);
    this.name = 'LanUnreachableError';
    this.attempts = attempts;
  }
}

interface TauriIncomingSyncEvent {
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  remoteIp: string;
}

export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== 'undefined'
  );
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

/**
 * Production transport backed by the Rust `sync_server` module inside Tauri,
 * with a browser `fetch` client fallback for preview/non-Tauri contexts.
 */
export class TauriLanTransport implements LanTransportAdapter {
  private unlisten: UnlistenFn | null = null;
  private handler: LanRequestHandler | null = null;

  public async startServer(
    handler: LanRequestHandler,
    preferredPort: number = DEFAULT_SYNC_PORT
  ): Promise<{ port: number; ips: string[] }> {
    this.handler = handler;

    if (!isTauriRuntime()) {
      throw new Error('Hosting a LAN sync server requires the native desktop or mobile runtime.');
    }

    if (!this.unlisten) {
      this.unlisten = await listen<TauriIncomingSyncEvent>(
        'sync:incoming-request',
        async event => {
          const payload = event.payload;
          let response: LanHttpResponse;
          try {
            if (!this.handler) {
              response = { status: 503, body: JSON.stringify({ error: 'Sync host not ready' }) };
            } else {
              response = await this.handler({
                method: payload.method.toUpperCase() === 'GET' ? 'GET' : 'POST',
                path: payload.path,
                headers: normalizeHeaders(payload.headers || {}),
                body: payload.body || '',
                remoteIp: payload.remoteIp,
              });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Internal sync handler error';
            response = { status: 500, body: JSON.stringify({ error: msg }) };
          }

          try {
            await invoke('sync_server_respond', {
              requestId: payload.requestId,
              status: response.status,
              body: response.body,
              headers: response.headers ?? null,
            });
          } catch {
            // Connection may have timed out or closed before JS replied.
          }
        }
      );
    }

    const [port, ips] = await Promise.all([
      invoke<number>('sync_server_start', { preferredPort }),
      this.getCandidateIps(),
    ]);

    return { port, ips };
  }

  public async stopServer(): Promise<void> {
    this.handler = null;
    if (this.unlisten) {
      this.unlisten();
      this.unlisten = null;
    }
    if (isTauriRuntime()) {
      await invoke('sync_server_stop');
    }
  }

  public async getCandidateIps(): Promise<string[]> {
    if (!isTauriRuntime()) {
      return [];
    }
    const raw = await invoke<string[]>('sync_server_get_local_ips');
    return normalizeCandidateIps(raw || []);
  }

  public async sendRequest(
    ip: string,
    port: number,
    req: LanHttpRequest,
    timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
  ): Promise<LanHttpResponse> {
    if (isTauriRuntime()) {
      const res = await invoke<{
        status: number;
        headers: Record<string, string>;
        body: string;
      }>('sync_http_request', {
        ip,
        port,
        method: req.method,
        path: req.path,
        headers: req.headers,
        body: req.body,
        timeoutMs,
      });
      return {
        status: res.status,
        headers: normalizeHeaders(res.headers || {}),
        body: res.body,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const normalizedPath = req.path.startsWith('/') ? req.path : `/${req.path}`;
      const res = await fetch(`http://${ip}:${port}${normalizedPath}`, {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          ...req.headers,
        },
        body: req.method === 'GET' ? undefined : req.body,
        signal: controller.signal,
      });
      const body = await res.text();
      return {
        status: res.status,
        body,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createDefaultLanTransport(): LanTransportAdapter {
  return new TauriLanTransport();
}

/**
 * Attempts a LAN request against ordered candidate IPv4 addresses until one responds.
 * Throws `LanUnreachableError` only if every candidate endpoint fails at transport level.
 */
export async function tryRequestAcrossCandidateIps(
  transport: LanTransportAdapter,
  candidateIps: string[],
  port: number,
  req: LanHttpRequest,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<{ ip: string; response: LanHttpResponse }> {
  const uniqueIps = normalizeCandidateIps(candidateIps);
  if (uniqueIps.length === 0) {
    throw new LanUnreachableError('No candidate peer IPv4 addresses available.', []);
  }

  const failures: LanAttemptFailure[] = [];
  for (const ip of uniqueIps) {
    try {
      const response = await transport.sendRequest(ip, port, req, timeoutMs);
      return { ip, response };
    } catch (err) {
      failures.push({
        ip,
        port,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  throw new LanUnreachableError(
    `Peer unreachable across ${uniqueIps.length} candidate IP(s): ${uniqueIps.join(', ')}`,
    failures
  );
}
