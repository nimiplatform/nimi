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

const AUTH_STUB = {
  async registerApp() {
    return { accepted: true };
  },
};
const APP_AUTH_STUB = {
  async authorizeExternalPrincipal() {
    return { tokenId: 'token-1', secret: 'secret-1' };
  },
};
const AI_CONFIG_IDENTITY = {
  ownerUserId: 'user-1',
  runtimeSourceRef: 'agent-alpha',
  localAgentRef: 'local-agent:user-1:agent-alpha',
};

function createModule(
  agent: NimiRuntimeAgentAIConfigAgentSurface,
  scopeLog: string[][] = [],
): NimiRuntimeAgentAIConfigModule {
  return createNimiRuntimeAgentAIConfigModule({
    runtime: {
      appId: 'nimi.test-app',
      auth: AUTH_STUB,
      appAuth: APP_AUTH_STUB,
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

test('AI Config upsert maps app intents to the typed mutation payload', async () => {
  const requests: UpsertRuntimeAgentAIConfigRequest[] = [];
  const scopeLog: string[][] = [];
  const module = createModule({
    async upsertRuntimeAgentAIConfig(request) {
      requests.push(request);
      const config = committedConfig();
      config.revision = '4';
      return { config };
    },
  }, scopeLog);

  const snapshot = await module.upsert({
    ...AI_CONFIG_IDENTITY,
    expectedRevision: 3,
    intents: {
      'text.generate': { route: 'local', modelId: 'local/default' },
      'text.embed': { route: 'local', modelId: 'local/default-embedding' },
      'image.generate': {
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
      },
    },
  });

  assert.deepEqual(scopeLog, [['runtime.agent.ai_config.write']]);
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
      voiceReferenceRef: '',
      imagePolicyRef: '',
    },
    {
      capability: 'text.embed',
      modelId: 'local/default-embedding',
      routePolicy: RoutePolicy.LOCAL,
      connectorId: '',
      voiceReferenceRef: '',
      imagePolicyRef: '',
    },
    {
      capability: 'image.generate',
      modelId: 'gpt-image-1.5',
      routePolicy: RoutePolicy.CLOUD,
      connectorId: 'connector-1',
      voiceReferenceRef: '',
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
  ]);
});

test('AI Config upsert fails closed on invalid app input', async () => {
  const module = createModule({
    async upsertRuntimeAgentAIConfig() {
      throw new Error('must not reach runtime');
    },
  });

  const invalidInputs: Array<Parameters<NimiRuntimeAgentAIConfigModule['upsert']>[0]> = [
    // Removing the required text.generate intent is invalid before dispatch.
    {
      ...AI_CONFIG_IDENTITY,
      expectedRevision: 3,
      intents: {
        'text.embed': { route: 'local', modelId: 'local/default-embedding' },
        'image.generate': { route: 'cloud', modelId: 'gpt-image-1.5' },
      },
    },
    // Removing the required text.embed intent is invalid before dispatch.
    {
      ...AI_CONFIG_IDENTITY,
      expectedRevision: 3,
      intents: { 'text.generate': { route: 'local', modelId: 'local/default' } },
    },
    // Empty intent maps are invalid.
    { ...AI_CONFIG_IDENTITY, expectedRevision: 3, intents: {} },
    // Unknown route values fail closed instead of defaulting.
    {
      ...AI_CONFIG_IDENTITY,
      expectedRevision: 3,
      intents: {
        'text.generate': { route: 'edge' as 'local', modelId: 'local/default' },
        'text.embed': { route: 'local', modelId: 'local/default-embedding' },
      },
    },
    // targetRef kind must match the declared route.
    {
      ...AI_CONFIG_IDENTITY,
      expectedRevision: 3,
      intents: {
        'text.generate': {
          route: 'local',
          modelId: 'local/default',
          targetRef: {
            kind: 'cloud-connector',
            version: 'v2',
            connectorId: 'connector-1',
            remoteModelCatalogId: 'catalog-1',
            providerModelId: 'model-1',
          },
        },
        'text.embed': { route: 'local', modelId: 'local/default-embedding' },
      },
    },
  ];
  for (const input of invalidInputs) {
    await assert.rejects(module.upsert(input), (error: { readonly reasonCode?: string }) => {
      assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_AI_CONFIG_INPUT_INVALID');
      return true;
    });
  }

  await assert.rejects(module.upsert({
    ...AI_CONFIG_IDENTITY,
    expectedRevision: 0,
    intents: {
      'text.generate': { route: 'local', modelId: 'local/default' },
      'text.embed': { route: 'local', modelId: 'local/default-embedding' },
    },
  }), (error: { readonly reasonCode?: string }) => {
    assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_AI_CONFIG_INPUT_INVALID');
    return true;
  });
});

test('AI Config upsert projects revision conflicts as typed concurrent modification', async () => {
  const module = createModule({
    async upsertRuntimeAgentAIConfig() {
      const error = new Error(
        'AI Config concurrent modification: expected_revision=2 committed_revision=3; re-read the committed config and retry',
      ) as Error & { details?: Record<string, unknown> };
      error.details = { grpcCode: 10, grpcDetails: '' };
      throw error;
    },
  });

  await assert.rejects(module.upsert({
    ...AI_CONFIG_IDENTITY,
    expectedRevision: 2,
    intents: {
      'text.generate': { route: 'local', modelId: 'local/default' },
      'text.embed': { route: 'local', modelId: 'local/default-embedding' },
    },
  }), (error: { readonly reasonCode?: string; readonly actionHint?: string; readonly details?: Record<string, unknown> }) => {
    assert.equal(error.reasonCode, 'RUNTIME_AGENT_AI_CONFIG_CONCURRENT_MODIFICATION');
    assert.equal(error.actionHint, 'reload_committed_agent_ai_config_and_retry');
    assert.equal(error.details?.expectedRevision, '2');
    return true;
  });
});

test('AI Config upsert re-throws non-conflict runtime failures unchanged', async () => {
  const module = createModule({
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

  await assert.rejects(module.upsert({
    ...AI_CONFIG_IDENTITY,
    expectedRevision: 3,
    intents: {
      'text.generate': { route: 'local', modelId: 'local/default' },
      'text.embed': { route: 'local', modelId: 'local/default-embedding' },
    },
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
              state: RuntimeAgentAIConfigReadinessState.RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_NOT_CONFIGURED,
              reasonCode: '',
              probedAt: { seconds: '1700000000', nanos: 0 },
            },
            {
              capability: 'audio.synthesize',
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
    ['image.generate', 'not_configured'],
    ['audio.synthesize', 'not_configured'],
    ['text.embed', 'unavailable'],
    ['voice_workflow.voice_clone', 'unavailable'],
    ['voice_workflow.voice_design', 'unavailable'],
    ['image.generate', 'unavailable'],
  ]);
  assert.deepEqual(readiness.capabilities.slice(3).map((entry) => entry.reasonCode), [
    'embedding_profile_unavailable',
    'voice_reference_missing',
    'voice_workflow_unavailable',
    'image_route_unavailable',
  ]);
  assert.equal(readiness.capabilities[0]?.probedAt, new Date(1700000000000).toISOString());

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
