import assert from 'node:assert/strict';
import test from 'node:test';

import { Realm } from '../../src/realm/index.js';
import { REALM_OPERATION_MAP } from '../../src/realm/generated/operation-map.js';
import { asNimiError } from '../../src/runtime/index.js';
import { ReasonCode } from '../../src/types/index.js';
import { FetchCall, extractPathParameterNames, resolveFetchHeaders, resolveFetchSignal, resolveFetchUrl, createAbortError } from './realm-client-test-helpers.js';

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

    await realmA.unsafeRaw.request({ method: 'GET', path: '/api/a' });
    await realmB.unsafeRaw.request({ method: 'GET', path: '/api/b' });

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://realm-a.nimi.xyz/api/a');
    assert.equal(calls[0]?.authorization, 'Bearer token-a');
    assert.equal(calls[1]?.url, 'https://realm-b.nimi.xyz/api/b');
    assert.equal(calls[1]?.authorization, 'Bearer token-b');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Realm unsafeRaw.request replaces pathParams before dispatch', async () => {
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

    await realm.unsafeRaw.request({
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

test('Realm exposes unsafeRaw as the explicit escape hatch', () => {
  const realm = new Realm({
    baseUrl: 'https://realm-unsafe-raw.nimi.xyz',
    auth: null,
  });

  assert.equal(typeof realm.unsafeRaw.request, 'function');
});

test('Realm unsafeRaw.request rejects unsupported HTTP methods with supported list', async () => {
  const realm = new Realm({
    baseUrl: 'https://realm-methods.nimi.xyz',
    auth: null,
  });

  await assert.rejects(
    () => realm.unsafeRaw.request({ method: 'TRACE', path: '/api/policy' }),
    (error: unknown) => {
      const nimiError = asNimiError(error, { source: 'realm' });
      assert.equal(nimiError.reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      assert.match(
        nimiError.message,
        /supported methods: GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD/,
      );
      return true;
    },
  );
});

test('Realm unsafeRaw.request only returns typed data through explicit parsing', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (): Promise<Response> => {
    return new Response(JSON.stringify({ allowed: true }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  }) as typeof globalThis.fetch;

  try {
    const realm = new Realm({
      baseUrl: 'https://realm-parser.nimi.xyz',
      auth: null,
    });

    const result = await realm.unsafeRaw.request({
      method: 'GET',
      path: '/api/policy',
      parseResponse: (value) => {
        const record = (value && typeof value === 'object') ? value as { allowed?: unknown } : {};
        return { allowed: record.allowed === true };
      },
    });

    assert.deepEqual(result, { allowed: true });
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
      await realm.unsafeRaw.request({ method: 'GET', path: '/api/secure' });
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
      await realm.unsafeRaw.request({ method: 'POST', path: '/api/validate', body: {} });
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
        await realm.unsafeRaw.request({ method: 'GET', path: item.path });
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
      await realm.unsafeRaw.request({ method: 'GET', path: '/api/ping' });
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
      await realm.unsafeRaw.request({ method: 'GET', path: '/api/slow' });
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
    const requestPromise = realm.unsafeRaw.request({
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
