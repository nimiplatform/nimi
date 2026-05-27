import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RUNTIME_BRIDGE_CONFIG_DEFAULTS,
  buildRuntimeBridgeConfigWithLocalEndpoint,
  extractRuntimeBridgeEndpointPort,
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
