import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentLifecycleStatus,
  type GetAgentCanonicalMemoryBankStatusRequest,
  type GetAgentRequest,
  type InitializeAgentRequest,
  type OpenConversationAnchorRequest,
  type QueryAgentMemoryRequest,
  type RuntimeTypedCallOptions,
  type SendAppMessageRequest,
} from '../../core-generated/runtime-typed-client';
import { createNimiRuntimeAgentClient } from './runtime-client';

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
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
  };

  await client.ensureInitialized(identity);
  await client.openConversation(identity);
  await client.sendTurn({
    ...identity,
    conversationAnchorId: 'anchor-1',
    executionBindings: {
      'text.generate': { route: 'local', modelId: 'local-model' },
    },
    messages: [{ role: 'user', content: 'hello' }],
  });
  await client.queryMemory({ ...identity, query: 'hello', limit: 3 });
  await client.getCanonicalMemoryStatus('local-agent:user-1:agent-1');

  assert.deepEqual(calls.map((call) => call.method), [
    'getAgent',
    'openConversationAnchor',
    'sendAppMessage',
    'queryAgentMemory',
    'getAgentCanonicalMemoryBankStatus',
  ]);
  assert.equal((calls[1]?.request as OpenConversationAnchorRequest).context?.appId, 'desktop');
  assert.equal(calls[1]?.options?.metadata?.scopes, 'runtime.agent.write');
  assert.equal((calls[2]?.request as SendAppMessageRequest).toAppId, 'runtime.agent');
  assert.equal((calls[2]?.request as SendAppMessageRequest).messageType, 'runtime.agent.turn.request');
  assert.equal(calls[2]?.options?.metadata?.scopes, 'runtime.agent.turn.write');
  assert.equal((calls[3]?.request as QueryAgentMemoryRequest).agentId, 'local-agent:user-1:agent-1');
  assert.equal(calls[3]?.options?.metadata?.scopes, 'runtime.agent.read');
});

async function* emptyAsyncIterable<T>(): AsyncIterable<T> {
  return;
}
