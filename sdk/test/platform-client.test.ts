import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  clearPlatformClient,
  createPlatformClient,
  createLocalFirstPartyRuntimePlatformClient,
  getPlatformClient,
  unstable_attachPlatformWorldEvolutionSelectorReadProvider,
} from '../src/index.js';
import { GetRuntimeHealthResponse, setNodeGrpcBridge } from '../src/runtime/index.js';
import { GetAccessTokenResponse } from '../src/runtime/generated/runtime/v1/account.js';
import { RegisterAppResponse } from '../src/runtime/generated/runtime/v1/auth.js';
import { ReasonCode } from '../src/types/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const distPlatformClientDtsPath = path.join(testDir, '..', 'dist', 'platform-client.d.ts');
const distRuntimeTypesDtsPath = path.join(testDir, '..', 'dist', 'runtime', 'types-runtime-modules.d.ts');

function readAuthorizationHeader(input: RequestInfo | URL, init?: RequestInit): string {
  if (input instanceof Request) {
    return input.headers.get('authorization') || '';
  }
  return new Headers(init?.headers as HeadersInit | undefined).get('authorization') || '';
}

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createJwt(expSecondsFromNow: number): string {
  const header = toBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = toBase64Url(JSON.stringify({
    sub: 'user-1',
    exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
  }));
  return `${header}.${payload}.signature`;
}

test('createPlatformClient initializes runtime, realm, and grouped domains', async () => {
  clearPlatformClient();

  const client = await createPlatformClient({
    appId: 'nimi.sdk.platform.test',
    realmBaseUrl: 'https://realm.example',
    accessToken: 'test-token',
    runtimeTransport: {
      type: 'tauri-ipc',
      commandNamespace: 'runtime_bridge',
      eventNamespace: 'runtime_bridge',
    },
  });

  assert.equal(client.runtime.appId, 'nimi.sdk.platform.test');
  assert.equal(client.realm.baseUrl, 'https://realm.example');
  assert.equal(typeof client.domains.auth.getCurrentUser, 'function');
  assert.equal(typeof client.domains.runtimeAdmin.listConnectors, 'function');
  assert.equal(typeof client.worldEvolution.executionEvents.read, 'function');
  assert.equal(typeof client.worldEvolution.commitRequests.read, 'function');
  assert.equal(getPlatformClient(), client);
});

test('platform client worldEvolution facade fails closed when no selector-read provider is attached', async () => {
  clearPlatformClient();

  const client = await createPlatformClient({
    appId: 'nimi.sdk.platform.wee.no-provider',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });

  await assert.rejects(
    () => client.worldEvolution.executionEvents.read({ eventId: 'evt-1' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_PERMISSION_DENIED);
      assert.equal((error as { source?: string }).source, 'sdk');
      assert.equal((error as { details?: { rejectionCategory?: string } }).details?.rejectionCategory, 'BOUNDARY_DENIED');
      return true;
    },
  );
});

test('platform client exposes an unstable bootstrap attachment helper for worldEvolution provider wiring', async () => {
  clearPlatformClient();

  const client = await createPlatformClient({
    appId: 'nimi.sdk.platform.wee.attach-helper',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });

  unstable_attachPlatformWorldEvolutionSelectorReadProvider(client, {
    executionEvents: {
      read: async () => [],
    },
    replays: {
      read: async () => [],
    },
    checkpoints: {
      read: async () => [],
    },
    supervision: {
      read: async () => [],
    },
    commitRequests: {
      read: async () => [],
    },
  });

  const result = await client.worldEvolution.executionEvents.read({ eventId: 'evt-attached' });
  assert.equal(result.matchMode, 'exact');
  assert.deepEqual(result.matches, []);
});

test('platform client worldEvolution replays.read fails closed on unsupported selector replay mode', async () => {
  clearPlatformClient();

  const client = await createPlatformClient({
    appId: 'nimi.sdk.platform.wee.replay-mode.selector',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });

  let providerCalled = false;
  unstable_attachPlatformWorldEvolutionSelectorReadProvider(client, {
    executionEvents: { read: async () => [] },
    replays: {
      read: async () => {
        providerCalled = true;
        return [];
      },
    },
    checkpoints: { read: async () => [] },
    supervision: { read: async () => [] },
    commitRequests: { read: async () => [] },
  });

  await assert.rejects(
    () => client.worldEvolution.replays.read({
      replayRef: { kind: 'replay', refId: 'replay-invalid-selector' },
      replayMode: 'HYBRID',
    }),
    (error: unknown) => {
      assert.equal(providerCalled, false);
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      assert.equal((error as { source?: string }).source, 'sdk');
      assert.equal((error as { details?: { rejectionCategory?: string } }).details?.rejectionCategory, 'INVALID_SELECTOR');
      assert.equal((error as { details?: { methodId?: string } }).details?.methodId, 'worldEvolution.replays.read');
      return true;
    },
  );
});

test('platform client worldEvolution replays.read fails closed on unsupported provider replay mode', async () => {
  clearPlatformClient();

  const client = await createPlatformClient({
    appId: 'nimi.sdk.platform.wee.replay-mode.provider',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });

  unstable_attachPlatformWorldEvolutionSelectorReadProvider(client, {
    executionEvents: { read: async () => [] },
    replays: {
      read: async () => [{
        replayRef: { kind: 'replay', refId: 'replay-invalid-provider' },
        replayMode: 'HYBRID',
      }],
    },
    checkpoints: { read: async () => [] },
    supervision: { read: async () => [] },
    commitRequests: { read: async () => [] },
  });

  await assert.rejects(
    () => client.worldEvolution.replays.read({
      replayRef: { kind: 'replay', refId: 'replay-invalid-provider' },
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED);
      assert.equal((error as { source?: string }).source, 'sdk');
      assert.equal((error as { details?: { rejectionCategory?: string } }).details?.rejectionCategory, 'UNSUPPORTED_PROJECTION_SHAPE');
      assert.equal((error as { details?: { methodId?: string } }).details?.methodId, 'worldEvolution.replays.read');
      return true;
    },
  );
});

test('createPlatformClient supports realm-only consumers with disabled runtime', async () => {
  clearPlatformClient();

  const client = await createPlatformClient({
    appId: 'nimi.sdk.realm.only',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
  });

  assert.equal(client.realm.baseUrl, 'https://realm.example');
  assert.equal(typeof client.domains.publicContent.getPublicPost, 'function');
  assert.throws(
    () => (client.runtime as unknown as { health: () => Promise<unknown> }).health(),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE);
      assert.match(String((error as { message?: string }).message || ''), /runtime is disabled/i);
      return true;
    },
  );
});

test('getPlatformClient throws structured not-ready error before initialization', () => {
  clearPlatformClient();
  assert.throws(
    () => getPlatformClient(),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.SDK_PLATFORM_CLIENT_NOT_READY);
      assert.equal((error as { source?: string }).source, 'sdk');
      return true;
    },
  );
});

test('createPlatformClient resolves realm base url from environment when omitted', async () => {
  clearPlatformClient();
  const previousRealmUrl = process.env.NIMI_REALM_URL;
  process.env.NIMI_REALM_URL = 'https://realm.env.example';

  try {
    const client = await createPlatformClient({
      appId: 'nimi.sdk.platform.env',
      runtimeTransport: null,
      allowAnonymousRealm: true,
    });

    assert.equal(client.realm.baseUrl, 'https://realm.env.example');
  } finally {
    if (previousRealmUrl == null) {
      delete process.env.NIMI_REALM_URL;
    } else {
      process.env.NIMI_REALM_URL = previousRealmUrl;
    }
  }
});

test('createPlatformClient fails closed when no realm base url source is available', async () => {
  clearPlatformClient();
  const previousRealmUrl = process.env.NIMI_REALM_URL;
  const originalLocation = (globalThis as { location?: unknown }).location;
  delete process.env.NIMI_REALM_URL;
  Object.defineProperty(globalThis, 'location', {
    value: undefined,
    configurable: true,
  });

  try {
    await assert.rejects(
      () => createPlatformClient({
        appId: 'nimi.sdk.platform.missing-realm',
        runtimeTransport: null,
        allowAnonymousRealm: true,
      }),
      (error: unknown) => {
        assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.SDK_REALM_ENDPOINT_REQUIRED);
        return true;
      },
    );
  } finally {
    if (previousRealmUrl == null) {
      delete process.env.NIMI_REALM_URL;
    } else {
      process.env.NIMI_REALM_URL = previousRealmUrl;
    }
    Object.defineProperty(globalThis, 'location', {
      value: originalLocation,
      configurable: true,
    });
  }
});

test('createPlatformClient prefers sessionStore token over provider and explicit token', async () => {
  clearPlatformClient();
  let authorizationHeader = '';
  const client = await createPlatformClient({
    appId: 'nimi.sdk.platform.tokens',
    realmBaseUrl: 'https://realm.example',
    accessToken: 'explicit-token',
    accessTokenProvider: async () => 'provider-token',
    sessionStore: {
      getAccessToken: async () => 'store-token',
    },
    runtimeTransport: null,
    realmFetchImpl: async (_input, init) => {
      authorizationHeader = readAuthorizationHeader(_input, init);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await client.realm.ready();
  assert.equal(authorizationHeader, 'Bearer store-token');
});

test('createPlatformClient allows anonymous realm access without authorization header', async () => {
  clearPlatformClient();
  let authorizationHeader: string | null = 'uninitialized';
  const client = await createPlatformClient({
    appId: 'nimi.sdk.platform.anonymous',
    realmBaseUrl: 'https://realm.example',
    allowAnonymousRealm: true,
    runtimeTransport: null,
    realmFetchImpl: async (input, init) => {
      authorizationHeader = readAuthorizationHeader(input, init) || null;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await client.realm.ready();
  assert.equal(authorizationHeader, null);
});

test('local first-party Runtime platform client rejects app-owned auth seams', async () => {
  clearPlatformClient();
  await assert.rejects(
    () => createPlatformClient({
      authMode: 'local-first-party-runtime',
      appId: 'nimi.sdk.local.reject-explicit-token',
      realmBaseUrl: 'https://realm.example',
      accessToken: 'app-token',
      runtimeTransport: null,
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.SDK_AUTH_MODE_INVALID);
      return true;
    },
  );
  await assert.rejects(
    () => createPlatformClient({
      authMode: 'local-first-party-runtime',
      appId: 'nimi.sdk.local.reject-token',
      realmBaseUrl: 'https://realm.example',
      accessTokenProvider: async () => 'app-token',
      runtimeTransport: null,
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.SDK_AUTH_MODE_INVALID);
      return true;
    },
  );
  await assert.rejects(
    () => createPlatformClient({
      authMode: 'local-first-party-runtime',
      appId: 'nimi.sdk.local.reject-refresh',
      realmBaseUrl: 'https://realm.example',
      refreshTokenProvider: async () => 'app-refresh-token',
      runtimeTransport: null,
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.SDK_AUTH_MODE_INVALID);
      return true;
    },
  );
  await assert.rejects(
    () => createPlatformClient({
      authMode: 'local-first-party-runtime',
      appId: 'nimi.sdk.local.reject-subject',
      realmBaseUrl: 'https://realm.example',
      subjectUserIdProvider: async () => 'caller-subject',
      runtimeTransport: null,
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.SDK_AUTH_MODE_INVALID);
      return true;
    },
  );
  await assert.rejects(
    () => createPlatformClient({
      authMode: 'local-first-party-runtime',
      appId: 'nimi.sdk.local.reject-session',
      realmBaseUrl: 'https://realm.example',
      sessionStore: {
        getAccessToken: async () => 'store-token',
      },
      runtimeTransport: null,
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.SDK_AUTH_MODE_INVALID);
      return true;
    },
  );
});

test('local first-party Runtime wrapper does not accept app-owned auth inputs at compile boundary', () => {
  assert.equal(typeof createLocalFirstPartyRuntimePlatformClient, 'function');
});

test('local first-party Runtime platform client uses Runtime access token for Realm data calls', async () => {
  clearPlatformClient();
  let runtimeMethodId = '';
  let runtimeAuthorizationHeader: string | undefined;
  let authorizationHeader = '';
  setNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      runtimeMethodId = input.methodId;
      runtimeAuthorizationHeader = input.authorization;
      if (input.methodId.endsWith('/RegisterApp')) {
        return RegisterAppResponse.toBinary(RegisterAppResponse.create({
          accepted: true,
        }));
      }
      return GetAccessTokenResponse.toBinary(GetAccessTokenResponse.create({
        accepted: true,
        accessToken: 'runtime-issued-short-lived-token',
      }));
    },
    openStream: async () => ({
      async *[Symbol.asyncIterator]() {
        // no-op
      },
    }),
    closeStream: async () => {},
  });

  try {
    const client = await createPlatformClient({
      authMode: 'local-first-party-runtime',
      appId: 'nimi.sdk.local.runtime-token',
      realmBaseUrl: 'https://realm.example',
      runtimeTransport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      realmFetchImpl: async (input, init) => {
        authorizationHeader = readAuthorizationHeader(input, init);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    await client.realm.ready();
    assert.equal(runtimeMethodId, '/nimi.runtime.v1.RuntimeAccountService/GetAccessToken');
    assert.equal(runtimeAuthorizationHeader, undefined);
    assert.equal(authorizationHeader, 'Bearer runtime-issued-short-lived-token');
    await assert.rejects(
      () => client.domains.auth.getCurrentUser(),
      /local first-party Runtime mode/,
    );
  } finally {
    setNodeGrpcBridge(null);
  }
});

test('local first-party Runtime Realm provider fails closed after Runtime revokes account projection', async () => {
  clearPlatformClient();
  let revoked = false;
  setNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId.endsWith('/RegisterApp')) {
        return RegisterAppResponse.toBinary(RegisterAppResponse.create({
          accepted: true,
        }));
      }
      return GetAccessTokenResponse.toBinary(GetAccessTokenResponse.create(
      revoked
        ? {
            accepted: false,
            accountReasonCode: 1,
          }
        : {
            accepted: true,
            accessToken: 'runtime-issued-before-revoke',
          },
      ));
    },
    openStream: async () => ({
      async *[Symbol.asyncIterator]() {
        // no-op
      },
    }),
    closeStream: async () => {},
  });

  try {
    const client = await createPlatformClient({
      authMode: 'local-first-party-runtime',
      appId: 'nimi.sdk.local.runtime-token-revoked',
      realmBaseUrl: 'https://realm.example',
      runtimeTransport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      realmFetchImpl: async () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });

    await client.realm.unsafeRaw.request({ method: 'GET', path: '/api/protected' });
    revoked = true;
    await assert.rejects(
      () => client.realm.unsafeRaw.request({ method: 'GET', path: '/api/protected' }),
      /runtime account access token unavailable/i,
    );
  } finally {
    setNodeGrpcBridge(null);
  }
});


test('createPlatformClient runtime auth provider does not forward expired bearer tokens', async () => {
  clearPlatformClient();
  const previousBridge = null;
  let authorizationHeader: string | undefined;

  setNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      authorizationHeader = input.authorization;
      return GetRuntimeHealthResponse.toBinary(GetRuntimeHealthResponse.create({}));
    },
    openStream: async () => ({
      async *[Symbol.asyncIterator]() {
        // no-op
      },
    }),
    closeStream: async () => {},
  });

  try {
    const client = await createPlatformClient({
      appId: 'nimi.sdk.platform.runtime.expired-token',
      realmBaseUrl: 'https://realm.example',
      accessToken: createJwt(-60),
      runtimeTransport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
    });

    await client.domains.runtimeAdmin.getRuntimeHealth({});
    assert.equal(authorizationHeader, undefined);
  } finally {
    setNodeGrpcBridge(previousBridge);
  }
});

test('createPlatformClient detects tauri transport from global runtime', async () => {
  clearPlatformClient();
  const originalTauri = (globalThis as { __TAURI__?: unknown }).__TAURI__;
  (globalThis as { __TAURI__?: unknown }).__TAURI__ = {};

  try {
    const client = await createPlatformClient({
      appId: 'nimi.sdk.platform.tauri',
      realmBaseUrl: 'https://realm.example',
      allowAnonymousRealm: true,
    });

    assert.equal(client.runtime.transport.type, 'tauri-ipc');
    if (client.runtime.transport.type === 'tauri-ipc') {
      assert.equal(client.runtime.transport.commandNamespace, 'runtime_bridge');
      assert.equal(client.runtime.transport.eventNamespace, 'runtime_bridge');
    }
  } finally {
    if (originalTauri === undefined) {
      delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    } else {
      (globalThis as { __TAURI__?: unknown }).__TAURI__ = originalTauri;
    }
  }
});

test('platform-client public declaration avoids Parameters/ReturnType utility signatures', () => {
  assert.equal(existsSync(distPlatformClientDtsPath), true, 'dist/platform-client.d.ts must exist');
  const source = readFileSync(distPlatformClientDtsPath, 'utf8');
  assert.equal(source.includes('Parameters<'), false);
  assert.equal(source.includes('ReturnType<'), false);
});

test('runtime public declaration does not expose ai fallback knobs on low-level scenario request inputs', () => {
  assert.equal(existsSync(distRuntimeTypesDtsPath), true, 'dist/runtime/types-runtime-modules.d.ts must exist');
  const source = readFileSync(distRuntimeTypesDtsPath, 'utf8');
  assert.equal(source.includes('fallback?:'), false);
});

test('runtime public declaration hard-cuts legacy agent chat/session-centric surface', () => {
  assert.equal(existsSync(distRuntimeTypesDtsPath), true, 'dist/runtime/types-runtime-modules.d.ts must exist');
  const source = readFileSync(distRuntimeTypesDtsPath, 'utf8');
  assert.equal(source.includes('RuntimeAgentChat'), false);
  assert.equal(source.includes('sessionId:'), false);
  assert.equal(source.includes('conversationAnchorId:'), true);
  assert.equal(source.includes('runtime.agent.turn.accepted'), true);
  assert.equal(source.includes('runtime.agent.state.status_text_changed'), true);
  assert.equal(source.includes('runtime.agent.hook.pending'), true);
  assert.equal(source.includes('originatingTurnId?: string;'), true);
});
