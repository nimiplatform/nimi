import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NIMI_RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY,
  buildNimiRuntimeRouteCapabilityProjectionMap,
  buildNimiRuntimeRouteCapabilityProjection,
  createNimiRuntimeRouteCapabilityRuntimeWithHost,
  createDefaultNimiRuntimeRouteCapabilitySelectionStore,
  getNimiRuntimeRouteCapabilityProjectionIssueKind,
  isNimiRuntimeRouteCapabilityProjectionReady,
  isNimiRuntimeRouteCapabilityProjectionSelectionRequired,
  updateNimiRuntimeRouteCapabilityBinding,
  type NimiRuntimeRouteCapabilityRuntime,
  type NimiRuntimeRouteBinding,
  type NimiRuntimeCanonicalCapability,
  type NimiRuntimeResolvedBinding,
  type NimiRuntimeRouteOptionsSnapshot,
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
  resolveNimiRuntimeRouteBindingFromSnapshot,
} from './route-capability-binding';
import { describeNimiRuntimeRouteWithHost } from './route-capability-describe';

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

test('Runtime route capability runtime resolves, checks health, and describes host metadata', async () => {
  const binding: NimiRuntimeRouteBinding = {
    source: 'cloud',
    connectorId: 'tester-cloud',
    provider: 'tester',
    model: 'tester-model',
  };
  const snapshot: NimiRuntimeRouteOptionsSnapshot = {
    capability: 'text.generate',
    selected: binding,
    local: {
      models: [],
    },
    connectors: [{
      id: 'tester-cloud',
      label: 'Tester Cloud',
      provider: 'tester',
      models: ['tester-model'],
      modelCapabilities: {
        'tester-model': ['text.generate'],
      },
    }],
  };
  const buildInputs: unknown[] = [];
  const healthInputs: unknown[] = [];
  const routeRuntime = createNimiRuntimeRouteCapabilityRuntimeWithHost({
    loadRuntimeRouteOptions: async (input) => {
      assert.equal(input.capability, 'text.generate');
      assert.equal(input.targetId, 'tester.route.options');
      assert.equal(input.selectedBinding?.connectorId, 'tester-cloud');
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
            resolvedBindingRef: 'cloud:text.generate:tester-cloud:tester-model',
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
    binding,
  });
  assert.equal(resolved.resolvedBindingRef, 'cloud:text.generate:tester-cloud:tester-model');

  const health = await routeRuntime.checkHealth({
    capability: 'text.generate',
    binding,
  });
  assert.equal(health.healthy, true);
  assert.equal(health.status, 'healthy');
  assert.deepEqual(healthInputs[0], {
    provider: 'tester',
    capability: 'text.generate',
    localProviderEndpoint: undefined,
    localProviderModel: 'tester-model',
    localOpenAiEndpoint: undefined,
    localModelId: undefined,
    goRuntimeLocalModelId: undefined,
    connectorId: 'tester-cloud',
  });

  const metadata = await routeRuntime.describe({
    capability: 'text.generate',
    resolvedBindingRef: resolved.resolvedBindingRef || '',
  });
  assert.equal(metadata.metadata.supportsThinking, true);
  assert.deepEqual(buildInputs[0], {
    targetId: 'tester.capability.route',
    timeoutMs: 30000,
    source: 'cloud',
    connectorId: 'tester-cloud',
    providerEndpoint: undefined,
  });
});

test('Runtime route capability projection resolves selected bindings through canonical vNext runtime', async () => {
  const binding: NimiRuntimeRouteBinding = {
    source: 'cloud',
    connectorId: 'tester-cloud',
    provider: 'tester',
    model: 'tester-model',
  };
  const routeRuntime = createNimiRuntimeRouteCapabilityRuntimeWithHost({
    loadRuntimeRouteOptions: async () => ({
      capability: 'text.generate',
      selected: binding,
      local: { models: [] },
      connectors: [{
        id: 'tester-cloud',
        label: 'Tester Cloud',
        provider: 'tester',
        models: ['tester-model'],
        modelCapabilities: {
          'tester-model': ['text.generate'],
        },
      }],
    }),
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
            resolvedBindingRef: 'cloud:text.generate:tester-cloud:tester-model',
            metadataKind: 'text.generate',
            metadata: createTextGenerateRouteMetadata(),
          }),
        });
        return {};
      },
    }),
  });
  const store = updateNimiRuntimeRouteCapabilityBinding(
    createDefaultNimiRuntimeRouteCapabilitySelectionStore(),
    'text.generate',
    binding,
  );

  const projection = await buildNimiRuntimeRouteCapabilityProjection({
    capability: 'text.generate',
    selectionStore: store,
    routeRuntime,
  });

  assert.equal(isNimiRuntimeRouteCapabilityProjectionReady(projection), true);
  assert.equal(projection.resolvedBinding?.resolvedBindingRef, 'cloud:text.generate:tester-cloud:tester-model');
});

test('Runtime route capability projection classifies selection, health, and metadata failures', async () => {
  const binding: NimiRuntimeRouteBinding = {
    source: 'local',
    connectorId: '',
    provider: 'llama',
    model: 'llama/tester',
    modelId: 'llama/tester',
    localModelId: 'asset-local-1',
    goRuntimeLocalModelId: 'asset-local-1',
    engine: 'llama',
  };
  const resolved: NimiRuntimeResolvedBinding = {
    ...binding,
    capability: 'text.generate',
    resolvedBindingRef: 'local:text.generate:llama:asset-local-1',
  };
  const store = updateNimiRuntimeRouteCapabilityBinding(
    createDefaultNimiRuntimeRouteCapabilitySelectionStore(),
    'text.generate',
    binding,
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
    selectionStore: updateNimiRuntimeRouteCapabilityBinding(
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
        return { ...resolved, goRuntimeStatus: 'installed' };
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

  const metadataMissing = await buildNimiRuntimeRouteCapabilityProjection({
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
          capability: 'image.generate',
          metadataVersion: 'v1',
          resolvedBindingRef: resolved.resolvedBindingRef || '',
          metadataKind: 'image.generate',
          metadata: {},
        };
      },
    },
  });
  assert.equal(metadataMissing.reasonCode, 'metadata_missing');

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
          resolvedBindingRef: 'local:text.generate:llama:other-asset',
          metadataKind: 'text.generate',
          metadata: createTextGenerateRouteMetadata(),
        };
      },
    },
  });
  assert.equal(metadataBindingMismatch.reasonCode, 'metadata_missing');

  const healthMissingPositiveEvidence = await buildNimiRuntimeRouteCapabilityProjection({
    capability: 'text.generate',
    selectionStore: store,
    routeRuntime: {
      async resolve() {
        return resolved;
      },
      async checkHealth() {
        return {
          healthy: true,
          status: 'degraded',
          provider: 'llama',
          detail: 'no ack',
          actionHint: 'verify',
        };
      },
      async describe() {
        throw new Error('should not describe without positive health evidence');
      },
    },
  });
  assert.equal(healthMissingPositiveEvidence.reasonCode, 'route_unhealthy');

  const metadataHostDenied = await buildNimiRuntimeRouteCapabilityProjection({
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
        throw { reasonCode: 'HOOK_PERMISSION_DENIED' };
      },
    },
  });
  assert.equal(metadataHostDenied.reasonCode, 'host_denied');

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
          resolvedBindingRef: resolved.resolvedBindingRef || '',
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

test('Runtime route capability runtime fails closed when capability evidence is missing', async () => {
  const binding: NimiRuntimeRouteBinding = {
    source: 'cloud',
    connectorId: 'tester-cloud',
    provider: 'tester',
    model: 'tester-model',
  };
  const routeRuntime = createNimiRuntimeRouteCapabilityRuntimeWithHost({
    loadRuntimeRouteOptions: async () => ({
      capability: 'image.generate',
      selected: binding,
      local: {
        models: [],
      },
      connectors: [{
        id: 'tester-cloud',
        label: 'Tester Cloud',
        provider: 'tester',
        models: ['tester-model'],
        modelCapabilities: {
          'tester-model': ['text.generate'],
        },
      }],
    }),
    checkHealth: async () => ({ status: 'healthy' }),
    describeTargetId: 'tester.capability.route',
    buildDescribeCallOptions: () => ({}),
    getDescribeHost: () => ({
      appId: 'nimi.tester',
      executeScenario: async () => ({}),
    }),
  });

  await assert.rejects(
    routeRuntime.resolve({
      capability: 'image.generate',
      binding,
    }),
    /NIMI_RUNTIME_ROUTE_CLOUD_EVIDENCE_REQUIRED/,
  );
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

  const localBinding: NimiRuntimeRouteBinding = {
    source: 'local',
    connectorId: '',
    provider: 'llama.cpp',
    model: 'llama/route-model',
    engine: 'llama.cpp',
  };
  const snapshot: NimiRuntimeRouteOptionsSnapshot = {
    capability: 'text.generate',
    selected: {
      ...localBinding,
      localModelId: 'asset-selected',
      goRuntimeLocalModelId: 'asset-selected',
    },
    local: {
      models: [{
        provider: 'llama.cpp',
        model: 'local/route-model',
        modelId: 'local/route-model',
        localModelId: 'asset-selected',
        goRuntimeLocalModelId: 'asset-selected',
        engine: 'llama.cpp',
        endpoint: 'http://127.0.0.1:11434',
        capabilities: ['text.generate'],
      }],
    },
    connectors: [{
      id: 'cloud-1',
      label: 'Cloud One',
      provider: 'provider-one',
      models: ['cloud-model'],
      modelCapabilities: {
        'cloud-model': ['text.generate'],
      },
    }],
  };

  const localResolved = resolveNimiRuntimeRouteBindingFromSnapshot({
    capability: 'text.generate',
    binding: localBinding,
    snapshot,
  });
  assert.equal(localResolved.localModelId, 'asset-selected');
  assert.equal(localResolved.modelId, 'route-model');
  assert.equal(localResolved.resolvedBindingRef, 'local:text.generate:llama.cpp:asset-selected');
  assert.deepEqual(nimiRuntimeRouteHealthInputFromResolvedBinding(localResolved), {
    provider: 'llama.cpp',
    capability: 'text.generate',
    localProviderEndpoint: 'http://127.0.0.1:11434',
    localProviderModel: 'route-model',
    localOpenAiEndpoint: 'http://127.0.0.1:11434',
    localModelId: 'asset-selected',
    goRuntimeLocalModelId: 'asset-selected',
    connectorId: undefined,
  });

  const cloudResolved = resolveNimiRuntimeRouteBindingFromSnapshot({
    capability: 'text.generate',
    binding: {
      source: 'cloud',
      connectorId: 'cloud-1',
      model: 'cloud-model',
    },
    snapshot,
  });
  assert.equal(cloudResolved.provider, 'provider-one');
  assert.equal(cloudResolved.resolvedBindingRef, 'cloud:text.generate:cloud-1:cloud-model');
  assert.deepEqual(nimiRuntimeRouteHealthResultFromProviderHealth({
    resolved: cloudResolved,
    health: { status: 'unreachable', provider: '', detail: 'offline' },
  }), {
    healthy: false,
    status: 'unavailable',
    provider: 'provider-one',
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
  assert.equal(nimiRuntimeRouteHealthResultFromProviderHealth({
    resolved: localResolved,
    health: { status: 'degraded', actionHint: '' },
  }).actionHint, 'none');

  assert.throws(
    () => resolveNimiRuntimeRouteBindingFromSnapshot({
      capability: 'text.generate',
      binding: null,
      snapshot,
    }),
    /NIMI_RUNTIME_ROUTE_BINDING_REQUIRED/u,
  );
  assert.throws(
    () => resolveNimiRuntimeRouteBindingFromSnapshot({
      capability: 'image.generate',
      binding: localBinding,
      snapshot,
    }),
    /NIMI_RUNTIME_ROUTE_LOCAL_EVIDENCE_REQUIRED/u,
  );
  assert.throws(
    () => resolveNimiRuntimeRouteBindingFromSnapshot({
      capability: 'text.generate',
      binding: {
        source: 'cloud',
        connectorId: 'cloud-1',
        model: 'missing-model',
      },
      snapshot,
    }),
    /NIMI_RUNTIME_ROUTE_CLOUD_EVIDENCE_REQUIRED/u,
  );
  assert.throws(
    () => resolveNimiRuntimeRouteBindingFromSnapshot({
      capability: 'text.generate',
      binding: {
        source: 'cloud',
        connectorId: 'cloud-without-provider',
        model: 'cloud-model',
      },
      snapshot: {
        ...snapshot,
        connectors: [{
          id: 'cloud-without-provider',
          label: 'Cloud',
          provider: '',
          models: ['cloud-model'],
          modelCapabilities: {
            'cloud-model': ['text.generate'],
          },
        }],
      },
    }),
    /NIMI_RUNTIME_ROUTE_BINDING_PROVIDER_REQUIRED/u,
  );
  assert.throws(
    () => resolveNimiRuntimeRouteBindingFromSnapshot({
      capability: 'text.generate',
      binding: localBinding,
      snapshot: {
        ...snapshot,
        selected: null,
        local: {
          models: [{
            localModelId: 'asset-selected',
            provider: 'llama.cpp',
            model: 'llama/route-model',
            engine: 'llama.cpp',
            endpoint: 'http://127.0.0.1:11434',
          }],
        },
      },
    }),
    /NIMI_RUNTIME_ROUTE_LOCAL_EVIDENCE_REQUIRED/u,
  );
  assert.throws(
    () => resolveNimiRuntimeRouteBindingFromSnapshot({
      capability: 'text.generate',
      binding: {
        source: 'cloud',
        connectorId: 'cloud-1',
        model: 'cloud-model',
      },
      snapshot: {
        ...snapshot,
        connectors: [{
          id: 'cloud-1',
          label: 'Cloud One',
          provider: 'provider-one',
          models: ['cloud-model'],
        }],
      },
    }),
    /NIMI_RUNTIME_ROUTE_CLOUD_EVIDENCE_REQUIRED/u,
  );
  assert.throws(
    () => resolveNimiRuntimeRouteBindingFromSnapshot({
      capability: 'text.generate',
      binding: {
        source: 'local',
        connectorId: '',
        provider: 'llama.cpp',
        model: 'llama/route-model',
        engine: 'llama.cpp',
      },
      snapshot: {
        ...snapshot,
        selected: null,
        local: {
          models: [{
            provider: 'llama.cpp',
            model: 'llama/route-model',
            engine: 'llama.cpp',
            capabilities: ['text.generate'],
          }],
        },
      },
    }),
    /NIMI_RUNTIME_ROUTE_BINDING_LOCAL_MODEL_REQUIRED/u,
  );
});

test('Runtime route describe builds non-text scenario probes and validates metadata boundaries', async () => {
  const cases: Array<{
    readonly capability: NimiRuntimeCanonicalCapability;
    readonly scenarioType: ScenarioType;
    readonly oneofKind: string;
    readonly modelId: string;
    readonly metadata: Record<string, unknown>;
  }> = [
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
    {
      capability: 'audio.transcribe',
      scenarioType: ScenarioType.SPEECH_TRANSCRIBE,
      oneofKind: 'speechTranscribe',
      modelId: 'stt-model',
      metadata: {
        tiers: ['standard'],
        supportedResponseFormats: ['json'],
        supportsLanguage: true,
        supportsPrompt: false,
        supportsTimestamps: true,
        supportsDiarization: false,
      },
    },
    {
      capability: 'voice_workflow.voice_clone',
      scenarioType: ScenarioType.VOICE_CLONE,
      oneofKind: 'voiceClone',
      modelId: 'voice-clone-model',
      metadata: {
        workflowType: 'voice_clone',
        requiresTargetSynthesisBinding: true,
        textPromptMode: 'unsupported',
        supportsLanguageHints: true,
        supportsPreferredName: true,
        referenceAudioUriInput: true,
        referenceAudioBytesInput: true,
        allowedReferenceAudioMimeTypes: ['audio/wav'],
      },
    },
    {
      capability: 'voice_workflow.voice_design',
      scenarioType: ScenarioType.VOICE_DESIGN,
      oneofKind: 'voiceDesign',
      modelId: 'voice-design-model',
      metadata: {
        workflowType: 'voice_design',
        requiresTargetSynthesisBinding: true,
        instructionTextMode: 'required',
        previewTextMode: 'optional',
        supportsLanguage: true,
        supportsPreferredName: true,
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
        source: 'local',
        connectorId: '',
        provider: 'runtime',
        engine: 'runtime',
        model: item.modelId,
        modelId: item.modelId,
        localModelId: `asset-${item.modelId}`,
        resolvedBindingRef,
      },
      buildCallOptions(input) {
        assert.equal(input.targetId, 'route.describe');
        assert.equal(input.source, 'local');
        return {
          timeoutMs: input.timeoutMs,
          responseMetadataObserver: (metadata) => observedMetadata.push(metadata),
        };
      },
      async executeScenario(request, options) {
        assert.equal(request.head?.appId, 'nimi.route.test');
        assert.equal(request.head?.modelId, item.modelId);
        assert.equal(request.head?.routePolicy, RoutePolicy.LOCAL);
        assert.equal(request.executionMode, ExecutionMode.SYNC);
        assert.equal(request.scenarioType, item.scenarioType);
        assert.equal(request.spec?.spec.oneofKind, item.oneofKind);
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
        source: 'local',
        connectorId: '',
        provider: 'runtime',
        engine: 'runtime',
        model: 'text-model',
        modelId: 'text-model',
        localModelId: 'asset-text-model',
      },
      buildCallOptions: () => ({}),
      async executeScenario() {
        return {};
      },
    }),
    hasRouteReasonCode('SDK_RUNTIME_ROUTE_DESCRIBE_METADATA_MISSING'),
  );
  await assert.rejects(
    () => describeNimiRuntimeRouteWithHost({
      appId: 'nimi.route.test',
      targetId: 'route.describe',
      capability: 'text.generate',
      resolvedBindingRef: 'local:text.generate:runtime:text-model',
      resolved: {
        capability: 'text.generate',
        source: 'local',
        connectorId: '',
        provider: 'runtime',
        engine: 'runtime',
        model: 'text-model',
        modelId: 'text-model',
        localModelId: 'asset-text-model',
      },
      buildCallOptions: () => ({}),
      async executeScenario(_request, options) {
        options.responseMetadataObserver?.({
          [NIMI_RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY]: encodeRouteDescribePayload({
            capability: 'text.generate',
            metadataVersion: 'v0',
            resolvedBindingRef: 'local:text.generate:runtime:text-model',
            metadataKind: '',
            metadata: {},
          }),
        });
        return {};
      },
    }),
    hasRouteReasonCode('SDK_RUNTIME_ROUTE_DESCRIBE_METADATA_INVALID'),
  );
  await assert.rejects(
    () => describeNimiRuntimeRouteWithHost({
      appId: 'nimi.route.test',
      targetId: 'route.describe',
      capability: 'text.generate',
      resolvedBindingRef: 'local:text.generate:runtime:text-model',
      resolved: {
        capability: 'text.generate',
        source: 'local',
        connectorId: '',
        provider: 'runtime',
        engine: 'runtime',
        model: 'text-model',
        modelId: 'text-model',
        localModelId: 'asset-text-model',
      },
      buildCallOptions: () => ({}),
      async executeScenario(_request, options) {
        options.responseMetadataObserver?.({
          [NIMI_RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY]: encodeRouteDescribePayload({
            capability: 'audio.synthesize',
            metadataVersion: 'v1',
            resolvedBindingRef: 'local:text.generate:runtime:text-model',
            metadataKind: 'audio.synthesize',
            metadata: {
              supportedAudioFormats: ['mp3'],
              supportedTimingModes: ['none'],
              supportsLanguage: true,
              supportsEmotion: false,
            },
          }),
        });
        return {};
      },
    }),
    hasRouteReasonCode('SDK_RUNTIME_ROUTE_DESCRIBE_METADATA_MISMATCH'),
  );
});

test('Runtime route describe validates K-RPC-017 typed metadata variants and fails closed', async () => {
  function describeTextGenerateWithMetadata(metadata: unknown): Promise<unknown> {
    return describeNimiRuntimeRouteWithHost({
      appId: 'nimi.route.test',
      targetId: 'route.describe',
      capability: 'text.generate',
      resolvedBindingRef: 'local:text.generate:runtime:text-model',
      resolved: {
        capability: 'text.generate',
        source: 'local',
        connectorId: '',
        provider: 'runtime',
        engine: 'runtime',
        model: 'text-model',
        modelId: 'text-model',
        localModelId: 'asset-text-model',
      },
      buildCallOptions: () => ({}),
      async executeScenario(_request, options) {
        options.responseMetadataObserver?.({
          [NIMI_RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY]: encodeRouteDescribePayload({
            capability: 'text.generate',
            metadataVersion: 'v1',
            resolvedBindingRef: 'local:text.generate:runtime:text-model',
            metadataKind: 'text.generate',
            metadata,
          }),
        });
        return {};
      },
    });
  }

  // Missing required typed field (supportsArtifactRefInput omitted) fails closed.
  await assert.rejects(
    () => describeTextGenerateWithMetadata(createTextGenerateRouteMetadata({ supportsArtifactRefInput: undefined as unknown as boolean })),
    hasRouteReasonCode('SDK_RUNTIME_ROUTE_DESCRIBE_METADATA_INVALID'),
  );

  // Out-of-domain enum value for a typed field fails closed.
  await assert.rejects(
    () => describeTextGenerateWithMetadata(createTextGenerateRouteMetadata({ traceModeSupport: 'verbose' as 'none' })),
    hasRouteReasonCode('SDK_RUNTIME_ROUTE_DESCRIBE_METADATA_INVALID'),
  );

  // Wrong-typed required field fails closed.
  await assert.rejects(
    () => describeTextGenerateWithMetadata(createTextGenerateRouteMetadata({ supportsThinking: 'yes' as unknown as boolean })),
    hasRouteReasonCode('SDK_RUNTIME_ROUTE_DESCRIBE_METADATA_INVALID'),
  );

  // Out-of-domain metadataKind fails closed before variant validation.
  await assert.rejects(
    () => describeNimiRuntimeRouteWithHost({
      appId: 'nimi.route.test',
      targetId: 'route.describe',
      capability: 'text.generate',
      resolvedBindingRef: 'local:text.generate:runtime:text-model',
      resolved: {
        capability: 'text.generate',
        source: 'local',
        connectorId: '',
        provider: 'runtime',
        engine: 'runtime',
        model: 'text-model',
        modelId: 'text-model',
        localModelId: 'asset-text-model',
      },
      buildCallOptions: () => ({}),
      async executeScenario(_request, options) {
        options.responseMetadataObserver?.({
          [NIMI_RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY]: encodeRouteDescribePayload({
            capability: 'text.generate',
            metadataVersion: 'v1',
            resolvedBindingRef: 'local:text.generate:runtime:text-model',
            metadataKind: 'video.generate',
            metadata: createTextGenerateRouteMetadata(),
          }),
        });
        return {};
      },
    }),
    hasRouteReasonCode('SDK_RUNTIME_ROUTE_DESCRIBE_METADATA_KIND_UNSUPPORTED'),
  );

  // A fully valid typed text.generate payload round-trips with typed field access.
  const valid = await describeTextGenerateWithMetadata(
    createTextGenerateRouteMetadata({ supportsThinking: true, traceModeSupport: 'separate' }),
  );
  const validResult = valid as Awaited<ReturnType<typeof describeNimiRuntimeRouteWithHost>>;
  assert.equal(validResult.metadataKind, 'text.generate');
  if (validResult.metadataKind === 'text.generate') {
    assert.equal(validResult.metadata.supportsThinking, true);
    assert.equal(validResult.metadata.traceModeSupport, 'separate');
  }
});

function hasRouteReasonCode(reasonCode: string): (error: unknown) => boolean {
  return (error: unknown) => {
    const shaped = error as { readonly reasonCode?: string; readonly code?: string };
    assert.equal(shaped.reasonCode ?? shaped.code, reasonCode);
    return true;
  };
}
