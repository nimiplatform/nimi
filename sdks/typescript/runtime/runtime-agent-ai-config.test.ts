import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RuntimeAgentAIConfigReadinessState,
  RoutePolicy,
  type RuntimeAgentAIConfigReadinessSnapshot,
  type GetRuntimeAgentAIConfigRequest,
  type GetRuntimeAgentAIConfigReadinessRequest,
  type RuntimeAgentAIConfig,
  type RuntimeTypedCallOptions,
  type SubscribeRuntimeAgentAIConfigReadinessRequest,
  type UpsertRuntimeAgentAIConfigRequest,
} from '../core-generated/runtime-typed-client';
import {
  createNimiRuntimeAgentAIConfigModule,
  type NimiRuntimeAgentAIConfigAgentSurface,
  type NimiRuntimeAgentAIConfigModule,
} from './runtime-agent-ai-config';
import type { NimiAIConfig } from '../core/ai';

const AUTH_STUB = {
  async registerApp() {
    return { accepted: true };
  },
};
const AI_CONFIG_IDENTITY = {
  ownerUserId: 'user-1',
  runtimeSourceRef: 'agent-alpha',
  localAgentRef: 'local-agent:user-1:agent-alpha',
};

function canonicalAIConfig(): NimiAIConfig {
  return {
    scopeRef: {
      kind: 'local-agent',
      ownerId: AI_CONFIG_IDENTITY.localAgentRef,
    },
    capabilities: {
      logicalModelIds: {
        'text.generate': 'local/default',
        'text.embed': 'local/default-embedding',
        'image.generate': 'gpt-image-1.5',
      },
      targetRefs: {
        'text.generate': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'local-runtime:asset-1',
        },
        'text.embed': {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'local-runtime:embedding-asset-1',
        },
        'image.generate': {
          kind: 'cloud-connector',
          version: 'v2',
          connectorId: 'connector-1',
          remoteModelCatalogId: 'catalog-1',
          providerModelId: 'gpt-image-1.5',
          provider: 'openai',
        },
      },
      selectedComponents: {},
      selectedParams: {
        'image.generate': { steps: 28 },
      },
    },
    profileOrigin: {
      profileId: 'profile-z-image',
      title: 'Z Image',
      appliedAt: '2026-07-31T10:00:00.000Z',
    },
  };
}

function createModule(
  agent: NimiRuntimeAgentAIConfigAgentSurface,
  scopeLog: string[][] = [],
): NimiRuntimeAgentAIConfigModule {
  return createNimiRuntimeAgentAIConfigModule({
    runtime: {
      appId: 'nimi.test-app',
      auth: AUTH_STUB,
      agent,
    },
    getSubjectUserId: () => 'user-1',
    withScopes: async (scopes, operation) => {
      scopeLog.push([...scopes]);
      return operation({ metadata: { scopes: scopes.join(' ') } });
    },
  });
}

function committedConfig(): RuntimeAgentAIConfig {
  return {
    agentInstanceId: 'local-agent:user-1:agent-alpha',
    revision: '3',
    intents: [
      {
        capability: 'text.generate',
        modelId: 'local/default',
        routePolicy: RoutePolicy.LOCAL,
        connectorId: '',
        targetRef: {
          target: {
            oneofKind: 'localRuntime',
            localRuntime: {
              version: 'v2',
              ref: { oneofKind: 'profileBindingId', profileBindingId: 'local-runtime:asset-1' },
            },
          },
        },
      },
      {
        capability: 'text.embed',
        modelId: 'local/default-embedding',
        routePolicy: RoutePolicy.LOCAL,
        connectorId: '',
        targetRef: {
          target: {
            oneofKind: 'localRuntime',
            localRuntime: {
              version: 'v2',
              ref: { oneofKind: 'profileBindingId', profileBindingId: 'local-runtime:embedding-asset-1' },
            },
          },
        },
      },
      {
        capability: 'image.generate',
        modelId: 'gpt-image-1.5',
        routePolicy: RoutePolicy.CLOUD,
        connectorId: 'connector-1',
        imagePolicyRef: 'image-policy:runtime-agent-default',
        targetRef: {
          target: {
            oneofKind: 'cloud',
            cloud: {
              version: 'v2',
              connectorId: 'connector-1',
              remoteModelCatalogId: 'catalog-1',
              providerModelId: 'gpt-image-1.5',
              provider: 'openai',
            },
          },
        },
      },
      {
        capability: 'audio.synthesize',
        modelId: 'qwen3-tts-runtime-live-native-stream',
        routePolicy: RoutePolicy.CLOUD,
        connectorId: 'connector-voice-1',
        voiceReferenceRef: 'voice-ref:runtime-agent-default',
        targetRef: {
          target: {
            oneofKind: 'cloud',
            cloud: {
              version: 'v2',
              connectorId: 'connector-voice-1',
              remoteModelCatalogId: 'catalog-voice-1',
              providerModelId: 'qwen3-tts-runtime-live-native-stream',
              provider: 'dashscope',
            },
          },
        },
      },
    ],
    updatedAt: { seconds: '1700000000', nanos: 0 },
    updatedByAppId: 'runtime',
  };
}

test('AI Config get projects the committed config into the app-facing snapshot', async () => {
  const requests: GetRuntimeAgentAIConfigRequest[] = [];
  const scopeLog: string[][] = [];
  const module = createModule({
    async getRuntimeAgentAIConfig(request) {
      requests.push(request);
      return { config: committedConfig() };
    },
  }, scopeLog);

  const snapshot = await module.get(AI_CONFIG_IDENTITY);

  assert.deepEqual(scopeLog, [['runtime.agent.ai_config.read']]);
  assert.equal(requests[0]?.context?.appId, 'nimi.test-app');
  assert.equal(requests[0]?.context?.subjectUserId, 'user-1');
  assert.equal(requests[0]?.context?.ownerUserId, 'user-1');
  assert.equal(requests[0]?.context?.runtimeSourceRef, 'agent-alpha');
  assert.equal(requests[0]?.context?.localAgentRef, 'local-agent:user-1:agent-alpha');
  assert.equal(snapshot.revision, 3);
  assert.equal(snapshot.updatedByAppId, 'runtime');
  assert.equal(snapshot.updatedAt, new Date(1700000000000).toISOString());
  assert.deepEqual(snapshot.intents['text.generate'], {
    route: 'local',
    modelId: 'local/default',
    targetRef: {
      kind: 'local-runtime',
      version: 'v2',
      profileBindingId: 'local-runtime:asset-1',
    },
  });
  assert.deepEqual(snapshot.intents['text.embed'], {
    route: 'local',
    modelId: 'local/default-embedding',
    targetRef: {
      kind: 'local-runtime',
      version: 'v2',
      profileBindingId: 'local-runtime:embedding-asset-1',
    },
  });
  assert.deepEqual(snapshot.intents['image.generate'], {
    route: 'cloud',
    modelId: 'gpt-image-1.5',
    connectorId: 'connector-1',
    imagePolicyRef: 'image-policy:runtime-agent-default',
    targetRef: {
      kind: 'cloud-connector',
      version: 'v2',
      connectorId: 'connector-1',
      remoteModelCatalogId: 'catalog-1',
      providerModelId: 'gpt-image-1.5',
      provider: 'openai',
    },
  });
  assert.deepEqual(snapshot.intents['audio.synthesize'], {
    route: 'cloud',
    modelId: 'qwen3-tts-runtime-live-native-stream',
    connectorId: 'connector-voice-1',
    voiceReferenceRef: 'voice-ref:runtime-agent-default',
    targetRef: {
      kind: 'cloud-connector',
      version: 'v2',
      connectorId: 'connector-voice-1',
      remoteModelCatalogId: 'catalog-voice-1',
      providerModelId: 'qwen3-tts-runtime-live-native-stream',
      provider: 'dashscope',
    },
  });
});

test('AI Config get omits targetless historical capabilities while preserving intents and allowing upsert', async () => {
  const historicalConfig = committedConfig();
  historicalConfig.intents = [
    {
      capability: 'text.embed',
      modelId: 'local/default-embedding',
      routePolicy: RoutePolicy.LOCAL,
      connectorId: '',
    },
    historicalConfig.intents[0]!,
  ];
  const requests: UpsertRuntimeAgentAIConfigRequest[] = [];
  const module = createModule({
    async getRuntimeAgentAIConfig() {
      return { config: historicalConfig };
    },
    async upsertRuntimeAgentAIConfig(request) {
      requests.push(request);
      return { config: historicalConfig };
    },
  });

  const snapshot = await module.get(AI_CONFIG_IDENTITY);

  assert.deepEqual(snapshot.aiConfig.capabilities, {
    logicalModelIds: { 'text.generate': 'local/default' },
    targetRefs: {
      'text.generate': {
        kind: 'local-runtime',
        version: 'v2',
        profileBindingId: 'local-runtime:asset-1',
      },
    },
    selectedComponents: {},
    selectedParams: {},
  });
  assert.deepEqual(snapshot.intents['text.embed'], {
    route: 'local',
    modelId: 'local/default-embedding',
  });
  assert.deepEqual(snapshot.intents['text.generate'], {
    route: 'local',
    modelId: 'local/default',
    targetRef: {
      kind: 'local-runtime',
      version: 'v2',
      profileBindingId: 'local-runtime:asset-1',
    },
  });

  await module.update({
    ...AI_CONFIG_IDENTITY,
    expectedRevision: snapshot.revision,
    config: {
      ...snapshot.aiConfig,
      capabilities: {
        ...snapshot.aiConfig.capabilities,
        logicalModelIds: {
          ...snapshot.aiConfig.capabilities.logicalModelIds,
          'text.summarize': 'local/summary',
        },
        targetRefs: {
          ...snapshot.aiConfig.capabilities.targetRefs,
          'text.summarize': {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local-runtime:summary-asset-1',
          },
        },
      },
    },
  });

  assert.deepEqual(requests[0]?.intents.map((intent) => intent.capability), [
    'text.generate',
    'text.summarize',
  ]);
  assert.equal(requests[0]?.intents.some((intent) => intent.capability === 'text.embed'), false);
});

test('AI Config get fails closed on unknown route policy and missing config', async () => {
  const unknownRoute = createModule({
    async getRuntimeAgentAIConfig() {
      const config = committedConfig();
      config.intents[0]!.routePolicy = RoutePolicy.UNSPECIFIED;
      return { config };
    },
  });
  await assert.rejects(unknownRoute.get(AI_CONFIG_IDENTITY), (error: { readonly reasonCode?: string }) => {
    assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_AI_CONFIG_RESPONSE_INVALID');
    return true;
  });

  const missingConfig = createModule({
    async getRuntimeAgentAIConfig() {
      return {};
    },
  });
  await assert.rejects(missingConfig.get(AI_CONFIG_IDENTITY), (error: { readonly reasonCode?: string }) => {
    assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_AI_CONFIG_RESPONSE_INVALID');
    return true;
  });
});

test('AI Config update maps the canonical config to one exact typed mutation payload', async () => {
  const requests: UpsertRuntimeAgentAIConfigRequest[] = [];
  const scopeLog: string[][] = [];
  const module = createModule({
    async getRuntimeAgentAIConfig() {
      return { config: committedConfig() };
    },
    async upsertRuntimeAgentAIConfig(request) {
      requests.push(request);
      const config = committedConfig();
      config.revision = '4';
      return { config };
    },
  }, scopeLog);

  const snapshot = await module.update({
    ...AI_CONFIG_IDENTITY,
    expectedRevision: 3,
    config: canonicalAIConfig(),
  });

  assert.deepEqual(scopeLog, [
    ['runtime.agent.ai_config.read'],
    ['runtime.agent.ai_config.write'],
  ]);
  assert.equal(snapshot.revision, 4);
  const request = requests[0]!;
  assert.equal(request.expectedRevision, '3');
  assert.equal(request.context?.appId, 'nimi.test-app');
  assert.deepEqual(request.intents, [
    {
      capability: 'text.generate',
      modelId: 'local/default',
      routePolicy: RoutePolicy.LOCAL,
      connectorId: '',
      provider: '',
      voiceReferenceRef: '',
      imagePolicyRef: '',
      selectedComponents: [],
      targetRef: {
        target: {
          oneofKind: 'localRuntime',
          localRuntime: {
            version: 'v2',
            ref: { oneofKind: 'profileBindingId', profileBindingId: 'local-runtime:asset-1' },
          },
        },
      },
    },
    {
      capability: 'text.embed',
      modelId: 'local/default-embedding',
      routePolicy: RoutePolicy.LOCAL,
      connectorId: '',
      provider: '',
      voiceReferenceRef: '',
      imagePolicyRef: '',
      selectedComponents: [],
      targetRef: {
        target: {
          oneofKind: 'localRuntime',
          localRuntime: {
            version: 'v2',
            ref: {
              oneofKind: 'profileBindingId',
              profileBindingId: 'local-runtime:embedding-asset-1',
            },
          },
        },
      },
    },
    {
      capability: 'image.generate',
      modelId: 'gpt-image-1.5',
      routePolicy: RoutePolicy.CLOUD,
      connectorId: 'connector-1',
      provider: 'openai',
      voiceReferenceRef: '',
      imagePolicyRef: 'image-policy:runtime-agent-default',
      selectedComponents: [],
      selectedParams: {
        fields: {
          steps: {
            kind: {
              oneofKind: 'numberValue',
              numberValue: 28,
            },
          },
        },
      },
      targetRef: {
        target: {
          oneofKind: 'cloud',
          cloud: {
            version: 'v2',
            connectorId: 'connector-1',
            remoteModelCatalogId: 'catalog-1',
            providerModelId: 'gpt-image-1.5',
            provider: 'openai',
          },
        },
      },
    },
  ]);
  assert.equal(request.profileOrigin?.profileId, 'profile-z-image');
  assert.equal(request.profileOrigin?.title, 'Z Image');
});

test('AI Config update accepts a dynamic capability set without required text intent pairing', async () => {
  const requests: UpsertRuntimeAgentAIConfigRequest[] = [];
  const module = createModule({
    async getRuntimeAgentAIConfig() {
      return { config: committedConfig() };
    },
    async upsertRuntimeAgentAIConfig(request) {
      requests.push(request);
      return { config: committedConfig() };
    },
  });
  const base = canonicalAIConfig();
  await module.update({
    ...AI_CONFIG_IDENTITY,
    expectedRevision: 3,
    config: {
      ...base,
      capabilities: {
        logicalModelIds: { 'image.generate': base.capabilities.logicalModelIds['image.generate']! },
        targetRefs: { 'image.generate': base.capabilities.targetRefs['image.generate']! },
        selectedComponents: {},
        selectedParams: { 'image.generate': base.capabilities.selectedParams['image.generate']! },
      },
    },
  });
  assert.deepEqual(requests[0]?.intents.map((intent) => intent.capability), ['image.generate']);
});

test('AI Config update fails closed on invalid canonical config input', async () => {
  const module = createModule({
    async getRuntimeAgentAIConfig() {
      return { config: committedConfig() };
    },
    async upsertRuntimeAgentAIConfig() {
      throw new Error('must not reach runtime');
    },
  });

  const base = canonicalAIConfig();
  const invalidInputs: Array<Parameters<NimiRuntimeAgentAIConfigModule['update']>[0]> = [
    {
      ...AI_CONFIG_IDENTITY,
      expectedRevision: 3,
      config: {
        ...base,
        capabilities: {
          logicalModelIds: base.capabilities.logicalModelIds,
          targetRefs: base.capabilities.targetRefs,
          selectedParams: base.capabilities.selectedParams,
        },
      } as NimiAIConfig,
    },
    {
      ...AI_CONFIG_IDENTITY,
      expectedRevision: 3,
      config: {
        ...base,
        capabilities: {
          ...base.capabilities,
          targetRefs: {
            ...base.capabilities.targetRefs,
            'image.generate': {
              kind: 'profile-slice',
              profileId: 'profile-z-image',
              profileSliceRef: 'image.main',
            },
          },
        },
      },
    },
    {
      ...AI_CONFIG_IDENTITY,
      expectedRevision: 3,
      config: {
        ...base,
        scopeRef: { kind: 'local-agent', ownerId: 'another-agent' },
      },
    },
  ];
  for (const input of invalidInputs) {
    await assert.rejects(module.update(input), (error: { readonly reasonCode?: string }) => {
      assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_AI_CONFIG_INPUT_INVALID');
      return true;
    });
  }

  await assert.rejects(module.update({
    ...AI_CONFIG_IDENTITY,
    expectedRevision: 0,
    config: base,
  }), (error: { readonly reasonCode?: string }) => {
    assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_AI_CONFIG_INPUT_INVALID');
    return true;
  });
});

test('AI Config update projects revision conflicts as typed concurrent modification', async () => {
  const module = createModule({
    async getRuntimeAgentAIConfig() {
      return { config: committedConfig() };
    },
    async upsertRuntimeAgentAIConfig() {
      const error = new Error(
        'AI Config concurrent modification: expected_revision=2 committed_revision=3; re-read the committed config and retry',
      ) as Error & { details?: Record<string, unknown> };
      error.details = { grpcCode: 10, grpcDetails: '' };
      throw error;
    },
  });

  await assert.rejects(module.update({
    ...AI_CONFIG_IDENTITY,
    expectedRevision: 3,
    config: canonicalAIConfig(),
  }), (error: { readonly reasonCode?: string; readonly actionHint?: string; readonly details?: Record<string, unknown> }) => {
    assert.equal(error.reasonCode, 'RUNTIME_AGENT_AI_CONFIG_CONCURRENT_MODIFICATION');
    assert.equal(error.actionHint, 'reload_committed_agent_ai_config_and_retry');
    assert.equal(error.details?.expectedRevision, '3');
    return true;
  });
});

test('AI Config update re-throws non-conflict runtime failures unchanged', async () => {
  const module = createModule({
    async getRuntimeAgentAIConfig() {
      return { config: committedConfig() };
    },
    async upsertRuntimeAgentAIConfig() {
      const error = new Error('AI Config must retain the required text.generate intent') as Error & {
        reasonCode?: string;
        details?: Record<string, unknown>;
      };
      error.reasonCode = 'RUNTIME_GRPC_INVALID_ARGUMENT';
      error.details = { grpcCode: 3 };
      throw error;
    },
  });

  await assert.rejects(module.update({
    ...AI_CONFIG_IDENTITY,
    expectedRevision: 3,
    config: canonicalAIConfig(),
  }), (error: { readonly reasonCode?: string }) => {
    assert.equal(error.reasonCode, 'RUNTIME_GRPC_INVALID_ARGUMENT');
    return true;
  });
});

test('AI Config readiness projects typed states and fails closed on unknown states', async () => {
  const requests: GetRuntimeAgentAIConfigReadinessRequest[] = [];
  const module = createModule({
    async getRuntimeAgentAIConfigReadiness(request) {
      requests.push(request);
      return {
        snapshot: {
          agentInstanceId: 'local-agent:user-1:agent-alpha',
          configRevision: '3',
          capabilities: [
            {
              capability: 'text.generate',
              state: RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY,
              reasonCode: '',
              probedAt: { seconds: '1700000000', nanos: 0 },
            },
            {
              capability: 'image.generate',
              state: RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_CONFIGURED_UNVERIFIED,
              reasonCode: 'image_configured_unverified',
            },
            {
              capability: 'audio.synthesize',
              state: RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_NOT_CONFIGURED,
              reasonCode: '',
              probedAt: { seconds: '1700000000', nanos: 0 },
            },
            {
              capability: 'audio.transcribe',
              state: RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_NOT_CONFIGURED,
              reasonCode: '',
              probedAt: { seconds: '1700000000', nanos: 0 },
            },
            {
              capability: 'text.embed',
              state: RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE,
              reasonCode: 'embedding_profile_unavailable',
              probedAt: { seconds: '1700000000', nanos: 0 },
            },
            {
              capability: 'voice_workflow.voice_clone',
              state: RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE,
              reasonCode: 'voice_reference_missing',
              probedAt: { seconds: '1700000000', nanos: 0 },
            },
            {
              capability: 'voice_workflow.voice_design',
              state: RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE,
              reasonCode: 'voice_workflow_unavailable',
              probedAt: { seconds: '1700000000', nanos: 0 },
            },
            {
              capability: 'image.generate',
              state: RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE,
              reasonCode: 'image_route_unavailable',
              probedAt: { seconds: '1700000000', nanos: 0 },
            },
            {
              capability: 'image.edit',
              state: RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE,
              reasonCode: 'target_unavailable',
              probedAt: { seconds: '1700000000', nanos: 0 },
            },
          ],
        },
      };
    },
  });

  const readiness = await module.readiness(AI_CONFIG_IDENTITY);
  assert.equal(requests[0]?.context?.appId, 'nimi.test-app');
  assert.equal(readiness.configRevision, 3);
  assert.deepEqual(readiness.capabilities.map((entry) => [entry.capability, entry.state]), [
    ['text.generate', 'ready'],
    ['image.generate', 'configured_unverified'],
    ['audio.synthesize', 'not_configured'],
    ['audio.transcribe', 'not_configured'],
    ['text.embed', 'unavailable'],
    ['voice_workflow.voice_clone', 'unavailable'],
    ['voice_workflow.voice_design', 'unavailable'],
    ['image.generate', 'unavailable'],
    ['image.edit', 'unavailable'],
  ]);
  assert.deepEqual(readiness.capabilities
    .filter((entry) => entry.state === 'unavailable')
    .map((entry) => entry.reasonCode), [
    'embedding_profile_unavailable',
    'voice_reference_missing',
    'voice_workflow_unavailable',
    'image_route_unavailable',
    'target_unavailable',
  ]);
  assert.equal(readiness.capabilities[0]?.probedAt, new Date(1700000000000).toISOString());
  assert.equal(readiness.capabilities[1]?.reasonCode, 'image_configured_unverified');
  assert.equal(readiness.capabilities[1]?.probedAt, null);

  const unknownState = createModule({
    async getRuntimeAgentAIConfigReadiness() {
      return {
        snapshot: {
          agentInstanceId: 'local-agent:user-1:agent-alpha',
          configRevision: '3',
          capabilities: [{
            capability: 'text.generate',
            state: 99 as RuntimeAgentAIConfigReadinessState,
            reasonCode: '',
            probedAt: undefined,
          }],
        },
      };
    },
  });
  await assert.rejects(unknownState.readiness(AI_CONFIG_IDENTITY), (error: { readonly reasonCode?: string }) => {
    assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_AI_CONFIG_RESPONSE_INVALID');
    return true;
  });

  const unknownReason = createModule({
    async getRuntimeAgentAIConfigReadiness() {
      return {
        snapshot: {
          agentInstanceId: 'local-agent:user-1:agent-alpha',
          configRevision: '3',
          capabilities: [{
            capability: 'text.generate',
            state: RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE,
            reasonCode: 'provider_said_maybe',
            probedAt: undefined,
          }],
        },
      };
    },
  });
  await assert.rejects(unknownReason.readiness(AI_CONFIG_IDENTITY), (error: { readonly reasonCode?: string }) => {
    assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_AI_CONFIG_RESPONSE_INVALID');
    return true;
  });
});

test('subscribeReadiness projects the server stream and honors early return', async () => {
  const requests: SubscribeRuntimeAgentAIConfigReadinessRequest[] = [];
  const scopeLog: string[][] = [];
  let streamClosed = false;
  const snapshots: RuntimeAgentAIConfigReadinessSnapshot[] = [
    {
      agentInstanceId: 'local-agent:user-1:agent-alpha',
      configRevision: '1',
      capabilities: [{
        capability: 'text.generate',
        state: RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_READY,
        reasonCode: '',
        probedAt: { seconds: '1700000000', nanos: 0 },
      }],
    },
    {
      agentInstanceId: 'local-agent:user-1:agent-alpha',
      configRevision: '2',
      capabilities: [{
        capability: 'image.generate',
        state: RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_UNAVAILABLE,
        reasonCode: 'connector_missing',
        probedAt: { seconds: '1700000100', nanos: 0 },
      }],
    },
  ];
  const module = createModule({
    subscribeRuntimeAgentAIConfigReadiness(request: SubscribeRuntimeAgentAIConfigReadinessRequest, _options?: RuntimeTypedCallOptions) {
      requests.push(request);
      let index = 0;
      return {
        [Symbol.asyncIterator]() {
          return {
            next: async () => {
              if (index >= snapshots.length) {
                return { done: true as const, value: undefined };
              }
              const value = snapshots[index]!;
              index += 1;
              return { done: false as const, value };
            },
            return: async () => {
              streamClosed = true;
              return { done: true as const, value: undefined };
            },
          };
        },
      };
    },
  }, scopeLog);

  const seen: Array<[number, string, string]> = [];
  const stream = module.subscribeReadiness(AI_CONFIG_IDENTITY);
  assert.equal(requests.length, 0, 'stream must not open before the first pull');
  for await (const snapshot of stream) {
    seen.push([
      snapshot.configRevision,
      snapshot.capabilities[0]!.capability,
      snapshot.capabilities[0]!.state,
    ]);
  }
  assert.deepEqual(scopeLog, [['runtime.agent.ai_config.read']]);
  assert.equal(requests[0]?.context?.subjectUserId, 'user-1');
  assert.deepEqual(seen, [
    [1, 'text.generate', 'ready'],
    [2, 'image.generate', 'unavailable'],
  ]);

  // Early return closes the underlying server stream.
  streamClosed = false;
  const second = module.subscribeReadiness(AI_CONFIG_IDENTITY)[Symbol.asyncIterator]();
  const first = await second.next();
  assert.equal(first.done, false);
  await second.return?.();
  assert.equal(streamClosed, true);
});

test('AI Config fails closed when the agent surface lacks the projection', async () => {
  const module = createModule({});
  await assert.rejects(module.get(AI_CONFIG_IDENTITY), (error: { readonly reasonCode?: string }) => {
    assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_AI_CONFIG_SURFACE_REQUIRED');
    return true;
  });
});
