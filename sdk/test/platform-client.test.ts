import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { clearPlatformClient, createPlatformClient, getPlatformClient } from '../src/index.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const distPlatformClientDtsPath = path.join(testDir, '..', 'dist', 'platform-client.d.ts');
const distRuntimeTypesDtsPath = path.join(testDir, '..', 'dist', 'runtime', 'types-runtime-modules.d.ts');

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
    /runtime is disabled/,
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
