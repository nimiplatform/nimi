import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentLifecycleStatus,
  OWNER_USER_ID,
  createNimiHostRuntimeAgentLifecycleSurface,
  protectedAuth,
  sourceContextStatus as rawSourceContextStatus,
  type RuntimeTypedCallOptions,
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
