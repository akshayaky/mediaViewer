import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMockTauriDatabase } from './tauriSqlMock';

vi.mock('@tauri-apps/plugin-sql', async () => {
  const { loadTauriSqlMock } = await import('./tauriSqlMock');
  return { default: { load: loadTauriSqlMock } };
});

import { dbService } from '../services/DatabaseService';
import { setLocalDeviceName } from '../sync/sqliteDelta';
import {
  completeHostPairingHandshake,
  createPairingHandshakeRequest,
  createPairingSession,
  encodeQrPairingPayload,
  finalizeClientPairingHandshake,
  getPairedDeviceCredential,
  hmacSha256Hex,
  listPairedDevices,
  normalizeCandidateIps,
  parseQrPairingPayload,
  sha256Hex,
  signAuthenticatedRequest,
  unpairDevice,
  verifyAuthenticatedRequest,
} from '../sync/qrPairing';

describe('Phase 2: QR Pairing & Handshake Layer', () => {
  beforeEach(async () => {
    await dbService.init();
    resetMockTauriDatabase();
  });

  it('computes standard SHA-256 and HMAC-SHA256 digests', () => {
    // NIST / RFC test vectors
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog')).toBe(
      'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'
    );
  });

  it('prioritizes routable LAN IPv4 addresses and filters invalid ones', () => {
    const normalized = normalizeCandidateIps([
      '127.0.0.1',
      '169.254.10.2',
      '192.168.1.45',
      '0.0.0.0',
      '999.1.2.3',
      '10.0.0.12',
      '192.168.1.45',
    ]);
    expect(normalized).toEqual(['192.168.1.45', '10.0.0.12', '127.0.0.1']);
  });

  it('encodes and parses a QR pairing payload and rejects expired or malformed codes', async () => {
    await setLocalDeviceName('Desktop Media');
    const now = 1_780_000_000_000;
    const session = await createPairingSession({
      ips: ['192.168.1.20', '10.0.0.5'],
      port: 47890,
      ttlMs: 60_000,
      nowMs: now,
    });

    const parsed = parseQrPairingPayload(session.qrText, now + 10_000);
    expect(parsed.valid).toBe(true);
    expect(parsed.payload?.deviceId).toBe(session.payload.deviceId);
    expect(parsed.payload?.deviceName).toBe('Desktop Media');
    expect(parsed.payload?.ips).toEqual(['192.168.1.20', '10.0.0.5']);
    expect(parsed.payload?.port).toBe(47890);

    // JSON representation also parses cleanly
    const jsonParsed = parseQrPairingPayload(JSON.stringify(session.payload), now + 10_000);
    expect(jsonParsed.valid).toBe(true);

    // Expired payload is rejected
    const expired = parseQrPairingPayload(session.qrText, now + 60_001);
    expect(expired.valid).toBe(false);
    expect(expired.reason).toMatch(/expired/i);

    // Malformed payloads are rejected
    expect(parseQrPairingPayload('https://example.com/nope', now).valid).toBe(false);
    expect(
      parseQrPairingPayload(
        encodeQrPairingPayload({
          ...session.payload,
          port: 47890,
        }).replace('p=47890', 'p=99999'),
        now
      ).valid
    ).toBe(false);
  });

  it('completes single-use handshake without transmitting token and persists identical shared secrets', async () => {
    const now = 1_780_000_000_000;
    const session = await createPairingSession({
      ips: ['192.168.1.50'],
      port: 47890,
      deviceInfo: { deviceId: 'dev_host', deviceName: 'Host PC' },
      nowMs: now,
    });

    const { request, clientNonce } = await createPairingHandshakeRequest(session.payload, {
      deviceInfo: { deviceId: 'dev_client', deviceName: 'Android Phone' },
      clientIp: '192.168.1.88',
      clientPort: 47891,
    });

    // Token must not appear in cleartext inside the handshake request
    expect(JSON.stringify(request)).not.toContain(session.payload.token);

    const hostResult = await completeHostPairingHandshake(session, request, {
      nowMs: now + 5_000,
    });
    expect(hostResult.response.accepted).toBe(true);
    expect(hostResult.device?.device_id).toBe('dev_client');
    expect(hostResult.device?.shared_secret).toBeTruthy();

    // Reusing the same session is rejected (single-use)
    const replayResult = await completeHostPairingHandshake(session, request, {
      nowMs: now + 6_000,
    });
    expect(replayResult.response.accepted).toBe(false);

    // Client finalizes using the host response and derives the exact same shared_secret
    const hostSecret = hostResult.device!.shared_secret!;
    resetMockTauriDatabase(); // Simulate separate device SQLite store for client persistence check
    const clientSaved = await finalizeClientPairingHandshake(
      session.payload,
      clientNonce,
      hostResult.response,
      '192.168.1.50'
    );

    expect(clientSaved.device_id).toBe('dev_host');
    expect(clientSaved.shared_secret).toBe(hostSecret);
    expect(clientSaved.last_ip).toBe('192.168.1.50');
    expect((await getPairedDeviceCredential('dev_host'))?.shared_secret).toBe(hostSecret);
    expect(await listPairedDevices()).toHaveLength(1);

    await unpairDevice('dev_host');
    expect(await getPairedDeviceCredential('dev_host')).toBeNull();
  });

  it('rejects pairing a device with itself or with invalid proof', async () => {
    const now = 1_780_000_000_000;
    const session = await createPairingSession({
      ips: ['192.168.1.50'],
      port: 47890,
      deviceInfo: { deviceId: 'dev_same', deviceName: 'Same' },
      nowMs: now,
    });

    await expect(
      createPairingHandshakeRequest(session.payload, {
        deviceInfo: { deviceId: 'dev_same', deviceName: 'Same' },
      })
    ).rejects.toThrow(/itself/i);

    const { request } = await createPairingHandshakeRequest(session.payload, {
      deviceInfo: { deviceId: 'dev_other', deviceName: 'Other' },
    });
    const badProof = await completeHostPairingHandshake(
      session,
      { ...request, proof: '0'.repeat(64) },
      { nowMs: now + 1000 }
    );
    expect(badProof.response.accepted).toBe(false);
    expect(session.consumed).toBe(false);
  });

  it('signs and verifies authenticated LAN sync requests', () => {
    const secret = 'shared-secret-hex';
    const body = JSON.stringify({ since: '2026-06-01T00:00:00.000Z' });
    const now = 1_780_000_000_000;
    const signed = signAuthenticatedRequest(secret, 'POST', '/sync/delta', body, now, 'nonce-1');

    expect(
      verifyAuthenticatedRequest(secret, 'POST', '/sync/delta', body, signed, { nowMs: now + 2_000 })
    ).toBe(true);
    // Tampered body fails verification
    expect(
      verifyAuthenticatedRequest(secret, 'POST', '/sync/delta', body + ' ', signed, {
        nowMs: now + 2_000,
      })
    ).toBe(false);
    // Expired timestamp fails verification
    expect(
      verifyAuthenticatedRequest(secret, 'POST', '/sync/delta', body, signed, {
        nowMs: now + 10 * 60_000,
      })
    ).toBe(false);
  });
});
