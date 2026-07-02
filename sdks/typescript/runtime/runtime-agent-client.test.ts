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
import { fromNimiRuntimeProtoStruct, toNimiRuntimeProtoStruct } from './runtime-agent-values';

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
    grants: {
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
        return { snapshot: { conversationAnchorId: 'anchor-1' } };
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
    executionBindings: {
      'text.generate': {
        route: 'local',
        modelId: 'local-model',
        targetRef: {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'local-runtime:local-model',
        },
      },
    },
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
  assert.deepEqual(fromNimiRuntimeProtoStruct((calls[2]?.request as SendAppMessageRequest).payload).execution_bindings, {
    'text.generate': {
      route: 'local',
      model_id: 'local-model',
      target_ref: {
        localRuntime: {
          version: 'v2',
          profileBindingId: 'local-runtime:local-model',
        },
      },
    },
  });
  assert.equal((calls[3]?.request as QueryAgentMemoryRequest).agentId, identity.localAgentRef);
  assert.equal(calls[3]?.options?.metadata?.scopes, 'runtime.agent.read');
});

test('runtime agent client discovers existing LocalAgents by Runtime inventory provenance', async () => {
  const calls: Array<{
    readonly method: string;
    readonly request?: unknown;
    readonly options?: RuntimeTypedCallOptions;
  }> = [];
  const runtimeSourceRef = 'runtime-source:worldCharacter:world-1:source-1:hash-1';
  const client = createNimiRuntimeAgentClient({
    runtime: {
      auth: {
        async registerApp() {
          return { accepted: true };
        },
      },
      grants: {
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
                metadata: toNimiRuntimeProtoStruct({
                  sourceMaterialization: {
                    sourceKind: 'worldCharacter',
                    sourceWorldId: 'world-1',
                    sourceId: 'source-1',
                    sourceContentHash: 'hash-1',
                  },
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
      sourceContentHash: 'hash-1',
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
      grants: {
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
                runtimeSourceRef: 'runtime-source:worldCharacter:world-1:source-1:hash-1',
                displayName: 'Existing Source Agent',
                lifecycleStatus: AgentLifecycleStatus.ACTIVE,
                metadata: toNimiRuntimeProtoStruct({
                  sourceMaterialization: {
                    sourceKind: 'worldCharacter',
                    sourceWorldId: 'world-1',
                    sourceId: 'source-1',
                    sourceContentHash: 'hash-1',
                  },
                }),
              },
              {
                agentId: 'local-agent:other-owner',
                localAgentRef: 'local-agent:other-owner',
                ownerUserId: 'other-user',
                runtimeSourceRef: 'runtime-source:worldCharacter:world-1:source-1:hash-1',
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
