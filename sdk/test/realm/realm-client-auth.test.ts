import assert from 'node:assert/strict';
import test from 'node:test';

import { Realm } from '../../src/realm/index.js';
import { asNimiError } from '../../src/runtime/index.js';
import { ReasonCode } from '../../src/types/index.js';
import { resolveFetchHeaders, resolveFetchUrl } from './realm-client-test-helpers.js';

test('Realm 401 with refreshToken triggers refresh then retries successfully', async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = resolveFetchUrl(input);
    callCount++;

    if (url.endsWith('/api/auth/refresh')) {
      return new Response(JSON.stringify({
        tokens: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          expiresIn: 3600,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const headers = resolveFetchHeaders(input, init);
    const authHeader = headers.get('Authorization') || '';

    if (authHeader === 'Bearer expired-token') {
      return new Response(JSON.stringify({
        message: 'token expired',
        reasonCode: ReasonCode.APP_TOKEN_EXPIRED,
      }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (authHeader === 'Bearer new-access-token') {
      return new Response(JSON.stringify({ data: 'success' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;

  try {
    let refreshedResult: unknown = null;
    const realm = new Realm({
      baseUrl: 'https://realm-refresh.nimi.xyz',
      auth: {
        accessToken: 'expired-token',
        refreshToken: 'valid-refresh-token',
        onTokenRefreshed: (result) => { refreshedResult = result; },
      },
    });

    const result = await realm.unsafeRaw.request({ method: 'GET', path: '/api/protected' });
    assert.deepEqual(result, { data: 'success' });
    assert.ok(refreshedResult);
    assert.equal((refreshedResult as { accessToken: string }).accessToken, 'new-access-token');
    assert.equal((refreshedResult as { refreshToken: string }).refreshToken, 'new-refresh-token');
    assert.equal(callCount, 3); // 401 + refresh + retry
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm refresh normalizes numeric-string expiresIn consistently across refresh paths', async () => {
  const originalFetch = globalThis.fetch;
  let refreshCallbackResult: unknown = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = resolveFetchUrl(input);
    if (url.endsWith('/api/auth/refresh')) {
      return new Response(JSON.stringify({
        tokens: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          expiresIn: '3600',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const headers = resolveFetchHeaders(input, init);
    if ((headers.get('Authorization') || '') === 'Bearer expired-token') {
      return new Response(JSON.stringify({
        message: 'token expired',
        reasonCode: ReasonCode.APP_TOKEN_EXPIRED,
      }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  try {
    const staticResult = await Realm.refreshAccessToken({
      realmBaseUrl: 'https://realm-refresh.nimi.xyz',
      refreshToken: 'refresh-token',
    });
    assert.equal(staticResult.expiresIn, 3600);

    const realm = new Realm({
      baseUrl: 'https://realm-refresh.nimi.xyz',
      auth: {
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        onTokenRefreshed: (result) => { refreshCallbackResult = result; },
      },
    });
    await realm.unsafeRaw.request({ method: 'GET', path: '/api/protected' });

    assert.equal((refreshCallbackResult as RealmTokenRefreshResult).expiresIn, 3600);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm refresh drops invalid expiresIn values', async () => {
  const originalFetch = globalThis.fetch;
  let refreshCallbackResult: unknown = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = resolveFetchUrl(input);
    if (url.endsWith('/api/auth/refresh')) {
      return new Response(JSON.stringify({
        tokens: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          expiresIn: 'not-a-number',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const headers = resolveFetchHeaders(input, init);
    if ((headers.get('Authorization') || '') === 'Bearer expired-token') {
      return new Response(JSON.stringify({
        message: 'token expired',
        reasonCode: ReasonCode.APP_TOKEN_EXPIRED,
      }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  try {
    const staticResult = await Realm.refreshAccessToken({
      realmBaseUrl: 'https://realm-refresh.nimi.xyz',
      refreshToken: 'refresh-token',
    });
    assert.equal(staticResult.expiresIn, undefined);

    const realm = new Realm({
      baseUrl: 'https://realm-refresh.nimi.xyz',
      auth: {
        accessToken: 'expired-token',
        refreshToken: 'refresh-token',
        onTokenRefreshed: (result) => { refreshCallbackResult = result; },
      },
    });
    await realm.unsafeRaw.request({ method: 'GET', path: '/api/protected' });
    assert.equal((refreshCallbackResult as { expiresIn?: number }).expiresIn, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm 401 without refreshToken throws directly (existing behavior)', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (): Promise<Response> => {
    return new Response(JSON.stringify({
      message: 'unauthorized',
      reasonCode: ReasonCode.APP_TOKEN_EXPIRED,
    }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-no-refresh.nimi.xyz',
      auth: { accessToken: 'expired-token' },
    });

    let thrown: unknown = null;
    try {
      await realm.unsafeRaw.request({ method: 'GET', path: '/api/protected' });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown);
    const nimiError = asNimiError(thrown, { source: 'realm' });
    assert.equal(nimiError.code, ReasonCode.AUTH_DENIED);
    assert.equal(nimiError.reasonCode, ReasonCode.APP_TOKEN_EXPIRED);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm refresh failure calls onRefreshFailed and throws original 401 error', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = resolveFetchUrl(input);

    if (url.endsWith('/api/auth/refresh')) {
      return new Response(JSON.stringify({
        message: 'refresh token expired',
      }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      message: 'access token expired',
      reasonCode: ReasonCode.APP_TOKEN_EXPIRED,
    }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  try {
    let failedError: unknown = null;
    const realm = new Realm({
      baseUrl: 'https://realm-refresh-fail.nimi.xyz',
      auth: {
        accessToken: 'expired-token',
        refreshToken: 'expired-refresh-token',
        onRefreshFailed: (error) => { failedError = error; },
      },
    });

    let thrown: unknown = null;
    try {
      await realm.unsafeRaw.request({ method: 'GET', path: '/api/protected' });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown);
    assert.ok(failedError);
    const nimiError = asNimiError(thrown, { source: 'realm' });
    assert.equal(nimiError.code, ReasonCode.AUTH_DENIED);
    assert.equal(nimiError.reasonCode, ReasonCode.APP_TOKEN_EXPIRED);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm 403 does not trigger refresh', async () => {
  const originalFetch = globalThis.fetch;
  let refreshCalled = false;

  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = resolveFetchUrl(input);
    if (url.endsWith('/api/auth/refresh')) {
      refreshCalled = true;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ message: 'forbidden' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-403.nimi.xyz',
      auth: {
        accessToken: 'valid-token',
        refreshToken: 'valid-refresh',
      },
    });

    let thrown: unknown = null;
    try {
      await realm.unsafeRaw.request({ method: 'GET', path: '/api/admin' });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown);
    assert.equal(refreshCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm refreshToken supports function mode', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = resolveFetchUrl(input);

    if (url.endsWith('/api/auth/refresh')) {
      const body = JSON.parse(String((init as { body?: string })?.body || '{}')) as Record<string, unknown>;
      assert.equal(body.refreshToken, 'dynamic-refresh-token');
      return new Response(JSON.stringify({
        tokens: { accessToken: 'refreshed-token' },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const headers = resolveFetchHeaders(input, init);
    const authHeader = headers.get('Authorization') || '';

    if (authHeader === 'Bearer expired-token') {
      return new Response(JSON.stringify({ message: 'expired' }), {
        status: 401,
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
      baseUrl: 'https://realm-fn-refresh.nimi.xyz',
      auth: {
        accessToken: 'expired-token',
        refreshToken: () => 'dynamic-refresh-token',
      },
    });

    const result = await realm.unsafeRaw.request({ method: 'GET', path: '/api/data' });
    assert.deepEqual(result, { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm.decodeTokenExpiry parses valid and invalid JWTs', () => {
  // Valid JWT with exp claim (exp = 1700000000 → 2023-11-14T22:13:20.000Z)
  const payload = btoa(JSON.stringify({ sub: 'user-1', exp: 1700000000 }));
  const validJwt = `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;

  const result = Realm.decodeTokenExpiry(validJwt);
  assert.ok(result);
  assert.equal(result.expiresAt, 1700000000 * 1000);
  assert.equal(typeof result.expiresInMs, 'number');

  // Invalid JWT (not enough parts)
  assert.equal(Realm.decodeTokenExpiry('not-a-jwt'), null);

  // JWT without exp claim
  const noExpPayload = btoa(JSON.stringify({ sub: 'user-1' }));
  const noExpJwt = `eyJhbGciOiJIUzI1NiJ9.${noExpPayload}.signature`;
  assert.equal(Realm.decodeTokenExpiry(noExpJwt), null);

  // Malformed base64
  const malformedJwt = 'header.!!!invalid-base64!!!.signature';
  assert.equal(Realm.decodeTokenExpiry(malformedJwt), null);

  const base64UrlPayload = Buffer.from(JSON.stringify({ sub: 'user-1', exp: 1700000001 }))
    .toString('base64url');
  const base64UrlJwt = `header.${base64UrlPayload}.signature`;
  assert.equal(Realm.decodeTokenExpiry(base64UrlJwt)?.expiresAt, 1700000001 * 1000);
  assert.deepEqual(Realm.decodeTokenExpiryUnsafe(validJwt), result);
});

test('Realm explicit unauthenticated mode does not send Authorization header (SDKREALM-016)', async () => {
  const originalFetch = globalThis.fetch;
  const capturedHeaders: Record<string, string>[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = resolveFetchHeaders(input, init);
    const captured: Record<string, string> = {};
    headers.forEach((value, key) => {
      captured[key.toLowerCase()] = value;
    });
    capturedHeaders.push(captured);

    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-noauth.nimi.xyz',
      auth: null,
    });

    await realm.unsafeRaw.request({ method: 'GET', path: '/api/public' });

    assert.equal(capturedHeaders.length, 1);
    assert.equal(capturedHeaders[0]?.authorization, undefined, 'unauthenticated mode must not emit Authorization header');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm ready() fails closed on probe failure and still emits error event', async () => {
  const originalFetch = globalThis.fetch;
  const errors: Array<{ error: { reasonCode?: string }; at: string }> = [];

  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = resolveFetchUrl(input);
    if (new URL(url).pathname === '/') {
      throw new TypeError('network failure during ready probe');
    }
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-ready-error.nimi.xyz',
      auth: null,
    });

    realm.events.on('error', (event) => {
      errors.push(event as typeof errors[number]);
    });

    await assert.rejects(
      async () => realm.ready({ timeoutMs: 1000 }),
      (error: unknown) => asNimiError(error, { source: 'realm' }).reasonCode === ReasonCode.REALM_UNAVAILABLE,
    );

    assert.equal(errors.length, 1, 'ready() probe failure must emit exactly one error event');
    assert.equal(errors[0]?.error?.reasonCode, 'REALM_UNAVAILABLE');
    assert.equal(realm.state().status, 'ready');
    assert.equal(realm.state().lastReadyAt, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm rejects non-positive timeoutMs values', async () => {
  const realm = new Realm({
    baseUrl: 'https://realm-timeout-invalid.nimi.xyz',
    auth: null,
  });

  await assert.rejects(
    () => realm.ready({ timeoutMs: 0 }),
    (error: unknown) => asNimiError(error, { source: 'sdk' }).reasonCode === ReasonCode.SDK_REALM_CONFIG_INVALID,
  );
});

test('Realm services support path-first call pattern for mixed path/query methods', async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    urls.push(resolveFetchUrl(input));
    return new Response('{}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-params.nimi.xyz',
      auth: null,
    });

    await realm.services.HumanChatsService.listMessages('chat-123', 20);
    await realm.services.HumanChatsService.syncChatEvents('chat-123', 200, 5);
    await realm.services.HumanChatsService.recallMessage('chat-123', 'msg-9');
    await realm.services.WorldsService.worldControllerGetWorldLevelAudits('world-7', 30);
    await realm.services.WorldsService.worldControllerGetWorldDetailWithAgents('world-7', 4);
    await realm.services.WorldsService.worldControllerGetWorldview('world-7');
    await realm.services.WorldsService.worldControllerGetWorldLorebooks('world-7');
    await realm.services.WorldsService.worldControllerGetMainWorld();
    await realm.services.WorldsService.worldControllerGetWorldBindings('world-7');

    assert.equal(urls.length, 9);

    const listMessagesUrl = new URL(urls[0] || '');
    assert.equal(listMessagesUrl.pathname, '/api/human/chats/chat-123/messages');
    assert.equal(listMessagesUrl.searchParams.get('limit'), '20');

    const syncEventsUrl = new URL(urls[1] || '');
    assert.equal(syncEventsUrl.pathname, '/api/human/chats/chat-123/sync');
    assert.equal(syncEventsUrl.searchParams.get('limit'), '200');
    assert.equal(syncEventsUrl.searchParams.get('afterSeq'), '5');

    const recallMessageUrl = new URL(urls[2] || '');
    assert.equal(recallMessageUrl.pathname, '/api/human/chats/chat-123/messages/msg-9/recall');

    const worldAuditsUrl = new URL(urls[3] || '');
    assert.equal(worldAuditsUrl.pathname, '/api/world/by-id/world-7/level/audits');
    assert.equal(worldAuditsUrl.searchParams.get('limit'), '30');

    const worldDetailUrl = new URL(urls[4] || '');
    assert.equal(worldDetailUrl.pathname, '/api/world/by-id/world-7/detail-with-agents');
    assert.equal(worldDetailUrl.searchParams.get('recommendedAgentLimit'), '4');

    const worldviewEventsUrl = new URL(urls[5] || '');
    assert.equal(worldviewEventsUrl.pathname, '/api/world/by-id/world-7/worldview');

    const lorebooksUrl = new URL(urls[6] || '');
    assert.equal(lorebooksUrl.pathname, '/api/world/by-id/world-7/lorebooks');

    const oasisUrl = new URL(urls[7] || '');
    assert.equal(oasisUrl.pathname, '/api/world/oasis');

    const resourceBindingsUrl = new URL(urls[8] || '');
    assert.equal(resourceBindingsUrl.pathname, '/api/world/by-id/world-7/bindings');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('S-REALM-012: endpoint validation throws SDK_REALM_ENDPOINT_REQUIRED when baseUrl is empty', () => {
  let thrown: unknown = null;
  try {
    new Realm({ baseUrl: '', auth: null });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, 'Realm with empty baseUrl must throw');
  const nimiError = asNimiError(thrown, { source: 'realm' });
  assert.equal(nimiError.reasonCode, ReasonCode.SDK_REALM_ENDPOINT_REQUIRED);

  let thrownUndefined: unknown = null;
  try {
    new Realm({ baseUrl: undefined as any, auth: null });
  } catch (error) {
    thrownUndefined = error;
  }

  assert.ok(thrownUndefined, 'Realm with undefined baseUrl must throw');
  const nimiErrorUndefined = asNimiError(thrownUndefined, { source: 'realm' });
  assert.equal(nimiErrorUndefined.reasonCode, ReasonCode.SDK_REALM_ENDPOINT_REQUIRED);
});

test('S-REALM-015: auth retry max once — second 401 after refresh does not loop', async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = resolveFetchUrl(input);
    callCount++;

    if (url.endsWith('/api/auth/refresh')) {
      return new Response(JSON.stringify({
        tokens: {
          accessToken: 'new-token',
          refreshToken: 'new-rt',
          expiresIn: 3600,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      message: 'Unauthorized',
      reasonCode: ReasonCode.APP_TOKEN_EXPIRED,
    }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-retry-max.nimi.xyz',
      auth: {
        accessToken: 'expired-token',
        refreshToken: 'valid-refresh',
      },
    });

    let thrown: unknown = null;
    try {
      await realm.unsafeRaw.request({ method: 'GET', path: '/api/protected' });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown, 'second 401 after refresh must throw');
    assert.equal(callCount, 3, 'must be exactly 3 calls: original 401 + refresh + retry 401');
    const nimiError = asNimiError(thrown, { source: 'realm' });
    assert.equal(nimiError.code, ReasonCode.AUTH_DENIED);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('S-REALM-029: concurrent 401 requests merge into a single refresh call', async () => {
  const originalFetch = globalThis.fetch;
  let refreshCount = 0;
  let callIndex = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = resolveFetchUrl(input);
    callIndex++;

    if (url.endsWith('/api/auth/refresh')) {
      refreshCount++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({
        tokens: {
          accessToken: 'refreshed-token',
          refreshToken: 'new-rt',
          expiresIn: 3600,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const headers = resolveFetchHeaders(input, init);
    const authHeader = headers.get('Authorization') || '';

    if (authHeader === 'Bearer expired-token') {
      return new Response(JSON.stringify({
        message: 'Unauthorized',
        reasonCode: ReasonCode.APP_TOKEN_EXPIRED,
      }), {
        status: 401,
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
      baseUrl: 'https://realm-single-flight.nimi.xyz',
      auth: {
        accessToken: 'expired-token',
        refreshToken: 'valid-refresh',
      },
    });

    const results = await Promise.allSettled([
      realm.unsafeRaw.request({ method: 'GET', path: '/api/resource-a' }),
      realm.unsafeRaw.request({ method: 'GET', path: '/api/resource-b' }),
    ]);

    assert.equal(refreshCount, 1, '/api/auth/refresh must be called exactly once (single-flight)');

    for (const result of results) {
      assert.equal(result.status, 'fulfilled', 'both concurrent requests must resolve after single refresh');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('S-REALM-027: accessToken as function resolves dynamically on each request', async () => {
  const originalFetch = globalThis.fetch;
  const capturedAuthHeaders: string[] = [];
  let tokenCallCount = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = resolveFetchHeaders(input, init);
    const authHeader = headers.get('Authorization') || '';
    capturedAuthHeaders.push(authHeader);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-fn-token.nimi.xyz',
      auth: {
        accessToken: () => 'dynamic-token-' + tokenCallCount++,
      },
    });

    await realm.unsafeRaw.request({ method: 'GET', path: '/api/first' });
    await realm.unsafeRaw.request({ method: 'GET', path: '/api/second' });

    assert.equal(capturedAuthHeaders.length, 2);
    assert.equal(capturedAuthHeaders[0], 'Bearer dynamic-token-0');
    assert.equal(capturedAuthHeaders[1], 'Bearer dynamic-token-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm refresh updates internal static token for subsequent requests', async () => {
  const originalFetch = globalThis.fetch;
  let refreshCount = 0;
  const seenAuthHeaders: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = resolveFetchUrl(input);
    if (url.endsWith('/api/auth/refresh')) {
      refreshCount += 1;
      return new Response(JSON.stringify({
        tokens: {
          accessToken: 'fresh-static-token',
          refreshToken: 'fresh-static-refresh',
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    const headers = resolveFetchHeaders(input, init);
    const authHeader = headers.get('Authorization') || '';
    seenAuthHeaders.push(authHeader);

    if (authHeader === 'Bearer expired-static-token') {
      return new Response(JSON.stringify({ reasonCode: ReasonCode.APP_TOKEN_EXPIRED }), {
        status: 401,
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
      baseUrl: 'https://realm-refresh-static.nimi.xyz',
      auth: {
        accessToken: 'expired-static-token',
        refreshToken: 'valid-refresh-token',
      },
    });

    await realm.unsafeRaw.request({ method: 'GET', path: '/api/first' });
    await realm.unsafeRaw.request({ method: 'GET', path: '/api/second' });

    assert.equal(refreshCount, 1);
    assert.deepEqual(seenAuthHeaders, [
      'Bearer expired-static-token',
      'Bearer fresh-static-token',
      'Bearer fresh-static-token',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
