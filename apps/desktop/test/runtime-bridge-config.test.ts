import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyRuntimeBridgeConfigToState,
  buildRuntimeBridgeConfigFromState,
  serializeRuntimeBridgeProjection,
} from '../src/shell/renderer/features/runtime-config/runtime-bridge-config';
import { createDefaultStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults';
import { createConnectorV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types';
import type { RuntimeConfigStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function createBaseState(): RuntimeConfigStateV11 {
  return createDefaultStateV11({
    provider: 'local',
    runtimeModelType: 'chat',
    localProviderEndpoint: 'http://127.0.0.1:1234/v1',
    localProviderModel: 'local-model',
    localOpenAiEndpoint: 'https://openrouter.ai/api/v1',
  });
}

test('applyRuntimeBridgeConfigToState maps llama engine loopback endpoint', () => {
  const previous = createBaseState();
  const next = applyRuntimeBridgeConfigToState(previous, {
    schemaVersion: 1,
    engines: {
      llama: {
        enabled: true,
        port: 18080,
      },
    },
  });

  assert.equal(next.local.endpoint, 'http://127.0.0.1:18080/v1');
});

test('applyRuntimeBridgeConfigToState preserves existing endpoint when no llama engine config is present', () => {
  const previous = createBaseState();
  previous.local.endpoint = 'http://127.0.0.1:9999/v1';

  const next = applyRuntimeBridgeConfigToState(previous, {
    schemaVersion: 1,
    engines: {},
  });

  assert.equal(next.local.endpoint, 'http://127.0.0.1:9999/v1');
});

test('applyRuntimeBridgeConfigToState does not manage connectors — they come from SDK', () => {
  const previous = createBaseState();
  const existingConnector = createConnectorV11('openrouter', 'Primary');
  previous.connectors = [existingConnector];

  const next = applyRuntimeBridgeConfigToState(previous, {
    schemaVersion: 1,
    engines: {
      llama: { enabled: true, port: 18080 },
    },
    providers: {
      gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKeyEnv: 'NIMI_RUNTIME_CLOUD_GEMINI_API_KEY' },
    },
  });

  // Connectors pass through unchanged — cloud providers managed by Go runtime
  assert.equal(next.connectors.length, 1);
  assert.equal(next.connectors[0]?.id, existingConnector.id);
});

test('buildRuntimeBridgeConfigFromState emits schema defaults and llama engine loopback config', () => {
  const state = createBaseState();
  state.local.endpoint = 'http://127.0.0.1:11434/v1';

  const config = buildRuntimeBridgeConfigFromState(state, {});
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.grpcAddr, '127.0.0.1:46371');
  assert.equal(config.httpAddr, '127.0.0.1:46372');

  const engines = asRecord(config.engines);
  const llama = asRecord(engines.llama);
  assert.equal(llama.enabled, true);
  assert.equal(llama.port, 11434);
});

test('buildRuntimeBridgeConfigFromState preserves existing non-local provider entries', () => {
  const state = createBaseState();
  state.local.endpoint = 'http://127.0.0.1:11434/v1';

  const config = buildRuntimeBridgeConfigFromState(state, {
    engines: {
      media: {
        enabled: true,
        port: 8321,
      },
    },
    providers: {
      gemini: {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKeyEnv: 'NIMI_RUNTIME_CLOUD_GEMINI_API_KEY',
      },
    },
  });

  const providers = asRecord(config.providers);
  const gemini = asRecord(providers.gemini);
  assert.equal(gemini.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(gemini.apiKeyEnv, 'NIMI_RUNTIME_CLOUD_GEMINI_API_KEY');
  const engines = asRecord(config.engines);
  const media = asRecord(engines.media);
  assert.equal(media.port, 8321);
});

test('serializeRuntimeBridgeProjection ignores status-only runtime state changes', () => {
  const state = createBaseState();
  const connector = createConnectorV11('openrouter', 'Primary');
  connector.endpoint = 'https://openrouter.ai/api/v1';
  state.connectors = [connector];
  state.selectedConnectorId = connector.id;

  const first = serializeRuntimeBridgeProjection(state);

  const changed = {
    ...state,
    local: {
      ...state.local,
      status: 'healthy',
      lastCheckedAt: '2026-02-27T12:00:00.000Z',
      lastDetail: 'runtime ready',
    },
    connectors: state.connectors.map((item) => ({
      ...item,
      status: 'healthy',
      lastCheckedAt: '2026-02-27T12:00:00.000Z',
      lastDetail: 'connector ok',
    })),
  } satisfies RuntimeConfigStateV11;

  const second = serializeRuntimeBridgeProjection(changed);
  assert.equal(first, second);
});

test('serializeRuntimeBridgeProjection detects local endpoint changes', () => {
  const state = createBaseState();
  state.local.endpoint = 'http://127.0.0.1:1234/v1';

  const first = serializeRuntimeBridgeProjection(state);

  const changed = {
    ...state,
    local: {
      ...state.local,
      endpoint: 'http://127.0.0.1:9999/v1',
    },
  };

  const second = serializeRuntimeBridgeProjection(changed);
  assert.notEqual(first, second);
});
