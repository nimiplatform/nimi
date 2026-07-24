import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentCanonicalMemoryBankMode,
  AgentEventType,
  AvatarDebugProbeKind,
  AvatarDebugRequestedBy,
  CompanionParticipationStatus,
  CompanionParticipationSurfaceKind,
  CompanionParticipationTriggerSource,
  ConversationAnchorStatus,
  DelegatedApprovalDecision,
  DelegatedProviderKind,
  DelegatedProviderState,
  DelegatedProviderTrustTier,
  DelegatedTransportKind,
  EffectClass,
  HookAdmissionState,
  NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
  SensitivityClass,
  asyncEvents,
  buildNimiRuntimeAgentConsumeContext,
  buildNimiRuntimeAgentDelegatedProviderProfileFromDraft,
  buildNimiRuntimeAgentResolvedOutputText,
  buildNimiRuntimeAgentSnapshotRecoveryEvents,
  cloneNimiRuntimeAgentResolvedMessageActionEnvelopeWithCommittedMessage,
  collectAsyncIterable,
  consumeContext,
  createNimiHostRuntimeAgentDelegatedCapabilitySurface,
  createNimiHostRuntimeAgentMemorySurface,
  createNimiRuntimeAgentConsumeClient,
  createUnexpectedRuntimeAgentConsumeRuntime,
  decodeNimiRuntimeAgentCompanionParticipationProjection,
  isNimiRuntimeAgentProjectionEvent,
  matchesNimiRuntimeAgentProjectionScope,
  nimiRuntimeAgentSnapshotCompletedTurnHasRecoverableContent,
  nimiRuntimeAgentSnapshotTurnIsCompleted,
  nimiRuntimeAgentSnapshotTurnIsFailed,
  nimiRuntimeAgentSnapshotTurnIsTerminal,
  parseNimiRuntimeAgentResolvedMessageActionEnvelopeFromPayload,
  parseNimiRuntimeAgentStructuredMessageActionEnvelope,
  parseNimiRuntimeAgentTimeline,
  projectNimiRuntimeAgentAppMessageEvent,
  projectNimiRuntimeAgentCanonicalMemoryBankStatus,
  readNimiRuntimeAgentStructuredMessageField,
  recoverNimiRuntimeAgentTerminalSnapshot,
  summarizeNimiRuntimeAgentProjectionEvent,
  summarizeNimiRuntimeAgentTimeline,
  toNimiRuntimeProtoStruct,
  type AppMessageEvent,
  type NimiRuntimeAgentConsumeEvent,
  type NimiRuntimeAgentConsumeRuntime,
  type NimiRuntimeAgentSessionTurnSnapshot,
} from './runtime-agent-consume.test-helper';
import {
  AgentContextProjectionReasonCode,
  AgentLocalSourceContextSchemaVersion,
  AgentLocalSourceContextState,
  AgentLocalSourceCoverageSection,
  AgentLocalSourceCoverageState,
  AgentLocalSourceSnapshotSchemaVersion,
  AgentTurnContextCompilerSchemaVersion,
  AgentTurnContextLaneId,
  AgentTurnContextLaneState,
  AgentTurnContextManifestSchemaVersion,
  AgentTurnContextState,
  AgentTurnContextSummarySchemaVersion,
  AgentTurnContextTruncationReason,
  CharacterSourceKindV3,
  WorldEntityRefKindV3,
} from '../core-generated/runtime-typed-client';
import {
  NIMI_RUNTIME_AGENT_TURN_CONTEXT_LANE_ORDER,
  assertNimiRuntimeAgentContextProjectionCorrelation,
  decodeNimiRuntimeAgentSourceContextStatus,
  decodeNimiRuntimeAgentTurnContextSummary,
} from './runtime-agent-context-projections';
import { decodeNimiRuntimeAgentConversationAnchorSnapshot } from './runtime-agent-consume-client';

const BOUNDED_LOCAL_AGENT_REF = 'local-agent:bounded-projection-1';
const BOUNDED_SOURCE_REF = {
  source: {
    oneofKind: 'worldCharacter' as const,
    worldCharacter: {
      kind: CharacterSourceKindV3.WORLD_CHARACTER,
      id: 'character-1',
      worldId: 'world-1',
      worldEntityRef: {
        kind: WorldEntityRefKindV3.WORLD_ENTITY,
        worldId: 'world-1',
        entityId: 'entity-character-1',
      },
      sourceHash: 'a'.repeat(64),
    },
  },
};

const CHARACTER_READY_COVERAGE = [
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
] as const;

const PERSONA_READY_COVERAGE = [
  AgentLocalSourceCoverageSection.IDENTITY,
  AgentLocalSourceCoverageSection.PRESENTATION,
  AgentLocalSourceCoverageSection.INTERACTION_PROFILE,
  AgentLocalSourceCoverageSection.ASSETS,
  AgentLocalSourceCoverageSection.AUTHORING,
  AgentLocalSourceCoverageSection.PERSONA_STYLE,
  AgentLocalSourceCoverageSection.CONTENT_PROFILE,
  AgentLocalSourceCoverageSection.WORLD_CORE,
  AgentLocalSourceCoverageSection.DEPENDENCY_CLOSURE,
] as const;

function completeCoverage(sections: readonly AgentLocalSourceCoverageSection[]) {
  return sections.map((section) => ({
    section,
    state: AgentLocalSourceCoverageState.COMPLETE,
    requiredCount: 1,
    resolvedCount: 1,
    omittedCount: 0,
  }));
}

function boundedSourceStatus() {
  return {
    schemaVersion: AgentLocalSourceContextSchemaVersion.V2,
    ready: true,
    state: AgentLocalSourceContextState.READY,
    reasonCode: AgentContextProjectionReasonCode.NONE,
    localAgentRef: BOUNDED_LOCAL_AGENT_REF,
    sourceRef: BOUNDED_SOURCE_REF,
    sourceSchemaVersion: 'realm.world-character-core/v1',
    snapshotSchemaVersion: AgentLocalSourceSnapshotSchemaVersion.V2,
    snapshotHash: 'b'.repeat(64),
    capturedAt: { seconds: '1783659600', nanos: 123_000_000 },
    worldContentHash: 'c'.repeat(64),
    materializationContextHash: 'd'.repeat(64),
    coverageSections: completeCoverage(CHARACTER_READY_COVERAGE),
  };
}

function boundedTurnSummary() {
  return {
    schemaVersion: AgentTurnContextSummarySchemaVersion.V1,
    ready: true,
    state: AgentTurnContextState.READY,
    reasonCode: AgentContextProjectionReasonCode.NONE,
    manifestSchemaVersion: AgentTurnContextManifestSchemaVersion.V1,
    compilerSchemaVersion: AgentTurnContextCompilerSchemaVersion.V1,
    manifestInstanceHash: '1'.repeat(64),
    contextContentHash: '2'.repeat(64),
    promptHash: '3'.repeat(64),
    sourceSnapshotHash: 'b'.repeat(64),
    sourceRef: BOUNDED_SOURCE_REF,
    worldContentHash: 'c'.repeat(64),
    materializationContextHash: 'd'.repeat(64),
    lanes: NIMI_RUNTIME_AGENT_TURN_CONTEXT_LANE_ORDER.map((_lane, index) => ({
      laneId: (index + 1) as AgentTurnContextLaneId,
      state: AgentTurnContextLaneState.INCLUDED,
      includedItemCount: 1,
      omittedItemCount: 0,
      truncatedItemCount: 0,
      allocatedTokens: '100',
      usedTokens: '10',
    })),
    budget: {
      contextWindowTokens: '4096',
      reservedOutputTokens: '512',
      reservedSafetyTokens: '256',
      reservedAdapterTokens: '256',
      inputBudgetTokens: '3072',
      usedTokens: '110',
    },
    truncation: [{
      reason: AgentTurnContextTruncationReason.NONE,
      omittedItemCount: 0,
      truncatedItemCount: 0,
    }],
    transcriptTurnCount: 2,
    memoryItemCount: 1,
    mediaCount: 0,
    toolCount: 3,
    routeDigest: '4'.repeat(64),
    catalogRevisionDigest: '5'.repeat(64),
    localAgentRef: BOUNDED_LOCAL_AGENT_REF,
    conversationAnchorId: 'anchor-bounded-1',
    turnId: 'turn-bounded-1',
  };
}

test('bounded source projection decodes proto and strict protojson without field loss', () => {
  const proto = decodeNimiRuntimeAgentSourceContextStatus(boundedSourceStatus());
  const protojson = decodeNimiRuntimeAgentSourceContextStatus({
    schema_version: 'AGENT_LOCAL_SOURCE_CONTEXT_SCHEMA_VERSION_V2',
    ready: true,
    state: 'AGENT_LOCAL_SOURCE_CONTEXT_STATE_READY',
    reason_code: 'AGENT_CONTEXT_PROJECTION_REASON_CODE_NONE',
    local_agent_ref: BOUNDED_LOCAL_AGENT_REF,
    source_ref: {
      world_character: {
        kind: 'CHARACTER_SOURCE_KIND_V3_WORLD_CHARACTER',
        id: 'character-1',
        world_id: 'world-1',
        world_entity_ref: {
          kind: 'WORLD_ENTITY_REF_KIND_V3_WORLD_ENTITY',
          world_id: 'world-1',
          entity_id: 'entity-character-1',
        },
        source_hash: 'a'.repeat(64),
      },
    },
    source_schema_version: 'realm.world-character-core/v1',
    snapshot_schema_version: 'AGENT_LOCAL_SOURCE_SNAPSHOT_SCHEMA_VERSION_V2',
    snapshot_hash: 'b'.repeat(64),
    captured_at: '2026-07-10T05:00:00.123Z',
    world_content_hash: 'c'.repeat(64),
    materialization_context_hash: 'd'.repeat(64),
    coverage_sections: [
      'IDENTITY',
      'PRESENTATION',
      'PLACEMENT',
      'BIOGRAPHY',
      'PSYCHOLOGY',
      'KNOWLEDGE',
      'RELATIONSHIPS',
      'CAPABILITIES',
      'INTERACTION_PROFILE',
      'ASSETS',
      'AUTHORING',
      'WORLD_CORE',
      'BOUND_ENTITY',
      'DEPENDENCY_CLOSURE',
    ].map((name) => ({
      section: `AGENT_LOCAL_SOURCE_COVERAGE_SECTION_${name}`,
      state: 'AGENT_LOCAL_SOURCE_COVERAGE_STATE_COMPLETE',
      required_count: 1,
      resolved_count: 1,
    })),
  });
  assert.deepEqual(protojson, proto);
  assert.equal(proto.sourceRef.kind, 'worldCharacter');
  assert.equal(proto.coverageSections.length, CHARACTER_READY_COVERAGE.length);
});

test('bounded source projection requires current source-kind baseline coverage', () => {
  const character = boundedSourceStatus();
  const persona = {
    ...character,
    sourceRef: {
      source: {
        oneofKind: 'personaCharacter' as const,
        personaCharacter: {
          kind: CharacterSourceKindV3.PERSONA_CHARACTER,
          id: 'persona-1',
          worldId: 'world-1',
          ownerAccountId: 'owner-1',
          sourceHash: 'a'.repeat(64),
        },
      },
    },
    sourceSchemaVersion: 'realm.persona-character-core/v1',
    coverageSections: completeCoverage(PERSONA_READY_COVERAGE),
  };
  assert.equal(decodeNimiRuntimeAgentSourceContextStatus(character).coverageSections.length, 14);
  assert.equal(decodeNimiRuntimeAgentSourceContextStatus(persona).coverageSections.length, 9);
  assert.throws(() => decodeNimiRuntimeAgentSourceContextStatus({
    ...character,
    coverageSections: character.coverageSections.slice(0, -1),
  }), /incomplete for worldCharacter/u);
  assert.throws(() => decodeNimiRuntimeAgentSourceContextStatus({
    ...persona,
    coverageSections: persona.coverageSections.slice(0, -1),
  }), /incomplete for personaCharacter/u);
  assert.equal(decodeNimiRuntimeAgentSourceContextStatus({
    ...persona,
    coverageSections: persona.coverageSections.map((entry, index) => index === 0
      ? { ...entry, state: AgentLocalSourceCoverageState.OPTIONAL_OMITTED, requiredCount: 0, resolvedCount: 0, omittedCount: 1 }
      : entry),
  }).sourceRef.kind, 'personaCharacter');
});

test('bounded source projection preserves omitted optional dependencies in complete coverage', () => {
  const status = boundedSourceStatus();
  const projection = decodeNimiRuntimeAgentSourceContextStatus({
    ...status,
    coverageSections: status.coverageSections.map((entry) => entry.section
      === AgentLocalSourceCoverageSection.DEPENDENCY_CLOSURE
      ? { ...entry, requiredCount: 2, resolvedCount: 2, omittedCount: 1 }
      : entry),
  });
  assert.deepEqual(
    projection.coverageSections.find((entry) => entry.section === 'dependency_closure'),
    {
      section: 'dependency_closure',
      state: 'complete',
      requiredCount: 2,
      resolvedCount: 2,
      omittedCount: 1,
    },
  );
  for (const contradictoryClosure of [
    {
      section: AgentLocalSourceCoverageSection.DEPENDENCY_CLOSURE,
      state: AgentLocalSourceCoverageState.COMPLETE,
      requiredCount: 2,
      resolvedCount: 1,
      omittedCount: 0,
    },
    {
      section: AgentLocalSourceCoverageSection.DEPENDENCY_CLOSURE,
      state: AgentLocalSourceCoverageState.INVALID,
      requiredCount: 2,
      resolvedCount: 2,
      omittedCount: 0,
    },
  ]) {
    assert.throws(() => decodeNimiRuntimeAgentSourceContextStatus({
      ...status,
      coverageSections: status.coverageSections.map((entry) => entry.section
        === AgentLocalSourceCoverageSection.DEPENDENCY_CLOSURE ? contradictoryClosure : entry),
    }), /counts contradict state/u);
  }
});

test('bounded source projection preserves legal non-ready discriminants and rejects partial/private input', () => {
  const cases = [
    [AgentLocalSourceContextState.NOT_MATERIALIZED, AgentContextProjectionReasonCode.SOURCE_NOT_MATERIALIZED, 'not_materialized'],
    [AgentLocalSourceContextState.VALIDATING, AgentContextProjectionReasonCode.SOURCE_VALIDATION_PENDING, 'validating'],
    [AgentLocalSourceContextState.INVALID, AgentContextProjectionReasonCode.SOURCE_SNAPSHOT_INVALID, 'invalid'],
    [AgentLocalSourceContextState.DELETED, AgentContextProjectionReasonCode.SOURCE_NOT_MATERIALIZED, 'deleted'],
  ] as const;
  for (const [state, reasonCode, expected] of cases) {
    const projection = decodeNimiRuntimeAgentSourceContextStatus({
      schemaVersion: AgentLocalSourceContextSchemaVersion.V2,
      ready: false,
      state,
      reasonCode,
      localAgentRef: BOUNDED_LOCAL_AGENT_REF,
      coverageSections: [],
    });
    assert.equal(projection.state, expected);
    assert.equal(projection.sourceRef, null);
  }
  assert.equal(decodeNimiRuntimeAgentSourceContextStatus({
    schema_version: 'AGENT_LOCAL_SOURCE_CONTEXT_SCHEMA_VERSION_V2',
    state: 'AGENT_LOCAL_SOURCE_CONTEXT_STATE_NOT_MATERIALIZED',
    reason_code: 'AGENT_CONTEXT_PROJECTION_REASON_CODE_SOURCE_NOT_MATERIALIZED',
    local_agent_ref: BOUNDED_LOCAL_AGENT_REF,
  }).state, 'not_materialized', 'protojson omitted default-false fields must decode identically');
  assert.throws(() => decodeNimiRuntimeAgentSourceContextStatus({
    ...boundedSourceStatus(),
    rawSystemPrompt: 'private',
  }), /not admitted/u);
  assert.throws(() => decodeNimiRuntimeAgentSourceContextStatus({
    ...boundedSourceStatus(),
    snapshotHash: '',
  }), /snapshotHash/u);
  assert.throws(() => decodeNimiRuntimeAgentSourceContextStatus({
    ...boundedSourceStatus(),
    coverageSections: boundedSourceStatus().coverageSections.filter(
      (entry) => entry.section !== AgentLocalSourceCoverageSection.BOUND_ENTITY,
    ),
  }), /incomplete for worldCharacter/u);
});

test('bounded turn summary decodes proto and protojson and rejects lane, budget, enum, and raw drift', () => {
  const proto = decodeNimiRuntimeAgentTurnContextSummary(boundedTurnSummary());
  const json = decodeNimiRuntimeAgentTurnContextSummary({
    schema_version: 'AGENT_TURN_CONTEXT_SUMMARY_SCHEMA_VERSION_V1',
    ready: true,
    state: 'AGENT_TURN_CONTEXT_STATE_READY',
    reason_code: 'AGENT_CONTEXT_PROJECTION_REASON_CODE_NONE',
    manifest_schema_version: 'AGENT_TURN_CONTEXT_MANIFEST_SCHEMA_VERSION_V1',
    compiler_schema_version: 'AGENT_TURN_CONTEXT_COMPILER_SCHEMA_VERSION_V1',
    manifest_instance_hash: '1'.repeat(64),
    context_content_hash: '2'.repeat(64),
    prompt_hash: '3'.repeat(64),
    source_snapshot_hash: 'b'.repeat(64),
    source_ref: {
      world_character: {
        kind: 'CHARACTER_SOURCE_KIND_V3_WORLD_CHARACTER', id: 'character-1', world_id: 'world-1',
        world_entity_ref: {
          kind: 'WORLD_ENTITY_REF_KIND_V3_WORLD_ENTITY', world_id: 'world-1', entity_id: 'entity-character-1',
        },
        source_hash: 'a'.repeat(64),
      },
    },
    world_content_hash: 'c'.repeat(64),
    materialization_context_hash: 'd'.repeat(64),
    lanes: NIMI_RUNTIME_AGENT_TURN_CONTEXT_LANE_ORDER.map((lane, index) => ({
      lane_id: `AGENT_TURN_CONTEXT_LANE_ID_${lane.toUpperCase()}`,
      state: 'AGENT_TURN_CONTEXT_LANE_STATE_INCLUDED',
      included_item_count: 1,
      allocated_tokens: '100', used_tokens: '10',
    })),
    budget: {
      context_window_tokens: '4096', reserved_output_tokens: '512', reserved_safety_tokens: '256',
      reserved_adapter_tokens: '256', input_budget_tokens: '3072', used_tokens: '110',
    },
    truncation: [{ reason: 'AGENT_TURN_CONTEXT_TRUNCATION_REASON_NONE' }],
    transcript_turn_count: 2, memory_item_count: 1, tool_count: 3,
    route_digest: '4'.repeat(64), catalog_revision_digest: '5'.repeat(64),
    local_agent_ref: BOUNDED_LOCAL_AGENT_REF,
    conversation_anchor_id: 'anchor-bounded-1', turn_id: 'turn-bounded-1',
  });
  assert.deepEqual(json, proto);
  assert.throws(() => decodeNimiRuntimeAgentTurnContextSummary({
    ...boundedTurnSummary(),
    lanes: [...boundedTurnSummary().lanes].reverse(),
  }), /fixed lane order/u);
  assert.throws(() => decodeNimiRuntimeAgentTurnContextSummary({
    ...boundedTurnSummary(),
    budget: { ...boundedTurnSummary().budget, inputBudgetTokens: '3071' },
  }), /inconsistent/u);
  assert.throws(() => decodeNimiRuntimeAgentTurnContextSummary({
    ...boundedTurnSummary(), state: 99,
  }), /unknown or unspecified/u);
  assert.throws(() => decodeNimiRuntimeAgentTurnContextSummary({
    ...boundedTurnSummary(), transcriptText: 'private',
  }), /not admitted/u);
  for (const contextWindowTokens of ['1023', '1024']) {
    const capacity = decodeNimiRuntimeAgentTurnContextSummary({
      ...boundedTurnSummary(),
      ready: false,
      state: AgentTurnContextState.CONTEXT_CAPACITY_EXCEEDED,
      reasonCode: AgentContextProjectionReasonCode.CONTEXT_CAPACITY_EXCEEDED,
      manifestInstanceHash: undefined,
      contextContentHash: undefined,
      promptHash: undefined,
      budget: {
        ...boundedTurnSummary().budget,
        contextWindowTokens,
        inputBudgetTokens: '0',
      },
      truncation: [{
        reason: AgentTurnContextTruncationReason.CONTEXT_CAPACITY_EXCEEDED,
        omittedItemCount: 0,
        truncatedItemCount: 0,
      }],
    });
    assert.equal(capacity.state, 'context_capacity_exceeded');
    assert.equal(capacity.budget.inputBudgetTokens, '0');
  }
  assert.throws(() => decodeNimiRuntimeAgentTurnContextSummary({
    ...boundedTurnSummary(),
    budget: {
      ...boundedTurnSummary().budget,
      contextWindowTokens: '1024',
      inputBudgetTokens: '0',
      usedTokens: '0',
    },
  }), /reserves and input budget are inconsistent/u);
  assert.throws(() => assertNimiRuntimeAgentContextProjectionCorrelation({
    turnContextSummary: proto,
    expectedLocalAgentRef: BOUNDED_LOCAL_AGENT_REF,
    expectedConversationAnchorId: 'anchor-bounded-1',
    expectedTurnId: 'turn-forged',
  }), /turnId correlation failed/u);
});

test('bounded source and turn decoders reject 100 deterministic unknown or private mutations', () => {
  for (let index = 0; index < 100; index += 1) {
    const sourceMutation = index % 4 === 0
      ? { ...boundedSourceStatus(), schemaVersion: 1000 + index }
      : index % 4 === 1
        ? { ...boundedSourceStatus(), state: 1000 + index }
        : index % 4 === 2
          ? { ...boundedSourceStatus(), reasonCode: 1000 + index }
          : { ...boundedSourceStatus(), [`private_source_${index}`]: 'RAW_SOURCE_CANARY' };
    assert.throws(
      () => decodeNimiRuntimeAgentSourceContextStatus(sourceMutation),
      /projection/u,
      `source mutation ${index} must fail closed`,
    );

    const turnMutation = index % 4 === 0
      ? { ...boundedTurnSummary(), schemaVersion: 1000 + index }
      : index % 4 === 1
        ? { ...boundedTurnSummary(), state: 1000 + index }
        : index % 4 === 2
          ? {
              ...boundedTurnSummary(),
              lanes: boundedTurnSummary().lanes.map((lane, laneIndex) => laneIndex === index % 11
                ? { ...lane, state: 1000 + index }
                : lane),
            }
          : { ...boundedTurnSummary(), [`private_turn_${index}`]: 'RAW_TURN_CANARY' };
    assert.throws(
      () => decodeNimiRuntimeAgentTurnContextSummary(turnMutation),
      /projection/u,
      `turn mutation ${index} must fail closed`,
    );
  }
});

test('bounded conversation snapshots require exact Runtime LocalAgent and anchor correlation', () => {
  const snapshot = {
    anchor: {
      conversationAnchorId: 'anchor-bounded-1',
      agentId: BOUNDED_LOCAL_AGENT_REF,
      subjectUserId: 'owner-1',
      status: ConversationAnchorStatus.ACTIVE,
      lastTurnId: '',
      lastMessageId: '',
      localAgentRef: BOUNDED_LOCAL_AGENT_REF,
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'agent-1',
    },
    activeTurnId: '',
    activeStreamId: '',
    sourceContextStatus: boundedSourceStatus(),
  };
  assert.equal(
    decodeNimiRuntimeAgentConversationAnchorSnapshot(
      snapshot,
      BOUNDED_LOCAL_AGENT_REF,
      'anchor-bounded-1',
    ).anchor?.conversationAnchorId,
    'anchor-bounded-1',
  );
  assert.throws(() => decodeNimiRuntimeAgentConversationAnchorSnapshot(
    { ...snapshot, anchor: undefined },
    BOUNDED_LOCAL_AGENT_REF,
    'anchor-bounded-1',
  ), /identity mismatch/u);
  assert.throws(() => decodeNimiRuntimeAgentConversationAnchorSnapshot(
    { ...snapshot, anchor: { ...snapshot.anchor, localAgentRef: 'local-agent:forged' } },
    BOUNDED_LOCAL_AGENT_REF,
    'anchor-bounded-1',
  ), /identity mismatch/u);
  assert.throws(() => decodeNimiRuntimeAgentConversationAnchorSnapshot(
    snapshot,
    BOUNDED_LOCAL_AGENT_REF,
    'anchor-forged',
  ), /identity mismatch/u);
});

test('Runtime Agent consume client builds canonical Runtime Agent requests', async () => {
  const requests: unknown[] = [];
  const runtime: NimiRuntimeAgentConsumeRuntime = {
    agents: {
      async openConversationAnchor(request) {
        requests.push(request);
        return {
          snapshot: {
            anchor: {
              conversationAnchorId: 'anchor-1',
              agentId: 'local-agent:test-owner-1-agent-1',
              subjectUserId: 'owner-1',
              status: 1,
              lastTurnId: '',
              lastMessageId: '',
              localAgentRef: 'local-agent:test-owner-1-agent-1',
              ownerUserId: 'owner-1',
              runtimeSourceRef: 'agent-1',
            },
            activeTurnId: '',
            activeStreamId: '',
          },
        };
      },
      async getConversationAnchorSnapshot() {
        throw new Error('unexpected');
      },
      async registerAvatarLiveInstanceBinding() {
        throw new Error('unexpected');
      },
      async resolveAvatarLiveInstanceBinding() {
        throw new Error('unexpected');
      },
      async getPublicChatSessionSnapshot() {
        throw new Error('unexpected');
      },
      subscribeAgentEvents() {
        throw new Error('unexpected');
      },
    },
  };

  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });
  const snapshot = await client.anchors.open(consumeContext);

  assert.equal(snapshot.anchor?.conversationAnchorId, 'anchor-1');
  assert.deepEqual(requests[0], {
    context: {
      appId: 'nimi.avatar',
      subjectUserId: 'owner-1',
      ownerUserId: 'owner-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:test-owner-1-agent-1',
    },
    subjectUserId: 'owner-1',
    localAgentRef: 'local-agent:test-owner-1-agent-1',
    ownerUserId: 'owner-1',
    runtimeSourceRef: 'agent-1',
  });
});

test('Runtime Agent consume client lists conversation summaries through Runtime Agent', async () => {
  const calls: {
    request: unknown;
    options?: unknown;
  }[] = [];
  const callOptions = { timeoutMs: 2000 };
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    async listAgentConversationSummaries(request, options) {
      calls.push({ request, options });
      return {
        summaries: [
          {
            anchor: {
              conversationAnchorId: 'anchor-1',
              agentId: 'local-agent:test-owner-1-agent-1',
              subjectUserId: 'owner-1',
              status: ConversationAnchorStatus.ACTIVE,
              lastTurnId: 'turn-1',
              lastMessageId: 'message-1',
              localAgentRef: 'local-agent:test-owner-1-agent-1',
              ownerUserId: 'owner-1',
              runtimeSourceRef: 'agent-1',
            },
            title: 'Runtime title',
            lastMessageRole: 'assistant',
            lastMessageText: 'hello',
            lastMessageId: 'message-1',
            transcriptMessageCount: 2,
          },
        ],
        nextPageToken: 'cursor-2',
      };
    },
  });

  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });
  const result = await client.anchors.listSummaries({
    ...consumeContext,
    statusFilter: ['active'],
    pageSize: 1,
    pageToken: 'cursor-1',
  }, callOptions);

  assert.equal(result.summaries.length, 1);
  assert.equal(result.nextPageToken, 'cursor-2');
  assert.deepEqual(calls, [
    {
      request: {
        context: {
          appId: 'nimi.avatar',
          subjectUserId: 'owner-1',
          ownerUserId: 'owner-1',
          runtimeSourceRef: 'agent-1',
          localAgentRef: 'local-agent:test-owner-1-agent-1',
        },
        agentId: 'local-agent:test-owner-1-agent-1',
        statusFilter: [ConversationAnchorStatus.ACTIVE],
        pageSize: 1,
        pageToken: 'cursor-1',
      },
      options: callOptions,
    },
  ]);
});

test('Runtime Agent consume client fails closed on invalid conversation summary inputs and responses', async () => {
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    async listAgentConversationSummaries() {
      return {};
    },
  });
  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });

  await assert.rejects(
    () => client.anchors.listSummaries({
      ...consumeContext,
      statusFilter: ['archived' as 'active'],
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_INPUT_INVALID');
      return true;
    },
  );
  await assert.rejects(
    () => client.anchors.listSummaries({
      ...consumeContext,
      pageSize: -1,
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_INPUT_INVALID');
      return true;
    },
  );
  await assert.rejects(
    () => client.anchors.listSummaries({
      ...consumeContext,
      pageToken: 1,
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_INPUT_INVALID');
      return true;
    },
  );
  await assert.rejects(
    () => client.anchors.listSummaries(consumeContext),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_RESPONSE_INVALID');
      return true;
    },
  );
});

test('Runtime Agent consume client registers Avatar live instance binding through Runtime Agent', async () => {
  const calls: {
    request: unknown;
    options?: unknown;
  }[] = [];
  const callOptions = { timeoutMs: 5000 };
  const runtime: NimiRuntimeAgentConsumeRuntime = {
    agents: {
      async openConversationAnchor() {
        throw new Error('unexpected');
      },
      async getConversationAnchorSnapshot() {
        throw new Error('unexpected');
      },
      async registerAvatarLiveInstanceBinding(request, options) {
        calls.push({ request, options });
        return {
          binding: {
            avatarInstanceId: 'avatar-1',
            conversationAnchorId: 'anchor-1',
            agentId: 'local-agent:test-owner-1-agent-1',
            subjectUserId: 'subject-1',
            localAgentRef: 'local-agent:test-owner-1-agent-1',
            ownerUserId: 'owner-1',
            runtimeSourceRef: 'agent-1',
            callerAppId: 'nimi.avatar',
          },
          snapshot: {
            anchor: {
              conversationAnchorId: 'anchor-1',
              agentId: 'local-agent:test-owner-1-agent-1',
              subjectUserId: 'subject-1',
              status: 1,
              lastTurnId: '',
              lastMessageId: '',
              localAgentRef: 'local-agent:test-owner-1-agent-1',
              ownerUserId: 'owner-1',
              runtimeSourceRef: 'agent-1',
            },
            activeTurnId: '',
            activeStreamId: '',
          },
        };
      },
      async resolveAvatarLiveInstanceBinding() {
        throw new Error('unexpected');
      },
      async getPublicChatSessionSnapshot() {
        throw new Error('unexpected');
      },
      subscribeAgentEvents() {
        throw new Error('unexpected');
      },
    },
  };

  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });
  const result = await client.anchors.registerAvatarLiveInstance({
    ...consumeContext,
    subjectUserId: 'subject-1',
    avatarInstanceId: 'avatar-1',
    conversationAnchorId: 'anchor-1',
  }, callOptions);

  assert.equal(result.binding.avatarInstanceId, 'avatar-1');
  assert.equal(result.snapshot.anchor?.conversationAnchorId, 'anchor-1');
  assert.deepEqual(calls, [
    {
      request: {
        context: {
          appId: 'nimi.avatar',
          subjectUserId: 'subject-1',
          ownerUserId: 'owner-1',
          runtimeSourceRef: 'agent-1',
          localAgentRef: 'local-agent:test-owner-1-agent-1',
        },
        avatarInstanceId: 'avatar-1',
        conversationAnchorId: 'anchor-1',
      },
      options: callOptions,
    },
  ]);
});

test('Runtime Agent consume client resolves Avatar live instance binding through Runtime Agent', async () => {
  const calls: { request: unknown; options?: unknown }[] = [];
  const callOptions = { timeoutMs: 5000 };
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    async resolveAvatarLiveInstanceBinding(request, options) {
      calls.push({ request, options });
      return {
        binding: {
          avatarInstanceId: 'avatar-1',
          conversationAnchorId: 'anchor-1',
          agentId: 'local-agent:test-owner-1-agent-1',
          subjectUserId: 'subject-1',
          localAgentRef: 'local-agent:test-owner-1-agent-1',
          ownerUserId: 'owner-1',
          runtimeSourceRef: 'agent-1',
          callerAppId: 'nimi.avatar',
        },
        snapshot: {
          anchor: {
            conversationAnchorId: 'anchor-1',
            agentId: 'local-agent:test-owner-1-agent-1',
            subjectUserId: 'subject-1',
            status: 1,
            lastTurnId: '',
            lastMessageId: '',
            localAgentRef: 'local-agent:test-owner-1-agent-1',
            ownerUserId: 'owner-1',
            runtimeSourceRef: 'agent-1',
          },
          activeTurnId: '',
          activeStreamId: '',
        },
      };
    },
  });

  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });
  const result = await client.anchors.resolveAvatarLiveInstance({
    ...consumeContext,
    subjectUserId: 'subject-1',
    avatarInstanceId: 'avatar-1',
  }, callOptions);

  assert.equal(result.binding.avatarInstanceId, 'avatar-1');
  assert.equal(result.snapshot.anchor?.conversationAnchorId, 'anchor-1');
  assert.deepEqual(calls, [
    {
      request: {
        context: {
          appId: 'nimi.avatar',
          subjectUserId: 'subject-1',
          ownerUserId: 'owner-1',
          runtimeSourceRef: 'agent-1',
          localAgentRef: 'local-agent:test-owner-1-agent-1',
        },
        avatarInstanceId: 'avatar-1',
      },
      options: callOptions,
    },
  ]);
});

test('Runtime Agent consume client fails closed when Avatar binding projection is missing', async () => {
  const runtime: NimiRuntimeAgentConsumeRuntime = {
    agents: {
      async openConversationAnchor() {
        throw new Error('unexpected');
      },
      async getConversationAnchorSnapshot() {
        throw new Error('unexpected');
      },
      async registerAvatarLiveInstanceBinding() {
        return {
          snapshot: {
            anchor: {
              conversationAnchorId: 'anchor-1',
              agentId: 'local-agent:test-owner-1-agent-1',
              subjectUserId: 'owner-1',
              status: 1,
              lastTurnId: '',
              lastMessageId: '',
              localAgentRef: 'local-agent:test-owner-1-agent-1',
              ownerUserId: 'owner-1',
              runtimeSourceRef: 'agent-1',
            },
            activeTurnId: '',
            activeStreamId: '',
          },
        };
      },
      async resolveAvatarLiveInstanceBinding() {
        throw new Error('unexpected');
      },
      async getPublicChatSessionSnapshot() {
        throw new Error('unexpected');
      },
      subscribeAgentEvents() {
        throw new Error('unexpected');
      },
    },
  };
  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });

  await assert.rejects(
    () => client.anchors.registerAvatarLiveInstance({
      ...consumeContext,
      avatarInstanceId: 'avatar-1',
      conversationAnchorId: 'anchor-1',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_RESPONSE_INVALID');
      return true;
    },
  );
});

test('Runtime Agent consume client decodes companion participation projection and builds getProjection request', async () => {
  const calls: {
    request: unknown;
    options?: unknown;
  }[] = [];
  const callOptions = { timeoutMs: 7000 };
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    async getCompanionParticipationProjection(request, options) {
      calls.push({ request, options });
      return {
        projection: {
          projectionId: 'projection-1',
          agentId: 'local-agent:test-owner-1-agent-1',
          surfaceKind: CompanionParticipationSurfaceKind.AVATAR_DEBUG_WORKBENCH,
          profileRef: 'runtime.agent.profile/local-agent:test-owner-1-agent-1',
          roomOrchestrationRef: 'runtime.room_orchestration/avatar_companion_presentation_room',
          triggerSource: CompanionParticipationTriggerSource.USER_EXPLICIT,
          status: CompanionParticipationStatus.BLOCKED,
          candidateRef: '',
          commitRef: '',
          refusalReason: 'runtime_policy_blocked',
          presentationRef: '',
          auditRef: 'runtime.audit.companion_participation/projection-1',
          conversationAnchorId: 'anchor-1',
          turnId: '',
          streamId: '',
        },
      };
    },
  });

  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });
  const projection = await client.companionParticipation.getProjection({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
    surfaceKind: 'avatar_debug_workbench',
    triggerSource: 'user_explicit',
    profileRef: 'runtime.agent.profile/local-agent:test-owner-1-agent-1',
    roomOrchestrationRef: 'runtime.room_orchestration/avatar_companion_presentation_room',
    requestId: 'request-1',
  }, callOptions);

  assert.equal(projection.surfaceKind, 'avatar_debug_workbench');
  assert.equal(projection.triggerSource, 'user_explicit');
  assert.equal(projection.status, 'blocked');
  assert.equal(projection.refusalReason, 'runtime_policy_blocked');
  assert.deepEqual(calls, [
    {
      request: {
        context: {
          appId: 'nimi.avatar',
          subjectUserId: 'owner-1',
          ownerUserId: 'owner-1',
          runtimeSourceRef: 'agent-1',
          localAgentRef: 'local-agent:test-owner-1-agent-1',
        },
        agentId: 'local-agent:test-owner-1-agent-1',
        conversationAnchorId: 'anchor-1',
        surfaceKind: CompanionParticipationSurfaceKind.AVATAR_DEBUG_WORKBENCH,
        triggerSource: CompanionParticipationTriggerSource.USER_EXPLICIT,
        profileRef: 'runtime.agent.profile/local-agent:test-owner-1-agent-1',
        roomOrchestrationRef: 'runtime.room_orchestration/avatar_companion_presentation_room',
        requestId: 'request-1',
      },
      options: callOptions,
    },
  ]);
});

test('Runtime Agent consume client fails closed on invalid companion participation projections', async () => {
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    async getCompanionParticipationProjection() {
      return {
        projection: {
          projectionId: 'projection-1',
          agentId: 'local-agent:test-owner-1-agent-1',
          surfaceKind: CompanionParticipationSurfaceKind.AVATAR_DEBUG_WORKBENCH,
          profileRef: 'runtime.agent.profile/local-agent:test-owner-1-agent-1',
          roomOrchestrationRef: 'runtime.room_orchestration/avatar_companion_presentation_room',
          triggerSource: CompanionParticipationTriggerSource.USER_EXPLICIT,
          status: 999 as CompanionParticipationStatus,
          candidateRef: '',
          commitRef: '',
          refusalReason: '',
          presentationRef: '',
          auditRef: 'runtime.audit.companion_participation/projection-1',
          conversationAnchorId: 'anchor-1',
          turnId: '',
          streamId: '',
        },
      };
    },
  });
  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });

  await assert.rejects(
    () => client.companionParticipation.getProjection({
      ...consumeContext,
      conversationAnchorId: 'anchor-1',
      surfaceKind: 'avatar_debug_workbench',
      triggerSource: 'user_explicit',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_RESPONSE_INVALID');
      return true;
    },
  );
});

test('Runtime Agent consume client builds avatar debug probe requests through Runtime Agent', async () => {
  const calls: {
    request: unknown;
    options?: unknown;
  }[] = [];
  const callOptions = { timeoutMs: 3000 };
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    async requestAvatarDebugProbe(request, options) {
      calls.push({ request, options });
      return {};
    },
  });

  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });
  await client.avatarDebug.requestProbe({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
    probeKind: AvatarDebugProbeKind.GENERATED_MOTION,
    requestedBy: AvatarDebugRequestedBy.DESKTOP_DEBUG_WORKBENCH,
    probeId: 'probe-1',
    turnId: 'turn-1',
    streamId: 'stream-1',
    avatarInstanceId: 'avatar-1',
    replayRequested: true,
  }, callOptions);

  assert.deepEqual(calls, [
    {
      request: {
        context: {
          appId: 'nimi.avatar',
          subjectUserId: 'owner-1',
          ownerUserId: 'owner-1',
          runtimeSourceRef: 'agent-1',
          localAgentRef: 'local-agent:test-owner-1-agent-1',
        },
        agentId: 'local-agent:test-owner-1-agent-1',
        conversationAnchorId: 'anchor-1',
        probeKind: AvatarDebugProbeKind.GENERATED_MOTION,
        requestedBy: AvatarDebugRequestedBy.DESKTOP_DEBUG_WORKBENCH,
        probeId: 'probe-1',
        turnId: 'turn-1',
        streamId: 'stream-1',
        avatarInstanceId: 'avatar-1',
        replayRequested: true,
      },
      options: callOptions,
    },
  ]);
});

test('Runtime Agent consume client rejects unsupported avatar debug enums', async () => {
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    async requestAvatarDebugProbe() {
      throw new Error('unexpected');
    },
  });
  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });

  await assert.rejects(
    () => client.avatarDebug.requestProbe({
      ...consumeContext,
      conversationAnchorId: 'anchor-1',
      probeKind: 999 as AvatarDebugProbeKind,
      requestedBy: AvatarDebugRequestedBy.DESKTOP_DEBUG_WORKBENCH,
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_INPUT_INVALID');
      return true;
    },
  );
  await assert.rejects(
    () => client.avatarDebug.requestProbe({
      ...consumeContext,
      conversationAnchorId: 'anchor-1',
      probeKind: AvatarDebugProbeKind.GENERATED_MOTION,
      requestedBy: AvatarDebugRequestedBy.UNSPECIFIED,
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_INPUT_INVALID');
      return true;
    },
  );
});

test('Runtime Agent consume client parses public chat session snapshots', async () => {
  const runtime: NimiRuntimeAgentConsumeRuntime = {
    agents: {
      async openConversationAnchor() {
        throw new Error('unexpected');
      },
      async getConversationAnchorSnapshot() {
        throw new Error('unexpected');
      },
      async registerAvatarLiveInstanceBinding() {
        throw new Error('unexpected');
      },
      async resolveAvatarLiveInstanceBinding() {
        throw new Error('unexpected');
      },
      async getPublicChatSessionSnapshot() {
        return {
          snapshot: toNimiRuntimeProtoStruct({
            session_status: 'ready',
            transcript_message_count: 2,
            transcript: [
              {
                id: 'message-user-1',
                role: 'user',
                content: 'hello',
                status: 'complete',
                kind: 'text',
                created_at: '2026-06-05T00:00:00.000Z',
                updated_at: '2026-06-05T00:00:00.000Z',
              },
              {
                id: 'message-assistant-1',
                role: 'assistant',
                content: 'hi',
                status: 'complete',
                kind: 'text',
                created_at: '2026-06-05T00:00:01.000Z',
                updated_at: '2026-06-05T00:00:01.000Z',
                parent_message_id: 'message-user-1',
                reasoning_text: '',
              },
            ],
            active_turn: {
              turn_id: 'turn-2',
              stream_id: 'stream-2',
              text: 'streaming',
            },
            last_turn: {
              turn_id: 'turn-1',
              stream_id: 'stream-1',
              message_id: 'message-1',
              text: 'hello',
              structured: {
                status_cue: {
                  mood: 'happy',
                },
              },
            },
          }),
        };
      },
      subscribeAgentEvents() {
        throw new Error('unexpected');
      },
    },
  };

  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });
  const snapshot = await client.turns.getSessionSnapshot({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
  });

  assert.equal(snapshot.sessionStatus, 'ready');
  assert.equal(snapshot.transcriptMessageCount, 2);
  assert.equal(snapshot.transcript?.length, 2);
  assert.equal(snapshot.transcript?.[0]?.id, 'message-user-1');
  assert.equal(snapshot.transcript?.[1]?.parentMessageId, 'message-user-1');
  assert.equal(snapshot.activeTurn?.turnId, 'turn-2');
  assert.equal(snapshot.lastTurn?.messageId, 'message-1');
  assert.deepEqual(snapshot.lastTurn?.structured, {
    status_cue: {
      mood: 'happy',
    },
  });
});

test('Runtime Agent consume client omits malformed transcript replay envelopes', async () => {
  const runtime = createUnexpectedRuntimeAgentConsumeRuntime({
    async getPublicChatSessionSnapshot() {
      return {
        snapshot: toNimiRuntimeProtoStruct({
          session_status: 'ready',
          transcript_message_count: 1,
          transcript: [
            {
              role: 'assistant',
              content: 'missing replay id',
              status: 'complete',
              kind: 'text',
              created_at: '2026-06-05T00:00:00.000Z',
              updated_at: '2026-06-05T00:00:00.000Z',
            },
          ],
        }),
      };
    },
  });
  const client = createNimiRuntimeAgentConsumeClient({ runtime, runtimeAppId: 'nimi.avatar' });
  const snapshot = await client.turns.getSessionSnapshot({
    ...consumeContext,
    conversationAnchorId: 'anchor-1',
  });

  assert.equal(snapshot.sessionStatus, 'ready');
  assert.equal(snapshot.transcriptMessageCount, 1);
  assert.equal(snapshot.transcript, undefined);
});
