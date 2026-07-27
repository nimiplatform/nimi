import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRuntimeDefaults } from '../src/shell/renderer/bridge/runtime-bridge/types';

test('parseRuntimeDefaults requires split realm/runtime payload', () => {
  const parsed = parseRuntimeDefaults({
    realm: {
      realmBaseUrl: 'http://localhost:3002',
      realtimeUrl: 'http://localhost:3003',
      accessToken: 'forged-renderer-token',
      jwksUrl: 'http://localhost:3002/api/auth/jwks',
      revocationUrl: 'http://localhost:3002/api/auth/sessions/introspect',
      jwtIssuer: 'http://localhost:3002',
      jwtAudience: 'nimi-runtime',
    },
    runtime: {
      targetType: '',
      targetAccountId: '',
      agentId: '',
      worldId: 'world-1',
      userConfirmedUpload: true,
    },
  });

  assert.equal(parsed.realm.realmBaseUrl, 'http://localhost:3002');
  assert.equal(parsed.realm.realtimeUrl, 'http://localhost:3003');
  assert.equal('accessToken' in parsed.realm, false);
  assert.equal(parsed.realm.jwksUrl, 'http://localhost:3002/api/auth/jwks');
  assert.equal(parsed.realm.revocationUrl, 'http://localhost:3002/api/auth/sessions/introspect');
  assert.equal(parsed.realm.jwtIssuer, 'http://localhost:3002');
  assert.equal(parsed.realm.jwtAudience, 'nimi-runtime');
  assert.equal(parsed.runtime.targetType, '');
  assert.equal(parsed.runtime.worldId, 'world-1');
  assert.equal(parsed.runtime.userConfirmedUpload, true);
});
