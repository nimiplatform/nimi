import { describe, expect, it } from 'vitest';

import type {
  NimiRuntimeAgentSourceContextStatus,
  NimiRuntimeAgentTurnContextSummary,
} from '@nimiplatform/kit/core/sdk-contract';
import { projectAgentCenterSourceContext } from '../src/source-context-projection.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const HASH_E = 'e'.repeat(64);
const HASH_F = 'f'.repeat(64);

const LANE_IDS = [
  'runtime_policy',
  'output_contract',
  'source_identity',
  'source_behavior',
  'world_context',
  'relationship_context',
  'source_knowledge',
  'canonical_memory',
  'conversation_history',
  'capability_context',
  'current_user_turn',
] as const;

function readySource(): NimiRuntimeAgentSourceContextStatus {
  return {
    schemaVersion: 'v2',
    ready: true,
    state: 'ready',
    reasonCode: 'none',
    localAgentRef: 'local-agent:owner:agent',
    sourceRef: {
      kind: 'worldCharacter',
      id: 'character-1',
      worldId: 'world-1',
      worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: 'entity-1' },
      sourceHash: HASH_A,
    },
    sourceSchemaVersion: 'realm.world-character-core/v1',
    snapshotSchemaVersion: 'v2',
    snapshotHash: HASH_B,
    capturedAt: '2026-07-11T01:02:03.000Z',
    worldContentHash: HASH_C,
    materializationContextHash: HASH_D,
    coverageSections: [
      { section: 'identity', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'presentation', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'biography', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'psychology', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'knowledge', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'relationships', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'capabilities', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'interaction_profile', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'assets', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'authoring', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'world_core', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
      { section: 'dependency_closure', state: 'complete', requiredCount: 2, resolvedCount: 2, omittedCount: 0 },
      { section: 'bound_entity', state: 'complete', requiredCount: 1, resolvedCount: 1, omittedCount: 0 },
    ],
  };
}

function readyTurn(): NimiRuntimeAgentTurnContextSummary {
  return {
    schemaVersion: 'v1',
    ready: true,
    state: 'ready',
    reasonCode: 'none',
    manifestSchemaVersion: 'v1',
    compilerSchemaVersion: 'v1',
    manifestInstanceHash: HASH_E,
    contextContentHash: HASH_F,
    promptHash: HASH_A,
    sourceSnapshotHash: HASH_B,
    sourceRef: {
      kind: 'worldCharacter',
      id: 'character-1',
      worldId: 'world-1',
      worldEntityRef: { kind: 'worldEntity', worldId: 'world-1', entityId: 'entity-1' },
      sourceHash: HASH_A,
    },
    worldContentHash: HASH_C,
    materializationContextHash: HASH_D,
    localAgentRef: 'local-agent:owner:agent',
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    lanes: LANE_IDS.map((laneId) => ({
      laneId,
      state: 'included' as const,
      includedItemCount: 1,
      omittedItemCount: 0,
      truncatedItemCount: 0,
      allocatedTokens: '10',
      usedTokens: '1',
    })),
    budget: {
      contextWindowTokens: '1000',
      reservedOutputTokens: '100',
      reservedSafetyTokens: '50',
      reservedAdapterTokens: '50',
      inputBudgetTokens: '800',
      usedTokens: '11',
    },
    truncation: [{ reason: 'none', omittedItemCount: 0, truncatedItemCount: 0 }],
    transcriptTurnCount: 3,
    memoryItemCount: 2,
    mediaCount: 0,
    toolCount: 0,
    routeDigest: HASH_B,
    catalogRevisionDigest: HASH_C,
  };
}

function unavailableSource(
  state: 'not_materialized' | 'validating' | 'invalid' | 'deleted',
): NimiRuntimeAgentSourceContextStatus {
  const reasonCode = state === 'validating'
    ? 'source_validation_pending'
    : state === 'invalid' ? 'source_snapshot_invalid' : 'source_not_materialized';
  return {
    schemaVersion: 'v2',
    ready: false,
    state,
    reasonCode,
    localAgentRef: 'local-agent:owner:agent',
    sourceRef: null,
    sourceSchemaVersion: null,
    snapshotSchemaVersion: null,
    snapshotHash: null,
    capturedAt: null,
    worldContentHash: null,
    materializationContextHash: null,
    coverageSections: [],
  };
}

describe('Agent Center source/context projection', () => {
  it('maps the five closed product states without retaining machine reasons', () => {
    const ready = projectAgentCenterSourceContext({
      sourceContextStatus: readySource(),
      turnContextSummary: readyTurn(),
    });
    expect(ready.status).toBe('ready');
    expect(ready.source).toMatchObject({
      kind: 'worldCharacter',
      sourceHash: HASH_A,
      snapshotHash: HASH_B,
    });
    expect(ready.context?.lanes).toHaveLength(11);

    expect(projectAgentCenterSourceContext({
      sourceContextStatus: unavailableSource('not_materialized'),
    }).status).toBe('blocked');

    const truncatedTurn = readyTurn() as Extract<NimiRuntimeAgentTurnContextSummary, { ready: true }>;
    const truncatedLanes = truncatedTurn.lanes.map((lane) => lane.laneId === 'source_knowledge'
      ? {
          ...lane,
          state: 'omitted' as const,
          includedItemCount: 0,
          omittedItemCount: 1,
          usedTokens: '0',
        }
      : lane);
    expect(projectAgentCenterSourceContext({
      sourceContextStatus: readySource(),
      turnContextSummary: {
        ...truncatedTurn,
        lanes: truncatedLanes,
        budget: { ...truncatedTurn.budget, usedTokens: '10' },
        truncation: [{ reason: 'optional_content_omitted', omittedItemCount: 1, truncatedItemCount: 0 }],
      },
    }).status).toBe('truncated');

    expect(projectAgentCenterSourceContext({
      sourceContextStatus: unavailableSource('invalid'),
    }).status).toBe('failed');
    expect(projectAgentCenterSourceContext({
      sourceContextStatus: unavailableSource('deleted'),
    }).status).toBe('failed');
    expect(projectAgentCenterSourceContext({}).status).toBe('unknown');
    expect(projectAgentCenterSourceContext({ sourceContextStatus: readySource() }).status).toBe('unknown');
  });

  it('maps capacity exhaustion to blocked and first-turn not-composed to unknown', () => {
    const ready = readyTurn() as Extract<NimiRuntimeAgentTurnContextSummary, { ready: true }>;
    expect(projectAgentCenterSourceContext({
      sourceContextStatus: readySource(),
      turnContextSummary: {
        ...ready,
        ready: false,
        state: 'context_capacity_exceeded',
        reasonCode: 'context_capacity_exceeded',
        manifestInstanceHash: null,
        contextContentHash: null,
        promptHash: null,
        truncation: [{ reason: 'context_capacity_exceeded', omittedItemCount: 0, truncatedItemCount: 0 }],
      },
    }).status).toBe('blocked');

    const notComposed: NimiRuntimeAgentTurnContextSummary = {
      schemaVersion: 'v1',
      ready: false,
      state: 'not_composed',
      reasonCode: 'context_not_composed',
      manifestSchemaVersion: null,
      compilerSchemaVersion: null,
      manifestInstanceHash: null,
      contextContentHash: null,
      promptHash: null,
      sourceSnapshotHash: null,
      sourceRef: null,
      worldContentHash: null,
      materializationContextHash: null,
      localAgentRef: 'local-agent:owner:agent',
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-0',
      lanes: [],
      budget: null,
      truncation: [],
      transcriptTurnCount: 0,
      memoryItemCount: 0,
      mediaCount: 0,
      toolCount: 0,
      routeDigest: null,
      catalogRevisionDigest: null,
    };
    expect(projectAgentCenterSourceContext({
      sourceContextStatus: readySource(),
      turnContextSummary: notComposed,
    }).status).toBe('unknown');
  });

  it('fails closed for partial, unknown, raw, and cross-source input', () => {
    const partial = { ...readySource(), snapshotHash: null } as unknown as NimiRuntimeAgentSourceContextStatus;
    const unknown = { ...readySource(), schemaVersion: 'v3' } as unknown as NimiRuntimeAgentSourceContextStatus;
    const raw = {
      ...readySource(),
      worldCoreRaw: 'RAW_WORLD_CANARY',
      prompt: 'RAW_PROMPT_CANARY',
      reasonCode: 'none',
    } as unknown as NimiRuntimeAgentSourceContextStatus;
    const wrongTurn = {
      ...readyTurn(),
      localAgentRef: 'local-agent:owner:other',
    } as NimiRuntimeAgentTurnContextSummary;

    for (const sourceContextStatus of [partial, unknown, raw]) {
      const projection = projectAgentCenterSourceContext({ sourceContextStatus });
      expect(projection.status).toBe('failed');
      expect(JSON.stringify(projection)).not.toMatch(/RAW_WORLD_CANARY|RAW_PROMPT_CANARY|reasonCode|actionHint/u);
    }
    expect(projectAgentCenterSourceContext({
      sourceContextStatus: readySource(),
      turnContextSummary: wrongTurn,
    }).status).toBe('failed');
  });

  it('fails closed across 100 deterministic partial, enum, and private mutations', () => {
    for (let index = 0; index < 100; index += 1) {
      const sourceContextStatus = index % 3 === 0
        ? { ...readySource(), state: `unknown_${index}` }
        : index % 3 === 1
          ? { ...readySource(), snapshotHash: index % 2 === 0 ? null : `bad-${index}` }
          : { ...readySource(), [`private_lane_${index}`]: `RAW_KIT_CANARY_${index}` };
      const projection = projectAgentCenterSourceContext({
        sourceContextStatus: sourceContextStatus as unknown as NimiRuntimeAgentSourceContextStatus,
      });
      expect(projection.status).toBe('failed');
      expect(JSON.stringify(projection)).not.toContain(`RAW_KIT_CANARY_${index}`);
    }
  });
});
