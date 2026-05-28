import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuntimeRouteOptionsSnapshot,
  checkRuntimeRouteHealthWithHost,
  describeRuntimeRouteWithHost,
  parseRuntimeRouteOptions,
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

test('route options snapshot does not promote first available local model to resolvedDefault', () => {
  const snapshot = buildRuntimeRouteOptionsSnapshot({
    capability: 'text.generate',
    selectedBinding: null,
    localModels: localSnapshot.local.models,
    connectors: [],
  });

  assert.equal(snapshot.selected, null);
  assert.equal(snapshot.resolvedDefault, undefined);
});

test('route options parser ignores external resolvedDefault fallback truth', () => {
  const parsed = parseRuntimeRouteOptions({
    capability: 'text.generate',
    selected: null,
    resolvedDefault: localSnapshot.selected,
    local: { models: [] },
    connectors: [],
  }, { includeResolvedDefault: true });

  assert.ok(parsed);
  assert.equal(parsed.selected, null);
  assert.equal(parsed.resolvedDefault, undefined);
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

test('route health host facade maps resolved binding through SDK projection', async () => {
  const resolved = resolveRuntimeRouteBindingFromSnapshot({
    capability: 'text.generate',
    binding: localSnapshot.selected,
    snapshot: localSnapshot,
  });
  let capturedProvider = '';
  let capturedLocalModelId = '';

  const health = await checkRuntimeRouteHealthWithHost({
    resolved,
    checkHealth: async (request) => {
      capturedProvider = request.provider;
      capturedLocalModelId = String(request.localModelId || '');
      return {
        provider: 'llama',
        endpoint: 'http://127.0.0.1:1234/v1',
        model: 'local-import/qwen3-chat',
        status: 'healthy',
        detail: '',
      };
    },
  });

  assert.equal(capturedProvider, 'llama');
  assert.equal(capturedLocalModelId, 'local-qwen');
  assert.equal(health.healthy, true);
  assert.equal(health.actionHint, 'none');
});

test('route describe host facade builds scenario probe and decodes runtime metadata', async () => {
  const resolved = resolveRuntimeRouteBindingFromSnapshot({
    capability: 'text.generate',
    binding: localSnapshot.selected,
    snapshot: localSnapshot,
  });
  const resolvedBindingRef = resolved.resolvedBindingRef || '';
  let capturedTargetId = '';
  let capturedNamespace = '';
  let capturedModelId = '';

  const describe = await describeRuntimeRouteWithHost({
    appId: 'nimi.desktop',
    targetId: 'core.chat.agent',
    capability: 'text.generate',
    resolvedBindingRef,
    resolved,
    buildCallOptions: async (input) => {
      capturedTargetId = input.targetId;
      return {
        idempotencyKey: 'route-describe-idem',
        timeoutMs: input.timeoutMs,
        metadata: {
          traceId: 'route-describe-trace',
          callerKind: 'desktop-core',
          callerId: input.targetId,
          surfaceId: 'desktop.renderer',
        },
      };
    },
    executeScenario: async (request, options) => {
      capturedModelId = String(request.head?.modelId || '');
      capturedNamespace = String(request.extensions[0]?.namespace || '');
      options._responseMetadataObserver?.({
        'x-nimi-route-describe-result': Buffer.from(JSON.stringify({
          capability: 'text.generate',
          metadataVersion: 'v1',
          resolvedBindingRef,
          metadataKind: 'text.generate',
          metadata: {
            supportsThinking: true,
            traceModeSupport: 'separate',
            supportsImageInput: false,
            supportsAudioInput: false,
            supportsVideoInput: false,
            supportsArtifactRefInput: false,
          },
        }), 'utf8').toString('base64'),
      });
    },
  });

  assert.equal(capturedTargetId, 'core.chat.agent');
  assert.equal(capturedNamespace, 'nimi.scenario.text_generate.route_describe');
  assert.equal(capturedModelId, 'local-import/qwen3-chat');
  assert.equal(describe.metadataKind, 'text.generate');
  assert.equal(describe.metadata.supportsThinking, true);
});
