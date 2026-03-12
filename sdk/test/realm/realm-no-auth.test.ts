import assert from 'node:assert/strict';
import test from 'node:test';

import { Realm } from '../../src/realm/index.js';

function resolveFetchHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  if (typeof Request !== 'undefined' && input instanceof Request) {
    const requestHeaders = new Headers(input.headers);
    requestHeaders.forEach((value, key) => {
      if (!headers.has(key)) {
        headers.set(key, value);
      }
    });
  }
  return headers;
}

test('Realm accepts explicit auth: undefined as unauthenticated mode', async () => {
  const originalFetch = globalThis.fetch;
  const capturedAuthHeaders: Array<string | null> = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedAuthHeaders.push(resolveFetchHeaders(input, init).get('Authorization'));
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-explicit-undefined.nimi.xyz',
      auth: undefined,
    });

    await realm.raw.request({ method: 'GET', path: '/api/public' });

    assert.deepEqual(capturedAuthHeaders, [null]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
