import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectMemoryEmbeddingRouteAvailability,
} from '../../src/runtime/index.js';
import {
  buildRuntimeRouteOptionsSnapshot,
  checkRuntimeRouteHealthWithHost,
  createRuntimeRouteLocalWarmCache,
  describeRuntimeRouteWithHost,
  ensureRuntimeRouteLocalWarmWithHost,
  isRuntimeRouteLocalOptionSelectable,
  parseRuntimeRouteOptions,
  resetRuntimeRouteLocalWarmCache,
  resolveRuntimeRouteBindingFromSnapshot,
  runtimeRouteLocalOptionToBinding,
  runtimeRouteCallTargetFromResolvedBinding,
  selectRuntimeLocalWarmCandidateFromResolvedBinding,
  type RuntimeRouteLocalWarmMetric,
  type RuntimeRouteOptionsSnapshot,
} from '../../src/runtime/index.js';

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

test('resolved route projection does not promote legacy resolvedDefault to execution truth', () => {
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

test('route options snapshot does not expose first available local model as default truth', () => {
  const snapshot = buildRuntimeRouteOptionsSnapshot({
    capability: 'text.generate',
    selectedBinding: null,
    localModels: localSnapshot.local.models,
    connectors: [],
  });

  assert.equal(snapshot.selected, null);
  assert.equal('resolvedDefault' in snapshot, false);
});

test('route options parser drops external resolvedDefault fallback truth', () => {
  const parsed = parseRuntimeRouteOptions({
    capability: 'text.generate',
    selected: null,
    resolvedDefault: localSnapshot.selected,
    local: { models: [] },
    connectors: [],
  });

  assert.ok(parsed);
  assert.equal(parsed.selected, null);
  assert.equal('resolvedDefault' in parsed, false);
});

test('local route option projection produces canonical RuntimeRouteBinding evidence', () => {
  const option = localSnapshot.local.models[0];
  assert.ok(option);
  assert.equal(isRuntimeRouteLocalOptionSelectable(option), true);
  assert.equal(isRuntimeRouteLocalOptionSelectable({ ...option, status: 'removed' }), false);
  const binding = runtimeRouteLocalOptionToBinding(option, {
    defaultEndpoint: 'http://127.0.0.1:9999/v1',
  });
  assert.deepEqual({
    source: binding.source,
    connectorId: binding.connectorId,
    model: binding.model,
    modelId: binding.modelId,
    localModelId: binding.localModelId,
    provider: binding.provider,
    engine: binding.engine,
    endpoint: binding.endpoint,
    goRuntimeLocalModelId: binding.goRuntimeLocalModelId,
    goRuntimeStatus: binding.goRuntimeStatus,
  }, {
    source: 'local',
    connectorId: '',
    model: 'local-import/qwen3-chat',
    modelId: 'local-import/qwen3-chat',
    localModelId: 'local-qwen',
    provider: 'llama',
    engine: 'llama',
    endpoint: 'http://127.0.0.1:1234/v1',
    goRuntimeLocalModelId: 'local-qwen',
    goRuntimeStatus: 'active',
  });
});

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

test('local warm host facade owns pagination, cache, and warm candidate execution', async () => {
  const resolved = resolveRuntimeRouteBindingFromSnapshot({
    capability: 'text.generate',
    binding: localSnapshot.selected,
    snapshot: localSnapshot,
  });
  const cache = createRuntimeRouteLocalWarmCache();
  const metrics: RuntimeRouteLocalWarmMetric[] = [];
  const listRequests: Array<{ pageToken: string; pageSize: number }> = [];
  const warmRequests: Array<{ localAssetId: string; timeoutMs: number }> = [];
  const stateChanges: string[] = [];
  let now = 1000;

  await ensureRuntimeRouteLocalWarmWithHost({
    targetId: 'core.chat-ai',
    resolvedBinding: resolved,
    timeoutMs: 999999,
    onStateChange: (state, candidate) => {
      stateChanges.push(`${state}:${candidate.localAssetId}`);
    },
  }, {
    cache,
    nowMs: () => {
      now += 7;
      return now;
    },
    emitMetric: (metric) => metrics.push(metric),
    listLocalAssets: async (request) => {
      listRequests.push({ pageToken: request.pageToken, pageSize: request.pageSize });
      if (!request.pageToken) {
        return {
          assets: [{
            localAssetId: 'not-target',
            assetId: 'different',
            engine: 'llama',
            endpoint: 'http://127.0.0.1:4444/v1',
            status: 2,
          }],
          nextPageToken: 'page-2',
        };
      }
      return {
        assets: [{
          localAssetId: 'local-qwen',
          assetId: 'local-import/qwen3-chat',
          engine: 'llama',
          endpoint: 'http://127.0.0.1:1234/v1',
          status: 2,
        }],
        nextPageToken: '',
      };
    },
    buildCallOptions: async (input) => ({
      timeoutMs: input.timeoutMs,
      metadata: {
        traceId: 'trace-1',
      },
    }),
    warmLocalAsset: async (request) => {
      warmRequests.push(request);
      return {};
    },
  });

  await ensureRuntimeRouteLocalWarmWithHost({
    targetId: 'core.chat-ai',
    resolvedBinding: resolved,
  }, {
    cache,
    emitMetric: (metric) => metrics.push(metric),
    listLocalAssets: async () => ({
      assets: [{
        localAssetId: 'local-qwen',
        assetId: 'local-import/qwen3-chat',
        engine: 'llama',
        endpoint: 'http://127.0.0.1:1234/v1',
        status: 2,
      }],
      nextPageToken: '',
    }),
    buildCallOptions: async () => {
      throw new Error('cache hit should not build call options');
    },
    warmLocalAsset: async () => {
      throw new Error('cache hit should not warm again');
    },
  });

  assert.deepEqual(listRequests, [
    { pageToken: '', pageSize: 100 },
    { pageToken: 'page-2', pageSize: 100 },
    { pageToken: '', pageSize: 100 },
    { pageToken: 'page-2', pageSize: 100 },
  ]);
  assert.deepEqual(warmRequests, [{
    localAssetId: 'local-qwen',
    timeoutMs: 300000,
  }]);
  assert.deepEqual(stateChanges, [
    'warming:local-qwen',
    'ready:local-qwen',
  ]);
  assert.ok(metrics.some((metric) => metric.kind === 'counter' && metric.name === 'runtime_route_local_warm_cache_hit_total'));
  resetRuntimeRouteLocalWarmCache(cache);
  assert.equal(cache.warmedLocalModelKeys.size, 0);
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
