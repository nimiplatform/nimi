import assert from 'node:assert/strict';
import test from 'node:test';
import { Runtime, type CoreTransport } from './index';
import { createNimiRuntimePlatformClient } from './platform-client';

function createTransport(): CoreTransport {
  return {
    async unary() {
      throw new Error('transport should not be called during platform client construction');
    },
    async *serverStream() {
      throw new Error('transport should not be called during platform client construction');
    },
  };
}

test('createNimiRuntimePlatformClient owns Runtime construction for platform consumers', () => {
  const transport = createTransport();
  const client = createNimiRuntimePlatformClient({
    appId: 'nimi.desktop',
    transport,
    createRuntimeAuthMetadata: ({ accountRuntime }) => {
      assert.ok(accountRuntime instanceof Runtime);
      return async () => ({ authorization: 'Bearer runtime-session' });
    },
  });

  assert.ok(client.runtime instanceof Runtime);
  assert.ok(client.accountRuntime instanceof Runtime);
  assert.notEqual(client.runtime, client.accountRuntime);
  assert.equal(client.domains.runtimeAdmin, client.accountRuntime);
});

test('createNimiRuntimePlatformClient does not return singleton Runtime handles', () => {
  const first = createNimiRuntimePlatformClient({
    appId: 'nimi.desktop',
    transport: createTransport(),
  });
  const second = createNimiRuntimePlatformClient({
    appId: 'nimi.desktop',
    transport: createTransport(),
  });

  assert.notEqual(first.runtime, second.runtime);
  assert.notEqual(first.accountRuntime, second.accountRuntime);
});
