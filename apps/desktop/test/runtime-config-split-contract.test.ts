import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveControlPlaneRuntimeConfig } from '../src/runtime/control-plane/env';
import { parseRuntimeDefaults } from '../src/shell/renderer/bridge/runtime-bridge/types';

function withEnv(
  updates: Record<string, string | undefined>,
  run: () => void,
): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(updates)) {
    previous.set(key, process.env[key]);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('parseRuntimeDefaults requires split realm/runtime payload', () => {
  const parsed = parseRuntimeDefaults({
    realm: {
      realmBaseUrl: 'http://localhost:3002',
      realtimeUrl: 'http://localhost:3003',
      accessToken: 'token-1',
    },
    runtime: {
      localProviderEndpoint: 'http://127.0.0.1:1234/v1',
      localProviderModel: 'local-model',
      localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
      credentialRefId: 'test-ref',
      targetType: 'AGENT',
      targetAccountId: 'account-1',
      agentId: 'agent-1',
      worldId: 'world-1',
      provider: 'local-runtime',
      userConfirmedUpload: true,
    },
  });

  assert.equal(parsed.realm.realmBaseUrl, 'http://localhost:3002');
  assert.equal(parsed.realm.realtimeUrl, 'http://localhost:3003');
  assert.equal(parsed.realm.accessToken, 'token-1');
  assert.equal(parsed.runtime.localProviderModel, 'local-model');
  assert.equal(parsed.runtime.targetType, 'AGENT');
  assert.equal(parsed.runtime.userConfirmedUpload, true);
});

test('parseRuntimeDefaults rejects legacy flat payload', () => {
  assert.throws(
    () => parseRuntimeDefaults({
      realmBaseUrl: 'http://localhost:3002',
      realtimeUrl: 'http://localhost:3003',
      accessToken: 'token-legacy',
    }),
    /runtime_defaults realm payload is invalid/,
  );
});

test('resolveControlPlaneRuntimeConfig prefers per-call values', () => {
  withEnv(
    {
      NIMI_CONTROL_PLANE_URL: 'http://env-control-plane.local',
      NIMI_ACCESS_TOKEN: 'env-token',
    },
    () => {
      const config = resolveControlPlaneRuntimeConfig({
        controlPlaneBaseUrl: 'http://input-control-plane.local',
        accessToken: 'input-token',
      });
      assert.equal(config.baseUrl, 'http://input-control-plane.local');
      assert.equal(config.accessToken, 'input-token');
    },
  );
});

test('resolveControlPlaneRuntimeConfig falls back to env and defaults', () => {
  withEnv(
    {
      NIMI_CONTROL_PLANE_URL: 'http://env-control-plane.local',
      NIMI_ACCESS_TOKEN: 'env-token',
    },
    () => {
      const fromEnv = resolveControlPlaneRuntimeConfig({});
      assert.equal(fromEnv.baseUrl, 'http://env-control-plane.local');
      assert.equal(fromEnv.accessToken, 'env-token');
    },
  );

  withEnv(
    {
      NIMI_CONTROL_PLANE_URL: undefined,
      NIMI_ACCESS_TOKEN: undefined,
    },
    () => {
      const fromDefault = resolveControlPlaneRuntimeConfig({});
      assert.equal(fromDefault.baseUrl, 'http://localhost');
      assert.equal(fromDefault.accessToken, '');
    },
  );
});
