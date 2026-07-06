import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentExecutionReadinessState,
  RoutePolicy,
  type AgentExecutionReadinessSnapshot,
  type GetAgentExecutionConfigRequest,
  type GetAgentExecutionReadinessRequest,
  type RuntimeAgentExecutionConfig,
  type RuntimeTypedCallOptions,
  type SubscribeAgentExecutionReadinessRequest,
  type UpsertAgentExecutionConfigRequest,
} from '../core-generated/runtime-typed-client';
import {
  createNimiRuntimeAgentExecutionConfigModule,
  type NimiRuntimeAgentExecutionConfigAgentSurface,
  type NimiRuntimeAgentExecutionConfigModule,
} from './runtime-agent-execution-config';

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

function createModule(
  agent: NimiRuntimeAgentExecutionConfigAgentSurface,
  scopeLog: string[][] = [],
): NimiRuntimeAgentExecutionConfigModule {
  return createNimiRuntimeAgentExecutionConfigModule({
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

function committedConfig(): RuntimeAgentExecutionConfig {
  return {
    revision: '3',
    bindings: [
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
        capability: 'image.generate',
        modelId: 'gpt-image-1.5',
        routePolicy: RoutePolicy.CLOUD,
        connectorId: 'connector-1',
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

test('execution config get projects the committed config into the app-facing snapshot', async () => {
  const requests: GetAgentExecutionConfigRequest[] = [];
  const scopeLog: string[][] = [];
  const module = createModule({
    async getAgentExecutionConfig(request) {
      requests.push(request);
      return { config: committedConfig() };
    },
  }, scopeLog);

  const snapshot = await module.get();

  assert.deepEqual(scopeLog, [['runtime.agent.execution_config.read']]);
  assert.equal(requests[0]?.context?.appId, 'nimi.test-app');
  assert.equal(requests[0]?.context?.subjectUserId, 'user-1');
  assert.equal(snapshot.revision, 3);
  assert.equal(snapshot.updatedByAppId, 'runtime');
  assert.equal(snapshot.updatedAt, new Date(1700000000000).toISOString());
  assert.deepEqual(snapshot.bindings['text.generate'], {
    route: 'local',
    modelId: 'local/default',
    targetRef: {
      kind: 'local-runtime',
      version: 'v2',
      profileBindingId: 'local-runtime:asset-1',
    },
  });
  assert.deepEqual(snapshot.bindings['image.generate'], {
    route: 'cloud',
    modelId: 'gpt-image-1.5',
    connectorId: 'connector-1',
    targetRef: {
      kind: 'cloud-connector',
      version: 'v2',
      connectorId: 'connector-1',
      remoteModelCatalogId: 'catalog-1',
      providerModelId: 'gpt-image-1.5',
      provider: 'openai',
    },
  });
  assert.deepEqual(snapshot.bindings['audio.synthesize'], {
    route: 'cloud',
    modelId: 'qwen3-tts-runtime-live-native-stream',
    connectorId: 'connector-voice-1',
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

test('execution config get fails closed on unknown route policy and missing config', async () => {
  const unknownRoute = createModule({
    async getAgentExecutionConfig() {
      const config = committedConfig();
      config.bindings[0]!.routePolicy = RoutePolicy.UNSPECIFIED;
      return { config };
    },
  });
  await assert.rejects(unknownRoute.get(), (error: { readonly reasonCode?: string }) => {
    assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_EXECUTION_CONFIG_RESPONSE_INVALID');
    return true;
  });

  const missingConfig = createModule({
    async getAgentExecutionConfig() {
      return {};
    },
  });
  await assert.rejects(missingConfig.get(), (error: { readonly reasonCode?: string }) => {
    assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_EXECUTION_CONFIG_RESPONSE_INVALID');
    return true;
  });
});

test('execution config upsert maps app bindings to the typed mutation payload', async () => {
  const requests: UpsertAgentExecutionConfigRequest[] = [];
  const scopeLog: string[][] = [];
  const module = createModule({
    async upsertAgentExecutionConfig(request) {
      requests.push(request);
      const config = committedConfig();
      config.revision = '4';
      return { config };
    },
  }, scopeLog);

  const snapshot = await module.upsert({
    expectedRevision: 3,
    bindings: {
      'text.generate': { route: 'local', modelId: 'local/default' },
      'image.generate': {
        route: 'cloud',
        modelId: 'gpt-image-1.5',
        connectorId: 'connector-1',
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

  assert.deepEqual(scopeLog, [['runtime.agent.execution_config.write']]);
  assert.equal(snapshot.revision, 4);
  const request = requests[0]!;
  assert.equal(request.expectedRevision, '3');
  assert.equal(request.context?.appId, 'nimi.test-app');
  assert.deepEqual(request.bindings, [
    {
      capability: 'text.generate',
      modelId: 'local/default',
      routePolicy: RoutePolicy.LOCAL,
      connectorId: '',
    },
    {
      capability: 'image.generate',
      modelId: 'gpt-image-1.5',
      routePolicy: RoutePolicy.CLOUD,
      connectorId: 'connector-1',
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

test('execution config upsert fails closed on invalid app input', async () => {
  const module = createModule({
    async upsertAgentExecutionConfig() {
      throw new Error('must not reach runtime');
    },
  });

  const invalidInputs: Array<Parameters<NimiRuntimeAgentExecutionConfigModule['upsert']>[0]> = [
    // Removing the required text.generate binding is invalid before dispatch.
    {
      expectedRevision: 3,
      bindings: { 'image.generate': { route: 'cloud', modelId: 'gpt-image-1.5' } },
    },
    // Empty binding maps are invalid.
    { expectedRevision: 3, bindings: {} },
    // Unknown route values fail closed instead of defaulting.
    {
      expectedRevision: 3,
      bindings: { 'text.generate': { route: 'edge' as 'local', modelId: 'local/default' } },
    },
    // targetRef kind must match the declared route.
    {
      expectedRevision: 3,
      bindings: {
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
      },
    },
  ];
  for (const input of invalidInputs) {
    await assert.rejects(module.upsert(input), (error: { readonly reasonCode?: string }) => {
      assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_EXECUTION_CONFIG_INPUT_INVALID');
      return true;
    });
  }

  await assert.rejects(module.upsert({
    expectedRevision: 0,
    bindings: { 'text.generate': { route: 'local', modelId: 'local/default' } },
  }), (error: { readonly reasonCode?: string }) => {
    assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_EXECUTION_CONFIG_INPUT_INVALID');
    return true;
  });
});

test('execution config upsert projects revision conflicts as typed concurrent modification', async () => {
  const module = createModule({
    async upsertAgentExecutionConfig() {
      const error = new Error(
        'execution config concurrent modification: expected_revision=2 committed_revision=3; re-read the committed config and retry',
      ) as Error & { details?: Record<string, unknown> };
      error.details = { grpcCode: 10, grpcDetails: '' };
      throw error;
    },
  });

  await assert.rejects(module.upsert({
    expectedRevision: 2,
    bindings: { 'text.generate': { route: 'local', modelId: 'local/default' } },
  }), (error: { readonly reasonCode?: string; readonly actionHint?: string; readonly details?: Record<string, unknown> }) => {
    assert.equal(error.reasonCode, 'RUNTIME_AGENT_EXECUTION_CONFIG_CONCURRENT_MODIFICATION');
    assert.equal(error.actionHint, 'reload_committed_execution_config_and_retry');
    assert.equal(error.details?.expectedRevision, '2');
    return true;
  });
});

test('execution config upsert re-throws non-conflict runtime failures unchanged', async () => {
  const module = createModule({
    async upsertAgentExecutionConfig() {
      const error = new Error('execution config must retain the required text.generate binding') as Error & {
        reasonCode?: string;
        details?: Record<string, unknown>;
      };
      error.reasonCode = 'RUNTIME_GRPC_INVALID_ARGUMENT';
      error.details = { grpcCode: 3 };
      throw error;
    },
  });

  await assert.rejects(module.upsert({
    expectedRevision: 3,
    bindings: { 'text.generate': { route: 'local', modelId: 'local/default' } },
  }), (error: { readonly reasonCode?: string }) => {
    assert.equal(error.reasonCode, 'RUNTIME_GRPC_INVALID_ARGUMENT');
    return true;
  });
});

test('execution readiness projects typed states and fails closed on unknown states', async () => {
  const requests: GetAgentExecutionReadinessRequest[] = [];
  const module = createModule({
    async getAgentExecutionReadiness(request) {
      requests.push(request);
      return {
        snapshot: {
          configRevision: '3',
          capabilities: [
            {
              capability: 'text.generate',
              state: AgentExecutionReadinessState.READY,
              reasonCode: '',
              probedAt: { seconds: '1700000000', nanos: 0 },
            },
            {
              capability: 'image.generate',
              state: AgentExecutionReadinessState.NOT_CONFIGURED,
              reasonCode: '',
              probedAt: { seconds: '1700000000', nanos: 0 },
            },
            {
              capability: 'audio.synthesize',
              state: AgentExecutionReadinessState.NOT_CONFIGURED,
              reasonCode: '',
              probedAt: { seconds: '1700000000', nanos: 0 },
            },
          ],
        },
      };
    },
  });

  const readiness = await module.readiness();
  assert.equal(requests[0]?.context?.appId, 'nimi.test-app');
  assert.equal(readiness.configRevision, 3);
  assert.deepEqual(readiness.capabilities.map((entry) => [entry.capability, entry.state]), [
    ['text.generate', 'ready'],
    ['image.generate', 'not_configured'],
    ['audio.synthesize', 'not_configured'],
  ]);
  assert.equal(readiness.capabilities[0]?.probedAt, new Date(1700000000000).toISOString());

  const unknownState = createModule({
    async getAgentExecutionReadiness() {
      return {
        snapshot: {
          configRevision: '3',
          capabilities: [{
            capability: 'text.generate',
            state: 99 as AgentExecutionReadinessState,
            reasonCode: '',
            probedAt: undefined,
          }],
        },
      };
    },
  });
  await assert.rejects(unknownState.readiness(), (error: { readonly reasonCode?: string }) => {
    assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_EXECUTION_CONFIG_RESPONSE_INVALID');
    return true;
  });
});

test('subscribeReadiness projects the server stream and honors early return', async () => {
  const requests: SubscribeAgentExecutionReadinessRequest[] = [];
  const scopeLog: string[][] = [];
  let streamClosed = false;
  const snapshots: AgentExecutionReadinessSnapshot[] = [
    {
      configRevision: '1',
      capabilities: [{
        capability: 'text.generate',
        state: AgentExecutionReadinessState.READY,
        reasonCode: '',
        probedAt: { seconds: '1700000000', nanos: 0 },
      }],
    },
    {
      configRevision: '2',
      capabilities: [{
        capability: 'image.generate',
        state: AgentExecutionReadinessState.UNAVAILABLE,
        reasonCode: 'connector_missing',
        probedAt: { seconds: '1700000100', nanos: 0 },
      }],
    },
  ];
  const module = createModule({
    subscribeAgentExecutionReadiness(request: SubscribeAgentExecutionReadinessRequest, _options?: RuntimeTypedCallOptions) {
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
  const stream = module.subscribeReadiness();
  assert.equal(requests.length, 0, 'stream must not open before the first pull');
  for await (const snapshot of stream) {
    seen.push([
      snapshot.configRevision,
      snapshot.capabilities[0]!.capability,
      snapshot.capabilities[0]!.state,
    ]);
  }
  assert.deepEqual(scopeLog, [['runtime.agent.execution_config.read']]);
  assert.equal(requests[0]?.context?.subjectUserId, 'user-1');
  assert.deepEqual(seen, [
    [1, 'text.generate', 'ready'],
    [2, 'image.generate', 'unavailable'],
  ]);

  // Early return closes the underlying server stream.
  streamClosed = false;
  const second = module.subscribeReadiness()[Symbol.asyncIterator]();
  const first = await second.next();
  assert.equal(first.done, false);
  await second.return?.();
  assert.equal(streamClosed, true);
});

test('execution config fails closed when the agent surface lacks the projection', async () => {
  const module = createModule({});
  await assert.rejects(module.get(), (error: { readonly reasonCode?: string }) => {
    assert.equal(error.reasonCode, 'SDK_RUNTIME_AGENT_EXECUTION_CONFIG_SURFACE_REQUIRED');
    return true;
  });
});
