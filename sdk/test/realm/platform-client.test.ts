import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlatformClient, getPlatformClient, clearPlatformClient } from '../../src/platform-client.js';
import { asNimiError } from '../../src/runtime/errors.js';
import { ReasonCode } from '../../src/types/index.js';

test('getPlatformClient throws SDK_PLATFORM_CLIENT_NOT_READY before init', async () => {
  await clearPlatformClient();

  assert.throws(
    () => getPlatformClient(),
    (error: unknown) => {
      const nimiError = asNimiError(error, { source: 'sdk' });
      assert.equal(nimiError.reasonCode, ReasonCode.SDK_PLATFORM_CLIENT_NOT_READY);
      return true;
    },
  );
});

test('createPlatformClient returns client with realm and domains', async () => {
  await clearPlatformClient();

  try {
    const client = await createPlatformClient({
      realmBaseUrl: 'https://platform-test.nimi.xyz',
      accessToken: 'test-token',
      runtimeTransport: null,
    });

    assert.ok(client.realm);
    assert.ok(client.domains);
    assert.equal(typeof client.domains.auth.getCurrentUser, 'function');
    assert.equal(typeof client.domains.social.startChat, 'function');
    assert.equal(typeof client.domains.world.getWorld, 'function');
    assert.equal(typeof client.domains.creator.listAgents, 'function');
    assert.equal(typeof client.domains.resources.createImageDirectUpload, 'function');
    assert.equal(typeof client.worldEvolution.executionEvents.read, 'function');
    assert.equal(typeof client.worldEvolution.supervision.read, 'function');

    const same = getPlatformClient();
    assert.equal(same, client);
  } finally {
    await clearPlatformClient();
  }
});

test('clearPlatformClient resets singleton so getPlatformClient throws', async () => {
  await clearPlatformClient();

  try {
    await createPlatformClient({
      realmBaseUrl: 'https://platform-clear.nimi.xyz',
      accessToken: 'test-token',
      runtimeTransport: null,
    });

    assert.ok(getPlatformClient());
    await clearPlatformClient();

    assert.throws(
      () => getPlatformClient(),
      (error: unknown) => {
        const e = asNimiError(error, { source: 'sdk' });
        return e.reasonCode === ReasonCode.SDK_PLATFORM_CLIENT_NOT_READY;
      },
    );
  } finally {
    await clearPlatformClient();
  }
});

test('disabled runtime proxy throws SDK_RUNTIME_METHOD_UNAVAILABLE', async () => {
  await clearPlatformClient();

  try {
    const client = await createPlatformClient({
      realmBaseUrl: 'https://platform-disabled-rt.nimi.xyz',
      accessToken: 'test-token',
      runtimeTransport: null,
    });

    assert.throws(
      () => {
        (client.runtime as unknown as { connector: unknown }).connector;
      },
      (error: unknown) => {
        const e = asNimiError(error, { source: 'sdk' });
        return e.reasonCode === ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE;
      },
    );
  } finally {
    await clearPlatformClient();
  }
});
