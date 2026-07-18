import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import {
  AgentContextProjectionReasonCode,
  AgentLifecycleStatus,
  AgentLocalSourceContextSchemaVersion,
  AgentLocalSourceContextState,
  AgentLocalSourceCoverageSection,
  AgentLocalSourceCoverageState,
  AgentLocalSourceSnapshotSchemaVersion,
  CharacterSourceKindV3,
  WorldEntityRefKindV3,
} from '../core-generated/runtime-typed-client';
import {
  createNimiHostRuntimeAgentLifecycleSurface,
} from './runtime-agent-lifecycle';
import { toNimiRuntimeProtoStruct, toNimiRuntimeTimestamp } from './runtime-agent-values';

const OWNER_USER_ID = 'user-1';
const SOURCE_HASH = 'a'.repeat(64);

test('Runtime Agent lifecycle lists active LocalAgents without source selection', async () => {
  const calls: Array<{ readonly method: string; readonly request: unknown; readonly options?: RuntimeTypedCallOptions }> = [];
  const surface = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: () => ({
      appId: 'desktop',
      auth: protectedAuth(),
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
                runtimeSourceRef: `runtime-source:worldCharacter:world-1:source-1:${SOURCE_HASH}`,
                displayName: 'Existing Source Agent',
                lifecycleStatus: AgentLifecycleStatus.ACTIVE,
                metadata: toNimiRuntimeProtoStruct({
                  legacySourceProjection: {
                    sourceKind: 'personaCharacter',
                    sourceWorldId: 'metadata-must-not-author-provenance',
                  },
                }),
                sourceContextStatus: {
                  schemaVersion: AgentLocalSourceContextSchemaVersion.V2,
                  ready: true,
                  state: AgentLocalSourceContextState.READY,
                  reasonCode: AgentContextProjectionReasonCode.NONE,
                  localAgentRef: 'local-agent:runtime-owned-existing',
                  sourceRef: {
                    source: {
                      oneofKind: 'worldCharacter' as const,
                      worldCharacter: {
                        kind: CharacterSourceKindV3.WORLD_CHARACTER,
                        id: 'source-1',
                        worldId: 'world-1',
                        worldEntityRef: {
                          kind: WorldEntityRefKindV3.WORLD_ENTITY,
                          worldId: 'world-1',
                          entityId: 'entity-source-1',
                        },
                        sourceHash: SOURCE_HASH,
                      },
                    },
                  },
                  sourceSchemaVersion: 'realm.world-character-core/v1',
                  snapshotSchemaVersion: AgentLocalSourceSnapshotSchemaVersion.V2,
                  snapshotHash: 'b'.repeat(64),
                  capturedAt: toNimiRuntimeTimestamp('2026-07-10T05:00:00.000Z'),
                  worldContentHash: 'c'.repeat(64),
                  materializationContextHash: 'd'.repeat(64),
                  coverageSections: [
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
                    AgentLocalSourceCoverageSection.WORLD_CORE,
                    AgentLocalSourceCoverageSection.BOUND_ENTITY,
                    AgentLocalSourceCoverageSection.DEPENDENCY_CLOSURE,
                  ].map((section) => ({
                    section,
                    state: AgentLocalSourceCoverageState.COMPLETE,
                    requiredCount: 1,
                    resolvedCount: 1,
                    omittedCount: 0,
                  })),
                },
              },
              {
                agentId: 'local-agent:inactive',
                localAgentRef: 'local-agent:inactive',
                ownerUserId: OWNER_USER_ID,
                runtimeSourceRef: `runtime-source:worldCharacter:world-1:source-2:${SOURCE_HASH}`,
                lifecycleStatus: AgentLifecycleStatus.TERMINATED,
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
      },
    }),
    getSubjectUserId: () => OWNER_USER_ID,
    withScopes: async (scopes, operation) => operation({ metadata: { scopes: scopes.join(' ') } }),
  });

  const listed = await surface.listLocalAgents({ ownerUserId: OWNER_USER_ID });

  assert.deepEqual(listed.map((agent) => agent.localAgentRef), ['local-agent:runtime-owned-existing']);
  assert.equal(listed[0]?.sourceKind, 'worldCharacter');
  assert.equal(listed[0]?.sourceWorldId, 'world-1');
  assert.equal(listed[0]?.sourceWorldName, null);
  assert.equal(listed[0]?.sourceId, 'source-1');
  assert.equal(listed[0]?.sourceHash, 'a'.repeat(64));
  assert.equal(listed[0]?.snapshotHash, 'b'.repeat(64));
  assert.equal(listed[0]?.worldContentHash, 'c'.repeat(64));
  assert.equal(listed[0]?.materializationContextHash, 'd'.repeat(64));
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
