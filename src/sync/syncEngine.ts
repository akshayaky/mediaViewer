/**
 * High-level serverless LAN sync & QR pairing orchestrator.
 *
 * Coordinates `qrPairing.ts`, `lanTransport.ts`, and `sqliteDelta.ts`, exposing
 * observable state transitions (`idle`, `pairing`, `syncing`, `error`, `offline`)
 * for thin UI components.
 */

import {
  DEFAULT_SYNC_PORT,
  LanHttpRequest,
  LanHttpResponse,
  LanTransportAdapter,
  LanUnreachableError,
  createDefaultLanTransport,
  isTauriRuntime,
  tryRequestAcrossCandidateIps,
} from './lanTransport';
import {
  DEFAULT_PAIRING_TTL_MS,
  completeHostPairingHandshake,
  createPairingHandshakeRequest,
  createPairingSession,
  finalizeClientPairingHandshake,
  getPairedDeviceCredential,
  isRoutableLanIpv4,
  listPairedDevices,
  normalizeCandidateIps,
  parseQrPairingPayload,
  signAuthenticatedRequest,
  unpairDevice as removePairedDevice,
  verifyAuthenticatedRequest,
} from './qrPairing';
import {
  applyDelta,
  exportDeltaSince,
  getOrCreateLocalDeviceInfo,
  setLocalDeviceName,
  updateLastSyncedAt,
  upsertSyncDevice,
} from './sqliteDelta';
import {
  LocalDeviceInfo,
  PairingHandshakeRequest,
  PairingHandshakeResponse,
  PairingSession,
  SqliteExecutor,
  SyncApplyStats,
  SyncDeviceRecord,
  SyncError,
  SyncExchangeRequest,
  SyncExchangeResponse,
  SyncStateSnapshot,
  SyncStatus,
} from './types';

export interface SyncEngineOptions {
  transport?: LanTransportAdapter;
  executor?: SqliteExecutor;
  preferredPort?: number;
  requestTimeoutMs?: number;
}

export type SyncStateListener = (snapshot: SyncStateSnapshot) => void;

function toSyncError(code: string, err: unknown): SyncError {
  if (err instanceof Error) {
    return { code, message: err.message, cause: err };
  }
  return { code, message: String(err), cause: err };
}

export class SyncEngine {
  private readonly transport: LanTransportAdapter;
  private readonly executor?: SqliteExecutor;
  private readonly preferredPort: number;
  private readonly requestTimeoutMs?: number;
  private readonly listeners = new Set<SyncStateListener>();
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null;
  private autoSyncCleanup: (() => void) | null = null;
  private lastAutoSyncAttemptMs = 0;

  private state: SyncStateSnapshot = {
    status: 'idle',
    localDevice: null,
    activePeerId: null,
    lastSyncedAt: null,
    lastStats: null,
    error: null,
    hostingPort: null,
    hostingIps: [],
    activePairingSession: null,
  };

  constructor(options: SyncEngineOptions = {}) {
    this.transport = options.transport ?? createDefaultLanTransport();
    this.executor = options.executor;
    this.preferredPort = options.preferredPort ?? DEFAULT_SYNC_PORT;
    this.requestTimeoutMs = options.requestTimeoutMs;
  }

  public getState(): SyncStateSnapshot {
    return { ...this.state };
  }

  public subscribe(listener: SyncStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(patch: Partial<SyncStateSnapshot>): void {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private setStatus(status: SyncStatus, extra: Partial<SyncStateSnapshot> = {}): void {
    this.setState({ status, ...extra });
  }

  public async getLocalDeviceInfo(): Promise<LocalDeviceInfo> {
    const info = await getOrCreateLocalDeviceInfo(this.executor);
    this.setState({ localDevice: info });
    return info;
  }

  public async renameLocalDevice(deviceName: string): Promise<LocalDeviceInfo> {
    await setLocalDeviceName(deviceName, this.executor);
    return this.getLocalDeviceInfo();
  }

  public async getPairedDevices(): Promise<SyncDeviceRecord[]> {
    return listPairedDevices(this.executor);
  }

  public async unpairDevice(deviceId: string): Promise<void> {
    await removePairedDevice(deviceId, this.executor);
  }

  public async refreshCandidateIps(): Promise<string[]> {
    const ips = await this.transport.getCandidateIps();
    this.setState({ hostingIps: ips });
    return ips;
  }

  public async startHosting(port: number = this.preferredPort): Promise<{ port: number; ips: string[] }> {
    await this.getLocalDeviceInfo();
    const { port: boundPort, ips } = await this.transport.startServer(
      req => this.handleIncomingRequest(req),
      port
    );
    this.setState({
      hostingPort: boundPort,
      hostingIps: ips,
      error: null,
    });
    return { port: boundPort, ips };
  }

  public async stopHosting(): Promise<void> {
    await this.transport.stopServer();
    this.setState({
      hostingPort: null,
      activePairingSession: null,
      status: this.state.status === 'pairing' ? 'idle' : this.state.status,
    });
  }

  /**
   * Starts hosting if needed and generates a short-lived QR pairing session.
   */
  public async startPairingSession(
    options?: { ttlMs?: number; overrideIps?: string[]; port?: number }
  ): Promise<PairingSession> {
    try {
      this.setStatus('pairing', { error: null });
      const localDevice = await this.getLocalDeviceInfo();

      let port = this.state.hostingPort;
      let ips = this.state.hostingIps;
      if (!port) {
        const hosted = await this.startHosting(options?.port ?? this.preferredPort);
        port = hosted.port;
        ips = hosted.ips;
      } else if (ips.length === 0) {
        ips = await this.refreshCandidateIps();
      }

      const finalIps = normalizeCandidateIps([...(options?.overrideIps ?? []), ...ips]);
      if (finalIps.length === 0) {
        throw new Error('No local Wi-Fi IPv4 address detected. Ensure Wi-Fi is connected.');
      }

      const session = await createPairingSession(
        {
          ips: finalIps,
          port,
          ttlMs: options?.ttlMs ?? DEFAULT_PAIRING_TTL_MS,
          deviceInfo: localDevice,
        },
        this.executor
      );

      this.setState({
        status: 'pairing',
        hostingIps: finalIps,
        activePairingSession: session,
      });
      return session;
    } catch (err) {
      this.setStatus('error', {
        activePairingSession: null,
        error: toSyncError('PAIRING_SESSION_FAILED', err),
      });
      throw err;
    }
  }

  public cancelPairingSession(): void {
    this.setState({
      activePairingSession: null,
      status: this.state.status === 'pairing' ? 'idle' : this.state.status,
      error: null,
    });
  }

  /**
   * Client flow: scans/parses QR text, connects across candidate IPs,
   * completes single-use pairing handshake, and stores shared credentials.
   */
  public async pairWithQrText(qrText: string): Promise<SyncDeviceRecord> {
    const parsed = parseQrPairingPayload(qrText);
    if (!parsed.valid || !parsed.payload) {
      const err = new Error(parsed.reason || 'Invalid QR pairing code.');
      this.setStatus('error', { error: toSyncError('INVALID_QR', err) });
      throw err;
    }

    const payload = parsed.payload;
    this.setStatus('pairing', { activePeerId: payload.deviceId, error: null });

    try {
      const localDevice = await this.getLocalDeviceInfo();
      if (isTauriRuntime() && !this.state.hostingPort) {
        await this.startHosting(this.preferredPort).catch(() => {
          // Non-fatal if client cannot bind a host port on this network.
        });
      }
      const candidateClientIps = await this.transport.getCandidateIps();
      const { request, clientNonce } = await createPairingHandshakeRequest(
        payload,
        {
          deviceInfo: localDevice,
          clientIp: candidateClientIps[0],
          clientPort: this.state.hostingPort ?? this.preferredPort,
        },
        this.executor
      );

      const { ip, response } = await tryRequestAcrossCandidateIps(
        this.transport,
        payload.ips,
        payload.port,
        {
          method: 'POST',
          path: '/sync/pair',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        },
        this.requestTimeoutMs
      );

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Peer rejected pairing (${response.status}): ${response.body}`);
      }

      const handshakeAck = JSON.parse(response.body) as PairingHandshakeResponse;
      const saved = await finalizeClientPairingHandshake(
        payload,
        clientNonce,
        handshakeAck,
        ip,
        this.executor
      );

      this.setStatus('idle', {
        activePeerId: null,
        error: null,
      });
      return saved;
    } catch (err) {
      if (err instanceof LanUnreachableError) {
        this.setStatus('offline', {
          activePeerId: null,
          error: toSyncError('PEER_OFFLINE', err),
        });
      } else {
        this.setStatus('error', {
          activePeerId: null,
          error: toSyncError('PAIRING_FAILED', err),
        });
      }
      throw err;
    }
  }

  /**
   * Bidirectional incremental delta sync with a paired peer.
   * Sends local deltas since `last_synced_at`, requests peer deltas since
   * `peer_cursor`, applies incoming rows, and updates both sync cursors.
   */
  public async syncWithDevice(
    deviceId: string,
    overrideIps?: string[]
  ): Promise<SyncApplyStats> {
    const peer = await getPairedDeviceCredential(deviceId, this.executor);
    if (!peer || !peer.shared_secret) {
      const err = new Error(`Device ${deviceId} is not paired or missing shared secret.`);
      this.setStatus('error', { error: toSyncError('NOT_PAIRED', err) });
      throw err;
    }

    const candidateIps = normalizeCandidateIps([
      ...(overrideIps ?? []),
      ...(peer.last_ip ? [peer.last_ip] : []),
    ]);
    const port = peer.last_port ?? this.preferredPort;

    if (candidateIps.length === 0) {
      const err = new Error(`No known LAN IP address for ${peer.device_name}.`);
      this.setStatus('offline', {
        activePeerId: deviceId,
        error: toSyncError('NO_PEER_IP', err),
      });
      throw err;
    }

    this.setStatus('syncing', { activePeerId: deviceId, error: null });

    try {
      const localDevice = await this.getLocalDeviceInfo();
      const outgoingDelta = await exportDeltaSince(peer.last_synced_at, this.executor);
      const localIps =
        this.state.hostingIps.length > 0
          ? this.state.hostingIps
          : await this.transport.getCandidateIps();

      const exchangeReq: SyncExchangeRequest = {
        version: 1,
        senderDeviceId: localDevice.deviceId,
        senderDeviceName: localDevice.deviceName,
        senderIp: localIps[0],
        senderPort: this.state.hostingPort ?? undefined,
        sinceForReceiver: peer.peer_cursor ?? null,
        delta: outgoingDelta,
      };

      const rawBody = JSON.stringify(exchangeReq);
      const auth = signAuthenticatedRequest(peer.shared_secret, 'POST', '/sync/exchange', rawBody);

      const { ip, response } = await tryRequestAcrossCandidateIps(
        this.transport,
        candidateIps,
        port,
        {
          method: 'POST',
          path: '/sync/exchange',
          headers: {
            'content-type': 'application/json',
            'x-veyview-device-id': localDevice.deviceId,
            'x-veyview-timestamp': auth.timestamp,
            'x-veyview-nonce': auth.nonce,
            'x-veyview-signature': auth.signature,
          },
          body: rawBody,
        },
        this.requestTimeoutMs
      );

      if (response.status === 401) {
        throw new Error('Peer rejected sync authentication. Please re-pair devices.');
      }
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Peer sync failed (${response.status}): ${response.body}`);
      }

      const exchangeResp = JSON.parse(response.body) as SyncExchangeResponse;
      if (!exchangeResp.accepted || exchangeResp.version !== 1) {
        throw new Error('Peer declined delta exchange.');
      }

      const stats = await applyDelta(exchangeResp.delta, this.executor);

      await upsertSyncDevice(
        {
          device_id: peer.device_id,
          device_name: exchangeResp.responderDeviceName || peer.device_name,
          last_ip: ip,
          last_port: port,
          last_synced_at: outgoingDelta.generatedAt,
          peer_cursor: exchangeResp.delta.generatedAt,
        },
        this.executor
      );

      this.setStatus('idle', {
        activePeerId: null,
        lastSyncedAt: outgoingDelta.generatedAt,
        lastStats: stats,
        error: null,
      });
      return stats;
    } catch (err) {
      if (err instanceof LanUnreachableError) {
        this.setStatus('offline', {
          activePeerId: null,
          error: toSyncError('PEER_OFFLINE', err),
        });
      } else {
        this.setStatus('error', {
          activePeerId: null,
          error: toSyncError('SYNC_FAILED', err),
        });
      }
      throw err;
    }
  }

  public async syncAllPairedDevices(): Promise<Record<string, SyncApplyStats | SyncError>> {
    const devices = await this.getPairedDevices();
    const results: Record<string, SyncApplyStats | SyncError> = {};
    for (const device of devices) {
      try {
        results[device.device_id] = await this.syncWithDevice(device.device_id);
      } catch (err) {
        results[device.device_id] = toSyncError(
          err instanceof LanUnreachableError ? 'PEER_OFFLINE' : 'SYNC_FAILED',
          err
        );
      }
    }
    return results;
  }

  /**
   * Starts the LAN host listener and enables automatic background sync on
   * startup, window focus/visibility, network reconnect, and periodic intervals.
   */
  public async startAutoSync(options?: {
    intervalMs?: number;
    minFocusGapMs?: number;
  }): Promise<void> {
    this.stopAutoSync();

    const intervalMs = options?.intervalMs ?? 60_000;
    const minFocusGapMs = options?.minFocusGapMs ?? 15_000;

    if (isTauriRuntime() && !this.state.hostingPort) {
      await this.startHosting(this.preferredPort).catch(() => {
        // Ignore startup bind failure if Wi-Fi is unavailable.
      });
    }

    const triggerBackgroundSync = async () => {
      if (this.state.status === 'pairing' || this.state.status === 'syncing') {
        return;
      }
      const now = Date.now();
      if (now - this.lastAutoSyncAttemptMs < minFocusGapMs) {
        return;
      }
      const devices = await this.getPairedDevices().catch(() => []);
      if (devices.length === 0) return;

      this.lastAutoSyncAttemptMs = now;
      await this.syncAllPairedDevices().catch(() => {
        // Offline/unreachable peers are reflected in state without crashing.
      });
    };

    void triggerBackgroundSync();

    this.autoSyncTimer = setInterval(() => {
      void triggerBackgroundSync();
    }, intervalMs);

    if (typeof window !== 'undefined') {
      const onResume = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        void triggerBackgroundSync();
      };
      window.addEventListener('focus', onResume);
      window.addEventListener('online', onResume);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', onResume);
      }
      this.autoSyncCleanup = () => {
        window.removeEventListener('focus', onResume);
        window.removeEventListener('online', onResume);
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', onResume);
        }
      };
    }
  }

  public stopAutoSync(): void {
    if (this.autoSyncTimer !== null) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
    if (this.autoSyncCleanup) {
      this.autoSyncCleanup();
      this.autoSyncCleanup = null;
    }
  }

  // ==========================================
  // INCOMING LAN HOST REQUEST HANDLERS
  // ==========================================

  private async handleIncomingRequest(req: LanHttpRequest): Promise<LanHttpResponse> {
    if (req.method === 'GET' && req.path === '/sync/ping') {
      const localDevice = await this.getLocalDeviceInfo();
      return {
        status: 200,
        body: JSON.stringify({
          ok: true,
          deviceId: localDevice.deviceId,
          deviceName: localDevice.deviceName,
        }),
      };
    }

    if (req.method === 'POST' && req.path === '/sync/pair') {
      return this.handleIncomingPair(req);
    }

    if (req.method === 'POST' && req.path === '/sync/exchange') {
      return this.handleIncomingExchange(req);
    }

    return {
      status: 404,
      body: JSON.stringify({ error: `Unknown sync route: ${req.method} ${req.path}` }),
    };
  }

  private async handleIncomingPair(req: LanHttpRequest): Promise<LanHttpResponse> {
    const session = this.state.activePairingSession;
    if (!session) {
      return {
        status: 400,
        body: JSON.stringify({
          version: 1,
          accepted: false,
          hostDeviceId: this.state.localDevice?.deviceId ?? '',
          hostDeviceName: this.state.localDevice?.deviceName ?? '',
          reason: 'No active pairing session on host.',
        } satisfies PairingHandshakeResponse),
      };
    }

    let parsedReq: PairingHandshakeRequest;
    try {
      parsedReq = JSON.parse(req.body) as PairingHandshakeRequest;
    } catch {
      return { status: 400, body: JSON.stringify({ error: 'Invalid JSON pairing request' }) };
    }

    const clientIp =
      req.remoteIp && isRoutableLanIpv4(req.remoteIp)
        ? req.remoteIp
        : parsedReq.clientIp;

    const result = await completeHostPairingHandshake(
      session,
      parsedReq,
      { clientIp },
      this.executor
    );

    if (result.response.accepted) {
      this.setState({
        activePairingSession: null,
        status: 'idle',
        error: null,
      });
    }

    return {
      status: result.response.accepted ? 200 : 400,
      body: JSON.stringify(result.response),
    };
  }

  private async handleIncomingExchange(req: LanHttpRequest): Promise<LanHttpResponse> {
    const deviceIdHeader = req.headers['x-veyview-device-id'] || '';
    const timestamp = req.headers['x-veyview-timestamp'] || '';
    const nonce = req.headers['x-veyview-nonce'] || '';
    const signature = req.headers['x-veyview-signature'] || '';

    let exchangeReq: SyncExchangeRequest;
    try {
      exchangeReq = JSON.parse(req.body) as SyncExchangeRequest;
    } catch {
      return { status: 400, body: JSON.stringify({ error: 'Invalid JSON sync payload' }) };
    }

    const senderDeviceId = deviceIdHeader || exchangeReq.senderDeviceId;
    const peer = senderDeviceId
      ? await getPairedDeviceCredential(senderDeviceId, this.executor)
      : null;

    if (!peer || !peer.shared_secret) {
      return {
        status: 401,
        body: JSON.stringify({ error: 'Unknown or unpaired sync device' }),
      };
    }

    const validAuth = verifyAuthenticatedRequest(
      peer.shared_secret,
      'POST',
      '/sync/exchange',
      req.body,
      { timestamp, nonce, signature }
    );
    if (!validAuth) {
      return {
        status: 401,
        body: JSON.stringify({ error: 'Invalid sync request signature' }),
      };
    }

    this.setStatus('syncing', { activePeerId: peer.device_id, error: null });

    try {
      const localDevice = await this.getLocalDeviceInfo();
      const appliedStats = await applyDelta(exchangeReq.delta, this.executor);
      const outgoingDelta = await exportDeltaSince(
        exchangeReq.sinceForReceiver,
        this.executor
      );

      const peerIp =
        req.remoteIp && isRoutableLanIpv4(req.remoteIp)
          ? req.remoteIp
          : exchangeReq.senderIp ?? peer.last_ip;

      await upsertSyncDevice(
        {
          device_id: peer.device_id,
          device_name: exchangeReq.senderDeviceName || peer.device_name,
          last_ip: peerIp ?? null,
          last_port: exchangeReq.senderPort ?? peer.last_port ?? null,
          last_synced_at: outgoingDelta.generatedAt,
          peer_cursor: exchangeReq.delta.generatedAt,
        },
        this.executor
      );
      await updateLastSyncedAt(
        peer.device_id,
        outgoingDelta.generatedAt,
        this.executor,
        exchangeReq.delta.generatedAt
      );

      const responseBody: SyncExchangeResponse = {
        version: 1,
        accepted: true,
        responderDeviceId: localDevice.deviceId,
        responderDeviceName: localDevice.deviceName,
        appliedStats,
        delta: outgoingDelta,
      };

      this.setStatus('idle', {
        activePeerId: null,
        lastSyncedAt: outgoingDelta.generatedAt,
        lastStats: appliedStats,
        error: null,
      });

      return {
        status: 200,
        body: JSON.stringify(responseBody),
      };
    } catch (err) {
      this.setStatus('error', {
        activePeerId: null,
        error: toSyncError('INCOMING_SYNC_FAILED', err),
      });
      return {
        status: 500,
        body: JSON.stringify({
          error: err instanceof Error ? err.message : 'Failed to process sync exchange',
        }),
      };
    }
  }
}

export const syncEngine = new SyncEngine();
