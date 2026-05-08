import assert from 'node:assert/strict';
import test from 'node:test';

import { asNimiError } from '../../src/runtime/errors.js';
import { Realm } from '../../src/realm/index.js';
import { ReasonCode } from '../../src/types/index.js';

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

test('Realm allows admitted AuthService endpoints with explicit auth: undefined', async () => {
  const originalFetch = globalThis.fetch;
  const capturedAuthHeaders: Array<string | null> = [];
  const capturedUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    capturedAuthHeaders.push(resolveFetchHeaders(input, init).get('Authorization'));
    capturedUrls.push(typeof Request !== 'undefined' && input instanceof Request ? input.url : String(input));
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

    await realm.services.AuthService.passwordLogin({
      email: 'test@nimi.xyz',
      password: 'secret',
    });

    assert.deepEqual(capturedAuthHeaders, [null]);
    assert.deepEqual(capturedUrls, ['https://realm-explicit-undefined.nimi.xyz/api/auth/password/login']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm fails closed without accessToken outside admitted AuthService endpoints', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  globalThis.fetch = (async (): Promise<Response> => {
    fetchCalled = true;
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

    let thrown: unknown = null;
    try {
      await realm.unsafeRaw.request({ method: 'GET', path: '/api/public' });
    } catch (error) {
      thrown = error;
    }

    assert.equal(fetchCalled, false);
    assert.ok(thrown);
    const nimiError = asNimiError(thrown, { source: 'sdk' });
    assert.equal(nimiError.reasonCode, ReasonCode.SDK_REALM_TOKEN_REQUIRED);
    assert.equal(nimiError.source, 'sdk');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
