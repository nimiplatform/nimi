import assert from 'node:assert/strict';
import test from 'node:test';

import { REALM_OPERATION_MAP } from '../../src/realm/generated/operation-map.js';
import { ReasonCode } from '../../src/types/index.js';
import { asNimiError } from '../../src/runtime/index.js';
import { Realm } from '../../src/realm/index.js';

type FetchCall = {
  url: string;
  authorization?: string;
};

function createAbortError(message: string): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, 'AbortError');
  }
  const error = new Error(message) as Error & { name?: string };
  error.name = 'AbortError';
  return error;
}

function resolveFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.url;
  }
  return String(input || '');
}

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

function resolveFetchSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | null {
  if (init?.signal) {
    return init.signal;
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.signal;
  }
  return null;
}

function extractPathParameterNames(path: string): string[] {
  const names: string[] = [];
  const matcher = /\{([^}]+)\}/g;
  let match = matcher.exec(path);
  while (match) {
    const name = String(match[1] || '').trim();
    if (name && !names.includes(name)) {
      names.push(name);
    }
    match = matcher.exec(path);
  }
  return names;
}

test('Realm keeps baseUrl/accessToken isolated per instance', async () => {
  const originalFetch = globalThis.fetch;
  const calls: FetchCall[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = resolveFetchUrl(input);
    const headers = resolveFetchHeaders(input, init);
    calls.push({
      url,
      authorization: headers.get('Authorization') || undefined,
    });

    return new Response('{}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  }) as typeof globalThis.fetch;

  try {
    const realmA = new Realm({
      baseUrl: 'https://realm-a.nimi.xyz',
      auth: { accessToken: 'token-a' },
    });
    const realmB = new Realm({
      baseUrl: 'https://realm-b.nimi.xyz',
      auth: { accessToken: 'token-b' },
    });

    await realmA.raw.request({ method: 'GET', path: '/api/a' });
    await realmB.raw.request({ method: 'GET', path: '/api/b' });

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://realm-a.nimi.xyz/api/a');
    assert.equal(calls[0]?.authorization, 'Bearer token-a');
    assert.equal(calls[1]?.url, 'https://realm-b.nimi.xyz/api/b');
    assert.equal(calls[1]?.authorization, 'Bearer token-b');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm raw.request replaces pathParams before dispatch', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    calls.push(resolveFetchUrl(input));
    return new Response('{}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-path-params.nimi.xyz',
      auth: null,
    });

    await realm.raw.request({
      method: 'GET',
      path: '/api/worlds/{worldId}/posts/{postId}',
      pathParams: {
        worldId: 'world 1',
        postId: 42,
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0], 'https://realm-path-params.nimi.xyz/api/worlds/world%201/posts/42');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm services facade uses instance config (no global OpenAPI mutation)', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    calls.push(resolveFetchUrl(input));
    return new Response('{}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-service.nimi.xyz',
      auth: null,
    });

    await realm.services.AuthService.passwordLogin({
      email: 'test@nimi.xyz',
      password: 'secret',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0], 'https://realm-service.nimi.xyz/api/auth/password/login');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm maps HTTP errors to NimiError with layered reasonCode/actionHint', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (): Promise<Response> => {
    return new Response(JSON.stringify({
      reasonCode: ReasonCode.APP_TOKEN_EXPIRED,
      actionHint: 'reauthenticate_now',
      message: 'token expired',
      traceId: 'trace-realm-401',
    }), {
      status: 401,
      headers: {
        'content-type': 'application/json',
      },
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-error.nimi.xyz',
      auth: null,
    });

    let thrown: unknown = null;
    try {
      await realm.raw.request({ method: 'GET', path: '/api/secure' });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown);
    const nimiError = asNimiError(thrown, { source: 'realm' });
    assert.equal(nimiError.code, ReasonCode.AUTH_DENIED);
    assert.equal(nimiError.reasonCode, ReasonCode.APP_TOKEN_EXPIRED);
    assert.equal(nimiError.actionHint, 'reauthenticate_now');
    assert.equal(nimiError.traceId, 'trace-realm-401');
    assert.equal(nimiError.source, 'realm');
    assert.equal(nimiError.details?.rawReasonCode, ReasonCode.APP_TOKEN_EXPIRED);
    assert.equal(nimiError.details?.httpStatus, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm maps HTTP 422 to CONFIG_INVALID when reasonCode is absent', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (): Promise<Response> => {
    return new Response(JSON.stringify({
      message: 'payload invalid',
    }), {
      status: 422,
      headers: {
        'content-type': 'application/json',
      },
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-validation.nimi.xyz',
      auth: null,
    });

    let thrown: unknown = null;
    try {
      await realm.raw.request({ method: 'POST', path: '/api/validate', body: {} });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown);
    const nimiError = asNimiError(thrown, { source: 'realm' });
    assert.equal(nimiError.code, ReasonCode.CONFIG_INVALID);
    assert.equal(nimiError.reasonCode, ReasonCode.CONFIG_INVALID);
    assert.equal(nimiError.actionHint, 'fix_realm_config_or_request_payload');
    assert.equal(nimiError.details?.httpStatus, 422);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm maps default 404/409/429 status codes when reasonCode is absent', async () => {
  const originalFetch = globalThis.fetch;

  const statusByPath: Record<string, number> = {
    '/api/not-found': 404,
    '/api/conflict': 409,
    '/api/rate-limited': 429,
  };

  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const pathname = new URL(resolveFetchUrl(input)).pathname;
    const status = statusByPath[pathname] || 500;
    return new Response(JSON.stringify({ message: `status ${status}` }), {
      status,
      headers: {
        'content-type': 'application/json',
      },
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-status-map.nimi.xyz',
      auth: null,
    });

    const expectations: Array<{
      path: string;
      reasonCode: string;
    }> = [
      { path: '/api/not-found', reasonCode: ReasonCode.REALM_NOT_FOUND },
      { path: '/api/conflict', reasonCode: ReasonCode.REALM_CONFLICT },
      { path: '/api/rate-limited', reasonCode: ReasonCode.REALM_RATE_LIMITED },
    ];

    for (const item of expectations) {
      let thrown: unknown = null;
      try {
        await realm.raw.request({ method: 'GET', path: item.path });
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown);
      const nimiError = asNimiError(thrown, { source: 'realm' });
      assert.equal(nimiError.code, item.reasonCode);
      assert.equal(nimiError.reasonCode, item.reasonCode);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm maps network failures to REALM_UNAVAILABLE', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (): Promise<Response> => {
    throw new TypeError('fetch failed');
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-network.nimi.xyz',
      auth: null,
    });

    let thrown: unknown = null;
    try {
      await realm.raw.request({ method: 'GET', path: '/api/ping' });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown);
    const nimiError = asNimiError(thrown, { source: 'realm' });
    assert.equal(nimiError.code, ReasonCode.REALM_UNAVAILABLE);
    assert.equal(nimiError.reasonCode, 'REALM_UNAVAILABLE');
    assert.equal(nimiError.source, 'realm');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm maps timeout abort to REALM_UNAVAILABLE (not OPERATION_ABORTED)', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    return await new Promise<Response>((_resolve, reject) => {
      const signal = resolveFetchSignal(_input, init);
      if (!signal) {
        reject(new Error('missing signal'));
        return;
      }
      if (signal.aborted) {
        reject(createAbortError('request aborted'));
        return;
      }
      signal.addEventListener('abort', () => {
        reject(createAbortError('request aborted'));
      }, { once: true });
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-timeout.nimi.xyz',
      timeoutMs: 10,
      auth: null,
    });

    let thrown: unknown = null;
    try {
      await realm.raw.request({ method: 'GET', path: '/api/slow' });
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown);
    const nimiError = asNimiError(thrown, { source: 'realm' });
    assert.equal(nimiError.code, ReasonCode.REALM_UNAVAILABLE);
    assert.equal(nimiError.reasonCode, ReasonCode.REALM_UNAVAILABLE);
    assert.equal(nimiError.actionHint, 'retry_after_backoff');
    assert.equal(nimiError.details?.timeoutMs, 10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm maps external abort signal to OPERATION_ABORTED', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    return await new Promise<Response>((_resolve, reject) => {
      const signal = resolveFetchSignal(_input, init);
      if (!signal) {
        reject(new Error('missing signal'));
        return;
      }
      if (signal.aborted) {
        reject(createAbortError('request aborted'));
        return;
      }
      signal.addEventListener('abort', () => {
        reject(createAbortError('request aborted'));
      }, { once: true });
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-abort.nimi.xyz',
      timeoutMs: 1000,
      auth: null,
    });
    const controller = new AbortController();
    const requestPromise = realm.raw.request({
      method: 'GET',
      path: '/api/stream',
      signal: controller.signal,
    });
    controller.abort();

    let thrown: unknown = null;
    try {
      await requestPromise;
    } catch (error) {
      thrown = error;
    }

    assert.ok(thrown);
    const nimiError = asNimiError(thrown, { source: 'realm' });
    assert.equal(nimiError.code, ReasonCode.OPERATION_ABORTED);
    assert.equal(nimiError.reasonCode, ReasonCode.OPERATION_ABORTED);
    assert.equal(nimiError.retryable, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm operation map keeps path params first and ordered by template', () => {
  for (const [operationKey, operation] of Object.entries(REALM_OPERATION_MAP)) {
    const parameters = operation.parameters || [];
    let nonPathSeen = false;
    for (const parameter of parameters) {
      if (parameter.in !== 'path') {
        nonPathSeen = true;
        continue;
      }
      assert.equal(
        nonPathSeen,
        false,
        `${operationKey} has path parameter after non-path parameter`,
      );
    }

    const expectedPathOrder = extractPathParameterNames(operation.path);
    const actualPathOrder = parameters
      .filter((parameter) => parameter.in === 'path')
      .map((parameter) => parameter.name);

    assert.deepEqual(
      actualPathOrder,
      expectedPathOrder,
      `${operationKey} path parameter order does not match ${operation.path}`,
    );
  }
});

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

    const result = await realm.raw.request({ method: 'GET', path: '/api/protected' });
    assert.deepEqual(result, { data: 'success' });
    assert.ok(refreshedResult);
    assert.equal((refreshedResult as { accessToken: string }).accessToken, 'new-access-token');
    assert.equal((refreshedResult as { refreshToken: string }).refreshToken, 'new-refresh-token');
    assert.equal(callCount, 3); // 401 + refresh + retry
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
      await realm.raw.request({ method: 'GET', path: '/api/protected' });
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
      await realm.raw.request({ method: 'GET', path: '/api/protected' });
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
      await realm.raw.request({ method: 'GET', path: '/api/admin' });
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

    const result = await realm.raw.request({ method: 'GET', path: '/api/data' });
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

    await realm.raw.request({ method: 'GET', path: '/api/public' });

    assert.equal(capturedHeaders.length, 1);
    assert.equal(capturedHeaders[0]?.authorization, undefined, 'unauthenticated mode must not emit Authorization header');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm ready() emits error event on probe failure (SDKREALM-019)', async () => {
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

    await realm.ready({ timeoutMs: 1000 });

    assert.equal(errors.length, 1, 'ready() probe failure must emit exactly one error event');
    assert.equal(errors[0]?.error?.reasonCode, 'REALM_UNAVAILABLE');
    assert.equal(realm.state().status, 'ready', 'state must still be ready (fail-open)');
  } finally {
    globalThis.fetch = originalFetch;
  }
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

    await realm.services.HumanChatService.listMessages('chat-123', 20);
    await realm.services.HumanChatService.syncChatEvents('chat-123', 200, 5);
    await realm.services.HumanChatService.recallMessage('chat-123', 'msg-9');
    await realm.services.WorldsService.worldControllerGetWorldLevelAudits('world-7', 30);
    await realm.services.WorldsService.worldControllerGetWorldDetailWithAgents('world-7', 4);
    await realm.services.WorldsService.worldControllerGetWorldviewEvents('world-7', 0, 50);
    await realm.services.WorldsService.worldControllerGetWorldLorebooks('world-7');
    await realm.services.WorldsService.worldControllerGetWorldScenes('world-7');
    await realm.services.WorldsService.worldControllerGetWorldMediaBindings('world-7');
    await realm.services.WorldsService.worldControllerGetWorldMutations('world-7');

    assert.equal(urls.length, 10);

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
    assert.equal(worldviewEventsUrl.pathname, '/api/world/by-id/world-7/worldview/events');
    assert.equal(worldviewEventsUrl.searchParams.get('offset'), '0');
    assert.equal(worldviewEventsUrl.searchParams.get('limit'), '50');

    const lorebooksUrl = new URL(urls[6] || '');
    assert.equal(lorebooksUrl.pathname, '/api/world/by-id/world-7/lorebooks');

    const scenesUrl = new URL(urls[7] || '');
    assert.equal(scenesUrl.pathname, '/api/world/by-id/world-7/scenes');

    const mediaBindingsUrl = new URL(urls[8] || '');
    assert.equal(mediaBindingsUrl.pathname, '/api/world/by-id/world-7/media-bindings');

    const mutationsUrl = new URL(urls[9] || '');
    assert.equal(mutationsUrl.pathname, '/api/world/by-id/world-7/mutations');
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
      await realm.raw.request({ method: 'GET', path: '/api/protected' });
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
      realm.raw.request({ method: 'GET', path: '/api/resource-a' }),
      realm.raw.request({ method: 'GET', path: '/api/resource-b' }),
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

    await realm.raw.request({ method: 'GET', path: '/api/first' });
    await realm.raw.request({ method: 'GET', path: '/api/second' });

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

    await realm.raw.request({ method: 'GET', path: '/api/first' });
    await realm.raw.request({ method: 'GET', path: '/api/second' });

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

    await realm.raw.request({ method: 'GET', path: '/api/one' });
    await realm.raw.request({ method: 'GET', path: '/api/two' });

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
    const result = await realm.raw.request({ method: 'GET', path: '/api/after-close' });

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

    const result = await realm.raw.request({ method: 'DELETE', path: '/api/resource' });
    assert.equal(result, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm returns text for text/plain responses', async () => {
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

    const result = await realm.raw.request({ method: 'GET', path: '/api/text' });
    assert.equal(result, 'plain-text-payload');
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

    const result = await realm.raw.request({ method: 'GET', path: '/api/rate-limited' });
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

    const result = await realm.raw.request({ method: 'GET', path: '/api/flaky' });
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
      () => realm.raw.request({ method: 'GET', path: '/api/still-flaky' }),
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
