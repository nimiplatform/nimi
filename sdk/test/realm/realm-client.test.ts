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
      baseUrl: 'https://realm-a.nimi.local',
      auth: { accessToken: 'token-a' },
    });
    const realmB = new Realm({
      baseUrl: 'https://realm-b.nimi.local',
      auth: { accessToken: 'token-b' },
    });

    await realmA.raw.request({ method: 'GET', path: '/api/a' });
    await realmB.raw.request({ method: 'GET', path: '/api/b' });

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://realm-a.nimi.local/api/a');
    assert.equal(calls[0]?.authorization, 'Bearer token-a');
    assert.equal(calls[1]?.url, 'https://realm-b.nimi.local/api/b');
    assert.equal(calls[1]?.authorization, 'Bearer token-b');
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
      baseUrl: 'https://realm-service.nimi.local',
    });

    await realm.services.AuthService.passwordLogin({
      email: 'test@nimi.local',
      password: 'secret',
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0], 'https://realm-service.nimi.local/api/auth/password/login');
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
      baseUrl: 'https://realm-error.nimi.local',
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
      baseUrl: 'https://realm-validation.nimi.local',
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
      baseUrl: 'https://realm-status-map.nimi.local',
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
      baseUrl: 'https://realm-network.nimi.local',
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
      baseUrl: 'https://realm-timeout.nimi.local',
      timeoutMs: 10,
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
      baseUrl: 'https://realm-abort.nimi.local',
      timeoutMs: 1000,
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
      baseUrl: 'https://realm-params.nimi.local',
    });

    await realm.services.HumanChatService.listMessages('chat-123', 20);
    await realm.services.HumanChatService.syncChatEvents('chat-123', 200, 5);
    await realm.services.HumanChatService.recallMessage('chat-123', 'msg-9');
    await realm.services.WorldsService.worldControllerGetWorldLevelAudits('world-7', 30);
    await realm.services.WorldsService.worldControllerGetWorldviewEvents('world-7', 0, 50);

    assert.equal(urls.length, 5);

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

    const worldviewEventsUrl = new URL(urls[4] || '');
    assert.equal(worldviewEventsUrl.pathname, '/api/world/by-id/world-7/worldview/events');
    assert.equal(worldviewEventsUrl.searchParams.get('offset'), '0');
    assert.equal(worldviewEventsUrl.searchParams.get('limit'), '50');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
