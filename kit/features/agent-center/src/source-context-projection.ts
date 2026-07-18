import {
  assertNimiRuntimeAgentContextProjectionCorrelation,
  decodeNimiRuntimeAgentSourceContextStatus,
  decodeNimiRuntimeAgentTurnContextSummary,
  type NimiRuntimeAgentSourceContextStatus,
  type NimiRuntimeAgentTurnContextSummary,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  AgentCenterSourceContextProjection,
  AgentCenterSourceCoverageSummary,
  AgentCenterSourceProjectionSummary,
  AgentCenterTurnContextProjectionSummary,
} from './types.js';

const SOURCE_FIELDS = new Set([
  'schemaVersion', 'ready', 'state', 'reasonCode', 'localAgentRef', 'sourceRef',
  'sourceSchemaVersion', 'snapshotSchemaVersion', 'snapshotHash', 'capturedAt',
  'worldContentHash', 'materializationContextHash', 'coverageSections',
]);
const WORLD_SOURCE_REF_FIELDS = new Set(['kind', 'id', 'worldId', 'worldEntityRef', 'sourceHash']);
const PERSONA_SOURCE_REF_FIELDS = new Set(['kind', 'id', 'worldId', 'ownerAccountId', 'sourceHash']);
const WORLD_ENTITY_REF_FIELDS = new Set(['kind', 'worldId', 'entityId']);
const COVERAGE_FIELDS = new Set([
  'section', 'state', 'requiredCount', 'resolvedCount', 'omittedCount',
]);
const TURN_FIELDS = new Set([
  'schemaVersion', 'ready', 'state', 'reasonCode', 'manifestSchemaVersion',
  'compilerSchemaVersion', 'manifestInstanceHash', 'contextContentHash',
  'promptHash', 'sourceSnapshotHash', 'sourceRef', 'worldContentHash',
  'materializationContextHash', 'lanes', 'budget', 'truncation',
  'transcriptTurnCount', 'memoryItemCount', 'mediaCount', 'toolCount',
  'routeDigest', 'catalogRevisionDigest', 'localAgentRef',
  'conversationAnchorId', 'turnId',
]);
const LANE_FIELDS = new Set([
  'laneId', 'state', 'includedItemCount', 'omittedItemCount',
  'truncatedItemCount', 'allocatedTokens', 'usedTokens',
]);
const BUDGET_FIELDS = new Set([
  'contextWindowTokens', 'reservedOutputTokens', 'reservedSafetyTokens',
  'reservedAdapterTokens', 'inputBudgetTokens', 'usedTokens',
]);
const TRUNCATION_FIELDS = new Set([
  'reason', 'omittedItemCount', 'truncatedItemCount',
]);

function hasOnlyFields(value: unknown, fields: ReadonlySet<string>): value is Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.keys(value).every((key) => fields.has(key));
}

function enumName(prefix: string, value: unknown): string {
  return `${prefix}${String(value).toUpperCase()}`;
}

function sourceKindName(value: unknown): string {
  return value === 'worldCharacter'
    ? 'CHARACTER_SOURCE_KIND_V3_WORLD_CHARACTER'
    : value === 'personaCharacter'
      ? 'CHARACTER_SOURCE_KIND_V3_PERSONA_CHARACTER'
      : `CHARACTER_SOURCE_KIND_V3_${String(value).toUpperCase()}`;
}

function sourceRefForDecoder(value: NimiRuntimeAgentSourceContextStatus['sourceRef']): unknown {
  if (!value) return undefined;
  if (value.kind === 'worldCharacter') {
    if (!hasOnlyFields(value, WORLD_SOURCE_REF_FIELDS)
      || !hasOnlyFields(value.worldEntityRef, WORLD_ENTITY_REF_FIELDS)) {
      throw new Error('world character source ref is not bounded');
    }
    return {
      worldCharacter: {
        ...value,
        kind: sourceKindName(value.kind),
        worldEntityRef: {
          ...value.worldEntityRef,
          kind: 'WORLD_ENTITY_REF_KIND_V3_WORLD_ENTITY',
        },
      },
    };
  }
  if (!hasOnlyFields(value, PERSONA_SOURCE_REF_FIELDS)) {
    throw new Error('persona character source ref is not bounded');
  }
  return {
    personaCharacter: { ...value, kind: sourceKindName(value.kind) },
  };
}

/** Re-encodes the SDK canonical union through its own strict decoder. */
function decodeCanonicalSource(
  value: NimiRuntimeAgentSourceContextStatus,
): NimiRuntimeAgentSourceContextStatus {
  if (!hasOnlyFields(value, SOURCE_FIELDS) || !Array.isArray(value.coverageSections)) {
    throw new Error('source projection is not bounded');
  }
  if (value.schemaVersion !== 'v2'
    || value.snapshotSchemaVersion !== null && value.snapshotSchemaVersion !== 'v2') {
    throw new Error('source projection version is not admitted');
  }
  const coverageSections = value.coverageSections.map((section) => {
    if (!hasOnlyFields(section, COVERAGE_FIELDS)) throw new Error('coverage is not bounded');
    return {
      ...section,
      section: enumName('AGENT_LOCAL_SOURCE_COVERAGE_SECTION_', section.section),
      state: enumName('AGENT_LOCAL_SOURCE_COVERAGE_STATE_', section.state),
    };
  });
  return decodeNimiRuntimeAgentSourceContextStatus({
    schemaVersion: 'AGENT_LOCAL_SOURCE_CONTEXT_SCHEMA_VERSION_V2',
    ready: value.ready,
    state: enumName('AGENT_LOCAL_SOURCE_CONTEXT_STATE_', value.state),
    reasonCode: enumName('AGENT_CONTEXT_PROJECTION_REASON_CODE_', value.reasonCode),
    localAgentRef: value.localAgentRef,
    ...(value.sourceRef ? { sourceRef: sourceRefForDecoder(value.sourceRef) } : {}),
    ...(value.sourceSchemaVersion ? { sourceSchemaVersion: value.sourceSchemaVersion } : {}),
    ...(value.snapshotSchemaVersion ? {
      snapshotSchemaVersion: 'AGENT_LOCAL_SOURCE_SNAPSHOT_SCHEMA_VERSION_V2',
    } : {}),
    ...(value.snapshotHash ? { snapshotHash: value.snapshotHash } : {}),
    ...(value.capturedAt ? { capturedAt: value.capturedAt } : {}),
    ...(value.worldContentHash ? { worldContentHash: value.worldContentHash } : {}),
    ...(value.materializationContextHash
      ? { materializationContextHash: value.materializationContextHash }
      : {}),
    coverageSections,
  });
}

function turnSourceRefForDecoder(value: NimiRuntimeAgentTurnContextSummary['sourceRef']): unknown {
  if (!value) return undefined;
  return sourceRefForDecoder(value);
}

/** Re-encodes the SDK canonical union through its own strict decoder. */
function decodeCanonicalTurn(
  value: NimiRuntimeAgentTurnContextSummary,
): NimiRuntimeAgentTurnContextSummary {
  if (!hasOnlyFields(value, TURN_FIELDS) || !Array.isArray(value.lanes)
    || !Array.isArray(value.truncation)) {
    throw new Error('turn projection is not bounded');
  }
  if (value.schemaVersion !== 'v1') {
    throw new Error('turn projection version is not admitted');
  }
  const lanes = value.lanes.map((lane) => {
    if (!hasOnlyFields(lane, LANE_FIELDS)) throw new Error('lane is not bounded');
    return {
      ...lane,
      laneId: enumName('AGENT_TURN_CONTEXT_LANE_ID_', lane.laneId),
      state: enumName('AGENT_TURN_CONTEXT_LANE_STATE_', lane.state),
    };
  });
  const truncation = value.truncation.map((entry) => {
    if (!hasOnlyFields(entry, TRUNCATION_FIELDS)) throw new Error('truncation is not bounded');
    return {
      ...entry,
      reason: enumName('AGENT_TURN_CONTEXT_TRUNCATION_REASON_', entry.reason),
    };
  });
  if (value.budget && !hasOnlyFields(value.budget, BUDGET_FIELDS)) {
    throw new Error('budget is not bounded');
  }
  const composed = value.state === 'ready' || value.state === 'context_capacity_exceeded';
  if (composed
    && (value.manifestSchemaVersion !== 'v1' || value.compilerSchemaVersion !== 'v1')) {
    throw new Error('turn composition version is not admitted');
  }
  return decodeNimiRuntimeAgentTurnContextSummary({
    schemaVersion: 'AGENT_TURN_CONTEXT_SUMMARY_SCHEMA_VERSION_V1',
    ready: value.ready,
    state: enumName('AGENT_TURN_CONTEXT_STATE_', value.state),
    reasonCode: enumName('AGENT_CONTEXT_PROJECTION_REASON_CODE_', value.reasonCode),
    localAgentRef: value.localAgentRef,
    conversationAnchorId: value.conversationAnchorId,
    turnId: value.turnId,
    ...(composed ? {
      manifestSchemaVersion: 'AGENT_TURN_CONTEXT_MANIFEST_SCHEMA_VERSION_V1',
      compilerSchemaVersion: 'AGENT_TURN_CONTEXT_COMPILER_SCHEMA_VERSION_V1',
      lanes,
      budget: value.budget,
      truncation,
    } : { lanes, truncation }),
    ...(value.manifestInstanceHash ? { manifestInstanceHash: value.manifestInstanceHash } : {}),
    ...(value.contextContentHash ? { contextContentHash: value.contextContentHash } : {}),
    ...(value.promptHash ? { promptHash: value.promptHash } : {}),
    ...(value.sourceSnapshotHash ? { sourceSnapshotHash: value.sourceSnapshotHash } : {}),
    ...(value.sourceRef ? { sourceRef: turnSourceRefForDecoder(value.sourceRef) } : {}),
    ...(value.worldContentHash ? { worldContentHash: value.worldContentHash } : {}),
    ...(value.materializationContextHash
      ? { materializationContextHash: value.materializationContextHash }
      : {}),
    transcriptTurnCount: value.transcriptTurnCount,
    memoryItemCount: value.memoryItemCount,
    mediaCount: value.mediaCount,
    toolCount: value.toolCount,
    ...(value.routeDigest ? { routeDigest: value.routeDigest } : {}),
    ...(value.catalogRevisionDigest ? { catalogRevisionDigest: value.catalogRevisionDigest } : {}),
  });
}

const UNKNOWN_PROJECTION: AgentCenterSourceContextProjection = {
  status: 'unknown',
  source: null,
  context: null,
};

const FAILED_PROJECTION: AgentCenterSourceContextProjection = {
  status: 'failed',
  source: null,
  context: null,
};

function sourceCoverage(
  source: Extract<NimiRuntimeAgentSourceContextStatus, { readonly ready: true }>,
): AgentCenterSourceCoverageSummary {
  return source.coverageSections.reduce<AgentCenterSourceCoverageSummary>((summary, section) => ({
    totalSections: summary.totalSections + 1,
    completeSections: summary.completeSections + (section.state === 'complete' ? 1 : 0),
    omittedSections: summary.omittedSections + (section.state === 'optional_omitted' ? 1 : 0),
    requiredItemCount: summary.requiredItemCount + section.requiredCount,
    resolvedItemCount: summary.resolvedItemCount + section.resolvedCount,
    omittedItemCount: summary.omittedItemCount + section.omittedCount,
  }), {
    totalSections: 0,
    completeSections: 0,
    omittedSections: 0,
    requiredItemCount: 0,
    resolvedItemCount: 0,
    omittedItemCount: 0,
  });
}

function sourceSummary(
  source: Extract<NimiRuntimeAgentSourceContextStatus, { readonly ready: true }>,
): AgentCenterSourceProjectionSummary {
  return {
    kind: source.sourceRef.kind,
    schemaVersion: source.schemaVersion,
    sourceSchemaVersion: source.sourceSchemaVersion,
    worldId: source.sourceRef.worldId,
    sourceId: source.sourceRef.id,
    sourceHash: source.sourceRef.sourceHash,
    snapshotHash: source.snapshotHash,
    worldContentHash: source.worldContentHash,
    materializationContextHash: source.materializationContextHash,
    capturedAt: source.capturedAt,
    coverage: sourceCoverage(source),
  };
}

function turnSummary(
  turn: Extract<NimiRuntimeAgentTurnContextSummary, { readonly manifestSchemaVersion: 'v1' }>,
): AgentCenterTurnContextProjectionSummary {
  return {
    schemaVersion: turn.schemaVersion,
    manifestSchemaVersion: turn.manifestSchemaVersion,
    compilerSchemaVersion: turn.compilerSchemaVersion,
    conversationAnchorId: turn.conversationAnchorId,
    turnId: turn.turnId,
    manifestInstanceHash: turn.manifestInstanceHash,
    contextContentHash: turn.contextContentHash,
    promptHash: turn.promptHash,
    lanes: turn.lanes.map((lane) => ({
      laneId: lane.laneId,
      state: lane.state,
      includedItemCount: lane.includedItemCount,
      omittedItemCount: lane.omittedItemCount,
      truncatedItemCount: lane.truncatedItemCount,
      allocatedTokens: lane.allocatedTokens,
      usedTokens: lane.usedTokens,
    })),
    budget: {
      contextWindowTokens: turn.budget.contextWindowTokens,
      inputBudgetTokens: turn.budget.inputBudgetTokens,
      usedTokens: turn.budget.usedTokens,
    },
    truncation: {
      omittedItemCount: turn.truncation[0].omittedItemCount,
      truncatedItemCount: turn.truncation[0].truncatedItemCount,
    },
    transcriptTurnCount: turn.transcriptTurnCount,
    memoryItemCount: turn.memoryItemCount,
    mediaCount: turn.mediaCount,
    toolCount: turn.toolCount,
    routeDigest: turn.routeDigest,
    catalogRevisionDigest: turn.catalogRevisionDigest,
  };
}

/**
 * Maps SDK-validated Runtime truth into a bounded, read-only Kit projection.
 * Invalid or contradictory input is collapsed to a closed failure state; no
 * decoder error, Runtime reason code, raw content, or execution authority is
 * retained by Agent Center state.
 */
export function projectAgentCenterSourceContext(input: {
  readonly sourceContextStatus?: NimiRuntimeAgentSourceContextStatus | null;
  readonly turnContextSummary?: NimiRuntimeAgentTurnContextSummary | null;
}): AgentCenterSourceContextProjection {
  if (!input.sourceContextStatus) {
    return input.turnContextSummary ? FAILED_PROJECTION : UNKNOWN_PROJECTION;
  }

  let source: NimiRuntimeAgentSourceContextStatus;
  let turn: NimiRuntimeAgentTurnContextSummary | null = null;
  try {
    source = decodeCanonicalSource(input.sourceContextStatus);
    turn = input.turnContextSummary
      ? decodeCanonicalTurn(input.turnContextSummary)
      : null;
    assertNimiRuntimeAgentContextProjectionCorrelation({
      sourceContextStatus: source,
      ...(turn ? { turnContextSummary: turn } : {}),
      expectedLocalAgentRef: source.localAgentRef,
    });
  } catch {
    return FAILED_PROJECTION;
  }

  if (!source.ready) {
    if (turn?.state === 'ready' || turn?.state === 'context_capacity_exceeded') {
      return FAILED_PROJECTION;
    }
    return {
      status: source.state === 'invalid' || source.state === 'deleted' ? 'failed' : 'blocked',
      source: null,
      context: null,
    };
  }

  const projectedSource = sourceSummary(source);
  if (!turn) {
    return {
      status: 'unknown',
      source: projectedSource,
      context: null,
    };
  }

  if (turn.state === 'invalid') {
    return {
      status: 'failed',
      source: projectedSource,
      context: null,
    };
  }
  if (turn.state === 'not_composed') {
    const status = turn.reasonCode === 'context_not_composed'
      ? 'unknown'
      : 'failed';
    return {
      status,
      source: projectedSource,
      context: null,
    };
  }

  if (turn.state !== 'ready' && turn.state !== 'context_capacity_exceeded') {
    return {
      status: 'failed',
      source: projectedSource,
      context: null,
    };
  }

  const projectedTurn = turnSummary(turn);
  if (turn.state === 'context_capacity_exceeded') {
    return {
      status: 'blocked',
      source: projectedSource,
      context: projectedTurn,
    };
  }

  const truncation = turn.truncation[0]!;
  const truncated = truncation.reason !== 'none'
    || truncation.omittedItemCount > 0
    || truncation.truncatedItemCount > 0;
  return {
    status: truncated ? 'truncated' : 'ready',
    source: projectedSource,
    context: projectedTurn,
  };
}
