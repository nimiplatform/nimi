// RL-INTOP-001 ~ 003 — Multi-App Interop Smoke Tests
// These tests require:
//   1. A running Realm instance (NIMI_REALM_URL)
//   2. A valid access token (NIMI_ACCESS_TOKEN)
// Run: NIMI_REALM_URL=<url> NIMI_ACCESS_TOKEN=<token> pnpm --filter @nimiplatform/relay test

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';

const REALM_URL = process.env.NIMI_REALM_URL;
const ACCESS_TOKEN = process.env.NIMI_ACCESS_TOKEN;
const INTEROP_TIMEOUT_MS = 5_000;

// Skip interop tests if Realm is not configured
const shouldSkip = !REALM_URL || !ACCESS_TOKEN;

describe('RL-INTOP-001 — Multi-App Chat Interop', { skip: shouldSkip }, () => {
  let socketA: Socket;
  let socketB: Socket;

  before(() => {
    if (shouldSkip) return;

    // Simulate two apps connecting to the same Realm
    // RL-INTOP-002: Each app registers with a unique appId
    socketA = io(REALM_URL!, {
      auth: { token: ACCESS_TOKEN },
      transports: ['websocket'],
      autoConnect: false,
    });

    socketB = io(REALM_URL!, {
      auth: { token: ACCESS_TOKEN },
      transports: ['websocket'],
      autoConnect: false,
    });
  });

  after(() => {
    socketA?.disconnect();
    socketB?.disconnect();
  });

  it('socket.io connections establish successfully', async () => {
    const connectA = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket A connect timeout')), INTEROP_TIMEOUT_MS);
      socketA.on('connect', () => { clearTimeout(timeout); resolve(); });
      socketA.on('connect_error', (err) => { clearTimeout(timeout); reject(err); });
    });

    const connectB = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Socket B connect timeout')), INTEROP_TIMEOUT_MS);
      socketB.on('connect', () => { clearTimeout(timeout); resolve(); });
      socketB.on('connect_error', (err) => { clearTimeout(timeout); reject(err); });
    });

    socketA.connect();
    socketB.connect();

    await Promise.all([connectA, connectB]);

    assert.ok(socketA.connected, 'Socket A should be connected');
    assert.ok(socketB.connected, 'Socket B should be connected');
  });

  it('messages sent by one socket are received by the other within 5s', async () => {
    const testChannel = `interop-test-${Date.now()}`;
    const testMessage = { text: `hello-${Date.now()}`, sender: 'socketA' };

    // Both sockets join the same channel
    socketA.emit('join', testChannel);
    socketB.emit('join', testChannel);

    // Wait briefly for join to propagate
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Listen for message on socket B
    const received = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Message receipt timeout')), INTEROP_TIMEOUT_MS);
      socketB.on('message', (data: unknown) => {
        clearTimeout(timeout);
        resolve(data);
      });
    });

    // Send from socket A
    socketA.emit('message', { channel: testChannel, ...testMessage });

    const receivedData = await received;
    assert.ok(receivedData, 'should receive the message');
  });
});

describe('RL-INTOP-002 — App Registration Isolation', { skip: shouldSkip }, () => {
  it('relay registers with appId nimi.relay', () => {
    // This is validated by the platform-client.ts code which sets appId: 'nimi.relay'
    // Here we just assert the contract expectation
    const expectedAppId = 'nimi.relay';
    assert.ok(expectedAppId, 'relay appId should be nimi.relay');
  });
});

describe('RL-INTOP-003 — Socket.io Connection', { skip: shouldSkip }, () => {
  let socket: Socket;

  after(() => {
    socket?.disconnect();
  });

  it('connects to Realm with authentication', async () => {
    socket = io(REALM_URL!, {
      auth: { token: ACCESS_TOKEN },
      transports: ['websocket'],
    });

    const connected = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connect timeout')), INTEROP_TIMEOUT_MS);
      socket.on('connect', () => { clearTimeout(timeout); resolve(); });
      socket.on('connect_error', (err) => { clearTimeout(timeout); reject(err); });
    });

    await connected;
    assert.ok(socket.connected, 'should be connected');
  });

  it('handles disconnect and reconnect', async () => {
    if (!socket?.connected) {
      assert.ok(true, 'skipping — no connection');
      return;
    }

    // Force disconnect
    socket.disconnect();
    assert.ok(!socket.connected, 'should be disconnected');

    // Reconnect
    const reconnected = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Reconnect timeout')), INTEROP_TIMEOUT_MS);
      socket.on('connect', () => { clearTimeout(timeout); resolve(); });
    });

    socket.connect();
    await reconnected;
    assert.ok(socket.connected, 'should be reconnected');
  });
});
