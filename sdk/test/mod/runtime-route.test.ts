import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseRuntimeRouteBinding,
  parseRuntimeRouteOptions,
} from '../../src/mod/runtime-route.js';

test('parseRuntimeRouteBinding keeps token-api provider metadata', () => {
  const parsed = parseRuntimeRouteBinding({
    source: 'token-api',
    connectorId: 'connector-dashscope',
    provider: 'dashscope',
    model: 'wan2.6-t2i',
  });

  assert.deepEqual(parsed, {
    source: 'token-api',
    connectorId: 'connector-dashscope',
    provider: 'dashscope',
    model: 'wan2.6-t2i',
    localModelId: undefined,
    engine: undefined,
  });
});

test('parseRuntimeRouteOptions keeps connector providers and models', () => {
  const parsed = parseRuntimeRouteOptions({
    capability: 'image.generate',
    selected: {
      source: 'token-api',
      connectorId: 'connector-dashscope',
      provider: 'dashscope',
      model: 'wan2.6-t2i',
    },
    resolvedDefault: {
      source: 'token-api',
      connectorId: 'connector-dashscope',
      provider: 'dashscope',
      model: 'wan2.6-t2i',
    },
    localRuntime: {
      models: [],
    },
    connectors: [{
      id: 'connector-dashscope',
      label: 'DashScope',
      vendor: 'dashscope',
      provider: 'dashscope',
      models: [
        'qwen-image-2.0-pro',
        'qwen-image-2.0',
        'wan2.6-t2i',
      ],
      modelCapabilities: {
        'qwen-image-2.0-pro': ['image.generate'],
        'qwen-image-2.0': ['image.generate'],
        'wan2.6-t2i': ['image.generate'],
      },
    }],
  }, { includeResolvedDefault: true });

  assert.ok(parsed);
  assert.equal(parsed?.selected.provider, 'dashscope');
  assert.equal(parsed?.resolvedDefault?.provider, 'dashscope');
  assert.equal(parsed?.connectors[0]?.provider, 'dashscope');
  assert.deepEqual(parsed?.connectors[0]?.models, [
    'qwen-image-2.0-pro',
    'qwen-image-2.0',
    'wan2.6-t2i',
  ]);
});
