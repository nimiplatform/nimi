import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NIMI_RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY,
  buildNimiRuntimeRouteCapabilityProjection,
  buildNimiRuntimeRouteCapabilityProjectionMap,
  createDefaultNimiRuntimeRouteCapabilitySelectionStore,
  createNimiRuntimeRouteCapabilityRuntimeWithHost,
  getNimiRuntimeRouteCapabilityProjectionIssueKind,
  isNimiRuntimeRouteCapabilityProjectionReady,
  isNimiRuntimeRouteCapabilityProjectionSelectionRequired,
  updateNimiRuntimeRouteCapabilityTargetRef,
  type NimiRuntimeCanonicalCapability,
  type NimiRuntimeResolvedBinding,
  type NimiRuntimeRouteCapabilityRuntime,
  type NimiRuntimeRouteOptionsSnapshot,
  type NimiRuntimeRouteTargetRef,
} from './index';
import {
  ExecutionMode,
  RoutePolicy,
  ScenarioType,
} from '../core-generated/runtime-typed-client';
import {
  nimiRuntimeRouteHealthInputFromResolvedBinding,
  nimiRuntimeRouteHealthResultFromProviderHealth,
  normalizeNimiRuntimeRouteEngineEvidence,
  normalizeNimiRuntimeRouteModelRoot,
  normalizeRequiredNimiRuntimeRouteCapability,
  resolveNimiRuntimeRouteTargetRefFromSnapshot,
} from './route-capability-binding';
import { describeNimiRuntimeRouteWithHost } from './route-capability-describe';

const cloudTargetRef: NimiRuntimeRouteTargetRef = {
  kind: 'cloud-connector',
  version: 'v2',
  connectorId: 'tester-cloud',
  remoteModelCatalogId: 'remote-catalog:tester-model',
  providerModelId: 'tester-model',
  provider: 'tester',
};

const localTargetRef: NimiRuntimeRouteTargetRef = {
  kind: 'local-runtime',
  version: 'v2',
  profileBindingId: 'local-runtime:asset-local-1',
};

function encodeRouteDescribePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function createTextGenerateRouteMetadata(
  overrides: Partial<{
    supportsThinking: boolean;
    traceModeSupport: 'none' | 'hide' | 'separate';
    supportsImageInput: boolean;
    supportsAudioInput: boolean;
    supportsVideoInput: boolean;
    supportsArtifactRefInput: boolean;
  }> = {},
): Record<string, unknown> {
  return {
    supportsThinking: false,
    traceModeSupport: 'none',
    supportsImageInput: false,
    supportsAudioInput: false,
    supportsVideoInput: false,
    supportsArtifactRefInput: false,
    ...overrides,
  };
}

function createTextEmbedRouteMetadata(
  overrides: Partial<{
    dimensions: number;
    maxInputsPerRequest: number;
    supportsBatch: boolean;
  }> = {},
): Record<string, unknown> {
  return {
    dimensions: 4,
    maxInputsPerRequest: 16,
    supportsBatch: true,
    ...overrides,
  };
}

function createRouteOptionsSnapshot(selectedTargetRef: NimiRuntimeRouteTargetRef | null = cloudTargetRef): NimiRuntimeRouteOptionsSnapshot {
  return {
    capability: 'text.generate',
    selectedTargetRef,
    inventory: {
      capability: 'text.generate',
      targets: [{
        targetRef: cloudTargetRef,
        display: { label: 'Tester Model', provider: 'tester', model: 'tester-model' },
        readiness: { status: 'ready' },
        compatibility: { capabilities: ['text.generate'] },
        evidence: {
          source: 'cloud-connector',
          connectorId: 'tester-cloud',
          remoteModelCatalogId: 'remote-catalog:tester-model',
          providerModelId: 'tester-model',
          provider: 'tester',
        },
      }, {
        targetRef: localTargetRef,
        display: { label: 'Local Tester', provider: 'llama.cpp', engine: 'llama.cpp', model: 'llama/route-model' },
        readiness: { status: 'active', endpoint: 'http://127.0.0.1:11434' },
        compatibility: { capabilities: ['text.generate'] },
        evidence: {
          source: 'local-runtime',
          localAssetId: 'asset-local-1',
          resolvedModelId: 'llama/route-model',
          engine: 'llama.cpp',
          endpoint: 'http://127.0.0.1:11434',
          runtimeStatus: 'active',
        },
      }],
    },
  };
}

test('Runtime route capability runtime resolves, checks health, and describes host metadata from v2 targetRefs', async () => {
  const snapshot = createRouteOptionsSnapshot(cloudTargetRef);
  const buildInputs: unknown[] = [];
  const healthInputs: unknown[] = [];
  const routeRuntime = createNimiRuntimeRouteCapabilityRuntimeWithHost({
    loadRuntimeRouteOptions: async (input) => {
      assert.equal(input.capability, 'text.generate');
      assert.equal(input.targetId, 'tester.route.options');
      assert.deepEqual(input.selectedTargetRef, cloudTargetRef);
      return snapshot;
    },
    checkHealth: async (input) => {
      healthInputs.push(input);
      return {
        provider: 'tester',
        status: 'healthy',
        detail: '',
      };
    },
    describeTargetId: 'tester.capability.route',
    routeOptionsTargetId: 'tester.route.options',
    buildDescribeCallOptions: (input) => {
      buildInputs.push(input);
      return {
        timeoutMs: input.timeoutMs,
        metadata: {
          callerKind: 'third-party-app',
          callerId: input.targetId,
          surfaceId: 'tester',
        },
      };
    },
    getDescribeHost: () => ({
      appId: 'nimi.tester',
      executeScenario: async (request, options) => {
        assert.equal(request.head?.appId, 'nimi.tester');
        assert.equal(request.head?.connectorId, 'tester-cloud');
        options.responseMetadataObserver?.({
          [NIMI_RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY]: encodeRouteDescribePayload({
            capability: 'text.generate',
            metadataVersion: 'v1',
            resolvedBindingRef: 'cloud:text.generate:tester-cloud:remote-catalog%3Atester-model:tester-model',
            metadataKind: 'text.generate',
            metadata: createTextGenerateRouteMetadata({ supportsThinking: true }),
          }),
        });
        return {};
      },
    }),
  });

  const resolved = await routeRuntime.resolve({
    capability: ' Text.Generate ',
    targetRef: cloudTargetRef,
  });
  assert.equal(resolved.resolvedBindingRef, 'cloud:text.generate:tester-cloud:remote-catalog%3Atester-model:tester-model');
  assert.equal(resolved.remoteModelCatalogId, 'remote-catalog:tester-model');

  const health = await routeRuntime.checkHealth({
    capability: 'text.generate',
    targetRef: cloudTargetRef,
  });
  assert.equal(health.healthy, true);
  assert.equal(health.status, 'healthy');
  assert.deepEqual(healthInputs[0], {
    provider: 'tester',
    capability: 'text.generate',
    localProviderEndpoint: undefined,
    localProviderModel: 'tester-model',
    localOpenAiEndpoint: undefined,
    localAssetId: undefined,
    connectorId: 'tester-cloud',
  });

  const metadata = await routeRuntime.describe({
    capability: 'text.generate',
    resolvedBindingRef: resolved.resolvedBindingRef,
  });
  assert.equal(metadata.metadata.supportsThinking, true);
  assert.deepEqual(buildInputs[0], {
    targetId: 'tester.capability.route',
    timeoutMs: 30000,
    source: 'cloud-connector',
    connectorId: 'tester-cloud',
    providerEndpoint: undefined,
  });
});

test('Runtime route capability projection resolves selected target refs through canonical vNext runtime', async () => {
  const routeRuntime = createNimiRuntimeRouteCapabilityRuntimeWithHost({
    loadRuntimeRouteOptions: async () => createRouteOptionsSnapshot(cloudTargetRef),
    checkHealth: async () => ({
      provider: 'tester',
      status: 'healthy',
      detail: '',
    }),
    describeTargetId: 'tester.capability.route',
    buildDescribeCallOptions: () => ({}),
    getDescribeHost: () => ({
      appId: 'nimi.tester',
      executeScenario: async (_request, options) => {
        options.responseMetadataObserver?.({
          [NIMI_RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY]: encodeRouteDescribePayload({
            capability: 'text.generate',
            metadataVersion: 'v1',
            resolvedBindingRef: 'cloud:text.generate:tester-cloud:remote-catalog%3Atester-model:tester-model',
            metadataKind: 'text.generate',
            metadata: createTextGenerateRouteMetadata(),
          }),
        });
        return {};
      },
    }),
  });
  const store = updateNimiRuntimeRouteCapabilityTargetRef(
    createDefaultNimiRuntimeRouteCapabilitySelectionStore(),
    'text.generate',
    cloudTargetRef,
  );

  const projection = await buildNimiRuntimeRouteCapabilityProjection({
    capability: 'text.generate',
    selectionStore: store,
    routeRuntime,
  });

  assert.equal(isNimiRuntimeRouteCapabilityProjectionReady(projection), true);
  assert.equal(projection.resolvedBinding?.resolvedBindingRef, 'cloud:text.generate:tester-cloud:remote-catalog%3Atester-model:tester-model');
  assert.deepEqual(projection.selectedTargetRef, cloudTargetRef);
});

test('Runtime route capability projection classifies selection, health, and metadata failures', async () => {
  const resolved: NimiRuntimeResolvedBinding = {
    capability: 'text.generate',
    source: 'local-runtime',
    targetRef: localTargetRef,
    resolvedBindingRef: 'local:text.generate:local-runtime%3Aasset-local-1',
    provider: 'llama',
    engine: 'llama',
    model: 'route-model',
    modelId: 'route-model',
    localAssetId: 'asset-local-1',
    localRuntimeStatus: 'active',
  };
  const store = updateNimiRuntimeRouteCapabilityTargetRef(
    createDefaultNimiRuntimeRouteCapabilitySelectionStore(),
    'text.generate',
    localTargetRef,
  );

  const selectionMissing = await buildNimiRuntimeRouteCapabilityProjection({
    capability: 'text.generate',
    selectionStore: createDefaultNimiRuntimeRouteCapabilitySelectionStore(),
  });
  assert.equal(selectionMissing.reasonCode, 'selection_missing');
  assert.equal(getNimiRuntimeRouteCapabilityProjectionIssueKind(selectionMissing), 'needs_selection');
  assert.equal(isNimiRuntimeRouteCapabilityProjectionSelectionRequired(selectionMissing), true);

  const selectionCleared = await buildNimiRuntimeRouteCapabilityProjection({
    capability: 'text.generate',
    selectionStore: updateNimiRuntimeRouteCapabilityTargetRef(
      createDefaultNimiRuntimeRouteCapabilitySelectionStore(),
      'text.generate',
      null,
    ),
  });
  assert.equal(selectionCleared.reasonCode, 'selection_cleared');
  assert.equal(getNimiRuntimeRouteCapabilityProjectionIssueKind(selectionCleared), 'needs_selection');

  const hostDenied = await buildNimiRuntimeRouteCapabilityProjection({
    capability: 'text.generate',
    selectionStore: store,
    hostAllowed: false,
  });
  assert.equal(hostDenied.reasonCode, 'host_denied');
  assert.equal(getNimiRuntimeRouteCapabilityProjectionIssueKind(hostDenied), 'host_denied');

  const bindingUnresolved = await buildNimiRuntimeRouteCapabilityProjection({
    capability: 'text.generate',
    selectionStore: store,
    routeRuntime: {
      async resolve() {
        return { ...resolved, resolvedBindingRef: '' };
      },
      async checkHealth() {
        throw new Error('should not check health');
      },
      async describe() {
        throw new Error('should not describe');
      },
    },
  });
  assert.equal(bindingUnresolved.reasonCode, 'binding_unresolved');

  const notReady = await buildNimiRuntimeRouteCapabilityProjection({
    capability: 'text.generate',
    selectionStore: store,
    routeRuntime: {
      async resolve() {
        return { ...resolved, localRuntimeStatus: 'installed' };
      },
      async checkHealth() {
        return {
          healthy: false,
          status: 'unavailable',
          provider: 'llama',
          detail: 'setup_required',
          actionHint: 'warm local model',
        };
      },
      async describe() {
        throw new Error('should not describe');
      },
    },
  });
  assert.equal(notReady.reasonCode, 'route_not_ready');
  assert.equal(getNimiRuntimeRouteCapabilityProjectionIssueKind(notReady), 'route_not_ready');

  const unhealthy = await buildNimiRuntimeRouteCapabilityProjection({
    capability: 'text.generate',
    selectionStore: store,
    routeRuntime: {
      async resolve() {
        return resolved;
      },
      async checkHealth() {
        return {
          healthy: false,
          status: 'unhealthy',
          provider: 'llama',
          detail: 'provider returned 500',
          actionHint: 'inspect_provider',
        };
      },
      async describe() {
        throw new Error('should not describe');
      },
    },
  });
  assert.equal(unhealthy.reasonCode, 'route_unhealthy');

  const metadataBindingMismatch = await buildNimiRuntimeRouteCapabilityProjection({
    capability: 'text.generate',
    selectionStore: store,
    routeRuntime: {
      async resolve() {
        return resolved;
      },
      async checkHealth() {
        return {
          healthy: true,
          status: 'healthy',
          provider: 'llama',
          detail: '',
          actionHint: 'none',
        };
      },
      async describe() {
        return {
          capability: 'text.generate',
          metadataVersion: 'v1',
          resolvedBindingRef: 'local:text.generate:other',
          metadataKind: 'text.generate',
          metadata: createTextGenerateRouteMetadata(),
        };
      },
    },
  });
  assert.equal(metadataBindingMismatch.reasonCode, 'metadata_missing');

  const projectionMap = await buildNimiRuntimeRouteCapabilityProjectionMap({
    selectionStore: store,
    routeRuntime: {
      async resolve() {
        return resolved;
      },
      async checkHealth() {
        return {
          healthy: true,
          status: 'healthy',
          provider: 'llama',
          detail: '',
          actionHint: 'none',
        };
      },
      async describe() {
        return {
          capability: 'text.generate',
          metadataVersion: 'v1',
          resolvedBindingRef: resolved.resolvedBindingRef,
          metadataKind: 'text.generate',
          metadata: createTextGenerateRouteMetadata({ supportsThinking: true }),
        };
      },
    } satisfies NimiRuntimeRouteCapabilityRuntime,
    hostAllowlist: { 'image.generate': false },
    capabilities: ['text.generate', 'image.generate'],
  });
  assert.equal(projectionMap['text.generate']?.supported, true);
  assert.equal(projectionMap['image.generate']?.reasonCode, 'host_denied');
});

test('Runtime route binding helpers resolve local and cloud evidence with fail-closed health projections', () => {
  assert.equal(normalizeNimiRuntimeRouteModelRoot(' llama/Meta-Llama-3 '), 'Meta-Llama-3');
  assert.equal(normalizeNimiRuntimeRouteModelRoot('cloud/gpt-4.1'), 'gpt-4.1');
  assert.equal(normalizeNimiRuntimeRouteEngineEvidence(' Llama.cpp Local! '), 'llama.cpp-local');
  assert.equal(normalizeRequiredNimiRuntimeRouteCapability(' Text.Generate '), 'text.generate');
  assert.throws(
    () => normalizeRequiredNimiRuntimeRouteCapability(''),
    hasRouteReasonCode('SDK_RUNTIME_ROUTE_INPUT_INVALID'),
  );

  const snapshot = createRouteOptionsSnapshot(localTargetRef);
  const localResolved = resolveNimiRuntimeRouteTargetRefFromSnapshot({
    capability: 'text.generate',
    targetRef: localTargetRef,
    snapshot,
  });
  assert.equal(localResolved.localAssetId, 'asset-local-1');
  assert.equal(localResolved.modelId, 'route-model');
  assert.equal(localResolved.resolvedBindingRef, 'local:text.generate:local-runtime%3Aasset-local-1');
  assert.deepEqual(nimiRuntimeRouteHealthInputFromResolvedBinding(localResolved), {
    provider: 'llama.cpp',
    capability: 'text.generate',
    localProviderEndpoint: 'http://127.0.0.1:11434',
    localProviderModel: 'route-model',
    localOpenAiEndpoint: 'http://127.0.0.1:11434',
    localAssetId: 'asset-local-1',
    connectorId: undefined,
  });

  const cloudResolved = resolveNimiRuntimeRouteTargetRefFromSnapshot({
    capability: 'text.generate',
    targetRef: cloudTargetRef,
    snapshot,
  });
  assert.equal(cloudResolved.provider, 'tester');
  assert.equal(cloudResolved.remoteModelCatalogId, 'remote-catalog:tester-model');
  assert.deepEqual(nimiRuntimeRouteHealthResultFromProviderHealth({
    resolved: cloudResolved,
    health: { status: 'unreachable', provider: '', detail: 'offline' },
  }), {
    healthy: false,
    status: 'unavailable',
    provider: 'tester',
    detail: 'offline',
    reasonCode: undefined,
    actionHint: 'verify-connector',
  });
  assert.deepEqual(nimiRuntimeRouteHealthResultFromProviderHealth({
    resolved: localResolved,
    health: { status: 'unreachable', detail: 'offline', reasonCode: 'LOCAL_PROVIDER_OFFLINE' },
  }), {
    healthy: false,
    status: 'unavailable',
    provider: 'llama.cpp',
    detail: 'offline',
    reasonCode: 'LOCAL_PROVIDER_OFFLINE',
    actionHint: 'install-local-model',
  });

  assert.throws(
    () => resolveNimiRuntimeRouteTargetRefFromSnapshot({
      capability: 'text.generate',
      targetRef: null,
      snapshot,
    }),
    /NIMI_RUNTIME_ROUTE_TARGET_REF_REQUIRED/u,
  );
  assert.throws(
    () => resolveNimiRuntimeRouteTargetRefFromSnapshot({
      capability: 'image.generate',
      targetRef: localTargetRef,
      snapshot,
    }),
    /NIMI_RUNTIME_ROUTE_LOCAL_EVIDENCE_REQUIRED/u,
  );
  assert.throws(
    () => resolveNimiRuntimeRouteTargetRefFromSnapshot({
      capability: 'text.generate',
      targetRef: {
        kind: 'cloud-connector',
        version: 'v2',
        connectorId: 'cloud-1',
        remoteModelCatalogId: 'missing',
        providerModelId: 'missing',
      },
      snapshot,
    }),
    /NIMI_RUNTIME_ROUTE_CLOUD_EVIDENCE_REQUIRED/u,
  );
});

test('Runtime route describe builds scenario probes and validates metadata boundaries', async () => {
  const cases: Array<{
    readonly capability: NimiRuntimeCanonicalCapability;
    readonly scenarioType: ScenarioType;
    readonly oneofKind: string;
    readonly modelId: string;
    readonly metadata: Record<string, unknown>;
  }> = [
    {
      capability: 'text.embed',
      scenarioType: ScenarioType.TEXT_EMBED,
      oneofKind: 'textEmbed',
      modelId: 'embedding-model',
      metadata: createTextEmbedRouteMetadata(),
    },
    {
      capability: 'image.generate',
      scenarioType: ScenarioType.IMAGE_GENERATE,
      oneofKind: 'imageGenerate',
      modelId: 'image-model',
      metadata: {
        supportedResponseFormats: ['b64_json'],
        maxImagesPerRequest: 1,
        supportsNegativePrompt: true,
        supportsReferenceImages: true,
        supportsMask: false,
        supportsSeed: true,
        supportsSize: true,
        supportsAspectRatio: true,
        supportsQuality: false,
        supportsStyle: true,
      },
    },
    {
      capability: 'audio.synthesize',
      scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
      oneofKind: 'speechSynthesize',
      modelId: 'tts-model',
      metadata: {
        supportedAudioFormats: ['mp3'],
        supportedTimingModes: ['none'],
        supportsLanguage: true,
        supportsEmotion: false,
      },
    },
  ];

  for (const item of cases) {
    const observedMetadata: unknown[] = [];
    const resolvedBindingRef = `local:${item.capability}:runtime:${item.modelId}`;
    const result = await describeNimiRuntimeRouteWithHost({
      appId: 'nimi.route.test',
      targetId: 'route.describe',
      capability: item.capability,
      resolvedBindingRef,
      resolved: {
        capability: item.capability,
        source: 'local-runtime',
        targetRef: { kind: 'local-runtime', version: 'v2', profileBindingId: `local-runtime:asset-${item.modelId}` },
        resolvedBindingRef,
        provider: 'runtime',
        engine: 'runtime',
        model: item.modelId,
        modelId: item.modelId,
        localAssetId: `asset-${item.modelId}`,
      },
      buildCallOptions(input) {
        assert.equal(input.targetId, 'route.describe');
        assert.equal(input.source, 'local-runtime');
        return {
          timeoutMs: input.timeoutMs,
          responseMetadataObserver: (metadata) => observedMetadata.push(metadata),
        };
      },
      async executeScenario(request, options) {
        assert.equal(request.head?.appId, 'nimi.route.test');
        assert.equal(request.head?.modelId, item.modelId);
        assert.equal(request.head?.routePolicy, RoutePolicy.LOCAL);
        assert.deepEqual(request.head?.targetRef, {
          target: {
            oneofKind: 'localRuntime',
            localRuntime: {
              version: 'v2',
              ref: { oneofKind: 'profileBindingId', profileBindingId: `local-runtime:asset-${item.modelId}` },
            },
          },
        });
        assert.equal(request.executionMode, ExecutionMode.SYNC);
        assert.equal(request.scenarioType, item.scenarioType);
        assert.equal(request.spec?.spec.oneofKind, item.oneofKind);
        assert.equal(Object.hasOwn(request.extensions?.[0]?.payload?.fields ?? {}, 'modelId'), false);
        options.responseMetadataObserver?.({
          [NIMI_RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY]: encodeRouteDescribePayload({
            capability: item.capability,
            metadataVersion: 'v1',
            resolvedBindingRef,
            metadataKind: item.capability,
            metadata: item.metadata,
          }),
        });
        return {};
      },
      timeoutMs: 12345,
    });
    assert.equal(result.capability, item.capability);
    assert.equal(result.metadataKind, item.capability);
    assert.deepEqual(result.metadata, item.metadata);
    assert.equal(observedMetadata.length, 1);
  }

  await assert.rejects(
    () => describeNimiRuntimeRouteWithHost({
      appId: 'nimi.route.test',
      targetId: 'route.describe',
      capability: 'text.generate',
      resolvedBindingRef: 'local:text.generate:runtime:text-model',
      resolved: {
        capability: 'text.generate',
        source: 'local-runtime',
        targetRef: { kind: 'local-runtime', version: 'v2', profileBindingId: 'local-runtime:asset-text-model' },
        resolvedBindingRef: 'local:text.generate:runtime:text-model',
        provider: 'runtime',
        engine: 'runtime',
        model: 'text-model',
        modelId: 'text-model',
        localAssetId: 'asset-text-model',
      },
      buildCallOptions: () => ({}),
      async executeScenario() {
        return {};
      },
    }),
    hasRouteReasonCode('SDK_RUNTIME_ROUTE_DESCRIBE_METADATA_MISSING'),
  );
});

function hasRouteReasonCode(reasonCode: string): (error: unknown) => boolean {
  return (error: unknown) => {
    const shaped = error as { readonly reasonCode?: string; readonly code?: string };
    assert.equal(shaped.reasonCode ?? shaped.code, reasonCode);
    return true;
  };
}
