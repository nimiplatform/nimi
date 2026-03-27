import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { clearPlatformClient, createPlatformClient, getPlatformClient } from '../src/index.js';
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
  assert.equal(getPlatformClient(), client);
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
