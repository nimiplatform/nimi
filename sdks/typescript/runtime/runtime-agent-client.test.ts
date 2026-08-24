import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentLifecycleStatus,
  type GetAgentCanonicalMemoryBankStatusRequest,
  type GetAgentRequest,
  type ListAgentsRequest,
  type ListAgentConversationSummariesRequest,
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

function sourceContextStatus(input: Parameters<typeof rawSourceContextStatus>[0]) {
  const sourceSections = [
    AgentLocalSourceCoverageSection.IDENTITY,
    AgentLocalSourceCoverageSection.PRESENTATION,
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

test('runtime agent client composes RuntimeAgentService and reserved turn seam as the owner path', async () => {
  const calls: Array<{
    readonly method: string;
    readonly request: unknown;
    readonly options?: RuntimeTypedCallOptions;
  }> = [];
  const runtime = {
    auth: {},
    agents: {
      async getAgent(request: GetAgentRequest, options?: RuntimeTypedCallOptions) {
        calls.push({ method: 'getAgent', request, options });
        return { agent: { lifecycleStatus: AgentLifecycleStatus.ACTIVE } };
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
      async listAgentConversationSummaries(
        request: ListAgentConversationSummariesRequest,
        options?: RuntimeTypedCallOptions,
      ) {
        calls.push({ method: 'listAgentConversationSummaries', request, options });
        return {
          summaries: [{
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
            title: '',
            lastMessageRole: 'assistant',
            lastMessageText: 'hello',
            lastMessageId: 'message-1',
            transcriptMessageCount: 2,
          }],
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

  await client.openConversation(identity);
  const summaries = await client.listConversationSummaries({
    ...identity,
    statusFilter: ['active'],
    pageSize: 2,
    pageToken: '',
  });
  await client.sendTurn({
    ...identity,
    conversationAnchorId: 'anchor-1',
    messages: [{ role: 'user', content: 'hello' }],
  });
  await client.queryMemory({ ...identity, query: 'hello', limit: 3 });
  await client.getCanonicalMemoryStatus(identity);

  assert.deepEqual(calls.map((call) => call.method), [
    'openConversationAnchor',
    'listAgentConversationSummaries',
    'sendAppMessage',
    'queryAgentMemory',
    'getAgentCanonicalMemoryBankStatus',
  ]);
  assert.equal((calls[0]?.request as OpenConversationAnchorRequest).context?.appId, 'desktop');
  assert.equal((calls[0]?.request as OpenConversationAnchorRequest).agentId, '');
  assert.equal((calls[0]?.request as OpenConversationAnchorRequest).localAgentRef, identity.localAgentRef);
  assert.equal(calls[0]?.options?.metadata?.scopes, 'runtime.agent.write');
  assert.equal(summaries.summaries[0]?.anchor?.conversationAnchorId, 'anchor-1');
  assert.equal((calls[1]?.request as ListAgentConversationSummariesRequest).agentId, identity.localAgentRef);
  assert.equal(calls[1]?.options?.metadata?.scopes, 'runtime.agent.read');
  assert.equal((calls[2]?.request as SendAppMessageRequest).toAppId, 'runtime.agent');
  assert.equal((calls[2]?.request as SendAppMessageRequest).messageType, 'runtime.agent.turn.request');
  assert.equal(calls[2]?.options?.metadata?.scopes, 'runtime.agent.turn.write');
  assert.equal((calls[3]?.request as QueryAgentMemoryRequest).agentId, identity.localAgentRef);
  assert.equal(calls[3]?.options?.metadata?.scopes, 'runtime.agent.read');
});

test('runtime agent client discovers existing LocalAgents by Runtime inventory provenance', async () => {
  const calls: Array<{
    readonly method: string;
    readonly request?: unknown;
    readonly options?: RuntimeTypedCallOptions;
  }> = [];
  const runtimeSourceRef = `runtime-source:worldCharacter:world-1:source-1:${SOURCE_HASH}`;
  const client = createNimiRuntimeAgentClient({
    runtime: {
      auth: {},
      agents: {
        async getAgent() {
          throw new Error('discoverBySource must not require caller localAgentRef');
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
      id: 'source-1',
      worldId: 'world-1',
      worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: 'entity-source-1' },
      sourceHash: SOURCE_HASH,
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
      auth: {},
      agents: {
        async getAgent() {
          throw new Error('listLocalAgents must not require caller localAgentRef');
        },
        async listAgents(request: ListAgentsRequest, options?: RuntimeTypedCallOptions) {
          calls.push({ method: 'listAgents', request, options });
          return {
            agents: [
              {
                agentId: 'local-agent:runtime-owned-existing',
                localAgentRef: 'local-agent:runtime-owned-existing',
                ownerUserId: 'user-1',
                runtimeSourceRef: `runtime-source:worldCharacter:world-1:source-1:${SOURCE_HASH}`,
                displayName: 'Existing Source Agent',
                lifecycleStatus: AgentLifecycleStatus.ACTIVE,
                sourceContextStatus: sourceContextStatus({
                  localAgentRef: 'local-agent:runtime-owned-existing',
                  worldId: 'world-1',
                  sourceId: 'source-1',
                  sourceHash: SOURCE_HASH,
                }),
              },
              {
                agentId: 'local-agent:other-owner',
                localAgentRef: 'local-agent:other-owner',
                ownerUserId: 'other-user',
                runtimeSourceRef: `runtime-source:worldCharacter:world-1:source-1:${SOURCE_HASH}`,
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
