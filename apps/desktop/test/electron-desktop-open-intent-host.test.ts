import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { NimiDesktopOpenIntentEnvelope } from '@nimiplatform/kit/core/desktop-open';
import {
  createDesktopElectronOpenIntentHost,
  DESKTOP_OPEN_INTENT_EVENT,
} from '../src-electron/desktop-open-intent-host';

test('Desktop Open shutdown closes idle HTTP connections without force-closing active requests', async () => {
  const source = await readFile(path.join(
    path.resolve(import.meta.dirname, '..'),
    'src-electron',
    'desktop-open-intent-host.ts',
  ), 'utf8');
  assert.match(source, /server\.closeIdleConnections\(\)/u);
  assert.match(source, /desktop-open-intent-http-shutdown-timeout/u);
  assert.doesNotMatch(source, /closeAllConnections\(\)/u);
});

const envelope: NimiDesktopOpenIntentEnvelope = {
  schemaVersion: 1,
  sourceApp: 'nimi.zhiyu',
  sourceHost: 'desktop-electron-local-app-host',
  requestId: 'desktop-open-zhiyu-test-1',
  intent: {
    kind: 'open-explore',
    section: 'personas',
    productIntent: 'select-partner',
  },
};

test('Electron Desktop Open host enforces auth/readiness and emits an exact admitted envelope', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-desktop-open-')));
  const descriptorPath = path.join(
    home,
    '.nimi',
    'run',
    'desktop',
    'open-intent',
    'presence.v1.json',
  );
  let now = Date.parse('2026-07-19T10:00:00.000Z');
  let focusCount = 0;
  const emitted: NimiDesktopOpenIntentEnvelope[] = [];
  const host = await createDesktopElectronOpenIntentHost({
    homeDirectory: home,
    now: () => now,
    heartbeatIntervalMs: 60_000,
    readinessTtlMs: 10_000,
    focusMainWindow: async () => { focusCount += 1; },
    emitIntent: (value) => emitted.push(value),
  });
  try {
    const descriptor = JSON.parse(await readFile(descriptorPath, 'utf8')) as {
      schemaVersion: number;
      desktopAppId: string;
      bridgeId: string;
      endpoint: string;
      token: string;
      startedAt: string;
      lastHeartbeatAt: string;
    };
    assert.equal(descriptor.schemaVersion, 1);
    assert.equal(descriptor.desktopAppId, 'nimi.desktop');
    assert.match(descriptor.bridgeId, /^desktop-open-bridge-[A-Za-z0-9_-]+$/u);
    assert.match(descriptor.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/u);
    assert.equal(descriptor.startedAt, '2026-07-19T10:00:00.000Z');
    assert.equal(descriptor.lastHeartbeatAt, descriptor.startedAt);

    const unknown = await fetch(`${descriptor.endpoint}/v1/open-intent?query=not-allowed`, {
      method: 'POST',
    });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.headers.get('access-control-allow-origin'), null);

    const unauthorized = await post(descriptor.endpoint, 'wrong-token', envelope);
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), {
      status: 'rejected',
      bridgeId: descriptor.bridgeId,
      reasonCode: 'desktop-open-bridge-auth-failed',
      actionHint: 'check_desktop_runtime_bridge',
    });

    const notReady = await post(descriptor.endpoint, descriptor.token, envelope);
    assert.equal(notReady.status, 200);
    assert.deepEqual(await notReady.json(), {
      status: 'rejected',
      bridgeId: descriptor.bridgeId,
      reasonCode: 'desktop-open-desktop-not-ready',
      actionHint: 'wait_for_desktop_ready',
    });
    assert.equal(focusCount, 0);
    assert.deepEqual(emitted, []);

    assert.throws(() => host.commandHandlers.desktop_open_intent_set_ready({
      command: 'desktop_open_intent_set_ready',
      payload: { ready: true, extra: true },
    }), /desktop-open-ready-payload-invalid/u);
    host.commandHandlers.desktop_open_intent_set_ready({
      command: 'desktop_open_intent_set_ready',
      payload: { ready: true },
    });

    const accepted = await post(descriptor.endpoint, descriptor.token, envelope);
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), {
      status: 'accepted',
      confirmation: 'desktop-accepted',
      bridgeId: descriptor.bridgeId,
      requestId: envelope.requestId,
      appliedTarget: envelope.intent.kind,
    });
    assert.equal(focusCount, 1);
    assert.deepEqual(emitted, [envelope]);

    now += 10_001;
    const stale = await post(descriptor.endpoint, descriptor.token, envelope);
    assert.deepEqual(await stale.json(), {
      status: 'rejected',
      bridgeId: descriptor.bridgeId,
      reasonCode: 'desktop-open-desktop-not-ready',
      actionHint: 'wait_for_desktop_ready',
    });
    assert.equal(focusCount, 1);
  } finally {
    await host.shutdown();
    await assert.rejects(readFile(descriptorPath, 'utf8'), { code: 'ENOENT' });
    await rm(home, { recursive: true, force: true });
  }
});

test('Electron Desktop Open host rejects a non-canonical symlinked home ancestry', {
  skip: process.platform !== 'darwin',
}, async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-desktop-open-symlink-')));
  const canonicalHome = path.join(root, 'canonical-home');
  const linkedHome = path.join(root, 'linked-home');
  try {
    await mkdir(canonicalHome, { mode: 0o700 });
    await symlink(canonicalHome, linkedHome, 'dir');
    await assert.rejects(
      createDesktopElectronOpenIntentHost({
        homeDirectory: linkedHome,
        focusMainWindow: async () => undefined,
        emitIntent: () => undefined,
      }),
      /desktop-open-presence-parent-must-not-be-symlink/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Electron Desktop Open event keeps the admitted cross-shell event identity', () => {
  assert.equal(DESKTOP_OPEN_INTENT_EVENT, 'desktop-open://open-intent');
});

async function post(endpoint: string, token: string, value: unknown): Promise<Response> {
  return await fetch(`${endpoint}/v1/open-intent`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(value),
  });
}
