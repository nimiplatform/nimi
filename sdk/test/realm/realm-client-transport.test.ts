import assert from 'node:assert/strict';
import test from 'node:test';

import { Realm } from '../../src/realm/index.js';
import { asNimiError } from '../../src/runtime/index.js';
import { ReasonCode } from '../../src/types/index.js';
import { resolveFetchHeaders, resolveFetchUrl } from './realm-client-test-helpers.js';

test('Realm resolves async headers function per request', async () => {
  const originalFetch = globalThis.fetch;
  const seenHeaders: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = resolveFetchHeaders(input, init);
    seenHeaders.push(headers.get('x-realm-test') || '');
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  try {
    let callCount = 0;
    const realm = new Realm({
      baseUrl: 'https://realm-headers-fn.nimi.xyz',
      auth: null,
      headers: async () => ({ 'x-realm-test': `call-${callCount++}` }),
    });

    await realm.unsafeRaw.request({ method: 'GET', path: '/api/one' });
    await realm.unsafeRaw.request({ method: 'GET', path: '/api/two' });

    assert.deepEqual(seenHeaders, ['call-0', 'call-1']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm requests still execute after close()', async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = (async (): Promise<Response> => {
    callCount += 1;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-close.nimi.xyz',
      auth: null,
    });

    await realm.close();
    const result = await realm.unsafeRaw.request({ method: 'GET', path: '/api/after-close' });

    assert.deepEqual(result, { ok: true });
    assert.equal(callCount, 1);
    assert.equal(realm.state().status, 'closed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm returns undefined for 204 responses', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (): Promise<Response> => (
    new Response(null, { status: 204 })
  )) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-no-content.nimi.xyz',
      auth: null,
    });

    const result = await realm.unsafeRaw.request({ method: 'DELETE', path: '/api/resource' });
    assert.equal(result, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm rejects text/plain responses when published contract expects JSON', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (): Promise<Response> => (
    new Response('plain-text-payload', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })
  )) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-text.nimi.xyz',
      auth: null,
    });

    await assert.rejects(
      async () => realm.unsafeRaw.request({ method: 'GET', path: '/api/text' }),
      (error: unknown) => asNimiError(error, { source: 'realm' }).reasonCode === ReasonCode.REALM_UNAVAILABLE,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm retries 429 responses using Retry-After', async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = (async (): Promise<Response> => {
    callCount += 1;
    if (callCount === 1) {
      return new Response(JSON.stringify({ message: 'slow down' }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '0',
        },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-retry-429.nimi.xyz',
      auth: null,
    });

    const result = await realm.unsafeRaw.request({ method: 'GET', path: '/api/rate-limited' });
    assert.deepEqual(result, { ok: true });
    assert.equal(callCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm retries configured 5xx responses and stops at maxRetries', async () => {
  const originalFetch = globalThis.fetch;
  let successCallCount = 0;

  globalThis.fetch = (async (): Promise<Response> => {
    successCallCount += 1;
    if (successCallCount < 3) {
      return new Response(JSON.stringify({ message: 'unavailable' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-retry-503.nimi.xyz',
      auth: null,
      retry: {
        maxRetries: 2,
        backoffMs: 1,
        maxBackoffMs: 1,
      },
    });

    const result = await realm.unsafeRaw.request({ method: 'GET', path: '/api/flaky' });
    assert.deepEqual(result, { ok: true });
    assert.equal(successCallCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }

  let failCallCount = 0;
  globalThis.fetch = (async (): Promise<Response> => {
    failCallCount += 1;
    return new Response(JSON.stringify({ message: 'still unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-retry-fail.nimi.xyz',
      auth: null,
      retry: {
        maxRetries: 1,
        backoffMs: 1,
        maxBackoffMs: 1,
      },
    });

    await assert.rejects(
      () => realm.unsafeRaw.request({ method: 'GET', path: '/api/still-flaky' }),
      (error: unknown) => {
        const nimiError = asNimiError(error, { source: 'realm' });
        assert.equal(nimiError.reasonCode, ReasonCode.REALM_UNAVAILABLE);
        return true;
      },
    );
    assert.equal(failCallCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
