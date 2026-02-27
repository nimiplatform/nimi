import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyRuntimeBridgeConfigToState,
  buildRuntimeBridgeConfigFromState,
  serializeRuntimeBridgeProjection,
} from '../src/shell/renderer/features/runtime-config/runtime-bridge-config';
import { createDefaultStateV11 } from '../src/shell/renderer/features/runtime-config/state/v11/storage/defaults';
import { createConnectorV11 } from '../src/shell/renderer/features/runtime-config/state/v11/types';
import type { RuntimeConfigStateV11 } from '../src/shell/renderer/features/runtime-config/state/v11/types';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function createBaseState(): RuntimeConfigStateV11 {
  return createDefaultStateV11({
    provider: 'local-runtime',
    runtimeModelType: 'chat',
    localProviderEndpoint: 'http://127.0.0.1:1234/v1',
    localProviderModel: 'local-model',
    localOpenAiEndpoint: 'https://openrouter.ai/api/v1',
    localOpenAiApiKey: '',
  });
}

test('applyRuntimeBridgeConfigToState maps provider endpoints into runtime setup state', () => {
  const previous = createBaseState();
  const next = applyRuntimeBridgeConfigToState(previous, {
    schemaVersion: 1,
    ai: {
      providers: {
        local: {
          baseUrl: 'http://127.0.0.1:18080/v1',
          apiKeyEnv: 'LOCALAI_API_KEY',
        },
        gemini: {
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKeyEnv: 'GEMINI_API_KEY',
        },
        alibaba: {
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          apiKeyEnv: 'DASHSCOPE_API_KEY',
        },
      },
    },
  });

  assert.equal(next.localRuntime.endpoint, 'http://127.0.0.1:18080/v1');
  assert.equal(next.connectors.length, 2);

  const geminiConnector = next.connectors.find((connector) => connector.vendor === 'gemini');
  assert.ok(geminiConnector);
  assert.equal(geminiConnector.endpoint, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(geminiConnector.tokenApiKey, '');
  assert.equal(geminiConnector.tokenApiKeyEnv, 'GEMINI_API_KEY');

  const dashscopeConnector = next.connectors.find((connector) => connector.vendor === 'dashscope');
  assert.ok(dashscopeConnector);
  assert.equal(dashscopeConnector.endpoint, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(dashscopeConnector.tokenApiKey, '');
  assert.equal(dashscopeConnector.tokenApiKeyEnv, 'DASHSCOPE_API_KEY');
});

test('buildRuntimeBridgeConfigFromState emits schema defaults and managed providers', () => {
  const state = createBaseState();
  state.localRuntime.endpoint = 'http://127.0.0.1:11434/v1';

  const geminiConnector = createConnectorV11('gemini', 'Gemini');
  geminiConnector.endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai';
  geminiConnector.tokenApiKeyEnv = 'GEMINI_API_KEY';

  const dashscopeConnector = createConnectorV11('dashscope', 'DashScope');
  dashscopeConnector.endpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  dashscopeConnector.tokenApiKeyEnv = 'DASHSCOPE_API_KEY';

  state.connectors = [geminiConnector, dashscopeConnector];
  state.selectedConnectorId = geminiConnector.id;

  const config = buildRuntimeBridgeConfigFromState(state, {});
  assert.equal(config.schemaVersion, 1);

  const runtime = asRecord(config.runtime);
  assert.equal(runtime.grpcAddr, '127.0.0.1:46371');
  assert.equal(runtime.httpAddr, '127.0.0.1:46372');

  const providers = asRecord(asRecord(config.ai).providers);
  const local = asRecord(providers.local);
  assert.equal(local.baseUrl, 'http://127.0.0.1:11434/v1');
  assert.equal(local.apiKeyEnv, 'LOCALAI_API_KEY');

  const gemini = asRecord(providers.gemini);
  assert.equal(gemini.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(gemini.apiKeyEnv, 'GEMINI_API_KEY');

  const alibaba = asRecord(providers.alibaba);
  assert.equal(alibaba.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(alibaba.apiKeyEnv, 'DASHSCOPE_API_KEY');
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
    localRuntime: {
      ...state.localRuntime,
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

test('serializeRuntimeBridgeProjection includes apiKeyEnv changes', () => {
  const state = createBaseState();
  const connector = createConnectorV11('gemini', 'Gemini');
  connector.endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai';
  connector.tokenApiKeyEnv = 'GEMINI_API_KEY';
  state.connectors = [connector];
  state.selectedConnectorId = connector.id;

  const first = serializeRuntimeBridgeProjection(state);

  state.connectors = [{
    ...connector,
    tokenApiKeyEnv: 'NIMI_RUNTIME_CLOUD_ADAPTER_GEMINI_API_KEY',
  }];

  const second = serializeRuntimeBridgeProjection(state);
  assert.notEqual(first, second);
});

test('applyRuntimeBridgeConfigToState preserves existing in-memory connector token for same provider', () => {
  const previous = createBaseState();
  const connector = createConnectorV11('gemini', 'Gemini');
  connector.endpoint = 'https://generativelanguage.googleapis.com/v1beta/openai';
  connector.tokenApiKey = 'session-token';
  previous.connectors = [connector];
  previous.selectedConnectorId = connector.id;

  const next = applyRuntimeBridgeConfigToState(previous, {
    schemaVersion: 1,
    ai: {
      providers: {
        gemini: {
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          apiKeyEnv: 'GEMINI_API_KEY',
        },
      },
    },
  });

  assert.equal(next.connectors.length, 1);
  assert.equal(next.connectors[0]?.tokenApiKey, 'session-token');
  assert.equal(next.connectors[0]?.tokenApiKeyEnv, 'GEMINI_API_KEY');
});
