import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RUNTIME_BRIDGE_CONFIG_DEFAULTS,
  buildRuntimeBridgeConfigWithLocalEndpoint,
  extractRuntimeBridgeEndpointPort,
  mergeRuntimeBridgeDataRootConfig,
  mergeRuntimeBridgeDeveloperRegistrationConfig,
  mergeRuntimeBridgeRealmJwtConfig,
  projectRuntimeBridgeLocalEndpoint,
  serializeRuntimeBridgeLocalEndpointProjection,
} from '../../src/runtime/index.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

test('runtime bridge config projection maps llama port to loopback endpoint', () => {
  const endpoint = projectRuntimeBridgeLocalEndpoint({
    engines: {
      llama: {
        enabled: true,
        port: 18080,
      },
    },
  });

  assert.equal(endpoint, 'http://127.0.0.1:18080/v1');
});

test('runtime bridge config projection ignores disabled or missing local engine endpoint', () => {
  assert.equal(projectRuntimeBridgeLocalEndpoint({ engines: { llama: { enabled: false, port: 18080 } } }), '');
  assert.equal(projectRuntimeBridgeLocalEndpoint({ engines: {} }), '');
});

test('runtime bridge config projection builds config with runtime-owned defaults and local endpoint', () => {
  const config = buildRuntimeBridgeConfigWithLocalEndpoint({
    engines: {
      media: {
        enabled: true,
        port: 8321,
      },
    },
    providers: {
      local: { baseUrl: 'http://127.0.0.1:11434/v1' },
      gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
    },
  }, 'http://127.0.0.1:11434/v1');

  assert.equal(config.schemaVersion, RUNTIME_BRIDGE_CONFIG_DEFAULTS.schemaVersion);
  assert.equal(config.grpcAddr, RUNTIME_BRIDGE_CONFIG_DEFAULTS.grpcAddr);
  assert.equal(config.httpAddr, RUNTIME_BRIDGE_CONFIG_DEFAULTS.httpAddr);

  const engines = asRecord(config.engines);
  const llama = asRecord(engines.llama);
  const media = asRecord(engines.media);
  assert.equal(llama.enabled, true);
  assert.equal(llama.port, 11434);
  assert.equal(media.port, 8321);

  const providers = asRecord(config.providers);
  assert.equal('local' in providers, false);
  assert.deepEqual(providers.gemini, { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' });
});

test('runtime bridge config projection preserves existing llama engine when endpoint is empty', () => {
  const config = buildRuntimeBridgeConfigWithLocalEndpoint({
    engines: {
      llama: {
        enabled: false,
        port: 1234,
      },
    },
  }, '');

  const engines = asRecord(config.engines);
  const llama = asRecord(engines.llama);
  assert.equal(llama.enabled, false);
  assert.equal(llama.port, 1234);
});

test('runtime bridge config projection extracts endpoint ports and serializes dirty-check state', () => {
  assert.equal(extractRuntimeBridgeEndpointPort('http://127.0.0.1:11434/v1'), 11434);
  assert.equal(extractRuntimeBridgeEndpointPort('127.0.0.1:11435/v1'), 11435);
  assert.equal(extractRuntimeBridgeEndpointPort(''), null);
  assert.equal(
    serializeRuntimeBridgeLocalEndpointProjection('http://127.0.0.1:11434/v1/'),
    JSON.stringify({ localEndpoint: 'http://127.0.0.1:11434/v1' }),
  );
});

test('runtime bridge config projection builds runtime data root managed roots', () => {
  const { nextConfig, changed } = mergeRuntimeBridgeDataRootConfig(
    {
      schemaVersion: 1,
      localModelsPath: 'C:\\Users\\Eric\\.nimi\\data\\models',
      managedRoots: { cache: 'preserved' },
    },
    'D:\\nimi_data',
    'D:\\nimi_data\\models',
    'D:\\nimi_data\\state.json',
  );

  assert.equal(changed, true);
  assert.equal(nextConfig.localModelsPath, undefined);
  assert.equal(nextConfig.dataRootRef, 'D:\\nimi_data');
  assert.deepEqual(nextConfig.managedRoots, {
    cache: 'preserved',
    models: 'D:\\nimi_data\\models',
    dependencies: 'D:\\nimi_data/dependencies',
    environments: 'D:\\nimi_data/environments',
    logs: 'D:\\nimi_data/logs',
    audit: 'D:\\nimi_data/audit',
  });
  assert.equal(nextConfig.localStatePath, 'D:\\nimi_data\\state.json');
});

test('runtime bridge config projection builds Realm JWT config without owning config writes', () => {
  const { nextConfig, changed } = mergeRuntimeBridgeRealmJwtConfig({ schemaVersion: 1 }, {
    realmBaseUrl: 'http://localhost:3002',
    jwtIssuer: 'http://localhost:3002',
    jwtAudience: 'nimi-runtime',
    jwksUrl: 'http://localhost:3002/api/auth/jwks',
    revocationUrl: 'http://localhost:3002/api/auth/sessions/introspect',
  });

  assert.equal(changed, true);
  const auth = asRecord(nextConfig.auth);
  const account = asRecord(auth.account);
  const jwt = asRecord(auth.jwt);
  assert.equal(account.realmBaseUrl, 'http://localhost:3002');
  assert.equal(jwt.issuer, 'http://localhost:3002');
  assert.equal(jwt.audience, 'nimi-runtime');
  assert.equal(jwt.jwksUrl, 'http://localhost:3002/api/auth/jwks');
  assert.equal(jwt.revocationUrl, 'http://localhost:3002/api/auth/sessions/introspect');
});

test('runtime bridge config projection toggles developer registration and preserves auth siblings', () => {
  const { nextConfig, changed } = mergeRuntimeBridgeDeveloperRegistrationConfig(
    { schemaVersion: 1, auth: { jwt: { issuer: 'https://realm.example' } } },
    true,
  );

  assert.equal(changed, true);
  const auth = asRecord(nextConfig.auth);
  assert.equal(asRecord(auth.jwt).issuer, 'https://realm.example');
  assert.equal(asRecord(auth.developerRegistration).enabled, true);
  assert.equal(mergeRuntimeBridgeDeveloperRegistrationConfig(nextConfig, true).changed, false);
});
