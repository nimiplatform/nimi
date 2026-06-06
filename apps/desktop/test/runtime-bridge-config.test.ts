import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  buildNimiRuntimeBridgeConfigWithLocalEndpoint,
} from '@nimiplatform/sdk/runtime';

import {
  applyRuntimeBridgeConfigToState,
  buildRuntimeBridgeConfigFromLocalEndpoint,
} from '../src/shell/renderer/features/runtime-config/runtime-bridge-config';
import { createDefaultStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults';
import { createConnectorV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types';
import type { RuntimeConfigStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function createBaseState(): RuntimeConfigStateV11 {
  const state = createDefaultStateV11();
  state.local.endpoint = 'http://127.0.0.1:1234/v1';
  return state;
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

test('applyRuntimeBridgeConfigToState clears local endpoint when Runtime bridge config has no llama engine endpoint', () => {
  const previous = createBaseState();
  previous.local.endpoint = 'http://127.0.0.1:9999/v1';

  const next = applyRuntimeBridgeConfigToState(previous, {
    schemaVersion: 1,
    engines: {},
  });

  assert.equal(next.local.endpoint, '');
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

test('buildRuntimeBridgeConfigFromLocalEndpoint delegates Runtime config schema projection to SDK', () => {
  const endpoint = 'http://127.0.0.1:11434/v1';
  const baseConfig = {};

  const config = buildRuntimeBridgeConfigFromLocalEndpoint(endpoint, baseConfig);
  assert.deepEqual(config, buildNimiRuntimeBridgeConfigWithLocalEndpoint(baseConfig, endpoint));
});

test('buildRuntimeBridgeConfigFromLocalEndpoint preserves existing non-local provider entries', () => {
  const endpoint = 'http://127.0.0.1:11434/v1';

  const config = buildRuntimeBridgeConfigFromLocalEndpoint(endpoint, {
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

  assert.deepEqual(config, buildNimiRuntimeBridgeConfigWithLocalEndpoint({
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
  }, endpoint));
});

test('runtime bridge config wrapper does not own Runtime config schema details', () => {
  const source = readRepoFile('apps/desktop/src/shell/renderer/features/runtime-config/runtime-bridge-config.ts');

  assert.doesNotMatch(source, /schemaVersion|grpcAddr|httpAddr/);
  assert.doesNotMatch(source, /engines\.llama|providers\.local/);
  assert.doesNotMatch(source, /function readNumber|function readBoolean|new URL\(/);
  assert.doesNotMatch(source, /buildRuntimeBridgeConfigFromState|serializeRuntimeBridgeProjection/);
});

test('runtime config bridge sync only saves endpoint on explicit user action', () => {
  const syncSource = readRepoFile(
    'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-panel-controller-bridge-sync.ts',
  );
  const localPageSource = readRepoFile(
    'apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-page-local.tsx',
  );

  assert.match(syncSource, /saveRuntimeLocalEndpoint/);
  assert.match(syncSource, /buildRuntimeBridgeConfigFromLocalEndpoint\(endpoint, baseConfig\)/);
  assert.doesNotMatch(syncSource, /serializeRuntimeBridgeProjection|runtimeBridgeFailedProjectionRef|runtimeBridgeProjectionRef/);
  assert.doesNotMatch(syncSource, /setTimeout\(\(\) =>[\s\S]*setRuntimeBridgeConfig/);
  assert.doesNotMatch(localPageSource, /onChangeLocalEndpoint/);
});
