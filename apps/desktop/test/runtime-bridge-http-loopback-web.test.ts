import assert from 'node:assert/strict';
import test from 'node:test';

function setWindowOrigin(origin: string): void {
  const currentWindow = globalThis.window as unknown;
  const existingWindow = (currentWindow && typeof currentWindow === 'object')
    ? currentWindow as Record<string, unknown>
    : {};
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...existingWindow,
      __TAURI__: undefined,
      location: { origin } as unknown as Location,
    },
    configurable: true,
    writable: true,
  });
}

test('web proxy http fallback allows loopback backend across localhost and 127.0.0.1 aliases', async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  setWindowOrigin('http://127.0.0.1:3000');
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    return new Response('{"available":false,"hasPassword":true}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  }) as typeof fetch;

  try {
    const { proxyHttp } = await import(`../src/shell/renderer/bridge/runtime-bridge/http.ts?loopback-web=${Date.now()}`);
    const result = await proxyHttp({
      url: 'http://localhost:3002/api/auth/email/check',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: '{"email":"test@nimi.xyz"}',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0], 'http://127.0.0.1:3000/api/auth/email/check');
    assert.equal(result.status, 200);
    assert.match(result.body, /hasPassword/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('web proxy http fallback still rejects non-loopback private network targets', async () => {
  const originalFetch = globalThis.fetch;
  setWindowOrigin('http://127.0.0.1:3000');
  globalThis.fetch = (async () => {
    throw new Error('fetch should not be reached for blocked private network requests');
  }) as typeof fetch;

  try {
    const { proxyHttp } = await import(`../src/shell/renderer/bridge/runtime-bridge/http.ts?private-network-block=${Date.now()}`);
    await assert.rejects(
      () => proxyHttp({
        url: 'http://192.168.1.8:3002/api/auth/email/check',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: '{"email":"test@nimi.xyz"}',
      }),
      /禁止访问私有网络地址/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
