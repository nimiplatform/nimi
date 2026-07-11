import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { parseRuntimeDefaults } from '../src/shell/renderer/bridge/runtime-bridge/types';

const runtimeBridgeSource = readFileSync(
  new URL('../src/shell/renderer/bridge/runtime-bridge.ts', import.meta.url),
  'utf8',
);
const runtimeParsersSource = readFileSync(
  new URL('../src/shell/renderer/bridge/runtime-bridge/runtime-parsers.ts', import.meta.url),
  'utf8',
);
const runtimeDaemonSource = readFileSync(
  new URL('../src/shell/renderer/bridge/runtime-bridge/runtime-daemon.ts', import.meta.url),
  'utf8',
);

test('runtime defaults bridge is consumed directly from Kit without Desktop forwarding shells', () => {
  assert.equal(
    existsSync(new URL('../src/shell/renderer/bridge/runtime-bridge/runtime-defaults.ts', import.meta.url)),
    false,
  );
  assert.equal(
    existsSync(new URL('../src/shell/renderer/bridge/runtime-bridge/env.ts', import.meta.url)),
    false,
  );
  assert.match(
    runtimeBridgeSource,
    /import \{[^}]*getRuntimeDefaults[^}]*hasTauriInvoke[^}]*\} from '@nimiplatform\/kit\/shell\/renderer\/bridge'/,
  );
  assert.doesNotMatch(
    runtimeBridgeSource,
    /function\s+(readEnv|resolveRealmBaseUrlFallback|readRuntimeDefaultsFallback|applyEnvOverrides)\b/,
  );
  assert.doesNotMatch(
    runtimeBridgeSource,
    /deriveDefaultJwksUrl|deriveDefaultRevocationUrl|normalizeLoopbackHttpUrl/,
  );
});

test('runtime daemon bridge exposes no generic config document path', () => {
  assert.doesNotMatch(runtimeParsersSource, /parseRuntimeBridgeConfig(Get|Set)Result/);
  assert.doesNotMatch(runtimeDaemonSource, /getDaemonConfig|setDaemonConfig|runtime_bridge_config_(get|set)/);
});

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

test('parseRuntimeDefaults ignores retired route defaults', () => {
  const parsed = parseRuntimeDefaults({
    realm: {
      realmBaseUrl: 'http://localhost:3002',
      realtimeUrl: '',
      accessToken: 'retired-token',
      jwksUrl: 'http://localhost:3002/api/auth/jwks',
      revocationUrl: 'http://localhost:3002/api/auth/sessions/introspect',
      jwtIssuer: 'http://localhost:3002',
      jwtAudience: 'nimi-runtime',
    },
    runtime: {
      localProviderEndpoint: 'http://127.0.0.1:1234/v1',
      localProviderModel: 'legacy-model',
      localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
      connectorId: 'legacy-connector',
      targetType: '',
      targetAccountId: '',
      agentId: '',
      worldId: '',
      provider: 'legacy-provider',
      userConfirmedUpload: false,
    },
  });

  const runtime = parsed.runtime as Record<string, unknown>;
  assert.equal(runtime.localProviderEndpoint, undefined);
  assert.equal(runtime.localProviderModel, undefined);
  assert.equal(runtime.localOpenAiEndpoint, undefined);
  assert.equal(runtime.connectorId, undefined);
  assert.equal(runtime.provider, undefined);
});

test('parseRuntimeDefaults rejects legacy flat payload', () => {
  assert.throws(
    () => parseRuntimeDefaults({
      realmBaseUrl: 'http://localhost:3002',
      realtimeUrl: 'http://localhost:3003',
      accessToken: 'token-legacy',
    }),
    /runtimeDefaults\.get realm payload is invalid/,
  );
});
