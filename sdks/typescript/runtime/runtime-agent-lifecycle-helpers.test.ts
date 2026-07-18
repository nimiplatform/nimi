import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentEventType,
  AgentLifecycleStatus,
  AgentPresentationEventFamily,
  CancellableStream,
  LOCAL_AGENT_REF,
  OWNER_USER_ID,
  RUNTIME_SOURCE_REF,
  RuntimeGeneratedReasonCode,
  SdkReasonCode,
  VoiceOutputMode,
  VoicePlaybackState,
  agentIdentity,
  buildNimiRuntimeAgentTurnPayload,
  createNimiError,
  createNimiHostRuntimeAgentLifecycleSurface,
  createNimiRuntimeAgentTurnsModule,
  createNimiRuntimeAgentVoiceModule,
  fromNimiRuntimeProtoStruct,
  protectedAuth,
  sourceContextStatus as rawSourceContextStatus,
  toNimiRuntimeProtoStruct,
  toNimiRuntimeTimestamp,
  trackedPendingStream,
  voicePlaybackRequestedAgentEvent,
  type AgentEvent,
  type AgentVoiceStreamEvent,
  type AppMessageEvent,
  type GetAgentRequest,
  type InitializeAgentRequest,
  type InterruptAgentVoicePlaybackRequest,
  type InterruptAgentVoicePlaybackResponse,
  type ReadArtifactBytesRequest,
  type ReadArtifactBytesResponse,
  type RuntimeTypedCallOptions,
  type SendAppMessageRequest,
  type SubscribeAgentEventsRequest,
  type SubscribeAgentVoiceStreamRequest,
  type SubscribeAppMessagesRequest,
  type TerminateAgentRequest,
} from './runtime-agent-helpers.test-helper';
import {
  AgentLocalSourceCoverageSection,
  AgentLocalSourceCoverageState,
} from '../core-generated/runtime-typed-client';

function sourceContextStatus(input: Parameters<typeof rawSourceContextStatus>[0]) {
  const sourceSections = input.kind === 'personaCharacter'
    ? [
        AgentLocalSourceCoverageSection.IDENTITY,
        AgentLocalSourceCoverageSection.PRESENTATION,
        AgentLocalSourceCoverageSection.INTERACTION_PROFILE,
        AgentLocalSourceCoverageSection.ASSETS,
        AgentLocalSourceCoverageSection.AUTHORING,
        AgentLocalSourceCoverageSection.PERSONA_STYLE,
        AgentLocalSourceCoverageSection.CONTENT_PROFILE,
      ]
    : [
        AgentLocalSourceCoverageSection.IDENTITY,
        AgentLocalSourceCoverageSection.PRESENTATION,
        AgentLocalSourceCoverageSection.PLACEMENT,
        AgentLocalSourceCoverageSection.BIOGRAPHY,
        AgentLocalSourceCoverageSection.PSYCHOLOGY,
        AgentLocalSourceCoverageSection.KNOWLEDGE,
        AgentLocalSourceCoverageSection.RELATIONSHIPS,
        AgentLocalSourceCoverageSection.CAPABILITIES,
        AgentLocalSourceCoverageSection.INTERACTION_PROFILE,
        AgentLocalSourceCoverageSection.ASSETS,
        AgentLocalSourceCoverageSection.AUTHORING,
      ];
  return {
    ...rawSourceContextStatus(input),
    coverageSections: [
      ...sourceSections,
      AgentLocalSourceCoverageSection.WORLD_CORE,
      ...(input.kind === 'personaCharacter' ? [] : [AgentLocalSourceCoverageSection.BOUND_ENTITY]),
      AgentLocalSourceCoverageSection.DEPENDENCY_CLOSURE,
    ].map((section) => ({
      section,
      state: AgentLocalSourceCoverageState.COMPLETE,
      requiredCount: 1,
      resolvedCount: 1,
      omittedCount: 0,
    })),
  };
}

const SOURCE_HASH = 'a'.repeat(64);

test('Runtime Agent lifecycle surface initializes idempotently and terminates through scoped Runtime calls', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown; readonly options?: RuntimeTypedCallOptions }> = [];
  let lifecycleStatus = AgentLifecycleStatus.ACTIVE;
  const surface = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: () => ({
      appId: 'desktop',
      auth: protectedAuth(),
      agent: {
        async getAgent(request: GetAgentRequest, options?: RuntimeTypedCallOptions) {
          calls.push({ method: 'getAgent', request, options });
          if (lifecycleStatus < 0) {
            throw createNimiError({
              message: 'not found',
              reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
              actionHint: 'check_runtime_agent',
              source: 'runtime',
            });
          }
          return { agent: { lifecycleStatus } };
        },
        async initializeAgent(request: InitializeAgentRequest, options?: RuntimeTypedCallOptions) {
          calls.push({ method: 'initializeAgent', request, options });
          return {
            agent: {
              agentId: LOCAL_AGENT_REF,
              localAgentRef: LOCAL_AGENT_REF,
              ownerUserId: OWNER_USER_ID,
              runtimeSourceRef: RUNTIME_SOURCE_REF,
              displayName: 'Agent One',
              lifecycleStatus: AgentLifecycleStatus.ACTIVE,
            },
          };
        },
        async terminateAgent(request: TerminateAgentRequest, options?: RuntimeTypedCallOptions) {
          calls.push({ method: 'terminateAgent', request, options });
          return {};
        },
      },
    }),
    getSubjectUserId: () => 'user-1',
    withScopes: async (scopes, operation) => operation({ metadata: { scopes: scopes.join(' ') } }),
  });

  await surface.ensureLocalAgentInitialized(agentIdentity());
  assert.deepEqual(calls.map((call) => call.method), ['getAgent']);

  lifecycleStatus = -1;
  await surface.ensureLocalAgentInitialized({
    ...agentIdentity(),
    displayName: 'Agent One',
    worldId: 'world-1',
  });
  assert.deepEqual(calls.map((call) => call.method), ['getAgent', 'getAgent', 'initializeAgent']);
  assert.equal((calls[2]?.request as InitializeAgentRequest).displayName, 'Agent One');
  assert.equal((calls[2]?.request as InitializeAgentRequest).worldId, 'world-1');
  assert.equal((calls[2]?.request as InitializeAgentRequest).metadata, undefined);
  assert.equal(calls[2]?.options?.metadata?.scopes, 'runtime.agent.admin');

  await surface.terminateLocalAgent({ ...agentIdentity(), reason: 'owner-requested' });
  assert.equal(calls[3]?.method, 'terminateAgent');
  assert.equal((calls[3]?.request as TerminateAgentRequest).agentId, LOCAL_AGENT_REF);
  assert.equal((calls[3]?.request as TerminateAgentRequest).reason, 'owner-requested');
});

test('Runtime Agent lifecycle materialization returns Runtime-generated localAgentRef', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown; readonly options?: RuntimeTypedCallOptions }> = [];
  const surface = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: () => ({
      appId: 'desktop',
      auth: protectedAuth(),
      agent: {
        async getAgent() {
          throw new Error('initializeLocalAgent must not read by caller localAgentRef');
        },
        async initializeAgent(request: InitializeAgentRequest, options?: RuntimeTypedCallOptions) {
          calls.push({ method: 'initializeAgent', request, options });
          return {
            agent: {
              agentId: 'local-agent:runtime-generated-1',
              localAgentRef: 'local-agent:runtime-generated-1',
              ownerUserId: OWNER_USER_ID,
              runtimeSourceRef: RUNTIME_SOURCE_REF,
              displayName: 'Runtime Generated Agent',
              lifecycleStatus: AgentLifecycleStatus.ACTIVE,
            },
          };
        },
        async terminateAgent() {
          return {};
        },
      },
    }),
    getSubjectUserId: () => 'user-1',
    withScopes: async (scopes, operation) => operation({ metadata: { scopes: scopes.join(' ') } }),
  });

  const result = await surface.initializeLocalAgent({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    displayName: 'Runtime Generated Agent',
  });

  assert.equal(result.localAgentRef, 'local-agent:runtime-generated-1');
  assert.deepEqual(calls.map((call) => call.method), ['initializeAgent']);
  const request = calls[0]?.request as InitializeAgentRequest;
  assert.equal(request.localAgentRef, '');
  assert.equal(request.context?.localAgentRef, '');
  assert.equal(request.ownerUserId, OWNER_USER_ID);
  assert.equal(request.runtimeSourceRef, RUNTIME_SOURCE_REF);
  assert.equal(calls[0]?.options?.metadata?.scopes, 'runtime.agent.admin');
});

test('Runtime Agent lifecycle rejects initialize responses without Runtime-owned localAgentRef', async () => {
  const surface = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: () => ({
      appId: 'desktop',
      auth: protectedAuth(),
      agent: {
        async getAgent() {
          throw new Error('initializeLocalAgent must not read before initialize');
        },
        async initializeAgent() {
          return {
            agent: {
              ownerUserId: OWNER_USER_ID,
              runtimeSourceRef: RUNTIME_SOURCE_REF,
              displayName: 'Missing Runtime Identity',
              lifecycleStatus: AgentLifecycleStatus.ACTIVE,
            },
          };
        },
        async terminateAgent() {
          return {};
        },
      },
    }),
    getSubjectUserId: () => 'user-1',
    withScopes: async (_scopes, operation) => operation({}),
  });

  await assert.rejects(
    () => surface.initializeLocalAgent({
      localAgentRef: 'local-agent:caller-authored-ref',
      ownerUserId: OWNER_USER_ID,
      runtimeSourceRef: RUNTIME_SOURCE_REF,
      displayName: 'Missing Runtime Identity',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_AGENT_RESPONSE_INVALID',
  );
});

test('Runtime Agent lifecycle fails closed instead of synthesizing AlreadyExists success', async () => {
  const surface = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: () => ({
      appId: 'desktop',
      auth: protectedAuth(),
      agent: {
        async getAgent() {
          throw new Error('initializeLocalAgent must not read before initialize');
        },
        async initializeAgent() {
          throw createNimiError({
            message: 'local agent already exists',
            reasonCode: 'RUNTIME_GRPC_ALREADY_EXISTS',
            actionHint: 'read_runtime_owned_local_agent_projection',
            source: 'runtime',
          });
        },
        async terminateAgent() {
          return {};
        },
      },
    }),
    getSubjectUserId: () => 'user-1',
    withScopes: async (_scopes, operation) => operation({}),
  });

  await assert.rejects(
    () => surface.initializeLocalAgent({
      localAgentRef: 'local-agent:caller-authored-ref',
      ownerUserId: OWNER_USER_ID,
      runtimeSourceRef: RUNTIME_SOURCE_REF,
      displayName: 'Already Exists Agent',
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'RUNTIME_GRPC_ALREADY_EXISTS',
  );
});

test('Runtime Agent lifecycle discovers existing LocalAgents through Runtime inventory provenance', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown; readonly options?: RuntimeTypedCallOptions }> = [];
  const matchingLocalAgentRef = 'local-agent:runtime-owned-existing';
  const surface = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: () => ({
      appId: 'desktop',
      auth: protectedAuth(),
      agent: {
        async getAgent() {
          throw new Error('discoverLocalAgentsBySource must not require caller localAgentRef');
        },
        async initializeAgent() {
          throw new Error('discoverLocalAgentsBySource must not materialize');
        },
        async listAgents(request: unknown, options?: RuntimeTypedCallOptions) {
          calls.push({ method: 'listAgents', request, options });
          if ((request as { readonly pageToken?: string }).pageToken === 'page-2') {
            return {
              agents: [
                {
                  agentId: matchingLocalAgentRef,
                  localAgentRef: matchingLocalAgentRef,
                  ownerUserId: OWNER_USER_ID,
                  runtimeSourceRef: `runtime-source:worldCharacter:world-1:source-1:${SOURCE_HASH}`,
                  displayName: 'Existing Source Agent',
                  lifecycleStatus: AgentLifecycleStatus.ACTIVE,
                  sourceContextStatus: sourceContextStatus({
                    localAgentRef: matchingLocalAgentRef,
                    worldId: 'world-1',
                    sourceId: 'source-1',
                    sourceHash: SOURCE_HASH,
                  }),
                },
              ],
              nextPageToken: '',
            };
          }
          return {
            agents: [
              {
                agentId: 'local-agent:other-owner',
                localAgentRef: 'local-agent:other-owner',
                ownerUserId: 'other-user',
                runtimeSourceRef: `runtime-source:worldCharacter:world-1:source-1:${SOURCE_HASH}`,
                lifecycleStatus: AgentLifecycleStatus.ACTIVE,
              },
              {
                agentId: 'local-agent:stale-hash',
                localAgentRef: 'local-agent:stale-hash',
                ownerUserId: OWNER_USER_ID,
                runtimeSourceRef: 'runtime-source:worldCharacter:world-1:source-1:stale',
                lifecycleStatus: AgentLifecycleStatus.ACTIVE,
              },
            ],
            nextPageToken: 'page-2',
          };
        },
        async terminateAgent() {
          return {};
        },
      },
    }),
    getSubjectUserId: () => 'user-1',
    withScopes: async (scopes, operation) => operation({ metadata: { scopes: scopes.join(' ') } }),
  });

  const discovered = await surface.discoverLocalAgentsBySource({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: `runtime-source:worldCharacter:world-1:source-1:${SOURCE_HASH}`,
    sourceRef: {
      kind: 'worldCharacter',
      id: 'source-1',
      worldId: 'world-1',
      worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: 'entity-source-1' },
      sourceHash: SOURCE_HASH,
    },
  });

  assert.deepEqual(discovered.map((agent) => agent.localAgentRef), [matchingLocalAgentRef]);
  assert.deepEqual(calls.map((call) => call.method), ['listAgents', 'listAgents']);
  assert.deepEqual(calls.map((call) => (call.request as { readonly pageToken?: string }).pageToken), ['', 'page-2']);
  assert.equal(calls[1]?.options?.metadata?.scopes, 'runtime.agent.read');
});

test('Runtime Agent lifecycle discovers source provenance without caller runtimeSourceRef', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown; readonly options?: RuntimeTypedCallOptions }> = [];
  const matchingLocalAgentRef = 'local-agent:runtime-owned-source-only';
  const runtimeSourceRef = `runtime-source:worldCharacter:world-1:source-1:${SOURCE_HASH}`;
  const surface = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: () => ({
      appId: 'desktop',
      auth: protectedAuth(),
      agent: {
        async getAgent() {
          throw new Error('source provenance discovery must not require caller localAgentRef');
        },
        async initializeAgent() {
          throw new Error('source provenance discovery must not materialize');
        },
        async listAgents(request: unknown, options?: RuntimeTypedCallOptions) {
          calls.push({ method: 'listAgents', request, options });
          return {
            agents: [
              {
                agentId: matchingLocalAgentRef,
                localAgentRef: matchingLocalAgentRef,
                ownerUserId: OWNER_USER_ID,
                runtimeSourceRef,
                displayName: 'Existing Source Agent',
                lifecycleStatus: AgentLifecycleStatus.ACTIVE,
                sourceContextStatus: sourceContextStatus({
                  localAgentRef: matchingLocalAgentRef,
                  worldId: 'world-1',
                  sourceId: 'source-1',
                  sourceHash: SOURCE_HASH,
                }),
              },
            ],
            nextPageToken: '',
          };
        },
        async terminateAgent() {
          return {};
        },
      },
    }),
    getSubjectUserId: () => OWNER_USER_ID,
    withScopes: async (scopes, operation) => operation({ metadata: { scopes: scopes.join(' ') } }),
  });

  const discovered = await surface.discoverLocalAgentsBySource({
    ownerUserId: OWNER_USER_ID,
    sourceRef: {
      kind: 'worldCharacter',
      id: 'source-1',
      worldId: 'world-1',
      worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: 'entity-source-1' },
      sourceHash: SOURCE_HASH,
    },
  });

  assert.deepEqual(discovered.map((agent) => agent.localAgentRef), [matchingLocalAgentRef]);
  assert.equal(discovered[0]?.runtimeSourceRef, runtimeSourceRef);
  assert.deepEqual(calls.map((call) => call.method), ['listAgents']);
  assert.equal(calls[0]?.options?.metadata?.scopes, 'runtime.agent.read');
});
