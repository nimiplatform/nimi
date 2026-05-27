import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveRuntimeRouteBindingFromSnapshot,
  runtimeRouteCallTargetFromResolvedBinding,
  selectRuntimeLocalWarmCandidateFromResolvedBinding,
  type RuntimeRouteOptionsSnapshot,
} from '../../src/ai/index.js';

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

test('resolved route projection builds local call target from runtime evidence', () => {
  const resolved = resolveRuntimeRouteBindingFromSnapshot({
    capability: 'text.generate',
    binding: localSnapshot.selected,
    snapshot: localSnapshot,
  });

  assert.equal(resolved.source, 'local');
  assert.equal(resolved.engine, 'llama');
  assert.equal(resolved.localModelId, 'local-qwen');

  const target = runtimeRouteCallTargetFromResolvedBinding(resolved);
  assert.equal(target.source, 'local');
  assert.equal(target.routePolicy, 1);
  assert.equal(target.modelId, 'llama/local-import/qwen3-chat');
  assert.equal(target.goRuntimeLocalModelId, 'local-qwen');
});

test('resolved route projection rejects missing local runtime evidence', () => {
  assert.throws(
    () => resolveRuntimeRouteBindingFromSnapshot({
      capability: 'text.generate',
      binding: {
        source: 'local',
        connectorId: '',
        model: 'qwen3-chat',
        modelId: 'qwen3-chat',
        localModelId: 'missing-local',
        engine: 'llama',
      },
      snapshot: localSnapshot,
    }),
    /RUNTIME_ROUTE_LOCAL_EVIDENCE_REQUIRED/,
  );
});

test('resolved route projection does not promote resolvedDefault to execution truth', () => {
  assert.throws(
    () => resolveRuntimeRouteBindingFromSnapshot({
      capability: 'text.generate',
      binding: {
        source: 'local',
        connectorId: '',
        model: 'fallback-model',
        modelId: 'fallback-model',
        localModelId: 'fallback-local',
        engine: 'llama',
      },
      snapshot: {
        ...localSnapshot,
        selected: null,
        resolvedDefault: localSnapshot.selected || undefined,
      },
    }),
    /RUNTIME_ROUTE_LOCAL_EVIDENCE_REQUIRED/,
  );
});

test('resolved route projection builds cloud call target from connector evidence', () => {
  const resolved = resolveRuntimeRouteBindingFromSnapshot({
    capability: 'text.generate',
    binding: {
      source: 'cloud',
      connectorId: 'connector-openai',
      model: 'gpt-5.4',
      provider: 'openai',
    },
    snapshot: {
      capability: 'text.generate',
      selected: {
        source: 'cloud',
        connectorId: 'connector-openai',
        model: 'gpt-5.4',
        provider: 'openai',
      },
      local: { models: [] },
      connectors: [{
        id: 'connector-openai',
        label: 'OpenAI',
        provider: 'openai',
        models: ['gpt-5.4'],
      }],
    },
  });
  const target = runtimeRouteCallTargetFromResolvedBinding(resolved);
  assert.equal(target.source, 'cloud');
  assert.equal(target.routePolicy, 2);
  assert.equal(target.modelId, 'cloud/gpt-5.4');
  assert.equal(target.connectorId, 'connector-openai');
});

test('local warm candidate selection is bound to resolved local evidence', () => {
  const resolved = resolveRuntimeRouteBindingFromSnapshot({
    capability: 'text.generate',
    binding: localSnapshot.selected,
    snapshot: localSnapshot,
  });
  const selected = selectRuntimeLocalWarmCandidateFromResolvedBinding({
    resolved,
    assets: [{
      localAssetId: 'local-qwen',
      assetId: 'local-import/qwen3-chat',
      engine: 'llama',
      endpoint: 'http://127.0.0.1:1234/v1',
      status: 3,
    }],
  });

  assert.equal(selected?.localAssetId, 'local-qwen');
  assert.equal(selected?.status, 3);
});

test('local warm candidate selection excludes removed assets', () => {
  const resolved = resolveRuntimeRouteBindingFromSnapshot({
    capability: 'text.generate',
    binding: localSnapshot.selected,
    snapshot: localSnapshot,
  });
  const selected = selectRuntimeLocalWarmCandidateFromResolvedBinding({
    resolved: {
      ...resolved,
      localModelId: '',
      goRuntimeLocalModelId: '',
    },
    assets: [{
      localAssetId: 'removed-model',
      assetId: 'local-import/qwen3-chat',
      engine: 'llama',
      endpoint: 'http://127.0.0.1:1234/v1',
      status: 4,
    }],
  });

  assert.equal(selected, null);
});
