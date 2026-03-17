import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseRuntimeRouteBinding,
  parseRuntimeRouteOptions,
} from '../../src/mod/runtime-route.js';

test('parseRuntimeRouteBinding keeps cloud provider metadata', () => {
  const parsed = parseRuntimeRouteBinding({
    source: 'cloud',
    connectorId: 'connector-dashscope',
    provider: 'dashscope',
    model: 'wan2.6-t2i',
  });

  assert.deepEqual(parsed, {
    source: 'cloud',
    connectorId: 'connector-dashscope',
    provider: 'dashscope',
    model: 'wan2.6-t2i',
    modelId: undefined,
    localModelId: undefined,
    engine: undefined,
    adapter: undefined,
    providerHints: undefined,
    endpoint: undefined,
    goRuntimeLocalModelId: undefined,
    goRuntimeStatus: undefined,
  });
});

test('parseRuntimeRouteBinding treats empty local endpoint as unconfigured', () => {
  const parsed = parseRuntimeRouteBinding({
    source: 'local',
    connectorId: '',
    provider: 'media',
    model: 'flux.1-schnell',
    engine: 'media',
    endpoint: '   ',
  });

  assert.deepEqual(parsed, {
    source: 'local',
    connectorId: '',
    provider: 'media',
    model: 'flux.1-schnell',
    modelId: undefined,
    localModelId: undefined,
    engine: 'media',
    adapter: undefined,
    providerHints: undefined,
    endpoint: undefined,
    goRuntimeLocalModelId: undefined,
    goRuntimeStatus: undefined,
  });
});

test('parseRuntimeRouteOptions keeps connector providers and models', () => {
  const parsed = parseRuntimeRouteOptions({
    capability: 'image.generate',
    selected: {
      source: 'cloud',
      connectorId: 'connector-dashscope',
      provider: 'dashscope',
      model: 'wan2.6-t2i',
    },
    resolvedDefault: {
      source: 'cloud',
      connectorId: 'connector-dashscope',
      provider: 'dashscope',
      model: 'wan2.6-t2i',
    },
    local: {
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

test('parseRuntimeRouteOptions keeps local adapter and go runtime metadata', () => {
  const parsed = parseRuntimeRouteOptions({
    capability: 'image.generate',
    selected: {
      source: 'local',
      connectorId: '',
      model: 'z-image-turbo',
      modelId: 'z-image-turbo',
      localModelId: 'file:z-image-turbo',
      engine: 'media',
      provider: 'media',
      adapter: 'media_native_adapter',
      goRuntimeLocalModelId: '01JTESTLOCALAIMODEL',
      goRuntimeStatus: 'active',
    },
    local: {
      models: [{
        localModelId: 'file:z-image-turbo',
        model: 'z-image-turbo',
        modelId: 'z-image-turbo',
        engine: 'media',
        provider: 'media',
        adapter: 'media_native_adapter',
        goRuntimeLocalModelId: '01JTESTLOCALAIMODEL',
        goRuntimeStatus: 'active',
        capabilities: ['image.generate'],
      }],
    },
    connectors: [],
  });

  assert.ok(parsed);
  assert.equal(parsed?.selected.adapter, 'media_native_adapter');
  assert.equal(parsed?.selected.goRuntimeStatus, 'active');
  assert.equal(parsed?.local.models[0]?.goRuntimeLocalModelId, '01JTESTLOCALAIMODEL');
});
