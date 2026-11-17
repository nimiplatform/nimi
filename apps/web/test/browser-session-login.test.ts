import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { runWebBrowserSessionLogin } from '../src/auth/browser-realm.js';

test('login confirmation holds the refresh lock through the account read and marker removal', async () => {
  let locked = false;
  let reads = 0;
  const server = createServer((_request, response) => {
    assert.equal(locked, true, 'account confirmation must remain in the cookie mutation lock');
    reads++;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ id: 'account-1', handle: 'alice', displayName: 'Alice', createdAt: '2026-11-17T00:00:00Z', role: 'USER' }));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const search = `?oauth_next=${encodeURIComponent(`${origin}/api/auth/oauth/authorize?state=isolated-test`)}`;
  const markerKey = `nimi:browser-session-renewal:${origin}`;
  const values = new Map([[markerKey, 'pending']]);
  const previous = new Map(['window', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { origin, search },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => { assert.equal(locked, true); values.delete(key); },
    },
  } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: async (key: string, work: () => Promise<unknown>) => {
      assert.equal(key, `nimi:browser-session:${origin}`);
      assert.equal(locked, false);
      locked = true;
      try { return await work(); } finally { locked = false; }
    },
  } } });
  try {
    await runWebBrowserSessionLogin(async () => {
      assert.equal(locked, true, 'credential submission must share the refresh lock');
      return { loginState: 'needs_2fa' as const, tokens: null };
    }, search);
    assert.equal(reads, 0);
    assert.equal(values.get(markerKey), 'pending', 'an incomplete login cannot release the fence');
    await runWebBrowserSessionLogin(async () => {
      assert.equal(locked, true);
      return { loginState: 'ok' as const, tokens: null };
    }, search);
    assert.equal(reads, 1);
    assert.equal(values.has(markerKey), false);
    assert.equal(locked, false);
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
