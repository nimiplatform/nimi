import assert from 'node:assert/strict';
import test from 'node:test';

import { clearPlatformClient, createPlatformClient, getPlatformClient } from '../src/index.js';

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
