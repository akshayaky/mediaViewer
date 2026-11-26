/**
 * QR-code pairing payload encoding/validation, short-lived single-use
 * pairing handshake logic, and paired-device credential storage helpers.
 *
 * Keeps pairing secrets out-of-band: the QR token is never transmitted in
 * cleartext during the LAN handshake; both sides verify proofs and derive a
 * shared secret persisted in `sync_devices`.
 */

import {
  getOrCreateLocalDeviceInfo,
  getSyncDevice,
  listSyncDevices,
  removeSyncDevice,
  upsertSyncDevice,
} from './sqliteDelta';
import {
  LocalDeviceInfo,
  PairingHandshakeRequest,
  PairingHandshakeResponse,
  PairingSession,
  QrPairingPayload,
  SqliteExecutor,
  SyncDeviceRecord,
} from './types';

export const QR_PAIRING_PREFIX = 'veyview://pair';
export const DEFAULT_PAIRING_TTL_MS = 120_000;
const MIN_PAIRING_TOKEN_LENGTH = 16;

// ==========================================
// 1. CRYPTOGRAPHIC PRIMITIVES (SYNC, ZERO-DEP)
// ==========================================

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function utf8ToBytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** Pure-TS SHA-256 digest returning lowercase hex, independent of HTTPS secure context. */
export function sha256Hex(message: string): string {
  const bytes = sha256Bytes(utf8ToBytes(message));
  return bytesToHex(bytes);
}

function sha256Bytes(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8;
  const paddedLen = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) {
    outView.setUint32(i * 4, h[i], false);
  }
  return out;
}

/** HMAC-SHA256 returning lowercase hex for authenticated LAN sync messages. */
export function hmacSha256Hex(key: string, message: string): string {
  const blockSize = 64;
  let keyBytes = utf8ToBytes(key);
  if (keyBytes.length > blockSize) {
    keyBytes = sha256Bytes(keyBytes);
  }
  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(keyBytes);

  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oKeyPad[i] = paddedKey[i] ^ 0x5c;
    iKeyPad[i] = paddedKey[i] ^ 0x36;
  }

  const msgBytes = utf8ToBytes(message);
  const inner = new Uint8Array(blockSize + msgBytes.length);
  inner.set(iKeyPad);
  inner.set(msgBytes, blockSize);
  const innerHash = sha256Bytes(inner);

  const outer = new Uint8Array(blockSize + innerHash.length);
  outer.set(oKeyPad);
  outer.set(innerHash, blockSize);
  return bytesToHex(sha256Bytes(outer));
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function generateRandomToken(byteLength = 24): string {
  const bytes = new Uint8Array(byteLength);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytesToHex(bytes);
}

// ==========================================
// 2. IPv4 & QR PAYLOAD ENCODING / VALIDATION
// ==========================================

export function isValidIpv4(ip: string): boolean {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part.startsWith('0')) return false;
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return false;
  }
  return true;
}

export function isRoutableLanIpv4(ip: string): boolean {
  if (!isValidIpv4(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  if (a === 0 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false; // Link-local APIPA
  return true;
}

export function normalizeCandidateIps(ips: string[]): string[] {
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const raw of ips) {
    const trimmed = raw.trim();
    if (!isValidIpv4(trimmed) || trimmed === '0.0.0.0' || trimmed === '255.255.255.255') {
      continue;
    }
    if (trimmed.startsWith('169.254.')) {
      continue;
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      valid.push(trimmed);
    }
  }
  // Prioritize private LAN IPv4 addresses ahead of loopback/other addresses.
  return valid.sort((a, b) => Number(isRoutableLanIpv4(b)) - Number(isRoutableLanIpv4(a)));
}

export interface QrValidationResult {
  valid: boolean;
  reason?: string;
  payload?: QrPairingPayload;
}

export function validateQrPairingPayload(
  candidate: unknown,
  nowMs: number = Date.now()
): QrValidationResult {
  if (!candidate || typeof candidate !== 'object') {
    return { valid: false, reason: 'QR payload must be an object.' };
  }

  const obj = candidate as Record<string, unknown>;
  if (obj.v !== 1) {
    return { valid: false, reason: 'Unsupported QR pairing version.' };
  }

  const deviceId = typeof obj.deviceId === 'string' ? obj.deviceId.trim() : '';
  const deviceName = typeof obj.deviceName === 'string' ? obj.deviceName.trim() : '';
  const token = typeof obj.token === 'string' ? obj.token.trim() : '';
  const expiresAt = typeof obj.expiresAt === 'string' ? obj.expiresAt.trim() : '';
  const port = typeof obj.port === 'number' ? obj.port : Number(obj.port);

  if (!deviceId) {
    return { valid: false, reason: 'Missing deviceId in QR payload.' };
  }
  if (!deviceName) {
    return { valid: false, reason: 'Missing deviceName in QR payload.' };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { valid: false, reason: 'Invalid port in QR payload.' };
  }
  if (token.length < MIN_PAIRING_TOKEN_LENGTH) {
    return { valid: false, reason: 'Invalid or too-short pairing token.' };
  }

  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) {
    return { valid: false, reason: 'Invalid expiresAt timestamp in QR payload.' };
  }
  if (expiresMs <= nowMs) {
    return { valid: false, reason: 'QR pairing code has expired.' };
  }

  const rawIps = Array.isArray(obj.ips)
    ? obj.ips.filter((v): v is string => typeof v === 'string')
    : [];
  const ips = normalizeCandidateIps(rawIps);
  if (ips.length === 0) {
    return { valid: false, reason: 'No valid IPv4 addresses in QR payload.' };
  }

  return {
    valid: true,
    payload: {
      v: 1,
      deviceId,
      deviceName,
      ips,
      port,
      token,
      expiresAt: new Date(expiresMs).toISOString(),
    },
  };
}

export function encodeQrPairingPayload(payload: QrPairingPayload): string {
  const validation = validateQrPairingPayload(payload, 0);
  if (!validation.valid || !validation.payload) {
    throw new Error(validation.reason || 'Invalid QR pairing payload.');
  }
  const p = validation.payload;
  const params = new URLSearchParams({
    v: String(p.v),
    d: p.deviceId,
    n: p.deviceName,
    ip: p.ips.join(','),
    p: String(p.port),
    t: p.token,
    exp: String(Date.parse(p.expiresAt)),
  });
  return `${QR_PAIRING_PREFIX}?${params.toString()}`;
}

export function parseQrPairingPayload(
  rawText: string,
  nowMs: number = Date.now()
): QrValidationResult {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { valid: false, reason: 'QR pairing text is empty.' };
  }

  if (trimmed.startsWith('{')) {
    try {
      return validateQrPairingPayload(JSON.parse(trimmed), nowMs);
    } catch {
      return { valid: false, reason: 'Malformed JSON QR pairing payload.' };
    }
  }

  if (!trimmed.startsWith(`${QR_PAIRING_PREFIX}?`)) {
    return { valid: false, reason: 'Unrecognized QR pairing format.' };
  }

  const queryString = trimmed.slice(QR_PAIRING_PREFIX.length + 1);
  const params = new URLSearchParams(queryString);
  const expRaw = params.get('exp') || '';
  const expNum = Number(expRaw);
  const expiresAt =
    /^\d+$/.test(expRaw) && Number.isFinite(expNum)
      ? new Date(expNum).toISOString()
      : expRaw;

  const candidate = {
    v: Number(params.get('v')),
    deviceId: params.get('d') || '',
    deviceName: params.get('n') || '',
    ips: (params.get('ip') || '').split(',').filter(Boolean),
    port: Number(params.get('p')),
    token: params.get('t') || '',
    expiresAt,
  };

  return validateQrPairingPayload(candidate, nowMs);
}

// ==========================================
// 3. PAIRING SESSION & HANDSHAKE LOGIC
// ==========================================

export interface CreatePairingSessionOptions {
  ips: string[];
  port: number;
  ttlMs?: number;
  deviceInfo?: LocalDeviceInfo;
  nowMs?: number;
}

export async function createPairingSession(
  options: CreatePairingSessionOptions,
  executor?: SqliteExecutor
): Promise<PairingSession> {
  const deviceInfo = options.deviceInfo ?? (await getOrCreateLocalDeviceInfo(executor));
  const nowMs = options.nowMs ?? Date.now();
  const ttlMs = options.ttlMs ?? DEFAULT_PAIRING_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error('Pairing session TTL must be positive.');
  }

  const ips = normalizeCandidateIps(options.ips);
  if (ips.length === 0) {
    throw new Error('At least one valid local IPv4 address is required to create a pairing QR.');
  }

  const payload: QrPairingPayload = {
    v: 1,
    deviceId: deviceInfo.deviceId,
    deviceName: deviceInfo.deviceName,
    ips,
    port: options.port,
    token: generateRandomToken(24),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
  };

  return {
    payload,
    qrText: encodeQrPairingPayload(payload),
    createdAt: new Date(nowMs).toISOString(),
    consumed: false,
  };
}

export function isPairingSessionActive(
  session: PairingSession,
  nowMs: number = Date.now()
): boolean {
  if (session.consumed) return false;
  const expMs = Date.parse(session.payload.expiresAt);
  return Number.isFinite(expMs) && expMs > nowMs;
}

function computeClientHandshakeProof(
  token: string,
  clientDeviceId: string,
  clientNonce: string
): string {
  return hmacSha256Hex(token, `pair-req:${clientDeviceId}:${clientNonce}`);
}

function deriveSharedSecret(
  token: string,
  clientNonce: string,
  hostNonce: string
): string {
  return hmacSha256Hex(token, `pair-secret:${clientNonce}:${hostNonce}:v1`);
}

function computeHostHandshakeProof(sharedSecret: string, hostDeviceId: string): string {
  return hmacSha256Hex(sharedSecret, `pair-ack:${hostDeviceId}`);
}

/**
 * Client side: builds a handshake request from a scanned QR payload without
 * putting the QR token on the wire in cleartext.
 */
export async function createPairingHandshakeRequest(
  payload: QrPairingPayload,
  options?: {
    clientIp?: string;
    clientPort?: number;
    deviceInfo?: LocalDeviceInfo;
    clientNonce?: string;
  },
  executor?: SqliteExecutor
): Promise<{ request: PairingHandshakeRequest; clientNonce: string }> {
  const localDevice = options?.deviceInfo ?? (await getOrCreateLocalDeviceInfo(executor));
  if (localDevice.deviceId === payload.deviceId) {
    throw new Error('Cannot pair a device with itself.');
  }

  const clientNonce = options?.clientNonce ?? generateRandomToken(16);
  const proof = computeClientHandshakeProof(payload.token, localDevice.deviceId, clientNonce);

  return {
    clientNonce,
    request: {
      version: 1,
      clientDeviceId: localDevice.deviceId,
      clientDeviceName: localDevice.deviceName,
      clientNonce,
      proof,
      clientIp: options?.clientIp,
      clientPort: options?.clientPort,
    },
  };
}

/**
 * Host side: validates a client's pairing handshake against an active single-use
 * session, derives the shared secret, persists the paired device, and returns an ack.
 */
export async function completeHostPairingHandshake(
  session: PairingSession,
  request: PairingHandshakeRequest,
  options?: { nowMs?: number; clientIp?: string },
  executor?: SqliteExecutor
): Promise<{ response: PairingHandshakeResponse; device?: SyncDeviceRecord }> {
  const nowMs = options?.nowMs ?? Date.now();
  const hostInfo = session.payload;

  if (session.consumed) {
    return {
      response: {
        version: 1,
        accepted: false,
        hostDeviceId: hostInfo.deviceId,
        hostDeviceName: hostInfo.deviceName,
        reason: 'Pairing session has already been used.',
      },
    };
  }

  if (!isPairingSessionActive(session, nowMs)) {
    return {
      response: {
        version: 1,
        accepted: false,
        hostDeviceId: hostInfo.deviceId,
        hostDeviceName: hostInfo.deviceName,
        reason: 'Pairing session has expired.',
      },
    };
  }

  if (request.version !== 1 || !request.clientDeviceId || !request.clientDeviceName || !request.clientNonce || !request.proof) {
    return {
      response: {
        version: 1,
        accepted: false,
        hostDeviceId: hostInfo.deviceId,
        hostDeviceName: hostInfo.deviceName,
        reason: 'Invalid pairing handshake request.',
      },
    };
  }

  if (request.clientDeviceId === hostInfo.deviceId) {
    return {
      response: {
        version: 1,
        accepted: false,
        hostDeviceId: hostInfo.deviceId,
        hostDeviceName: hostInfo.deviceName,
        reason: 'Cannot pair a device with itself.',
      },
    };
  }

  const expectedProof = computeClientHandshakeProof(
    hostInfo.token,
    request.clientDeviceId,
    request.clientNonce
  );
  if (!constantTimeEqual(request.proof, expectedProof)) {
    return {
      response: {
        version: 1,
        accepted: false,
        hostDeviceId: hostInfo.deviceId,
        hostDeviceName: hostInfo.deviceName,
        reason: 'Pairing verification failed.',
      },
    };
  }

  session.consumed = true;
  const hostNonce = generateRandomToken(16);
  const sharedSecret = deriveSharedSecret(hostInfo.token, request.clientNonce, hostNonce);
  const hostProof = computeHostHandshakeProof(sharedSecret, hostInfo.deviceId);

  const device = await savePairedDeviceCredential(
    {
      deviceId: request.clientDeviceId,
      deviceName: request.clientDeviceName,
      sharedSecret,
      lastIp: options?.clientIp ?? request.clientIp ?? null,
      lastPort: request.clientPort ?? null,
    },
    executor
  );

  return {
    device,
    response: {
      version: 1,
      accepted: true,
      hostDeviceId: hostInfo.deviceId,
      hostDeviceName: hostInfo.deviceName,
      hostNonce,
      hostProof,
    },
  };
}

/**
 * Client side: verifies the host's handshake response, derives the matching
 * shared secret, and persists the host device credentials locally.
 */
export async function finalizeClientPairingHandshake(
  payload: QrPairingPayload,
  clientNonce: string,
  response: PairingHandshakeResponse,
  connectedIp?: string,
  executor?: SqliteExecutor
): Promise<SyncDeviceRecord> {
  if (!response.accepted || !response.hostNonce || !response.hostProof) {
    throw new Error(response.reason || 'Host rejected pairing handshake.');
  }
  if (response.hostDeviceId !== payload.deviceId) {
    throw new Error('Host deviceId mismatch during pairing handshake.');
  }

  const sharedSecret = deriveSharedSecret(payload.token, clientNonce, response.hostNonce);
  const expectedHostProof = computeHostHandshakeProof(sharedSecret, payload.deviceId);
  if (!constantTimeEqual(response.hostProof, expectedHostProof)) {
    throw new Error('Host pairing proof verification failed.');
  }

  return savePairedDeviceCredential(
    {
      deviceId: payload.deviceId,
      deviceName: response.hostDeviceName || payload.deviceName,
      sharedSecret,
      lastIp: connectedIp ?? payload.ips[0] ?? null,
      lastPort: payload.port,
    },
    executor
  );
}

// ==========================================
// 4. CREDENTIAL STORAGE & REQUEST SIGNING
// ==========================================

export interface SavePairedDeviceInput {
  deviceId: string;
  deviceName: string;
  sharedSecret: string;
  lastIp?: string | null;
  lastPort?: number | null;
}

export async function savePairedDeviceCredential(
  input: SavePairedDeviceInput,
  executor?: SqliteExecutor
): Promise<SyncDeviceRecord> {
  if (!input.deviceId || !input.deviceName || !input.sharedSecret) {
    throw new Error('deviceId, deviceName, and sharedSecret are required.');
  }
  return upsertSyncDevice(
    {
      device_id: input.deviceId,
      device_name: input.deviceName,
      shared_secret: input.sharedSecret,
      last_ip: input.lastIp ?? null,
      last_port: input.lastPort ?? null,
      last_synced_at: null,
    },
    executor
  );
}

export async function getPairedDeviceCredential(
  deviceId: string,
  executor?: SqliteExecutor
): Promise<SyncDeviceRecord | null> {
  return getSyncDevice(deviceId, executor);
}

export async function listPairedDevices(executor?: SqliteExecutor): Promise<SyncDeviceRecord[]> {
  return listSyncDevices(executor);
}

export async function unpairDevice(deviceId: string, executor?: SqliteExecutor): Promise<void> {
  return removeSyncDevice(deviceId, executor);
}

export function signAuthenticatedRequest(
  sharedSecret: string,
  method: string,
  path: string,
  body: string,
  timestampMs: number = Date.now(),
  nonce: string = generateRandomToken(12)
): { timestamp: string; nonce: string; signature: string } {
  const timestamp = String(timestampMs);
  const canonical = `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${body}`;
  return {
    timestamp,
    nonce,
    signature: hmacSha256Hex(sharedSecret, canonical),
  };
}

export function verifyAuthenticatedRequest(
  sharedSecret: string,
  method: string,
  path: string,
  body: string,
  headers: { timestamp: string; nonce: string; signature: string },
  options?: { nowMs?: number; maxSkewMs?: number }
): boolean {
  const nowMs = options?.nowMs ?? Date.now();
  const maxSkewMs = options?.maxSkewMs ?? 5 * 60_000;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > maxSkewMs) {
    return false;
  }
  if (!headers.nonce || !headers.signature) {
    return false;
  }
  const canonical = `${method.toUpperCase()}\n${path}\n${headers.timestamp}\n${headers.nonce}\n${body}`;
  const expected = hmacSha256Hex(sharedSecret, canonical);
  return constantTimeEqual(headers.signature, expected);
}
