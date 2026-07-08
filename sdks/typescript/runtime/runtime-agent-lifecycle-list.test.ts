import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import {
  AgentLifecycleStatus,
} from '../core-generated/runtime-typed-client';
import {
  createNimiHostRuntimeAgentLifecycleSurface,
} from './runtime-agent-lifecycle';
import { toNimiRuntimeProtoStruct } from './runtime-agent-values';

const OWNER_USER_ID = 'user-1';

test('Runtime Agent lifecycle lists active LocalAgents without source selection', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown; readonly options?: RuntimeTypedCallOptions }> = [];
  const surface = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: () => ({
      appId: 'desktop',
      auth: protectedAuth(),
      appAuth: protectedAppAuth(),
      agent: {
        async getAgent() {
          throw new Error('listLocalAgents must not require caller localAgentRef');
        },
        async initializeAgent() {
          throw new Error('listLocalAgents must not materialize');
        },
        async listAgents(request: unknown, options?: RuntimeTypedCallOptions) {
          calls.push({ method: 'listAgents', request, options });
          return {
            agents: [
              {
                agentId: 'local-agent:runtime-owned-existing',
                localAgentRef: 'local-agent:runtime-owned-existing',
                ownerUserId: OWNER_USER_ID,
                runtimeSourceRef: 'runtime-source:worldCharacter:world-1:source-1:hash-1',
                displayName: 'Existing Source Agent',
                lifecycleStatus: AgentLifecycleStatus.ACTIVE,
                metadata: toNimiRuntimeProtoStruct({
                  sourceMaterialization: {
                    sourceKind: 'worldCharacter',
                    sourceWorldId: 'world-1',
                    sourceWorldName: '唐代文人世界',
                    sourceId: 'source-1',
                    sourceContentHash: 'hash-1',
                  },
                }),
              },
              {
                agentId: 'local-agent:inactive',
                localAgentRef: 'local-agent:inactive',
                ownerUserId: OWNER_USER_ID,
                runtimeSourceRef: 'runtime-source:worldCharacter:world-1:source-2:hash-1',
                lifecycleStatus: AgentLifecycleStatus.TERMINATED,
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
      },
    }),
    getSubjectUserId: () => OWNER_USER_ID,
    withScopes: async (scopes, operation) => operation({ metadata: { scopes: scopes.join(' ') } }),
  });

  const listed = await surface.listLocalAgents({ ownerUserId: OWNER_USER_ID });

  assert.deepEqual(listed.map((agent) => agent.localAgentRef), ['local-agent:runtime-owned-existing']);
  assert.equal(listed[0]?.sourceKind, 'worldCharacter');
  assert.equal(listed[0]?.sourceWorldId, 'world-1');
  assert.equal(listed[0]?.sourceWorldName, '唐代文人世界');
  assert.equal(listed[0]?.sourceId, 'source-1');
  assert.equal(listed[0]?.sourceContentHash, 'hash-1');
  assert.deepEqual(calls.map((call) => call.method), ['listAgents']);
  assert.equal(calls[0]?.options?.metadata?.scopes, 'runtime.agent.read');
});

function protectedAuth() {
  return {
    async registerApp() {
      return { accepted: true };
    },
  };
}

function protectedAppAuth() {
  return {
    async authorizeExternalPrincipal() {
      return { tokenId: 'token-1', secret: 'secret-1' };
    },
  };
}
