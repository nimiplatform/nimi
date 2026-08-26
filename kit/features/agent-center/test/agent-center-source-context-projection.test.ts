import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import type {
  NimiRuntimeAgentSourceContextStatus,
  NimiRuntimeAgentTurnContextSummary,
} from '@nimiplatform/kit/core/sdk-contract';
import { projectAgentCenterSourceContext } from '../src/source-context-projection.js';
import { AgentCenter } from '../src/components/AgentCenter.js';
import { sessionFor } from './session-fixture.js';

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
  'cognition_source',
  'canonical_memory',
  'conversation_summary',
  'conversation_history',
  'capability_context',
  'current_user_turn',
  'private_recall',
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
    snapshotSchemaVersion: 'v3',
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
    lorebookReady: true,
    lorebookItemCount: 3,
    lorebookEstimatedTokens: '1615',
  };
}

function readyTurn(): NimiRuntimeAgentTurnContextSummary {
  return {
    schemaVersion: 'v2',
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
      reservedReasoningTokens: '25',
      reservedSafetyTokens: '50',
      reservedAdapterTokens: '50',
      inputBudgetTokens: '775',
      usedTokens: '11',
      requiredInputTokens: '600',
      requiredContextWindowTokens: '825',
    },
    truncation: [{ reason: 'none', omittedItemCount: 0, truncatedItemCount: 0 }],
    transcriptTurnCount: 3,
    memoryItemCount: 2,
    mediaCount: 0,
    toolCount: 0,
    routeDigest: HASH_B,
    catalogRevisionDigest: HASH_C,
    sourceCognition: {
      adapterStatus: 'ready', selectionStatus: 'ready', generation: '2',
      candidateCount: 4, includedUnitCount: 2, omittedUnitCount: 2,
    },
    conversationSummary: {
      status: 'ready', revision: '1', coveredSequenceStart: '0', coveredSequenceEnd: '0',
    },
    privateRecallCount: 1,
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
    lorebookReady: false,
    lorebookItemCount: 0,
    lorebookEstimatedTokens: '0',
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
    expect(ready.context?.lanes).toHaveLength(14);
    expect(ready.context?.budget.reservedReasoningTokens).toBe('25');

    const summaryUnavailable = readyTurn() as Extract<NimiRuntimeAgentTurnContextSummary, { ready: true }>;
    expect(projectAgentCenterSourceContext({
      sourceContextStatus: readySource(),
      turnContextSummary: {
        ...summaryUnavailable,
        conversationSummary: {
          status: 'unavailable', revision: '0', coveredSequenceStart: '0', coveredSequenceEnd: '0',
        },
      },
    }).context?.conversationSummary.status).toBe('unavailable');

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
        budget: {
          ...ready.budget,
          requiredInputTokens: '776',
          requiredContextWindowTokens: '1001',
        },
        truncation: [{ reason: 'context_capacity_exceeded', omittedItemCount: 0, truncatedItemCount: 0 }],
      },
    }).status).toBe('blocked');

    const notComposed: NimiRuntimeAgentTurnContextSummary = {
      schemaVersion: 'v2',
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
      sourceCognition: null,
      conversationSummary: null,
      privateRecallCount: 0,
    };
    expect(projectAgentCenterSourceContext({
      sourceContextStatus: readySource(),
      turnContextSummary: notComposed,
    }).status).toBe('unknown');
  });

  it('renders typed current and required capacity with the Machine Loadout owner action', async () => {
    const ready = readyTurn() as Extract<NimiRuntimeAgentTurnContextSummary, { ready: true }>;
    const capacity = {
      ...ready,
      ready: false,
      state: 'context_capacity_exceeded',
      reasonCode: 'context_capacity_exceeded',
      manifestInstanceHash: null,
      contextContentHash: null,
      promptHash: null,
      budget: {
        ...ready.budget,
        requiredInputTokens: '776',
        requiredContextWindowTokens: '1001',
      },
      truncation: [{ reason: 'context_capacity_exceeded', omittedItemCount: 0, truncatedItemCount: 0 }],
    } as NimiRuntimeAgentTurnContextSummary;
    const session = await sessionFor({ sourceContextStatus: readySource(), turnContextSummary: capacity });
    const openMachineLoadout = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(createElement(AgentCenter, {
          activeSection: 'advanced',
          placementActions: { openMachineLoadout },
          session,
        }));
      });
      expect(container.textContent).toContain('1000 current, 1001 required tokens');
      const action = Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Open Machine Loadouts'));
      expect(action).toBeTruthy();
      act(() => { action?.click(); });
      expect(openMachineLoadout).toHaveBeenCalledWith('text.generate');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
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
