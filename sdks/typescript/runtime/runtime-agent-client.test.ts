import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentLifecycleStatus,
  type GetAgentCanonicalMemoryBankStatusRequest,
  type GetAgentRequest,
  type InitializeAgentRequest,
  type ListAgentsRequest,
  type OpenConversationAnchorRequest,
  type QueryAgentMemoryRequest,
  type RuntimeTypedCallOptions,
  type SendAppMessageRequest,
} from '../core-generated/runtime-typed-client';
import { createNimiRuntimeAgentClient } from './runtime-agent-client';
import { sourceContextStatus as rawSourceContextStatus } from './runtime-agent-helpers.test-helper';
import {
  AgentLocalSourceCoverageSection,
  AgentLocalSourceCoverageState,
} from '../core-generated/runtime-typed-client';
import { fromNimiRuntimeProtoStruct } from './runtime-agent-values';

function sourceContextStatus(input: Parameters<typeof rawSourceContextStatus>[0]) {
  const sourceSections = input.kind === 'realmPersona'
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
      ...(input.kind === 'realmPersona' ? [] : [AgentLocalSourceCoverageSection.BOUND_ENTITY]),
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

const SOURCE_CONTENT_HASH = 'a'.repeat(64);

test('runtime agent client rejects a public Runtime grants fallback before invoking it', () => {
  let publicGrantCalls = 0;

  assert.throws(
    () => createNimiRuntimeAgentClient({
      runtime: {
        appId: 'desktop',
        auth: {},
        grants: {
          async authorizeExternalPrincipal() {
            publicGrantCalls += 1;
            return { tokenId: 'public-token', secret: 'public-secret' };
          },
        },
        agents: {},
        appMessages: {},
      } as never,
      getSubjectUserId: () => 'user-1',
    }),
    (error: unknown) =>
      (error as { readonly reasonCode?: string }).reasonCode === 'SDK_RUNTIME_AGENT_AUTH_REQUIRED',
  );

  assert.equal(publicGrantCalls, 0);
});

test('runtime agent client composes RuntimeAgentService and reserved turn seam as the owner path', async () => {
  const calls: Array<{
    readonly method: string;
    readonly request: unknown;
    readonly options?: RuntimeTypedCallOptions;
  }> = [];
  const runtime = {
    auth: {
      async registerApp() {
        return { accepted: true };
      },
    },
    appAuth: {
      async authorizeExternalPrincipal() {
        return { tokenId: 'token-1', secret: 'secret-1' };
      },
    },
    agents: {
      async getAgent(request: GetAgentRequest, options?: RuntimeTypedCallOptions) {
        calls.push({ method: 'getAgent', request, options });
        return { agent: { lifecycleStatus: AgentLifecycleStatus.ACTIVE } };
      },
      async initializeAgent(request: InitializeAgentRequest, options?: RuntimeTypedCallOptions) {
        calls.push({ method: 'initializeAgent', request, options });
        return {};
      },
      async terminateAgent() {
        return {};
      },
      async openConversationAnchor(request: OpenConversationAnchorRequest, options?: RuntimeTypedCallOptions) {
        calls.push({ method: 'openConversationAnchor', request, options });
        return {
          snapshot: {
            anchor: {
              conversationAnchorId: 'anchor-1',
              agentId: 'local-agent:test-user-1-agent-1',
              subjectUserId: 'user-1',
              status: 1,
              lastTurnId: '',
              lastMessageId: '',
              localAgentRef: 'local-agent:test-user-1-agent-1',
              ownerUserId: 'user-1',
              runtimeSourceRef: 'agent-1',
            },
            activeTurnId: '',
            activeStreamId: '',
          },
        };
      },
      async getPublicChatSessionSnapshot() {
        return { snapshot: {} };
      },
      subscribeAgentEvents() {
        return emptyAsyncIterable();
      },
      async queryAgentMemory(request: QueryAgentMemoryRequest, options?: RuntimeTypedCallOptions) {
        calls.push({ method: 'queryAgentMemory', request, options });
        return { memories: [] };
      },
      async writeAgentMemory() {
        return { accepted: [], rejected: [] };
      },
      async getAgentCanonicalMemoryBankStatus(
        request: GetAgentCanonicalMemoryBankStatusRequest,
        options?: RuntimeTypedCallOptions,
      ) {
        calls.push({ method: 'getAgentCanonicalMemoryBankStatus', request, options });
        return { status: { mode: 1 } };
      },
      async requestAgentCanonicalMemoryBankBind() {
        return { status: { mode: 1 } };
      },
    },
    appMessages: {
      async sendAppMessage(request: SendAppMessageRequest, options?: RuntimeTypedCallOptions) {
        calls.push({ method: 'sendAppMessage', request, options });
        return { accepted: true, messageId: 'message-1' };
      },
      subscribeAppMessages() {
        return emptyAsyncIterable();
      },
    },
  };
  const client = createNimiRuntimeAgentClient({
    runtime,
    appId: 'desktop',
    getSubjectUserId: () => 'user-1',
    withScopes: async (scopes, operation) => operation({ metadata: { scopes: scopes.join(' ') } }),
  });
  const identity = {
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:test-user-1-agent-1',
  };

  await client.ensureInitialized(identity);
  await client.openConversation(identity);
  await client.sendTurn({
    ...identity,
    conversationAnchorId: 'anchor-1',
    messages: [{ role: 'user', content: 'hello' }],
  });
  await client.queryMemory({ ...identity, query: 'hello', limit: 3 });
  await client.getCanonicalMemoryStatus(identity);

  assert.deepEqual(calls.map((call) => call.method), [
    'getAgent',
    'openConversationAnchor',
    'sendAppMessage',
    'queryAgentMemory',
    'getAgentCanonicalMemoryBankStatus',
  ]);
  assert.equal((calls[1]?.request as OpenConversationAnchorRequest).context?.appId, 'desktop');
  assert.equal((calls[1]?.request as OpenConversationAnchorRequest).agentId, '');
  assert.equal((calls[1]?.request as OpenConversationAnchorRequest).localAgentRef, identity.localAgentRef);
  assert.equal(calls[1]?.options?.metadata?.scopes, 'runtime.agent.write');
  assert.equal((calls[2]?.request as SendAppMessageRequest).toAppId, 'runtime.agent');
  assert.equal((calls[2]?.request as SendAppMessageRequest).messageType, 'runtime.agent.turn.request');
  assert.equal(calls[2]?.options?.metadata?.scopes, 'runtime.agent.turn.write');
  // Atomic hard cut: turn requests never carry execution_bindings; the
  // runtime resolves the committed Runtime Agent AI Config (K-AGCORE-147).
  assert.equal(
    'execution_bindings' in fromNimiRuntimeProtoStruct((calls[2]?.request as SendAppMessageRequest).payload),
    false,
  );
  assert.equal((calls[3]?.request as QueryAgentMemoryRequest).agentId, identity.localAgentRef);
  assert.equal(calls[3]?.options?.metadata?.scopes, 'runtime.agent.read');
});

test('runtime agent client discovers existing LocalAgents by Runtime inventory provenance', async () => {
  const calls: Array<{
    readonly method: string;
    readonly request?: unknown;
    readonly options?: RuntimeTypedCallOptions;
  }> = [];
  const runtimeSourceRef = `runtime-source:worldCharacter:world-1:source-1:${SOURCE_CONTENT_HASH}`;
  const client = createNimiRuntimeAgentClient({
    runtime: {
      auth: {
        async registerApp() {
          return { accepted: true };
        },
      },
      appAuth: {
        async authorizeExternalPrincipal() {
          return { tokenId: 'token-1', secret: 'secret-1' };
        },
      },
      agents: {
        async getAgent() {
          throw new Error('discoverBySource must not require caller localAgentRef');
        },
        async initializeAgent() {
          throw new Error('discoverBySource must not materialize');
        },
        async listAgents(request: ListAgentsRequest, options?: RuntimeTypedCallOptions) {
          calls.push({ method: 'listAgents', request, options });
          return {
            agents: [
              {
                agentId: 'local-agent:runtime-owned-existing',
                localAgentRef: 'local-agent:runtime-owned-existing',
                ownerUserId: 'user-1',
                runtimeSourceRef,
                displayName: 'Existing Source Agent',
                lifecycleStatus: AgentLifecycleStatus.ACTIVE,
                sourceContextStatus: sourceContextStatus({
                  localAgentRef: 'local-agent:runtime-owned-existing',
                  worldId: 'world-1',
                  sourceId: 'source-1',
                  sourceContentHash: SOURCE_CONTENT_HASH,
                }),
              },
            ],
            nextPageToken: '',
          };
        },
        async terminateAgent() {
          return {};
        },
        async openConversationAnchor() {
          throw new Error('unused');
        },
        async getPublicChatSessionSnapshot() {
          return { snapshot: {} };
        },
        subscribeAgentEvents() {
          return emptyAsyncIterable();
        },
        async queryAgentMemory() {
          return { memories: [] };
        },
        async writeAgentMemory() {
          return { accepted: [], rejected: [] };
        },
        async getAgentCanonicalMemoryBankStatus() {
          return { status: { mode: 1 } };
        },
        async requestAgentCanonicalMemoryBankBind() {
          return { status: { mode: 1 } };
        },
      },
      appMessages: {
        async sendAppMessage() {
          return { accepted: true, messageId: 'message-1' };
        },
        subscribeAppMessages() {
          return emptyAsyncIterable();
        },
      },
    },
    appId: 'zhiyu',
    getSubjectUserId: () => 'user-1',
    withScopes: async (scopes, operation) => operation({ metadata: { scopes: scopes.join(' ') } }),
  });

  const discovered = await client.discoverBySource({
    ownerUserId: 'user-1',
    runtimeSourceRef,
    sourceRef: {
      kind: 'worldCharacter',
      worldId: 'world-1',
      sourceId: 'source-1',
      sourceContentHash: SOURCE_CONTENT_HASH,
    },
  });

  assert.deepEqual(discovered.map((agent) => agent.localAgentRef), ['local-agent:runtime-owned-existing']);
  assert.deepEqual(calls.map((call) => call.method), ['listAgents']);
  assert.equal(calls[0]?.options?.metadata?.scopes, 'runtime.agent.read');
});

test('runtime agent client lists existing LocalAgents from Runtime inventory', async () => {
  const calls: Array<{
    readonly method: string;
    readonly request?: unknown;
    readonly options?: RuntimeTypedCallOptions;
  }> = [];
  const client = createNimiRuntimeAgentClient({
    runtime: {
      auth: {
        async registerApp() {
          return { accepted: true };
        },
      },
      appAuth: {
        async authorizeExternalPrincipal() {
          return { tokenId: 'token-1', secret: 'secret-1' };
        },
      },
      agents: {
        async getAgent() {
          throw new Error('listLocalAgents must not require caller localAgentRef');
        },
        async initializeAgent() {
          throw new Error('listLocalAgents must not materialize');
        },
        async listAgents(request: ListAgentsRequest, options?: RuntimeTypedCallOptions) {
          calls.push({ method: 'listAgents', request, options });
          return {
            agents: [
              {
                agentId: 'local-agent:runtime-owned-existing',
                localAgentRef: 'local-agent:runtime-owned-existing',
                ownerUserId: 'user-1',
                runtimeSourceRef: `runtime-source:worldCharacter:world-1:source-1:${SOURCE_CONTENT_HASH}`,
                displayName: 'Existing Source Agent',
                lifecycleStatus: AgentLifecycleStatus.ACTIVE,
                sourceContextStatus: sourceContextStatus({
                  localAgentRef: 'local-agent:runtime-owned-existing',
                  worldId: 'world-1',
                  sourceId: 'source-1',
                  sourceContentHash: SOURCE_CONTENT_HASH,
                }),
              },
              {
                agentId: 'local-agent:other-owner',
                localAgentRef: 'local-agent:other-owner',
                ownerUserId: 'other-user',
                runtimeSourceRef: `runtime-source:worldCharacter:world-1:source-1:${SOURCE_CONTENT_HASH}`,
                lifecycleStatus: AgentLifecycleStatus.ACTIVE,
              },
            ],
            nextPageToken: '',
          };
        },
        async terminateAgent() {
          return {};
        },
        async openConversationAnchor() {
          throw new Error('unused');
        },
        async getPublicChatSessionSnapshot() {
          return { snapshot: {} };
        },
        subscribeAgentEvents() {
          return emptyAsyncIterable();
        },
        async queryAgentMemory() {
          return { memories: [] };
        },
        async writeAgentMemory() {
          return { accepted: [], rejected: [] };
        },
        async getAgentCanonicalMemoryBankStatus() {
          return { status: { mode: 1 } };
        },
        async requestAgentCanonicalMemoryBankBind() {
          return { status: { mode: 1 } };
        },
      },
      appMessages: {
        async sendAppMessage() {
          return { accepted: true, messageId: 'message-1' };
        },
        subscribeAppMessages() {
          return emptyAsyncIterable();
        },
      },
    },
    appId: 'zhiyu',
    getSubjectUserId: () => 'user-1',
    withScopes: async (scopes, operation) => operation({ metadata: { scopes: scopes.join(' ') } }),
  });

  const listed = await client.listLocalAgents({ ownerUserId: 'user-1' });

  assert.deepEqual(listed.map((agent) => agent.localAgentRef), ['local-agent:runtime-owned-existing']);
  assert.deepEqual(calls.map((call) => call.method), ['listAgents']);
  assert.equal(calls[0]?.options?.metadata?.scopes, 'runtime.agent.read');
});

async function* emptyAsyncIterable<T>(): AsyncIterable<T> {
  return;
}
