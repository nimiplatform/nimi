import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectMemoryEmbeddingRouteAvailability,
} from '../src/ai/index.js';
import type { RuntimeRouteOptionsSnapshot } from '../src/runtime/index.js';

const localSnapshot: RuntimeRouteOptionsSnapshot = {
  capability: 'text.generate',
  selected: {
    source: 'local',
    connectorId: '',
    model: 'qwen3-chat',
    modelId: 'qwen3-chat',
    localModelId: 'local-qwen',
    engine: 'llama',
  },
  local: {
    models: [{
      localModelId: 'local-qwen',
      model: 'local-import/qwen3-chat',
      modelId: 'local-import/qwen3-chat',
      engine: 'llama',
      provider: 'llama',
      endpoint: 'http://127.0.0.1:1234/v1',
      status: 'active',
      goRuntimeLocalModelId: 'local-qwen',
      goRuntimeStatus: 'active',
      capabilities: ['text.generate'],
    }],
  },
  connectors: [],
};

test('memory embedding route availability projects binding intent against route options only', () => {
  const embeddingSnapshot: RuntimeRouteOptionsSnapshot = {
    ...localSnapshot,
    capability: 'text.embed',
    local: {
      models: localSnapshot.local.models.map((model) => ({
        ...model,
        capabilities: ['text.embed'],
      })),
    },
  };
  assert.deepEqual(
    projectMemoryEmbeddingRouteAvailability({
      config: {
        scopeRef: { kind: 'feature', ownerId: 'desktop', surfaceId: 'memory-embedding' },
        sourceKind: 'local',
        bindingRef: { kind: 'local', targetId: 'local-import/qwen3-chat' },
        revisionToken: 'rev',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      routeOptions: embeddingSnapshot,
    }),
    {
      state: 'ready',
      reason: 'local_model_active',
      sourceKind: 'local',
      bindingRef: { kind: 'local', targetId: 'local-import/qwen3-chat' },
    },
  );

  const cloudProjection = projectMemoryEmbeddingRouteAvailability({
    config: {
      scopeRef: { kind: 'feature', ownerId: 'desktop', surfaceId: 'memory-embedding' },
      sourceKind: 'cloud',
      bindingRef: { kind: 'cloud', connectorId: 'connector-openai', modelId: 'gpt-5.4' },
      revisionToken: 'rev',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    routeOptions: {
      capability: 'text.embed',
      selected: null,
      local: { models: [] },
      connectors: [{
        id: 'connector-openai',
        label: 'OpenAI',
        provider: 'openai',
        models: ['gpt-5.4'],
      }],
    },
  });

  assert.equal(cloudProjection.state, 'ready');
  assert.equal(cloudProjection.reason, 'cloud_model_available');
  assert.equal(
    projectMemoryEmbeddingRouteAvailability({
      config: {
        scopeRef: { kind: 'feature', ownerId: 'desktop', surfaceId: 'memory-embedding' },
        sourceKind: 'local',
        bindingRef: { kind: 'local', targetId: 'local-import/qwen3-chat' },
        revisionToken: 'rev',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      routeOptions: localSnapshot,
    }).reason,
    'route_options_capability_mismatch',
  );
});
