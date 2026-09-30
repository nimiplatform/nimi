import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  acquireNimiManagedConnectorCredentialInHost,
  type NimiConnectorAuthAcquisitionCallback,
  type NimiConnectorAuthAcquisitionNativeHost,
} from '@nimiplatform/sdk/runtime/host';

import {
  readOrCreateDesktopConnectorAuthHostId,
  startDesktopConnectorAuthCallback,
} from '../src-electron/connector-auth-callback-host.js';

const CALLBACK_REQUEST = { profileId: 'openai_chatgpt_plan', host: '127.0.0.1', path: '/auth/callback' } as const;

async function listenerClosed(redirectUri: string): Promise<boolean> {
  try {
    await fetch(`${redirectUri}?state=probe&code=local-only`);
    return false;
  } catch {
    return true;
  }
}

test('loopback callback binds 127.0.0.1 on a fresh port and accepts one GET on the exact path', async () => {
  const callback = await startDesktopConnectorAuthCallback({ profileId: 'openai_chatgpt_plan', host: '127.0.0.1', path: '/auth/callback' });
  try {
    const redirect = new URL(callback.redirectUri);
    assert.equal(redirect.protocol, 'http:');
    assert.equal(redirect.hostname, '127.0.0.1');
    assert.equal(redirect.pathname, '/auth/callback');
    assert.ok(Number(redirect.port) > 0);

    assert.equal((await fetch(new URL('/callback?code=x', redirect))).status, 404);
    assert.equal((await fetch(new URL('/auth/callback?code=x', redirect), { method: 'POST' })).status, 404);
    const waiting = callback.waitForCallback(new AbortController().signal);
    const response = await fetch(`${callback.redirectUri}?code=auth-code&state=s1&client_id=oaiapp_1&state=s2`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(await response.text(), /return to Nimi/);
    assert.deepEqual(await waiting, { code: 'auth-code', state: '', client_id: 'oaiapp_1' });
    assert.equal((await fetch(`${callback.redirectUri}?code=replay&state=s1`)).status, 410);
  } finally {
    await callback.close();
  }
});

test('loopback callback waiting follows cancellation and rejects foreign hosts or paths', async () => {
  const callback = await startDesktopConnectorAuthCallback({ profileId: 'openai_chatgpt_plan', host: '127.0.0.1', path: '/auth/callback' });
  const controller = new AbortController();
  const waiting = callback.waitForCallback(controller.signal);
  controller.abort(new DOMException('canceled', 'AbortError'));
  await assert.rejects(waiting, (error: unknown) => (error as { name?: string }).name === 'AbortError');
  await callback.close();
  await assert.rejects(fetch(callback.redirectUri));
  for (const request of [
    { profileId: 'openai_chatgpt_plan', host: 'localhost', path: '/auth/callback' },
    { profileId: 'openai_chatgpt_plan', host: '0.0.0.0', path: '/auth/callback' },
    { profileId: 'openai_chatgpt_plan', host: '127.0.0.1', path: '/auth/callback?x=1' },
  ]) {
    await assert.rejects(startDesktopConnectorAuthCallback(request), /admitted loopback host and path/);
  }
});

test('Desktop host identifier is created once as an opaque urn:uuid and then reused', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nimi-host-id-'));
  try {
    const first = await readOrCreateDesktopConnectorAuthHostId(directory);
    const second = await readOrCreateDesktopConnectorAuthHostId(directory);
    assert.match(first, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    assert.equal(second, first);
    assert.equal((await readFile(path.join(directory, 'connector-auth-host-id'), 'utf8')).trim(), first);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the acquisition signal owns the loopback listener during and after startup', async () => {
  // Canceled while listening starts: no live listener is returned.
  const early = new AbortController();
  const starting = startDesktopConnectorAuthCallback(CALLBACK_REQUEST, early.signal);
  early.abort(new DOMException('canceled during startup', 'AbortError'));
  await assert.rejects(starting, (error: unknown) => (error as { name?: string }).name === 'AbortError');

  // Canceled after startup: the listener closes without an explicit close.
  const later = new AbortController();
  const callback = await startDesktopConnectorAuthCallback(CALLBACK_REQUEST, later.signal);
  try {
    later.abort(new DOMException('canceled while waiting', 'AbortError'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(await listenerClosed(callback.redirectUri), true);
  } finally {
    await callback.close();
  }
});

test('canceling sign-in while the host is still starting the listener closes the real loopback listener', async () => {
  const controller = new AbortController();
  let callback: NimiConnectorAuthAcquisitionCallback | undefined;
  let listenerCreated!: () => void;
  const created = new Promise<void>((resolve) => {
    listenerCreated = resolve;
  });
  let returnListener!: () => void;
  const returned = new Promise<void>((resolve) => {
    returnListener = resolve;
  });
  let closes = 0;
  const unexpected = (what: string) => async (): Promise<never> => { throw new Error(`unexpected ${what}`); };
  const host: NimiConnectorAuthAcquisitionNativeHost = {
    hostIdentifier: async () => 'urn:uuid:9d7f1f61-4ab0-4d1b-a0e6-3c1f5e4d2b10',
    crypto: webcrypto as unknown as NimiConnectorAuthAcquisitionNativeHost['crypto'],
    now: Date.now,
    openExternalUrl: unexpected('browser open'),
    proxyHttp: unexpected('provider request'),
    async startAuthorizationCallback(request, signal) {
      const started = await startDesktopConnectorAuthCallback(request, signal);
      callback = { ...started, close: async () => { closes += 1; await started.close(); } };
      listenerCreated();
      // The host returns the listener only after the acquisition was canceled.
      await returned;
      return callback;
    },
  };
  const operation = acquireNimiManagedConnectorCredentialInHost({
    profileId: 'openai_chatgpt_plan', signal: controller.signal, host,
    runtime: { createConnector: unexpected('custody write'), updateConnector: unexpected('custody write'), listConnectors: unexpected('read') },
  });
  try {
    await created;
    controller.abort(new DOMException('user canceled during listener startup', 'AbortError'));
    returnListener();
    await assert.rejects(operation, (error: unknown) => (error as { name?: string }).name === 'AbortError');
    assert.equal(closes, 1);
    assert.equal(await listenerClosed(callback!.redirectUri), true);
  } finally {
    await callback?.close();
  }
});
