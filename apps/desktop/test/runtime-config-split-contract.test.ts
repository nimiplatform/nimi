import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRuntimeDefaults } from '../src/shell/renderer/bridge/runtime-bridge/types';

test('parseRuntimeDefaults requires split realm/runtime payload', () => {
  const parsed = parseRuntimeDefaults({
    realm: {
      realmBaseUrl: 'http://localhost:3002',
      realtimeUrl: 'http://localhost:3003',
      accessToken: 'token-1',
      jwksUrl: 'http://localhost:3002/api/auth/jwks',
      revocationUrl: 'http://localhost:3002/api/auth/sessions/introspect',
      jwtIssuer: 'http://localhost:3002',
      jwtAudience: 'nimi-runtime',
    },
    runtime: {
      localProviderEndpoint: 'http://127.0.0.1:1234/v1',
      localProviderModel: 'local-model',
      localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
      connectorId: 'test-ref',
      targetType: '',
      targetAccountId: '',
      agentId: '',
      worldId: 'world-1',
      provider: 'local',
      userConfirmedUpload: true,
    },
  });

  assert.equal(parsed.realm.realmBaseUrl, 'http://localhost:3002');
  assert.equal(parsed.realm.realtimeUrl, 'http://localhost:3003');
  assert.equal(parsed.realm.accessToken, 'token-1');
  assert.equal(parsed.realm.jwksUrl, 'http://localhost:3002/api/auth/jwks');
  assert.equal(parsed.realm.revocationUrl, 'http://localhost:3002/api/auth/sessions/introspect');
  assert.equal(parsed.realm.jwtIssuer, 'http://localhost:3002');
  assert.equal(parsed.realm.jwtAudience, 'nimi-runtime');
  assert.equal(parsed.runtime.localProviderModel, 'local-model');
  assert.equal(parsed.runtime.targetType, '');
  assert.equal(parsed.runtime.userConfirmedUpload, true);
});

test('parseRuntimeDefaults allows empty local bindings', () => {
  const parsed = parseRuntimeDefaults({
    realm: {
      realmBaseUrl: 'http://localhost:3002',
      realtimeUrl: '',
      accessToken: '',
      jwksUrl: 'http://localhost:3002/api/auth/jwks',
      revocationUrl: 'http://localhost:3002/api/auth/sessions/introspect',
      jwtIssuer: 'http://localhost:3002',
      jwtAudience: 'nimi-runtime',
    },
    runtime: {
      localProviderEndpoint: '',
      localProviderModel: '',
      localOpenAiEndpoint: '',
      connectorId: '',
      targetType: '',
      targetAccountId: '',
      agentId: '',
      worldId: '',
      provider: '',
      userConfirmedUpload: false,
    },
  });

  assert.equal(parsed.runtime.localProviderEndpoint, '');
  assert.equal(parsed.runtime.localProviderModel, '');
  assert.equal(parsed.runtime.localOpenAiEndpoint, '');
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
