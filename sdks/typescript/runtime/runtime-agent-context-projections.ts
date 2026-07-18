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
import { isRuntimeLocalAgentRef } from './agent-local-identity';
import {
  aliased,
  digest,
  enumValue,
  exactText,
  optionalDigest,
  optionalExactText,
  projectionError,
  record,
  timestamp,
  uint32,
  uint32Default,
  uint64,
  uint64Default,
  version,
  type UnknownRecord,
} from './runtime-agent-context-projection-validation';
import {
  decodeNimiRuntimeAgentSourceRef,
  type NimiRuntimeAgentSourceContextStatus,
  type NimiRuntimeAgentSourceRef,
} from './runtime-agent-source-context-projection';

export { decodeNimiRuntimeAgentSourceContextStatus } from './runtime-agent-source-context-projection';
export type {
  NimiRuntimeAgentPersonaCharacterSourceRefV3,
  NimiRuntimeAgentSourceContextStatus,
  NimiRuntimeAgentSourceCoverageSection,
  NimiRuntimeAgentSourceCoverageStatus,
  NimiRuntimeAgentSourceKind,
  NimiRuntimeAgentSourceRef,
  NimiRuntimeAgentWorldCharacterSourceRefV3,
  NimiRuntimeAgentWorldEntityRefV3,
} from './runtime-agent-source-context-projection';

export const NIMI_RUNTIME_AGENT_TURN_CONTEXT_LANE_ORDER = [
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

export type NimiRuntimeAgentTurnContextLaneId =
  (typeof NIMI_RUNTIME_AGENT_TURN_CONTEXT_LANE_ORDER)[number];

export type NimiRuntimeAgentTurnContextLaneSummary = {
  readonly laneId: NimiRuntimeAgentTurnContextLaneId;
  readonly state: 'included' | 'empty' | 'omitted' | 'truncated';
  readonly includedItemCount: number;
  readonly omittedItemCount: number;
  readonly truncatedItemCount: number;
  readonly allocatedTokens: string;
  readonly usedTokens: string;
};

export type NimiRuntimeAgentTurnContextBudgetSummary = {
  readonly contextWindowTokens: string;
  readonly reservedOutputTokens: string;
  readonly reservedSafetyTokens: string;
  readonly reservedAdapterTokens: string;
  readonly inputBudgetTokens: string;
  readonly usedTokens: string;
};

export type NimiRuntimeAgentTurnContextTruncationSummary = {
  readonly reason:
    | 'none'
    | 'input_budget_exhausted'
    | 'optional_content_omitted'
    | 'context_capacity_exceeded';
  readonly omittedItemCount: number;
  readonly truncatedItemCount: number;
};

type NimiRuntimeAgentTurnContextIdentity = {
  readonly localAgentRef: string;
  readonly conversationAnchorId: string;
  readonly turnId: string;
};

type NimiRuntimeAgentComposedTurnContextSummary = NimiRuntimeAgentTurnContextIdentity & {
  readonly schemaVersion: 'v1';
  readonly manifestSchemaVersion: 'v1';
  readonly compilerSchemaVersion: 'v1';
  readonly manifestInstanceHash: string | null;
  readonly contextContentHash: string | null;
  readonly promptHash: string | null;
  readonly sourceSnapshotHash: string;
  readonly sourceRef: NimiRuntimeAgentSourceRef;
  readonly worldContentHash: string;
  readonly materializationContextHash: string;
  readonly lanes: readonly NimiRuntimeAgentTurnContextLaneSummary[];
  readonly budget: NimiRuntimeAgentTurnContextBudgetSummary;
  readonly truncation: readonly [NimiRuntimeAgentTurnContextTruncationSummary];
  readonly transcriptTurnCount: number;
  readonly memoryItemCount: number;
  readonly mediaCount: number;
  readonly toolCount: number;
  readonly routeDigest: string;
  readonly catalogRevisionDigest: string;
};

export type NimiRuntimeAgentTurnContextReadySummary = NimiRuntimeAgentComposedTurnContextSummary & {
  readonly ready: true;
  readonly state: 'ready';
  readonly reasonCode: 'none';
  readonly manifestInstanceHash: string;
  readonly contextContentHash: string;
  readonly promptHash: string;
};

export type NimiRuntimeAgentTurnContextCapacitySummary = NimiRuntimeAgentComposedTurnContextSummary & {
  readonly ready: false;
  readonly state: 'context_capacity_exceeded';
  readonly reasonCode: 'context_capacity_exceeded';
  readonly manifestInstanceHash: null;
  readonly contextContentHash: null;
  readonly promptHash: null;
};

export type NimiRuntimeAgentTurnContextFailureSummary = NimiRuntimeAgentTurnContextIdentity & {
  readonly schemaVersion: 'v1';
  readonly ready: false;
  readonly state: 'not_composed' | 'invalid';
  readonly reasonCode:
    | 'source_not_materialized'
    | 'source_validation_pending'
    | 'source_snapshot_invalid'
    | 'context_not_composed'
    | 'context_manifest_invalid';
  readonly manifestSchemaVersion: null;
  readonly compilerSchemaVersion: null;
  readonly manifestInstanceHash: null;
  readonly contextContentHash: null;
  readonly promptHash: null;
  readonly sourceSnapshotHash: string | null;
  readonly sourceRef: NimiRuntimeAgentSourceRef | null;
  readonly worldContentHash: string | null;
  readonly materializationContextHash: string | null;
  readonly lanes: readonly [];
  readonly budget: null;
  readonly truncation: readonly [];
  readonly transcriptTurnCount: 0;
  readonly memoryItemCount: 0;
  readonly mediaCount: 0;
  readonly toolCount: 0;
  readonly routeDigest: null;
  readonly catalogRevisionDigest: null;
};

export type NimiRuntimeAgentTurnContextSummary =
  | NimiRuntimeAgentTurnContextReadySummary
  | NimiRuntimeAgentTurnContextCapacitySummary
  | NimiRuntimeAgentTurnContextFailureSummary;

const TURN_SUMMARY_FIELDS = new Set([
  'schemaVersion', 'schema_version', 'ready', 'state', 'reasonCode', 'reason_code',
  'manifestSchemaVersion', 'manifest_schema_version', 'compilerSchemaVersion', 'compiler_schema_version',
  'manifestInstanceHash', 'manifest_instance_hash', 'contextContentHash', 'context_content_hash',
  'promptHash', 'prompt_hash', 'sourceSnapshotHash', 'source_snapshot_hash', 'sourceRef', 'source_ref',
  'worldContentHash', 'world_content_hash', 'materializationContextHash', 'materialization_context_hash',
  'lanes', 'budget', 'truncation', 'transcriptTurnCount', 'transcript_turn_count',
  'memoryItemCount', 'memory_item_count', 'mediaCount', 'media_count', 'toolCount', 'tool_count',
  'routeDigest', 'route_digest', 'catalogRevisionDigest', 'catalog_revision_digest',
  'localAgentRef', 'local_agent_ref', 'conversationAnchorId', 'conversation_anchor_id', 'turnId', 'turn_id',
]);
const LANE_FIELDS = new Set([
  'laneId', 'lane_id', 'state', 'includedItemCount', 'included_item_count',
  'omittedItemCount', 'omitted_item_count', 'truncatedItemCount', 'truncated_item_count',
  'allocatedTokens', 'allocated_tokens', 'usedTokens', 'used_tokens',
]);
const BUDGET_FIELDS = new Set([
  'contextWindowTokens', 'context_window_tokens', 'reservedOutputTokens', 'reserved_output_tokens',
  'reservedSafetyTokens', 'reserved_safety_tokens', 'reservedAdapterTokens', 'reserved_adapter_tokens',
  'inputBudgetTokens', 'input_budget_tokens', 'usedTokens', 'used_tokens',
]);
const TRUNCATION_FIELDS = new Set([
  'reason', 'omittedItemCount', 'omitted_item_count', 'truncatedItemCount', 'truncated_item_count',
]);

const TURN_STATE = new Map<unknown, NimiRuntimeAgentTurnContextSummary['state']>([
  [AgentTurnContextState.NOT_COMPOSED, 'not_composed'],
  ['AGENT_TURN_CONTEXT_STATE_NOT_COMPOSED', 'not_composed'],
  [AgentTurnContextState.READY, 'ready'],
  ['AGENT_TURN_CONTEXT_STATE_READY', 'ready'],
  [AgentTurnContextState.CONTEXT_CAPACITY_EXCEEDED, 'context_capacity_exceeded'],
  ['AGENT_TURN_CONTEXT_STATE_CONTEXT_CAPACITY_EXCEEDED', 'context_capacity_exceeded'],
  [AgentTurnContextState.INVALID, 'invalid'],
  ['AGENT_TURN_CONTEXT_STATE_INVALID', 'invalid'],
]);
const REASON = new Map<unknown, NimiRuntimeAgentTurnContextSummary['reasonCode']>([
  [AgentContextProjectionReasonCode.NONE, 'none'],
  ['AGENT_CONTEXT_PROJECTION_REASON_CODE_NONE', 'none'],
  [AgentContextProjectionReasonCode.SOURCE_NOT_MATERIALIZED, 'source_not_materialized'],
  ['AGENT_CONTEXT_PROJECTION_REASON_CODE_SOURCE_NOT_MATERIALIZED', 'source_not_materialized'],
  [AgentContextProjectionReasonCode.SOURCE_VALIDATION_PENDING, 'source_validation_pending'],
  ['AGENT_CONTEXT_PROJECTION_REASON_CODE_SOURCE_VALIDATION_PENDING', 'source_validation_pending'],
  [AgentContextProjectionReasonCode.SOURCE_SNAPSHOT_INVALID, 'source_snapshot_invalid'],
  ['AGENT_CONTEXT_PROJECTION_REASON_CODE_SOURCE_SNAPSHOT_INVALID', 'source_snapshot_invalid'],
  [AgentContextProjectionReasonCode.CONTEXT_NOT_COMPOSED, 'context_not_composed'],
  ['AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_NOT_COMPOSED', 'context_not_composed'],
  [AgentContextProjectionReasonCode.CONTEXT_CAPACITY_EXCEEDED, 'context_capacity_exceeded'],
  ['AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_CAPACITY_EXCEEDED', 'context_capacity_exceeded'],
  [AgentContextProjectionReasonCode.CONTEXT_MANIFEST_INVALID, 'context_manifest_invalid'],
  ['AGENT_CONTEXT_PROJECTION_REASON_CODE_CONTEXT_MANIFEST_INVALID', 'context_manifest_invalid'],
]);
const LANE_ID = new Map<unknown, NimiRuntimeAgentTurnContextLaneId>(
  NIMI_RUNTIME_AGENT_TURN_CONTEXT_LANE_ORDER.flatMap((lane, index) => {
    const suffix = lane.toUpperCase();
    return [
      [index + 1, lane] as const,
      [`AGENT_TURN_CONTEXT_LANE_ID_${suffix}`, lane] as const,
    ];
  }),
);
const LANE_STATE = new Map<unknown, NimiRuntimeAgentTurnContextLaneSummary['state']>([
  [AgentTurnContextLaneState.INCLUDED, 'included'], ['AGENT_TURN_CONTEXT_LANE_STATE_INCLUDED', 'included'],
  [AgentTurnContextLaneState.EMPTY, 'empty'], ['AGENT_TURN_CONTEXT_LANE_STATE_EMPTY', 'empty'],
  [AgentTurnContextLaneState.OMITTED, 'omitted'], ['AGENT_TURN_CONTEXT_LANE_STATE_OMITTED', 'omitted'],
  [AgentTurnContextLaneState.TRUNCATED, 'truncated'], ['AGENT_TURN_CONTEXT_LANE_STATE_TRUNCATED', 'truncated'],
]);
const TRUNCATION_REASON = new Map<unknown, NimiRuntimeAgentTurnContextTruncationSummary['reason']>([
  [AgentTurnContextTruncationReason.NONE, 'none'], ['AGENT_TURN_CONTEXT_TRUNCATION_REASON_NONE', 'none'],
  [AgentTurnContextTruncationReason.INPUT_BUDGET_EXHAUSTED, 'input_budget_exhausted'],
  ['AGENT_TURN_CONTEXT_TRUNCATION_REASON_INPUT_BUDGET_EXHAUSTED', 'input_budget_exhausted'],
  [AgentTurnContextTruncationReason.OPTIONAL_CONTENT_OMITTED, 'optional_content_omitted'],
  ['AGENT_TURN_CONTEXT_TRUNCATION_REASON_OPTIONAL_CONTENT_OMITTED', 'optional_content_omitted'],
  [AgentTurnContextTruncationReason.CONTEXT_CAPACITY_EXCEEDED, 'context_capacity_exceeded'],
  ['AGENT_TURN_CONTEXT_TRUNCATION_REASON_CONTEXT_CAPACITY_EXCEEDED', 'context_capacity_exceeded'],
]);

function lanes(value: unknown): readonly NimiRuntimeAgentTurnContextLaneSummary[] {
  if (!Array.isArray(value) || value.length !== NIMI_RUNTIME_AGENT_TURN_CONTEXT_LANE_ORDER.length) {
    projectionError('turnContextSummary.lanes must contain the fixed eleven lanes');
  }
  return value.map((item, index) => {
    const input = record(item, `turnContextSummary.lanes[${index}]`, LANE_FIELDS);
    const laneId = enumValue(aliased(input, 'laneId', 'lane_id'), LANE_ID, `turnContextSummary.lanes[${index}].laneId`);
    if (laneId !== NIMI_RUNTIME_AGENT_TURN_CONTEXT_LANE_ORDER[index]) {
      projectionError(`turnContextSummary.lanes[${index}] violates fixed lane order`);
    }
    const state = enumValue(input.state, LANE_STATE, `turnContextSummary.lanes[${index}].state`);
    const includedItemCount = uint32Default(aliased(input, 'includedItemCount', 'included_item_count'), `turnContextSummary.lanes[${index}].includedItemCount`);
    const omittedItemCount = uint32Default(aliased(input, 'omittedItemCount', 'omitted_item_count'), `turnContextSummary.lanes[${index}].omittedItemCount`);
    const truncatedItemCount = uint32Default(aliased(input, 'truncatedItemCount', 'truncated_item_count'), `turnContextSummary.lanes[${index}].truncatedItemCount`);
    const allocatedTokens = uint64Default(aliased(input, 'allocatedTokens', 'allocated_tokens'), `turnContextSummary.lanes[${index}].allocatedTokens`);
    const usedTokens = uint64Default(aliased(input, 'usedTokens', 'used_tokens'), `turnContextSummary.lanes[${index}].usedTokens`);
    if (BigInt(usedTokens) > BigInt(allocatedTokens)
      || (state === 'empty' && (includedItemCount + omittedItemCount + truncatedItemCount !== 0 || usedTokens !== '0'))
      || (state === 'included' && (includedItemCount === 0 || truncatedItemCount !== 0))
      || (state === 'omitted' && (includedItemCount !== 0 || omittedItemCount === 0 || truncatedItemCount !== 0))
      || (state === 'truncated' && truncatedItemCount === 0)) {
      projectionError(`turnContextSummary.lanes[${index}] counts or tokens contradict state`);
    }
    return { laneId, state, includedItemCount, omittedItemCount, truncatedItemCount, allocatedTokens, usedTokens };
  });
}

function budget(
  value: unknown,
  state: 'ready' | 'context_capacity_exceeded',
): NimiRuntimeAgentTurnContextBudgetSummary {
  const input = record(value, 'turnContextSummary.budget', BUDGET_FIELDS);
  const result = {
    contextWindowTokens: uint64Default(aliased(input, 'contextWindowTokens', 'context_window_tokens'), 'turnContextSummary.budget.contextWindowTokens'),
    reservedOutputTokens: uint64Default(aliased(input, 'reservedOutputTokens', 'reserved_output_tokens'), 'turnContextSummary.budget.reservedOutputTokens'),
    reservedSafetyTokens: uint64Default(aliased(input, 'reservedSafetyTokens', 'reserved_safety_tokens'), 'turnContextSummary.budget.reservedSafetyTokens'),
    reservedAdapterTokens: uint64Default(aliased(input, 'reservedAdapterTokens', 'reserved_adapter_tokens'), 'turnContextSummary.budget.reservedAdapterTokens'),
    inputBudgetTokens: uint64Default(aliased(input, 'inputBudgetTokens', 'input_budget_tokens'), 'turnContextSummary.budget.inputBudgetTokens'),
    usedTokens: uint64Default(aliased(input, 'usedTokens', 'used_tokens'), 'turnContextSummary.budget.usedTokens'),
  };
  const contextWindow = BigInt(result.contextWindowTokens);
  const reserved = BigInt(result.reservedOutputTokens) + BigInt(result.reservedSafetyTokens) + BigInt(result.reservedAdapterTokens);
  const expectedInputBudget = contextWindow > reserved ? contextWindow - reserved : 0n;
  if (contextWindow === 0n
      || expectedInputBudget !== BigInt(result.inputBudgetTokens)
      || (state === 'ready' && contextWindow <= reserved)) {
    projectionError('turnContextSummary.budget reserves and input budget are inconsistent');
  }
  return result;
}

function truncation(value: unknown): readonly [NimiRuntimeAgentTurnContextTruncationSummary] {
  if (!Array.isArray(value) || value.length !== 1) projectionError('turnContextSummary.truncation must contain one aggregate');
  const input = record(value[0], 'turnContextSummary.truncation[0]', TRUNCATION_FIELDS);
  return [{
    reason: enumValue(input.reason, TRUNCATION_REASON, 'turnContextSummary.truncation[0].reason'),
    omittedItemCount: uint32Default(aliased(input, 'omittedItemCount', 'omitted_item_count'), 'turnContextSummary.truncation[0].omittedItemCount'),
    truncatedItemCount: uint32Default(aliased(input, 'truncatedItemCount', 'truncated_item_count'), 'turnContextSummary.truncation[0].truncatedItemCount'),
  }];
}

function isEmptyComposition(input: UnknownRecord): boolean {
  const manifest = aliased(input, 'manifestSchemaVersion', 'manifest_schema_version');
  const compiler = aliased(input, 'compilerSchemaVersion', 'compiler_schema_version');
  return (manifest === undefined
      || manifest === AgentTurnContextManifestSchemaVersion.UNSPECIFIED
      || manifest === 'AGENT_TURN_CONTEXT_MANIFEST_SCHEMA_VERSION_UNSPECIFIED')
    && (compiler === undefined
      || compiler === AgentTurnContextCompilerSchemaVersion.UNSPECIFIED
      || compiler === 'AGENT_TURN_CONTEXT_COMPILER_SCHEMA_VERSION_UNSPECIFIED');
}

export function decodeNimiRuntimeAgentTurnContextSummary(value: unknown): NimiRuntimeAgentTurnContextSummary {
  const input = record(value, 'turnContextSummary', TURN_SUMMARY_FIELDS);
  version(aliased(input, 'schemaVersion', 'schema_version'), AgentTurnContextSummarySchemaVersion.V1,
    'AGENT_TURN_CONTEXT_SUMMARY_SCHEMA_VERSION_V1', 'turnContextSummary.schemaVersion', 'v1');
  const state = enumValue(input.state, TURN_STATE, 'turnContextSummary.state');
  const reasonCode = enumValue(aliased(input, 'reasonCode', 'reason_code'), REASON, 'turnContextSummary.reasonCode');
  const ready = input.ready === undefined ? false : input.ready;
  if (typeof ready !== 'boolean') projectionError('turnContextSummary.ready must be boolean');
  const localAgentRef = exactText(aliased(input, 'localAgentRef', 'local_agent_ref'), 'turnContextSummary.localAgentRef');
  if (!isRuntimeLocalAgentRef(localAgentRef)) projectionError('turnContextSummary.localAgentRef is not Runtime-owned');
  const identity = {
    localAgentRef,
    conversationAnchorId: exactText(aliased(input, 'conversationAnchorId', 'conversation_anchor_id'), 'turnContextSummary.conversationAnchorId'),
    turnId: exactText(aliased(input, 'turnId', 'turn_id'), 'turnContextSummary.turnId'),
  };
  if (state === 'not_composed' || state === 'invalid') {
    const admittedReasons = state === 'not_composed'
      ? new Set(['source_not_materialized', 'source_validation_pending', 'context_not_composed'])
      : new Set(['source_snapshot_invalid', 'context_manifest_invalid']);
    const rawLanes = input.lanes ?? [];
    const rawTruncation = input.truncation ?? [];
    const sourceSnapshotHash = optionalDigest(aliased(input, 'sourceSnapshotHash', 'source_snapshot_hash'), 'turnContextSummary.sourceSnapshotHash');
    const source = aliased(input, 'sourceRef', 'source_ref');
    const projectedSource = source ? decodeNimiRuntimeAgentSourceRef(source, 'turnContextSummary.sourceRef') : null;
    const worldContentHash = optionalDigest(aliased(input, 'worldContentHash', 'world_content_hash'), 'turnContextSummary.worldContentHash');
    const materializationContextHash = optionalDigest(aliased(input, 'materializationContextHash', 'materialization_context_hash'), 'turnContextSummary.materializationContextHash');
    const sourceParts = [sourceSnapshotHash, projectedSource, worldContentHash, materializationContextHash];
    if (ready !== false || !admittedReasons.has(reasonCode) || !isEmptyComposition(input)
      || optionalExactText(aliased(input, 'manifestInstanceHash', 'manifest_instance_hash'), 'turnContextSummary.manifestInstanceHash')
      || optionalExactText(aliased(input, 'contextContentHash', 'context_content_hash'), 'turnContextSummary.contextContentHash')
      || optionalExactText(aliased(input, 'promptHash', 'prompt_hash'), 'turnContextSummary.promptHash')
      || input.budget !== undefined && input.budget !== null
      || !Array.isArray(rawLanes) || rawLanes.length !== 0
      || !Array.isArray(rawTruncation) || rawTruncation.length !== 0
      || sourceParts.some(Boolean) && !sourceParts.every(Boolean)
      || uint32Default(aliased(input, 'transcriptTurnCount', 'transcript_turn_count'), 'turnContextSummary.transcriptTurnCount') !== 0
      || uint32Default(aliased(input, 'memoryItemCount', 'memory_item_count'), 'turnContextSummary.memoryItemCount') !== 0
      || uint32Default(aliased(input, 'mediaCount', 'media_count'), 'turnContextSummary.mediaCount') !== 0
      || uint32Default(aliased(input, 'toolCount', 'tool_count'), 'turnContextSummary.toolCount') !== 0
      || optionalExactText(aliased(input, 'routeDigest', 'route_digest'), 'turnContextSummary.routeDigest')
      || optionalExactText(aliased(input, 'catalogRevisionDigest', 'catalog_revision_digest'), 'turnContextSummary.catalogRevisionDigest')) {
      projectionError('turnContextSummary failure state is partial or inconsistent');
    }
    return {
      schemaVersion: 'v1', ready: false, state, reasonCode: reasonCode as NimiRuntimeAgentTurnContextFailureSummary['reasonCode'],
      manifestSchemaVersion: null, compilerSchemaVersion: null,
      manifestInstanceHash: null, contextContentHash: null, promptHash: null,
      sourceSnapshotHash, sourceRef: projectedSource, worldContentHash, materializationContextHash,
      lanes: [], budget: null, truncation: [], transcriptTurnCount: 0, memoryItemCount: 0, mediaCount: 0, toolCount: 0,
      routeDigest: null, catalogRevisionDigest: null, ...identity,
    };
  }
  version(aliased(input, 'manifestSchemaVersion', 'manifest_schema_version'), AgentTurnContextManifestSchemaVersion.V1,
    'AGENT_TURN_CONTEXT_MANIFEST_SCHEMA_VERSION_V1', 'turnContextSummary.manifestSchemaVersion', 'v1');
  version(aliased(input, 'compilerSchemaVersion', 'compiler_schema_version'), AgentTurnContextCompilerSchemaVersion.V1,
    'AGENT_TURN_CONTEXT_COMPILER_SCHEMA_VERSION_V1', 'turnContextSummary.compilerSchemaVersion', 'v1');
  const projectedLanes = lanes(input.lanes);
  const projectedBudget = budget(input.budget, state);
  const projectedTruncation = truncation(input.truncation);
  const omitted = projectedLanes.reduce((sum, lane) => sum + lane.omittedItemCount, 0);
  const truncated = projectedLanes.reduce((sum, lane) => sum + lane.truncatedItemCount, 0);
  if (projectedTruncation[0].omittedItemCount !== omitted || projectedTruncation[0].truncatedItemCount !== truncated) {
    projectionError('turnContextSummary truncation aggregate does not match lanes');
  }
  const currentUserLane = projectedLanes[projectedLanes.length - 1];
  if (currentUserLane?.state !== 'included' || currentUserLane.includedItemCount !== 1) {
    projectionError('turnContextSummary current_user_turn lane is not exactly one included item');
  }
  const common = {
    schemaVersion: 'v1' as const,
    manifestSchemaVersion: 'v1' as const,
    compilerSchemaVersion: 'v1' as const,
    sourceSnapshotHash: digest(aliased(input, 'sourceSnapshotHash', 'source_snapshot_hash'), 'turnContextSummary.sourceSnapshotHash'),
    sourceRef: decodeNimiRuntimeAgentSourceRef(aliased(input, 'sourceRef', 'source_ref'), 'turnContextSummary.sourceRef'),
    worldContentHash: digest(aliased(input, 'worldContentHash', 'world_content_hash'), 'turnContextSummary.worldContentHash'),
    materializationContextHash: digest(aliased(input, 'materializationContextHash', 'materialization_context_hash'), 'turnContextSummary.materializationContextHash'),
    lanes: projectedLanes,
    budget: projectedBudget,
    truncation: projectedTruncation,
    transcriptTurnCount: uint32Default(aliased(input, 'transcriptTurnCount', 'transcript_turn_count'), 'turnContextSummary.transcriptTurnCount'),
    memoryItemCount: uint32Default(aliased(input, 'memoryItemCount', 'memory_item_count'), 'turnContextSummary.memoryItemCount'),
    mediaCount: uint32Default(aliased(input, 'mediaCount', 'media_count'), 'turnContextSummary.mediaCount'),
    toolCount: uint32Default(aliased(input, 'toolCount', 'tool_count'), 'turnContextSummary.toolCount'),
    routeDigest: digest(aliased(input, 'routeDigest', 'route_digest'), 'turnContextSummary.routeDigest'),
    catalogRevisionDigest: digest(aliased(input, 'catalogRevisionDigest', 'catalog_revision_digest'), 'turnContextSummary.catalogRevisionDigest'),
    ...identity,
  };
  if (state === 'ready') {
    if (ready !== true || reasonCode !== 'none' || BigInt(projectedBudget.usedTokens) > BigInt(projectedBudget.inputBudgetTokens)
      || projectedTruncation[0].reason === 'none' !== (omitted === 0 && truncated === 0)) {
      projectionError('turnContextSummary ready state is inconsistent');
    }
    return {
      ...common, ready: true, state, reasonCode,
      manifestInstanceHash: digest(aliased(input, 'manifestInstanceHash', 'manifest_instance_hash'), 'turnContextSummary.manifestInstanceHash'),
      contextContentHash: digest(aliased(input, 'contextContentHash', 'context_content_hash'), 'turnContextSummary.contextContentHash'),
      promptHash: digest(aliased(input, 'promptHash', 'prompt_hash'), 'turnContextSummary.promptHash'),
    };
  }
  if (ready !== false || state !== 'context_capacity_exceeded' || reasonCode !== 'context_capacity_exceeded'
    || projectedTruncation[0].reason !== 'context_capacity_exceeded'
    || optionalExactText(aliased(input, 'manifestInstanceHash', 'manifest_instance_hash'), 'turnContextSummary.manifestInstanceHash')
    || optionalExactText(aliased(input, 'contextContentHash', 'context_content_hash'), 'turnContextSummary.contextContentHash')
    || optionalExactText(aliased(input, 'promptHash', 'prompt_hash'), 'turnContextSummary.promptHash')) {
    projectionError('turnContextSummary capacity state is inconsistent');
  }
  return {
    ...common, ready: false, state, reasonCode,
    manifestInstanceHash: null, contextContentHash: null, promptHash: null,
  };
}

export function assertNimiRuntimeAgentContextProjectionCorrelation(input: {
  readonly sourceContextStatus?: NimiRuntimeAgentSourceContextStatus;
  readonly turnContextSummary?: NimiRuntimeAgentTurnContextSummary;
  readonly expectedLocalAgentRef?: string;
  readonly expectedConversationAnchorId?: string;
  readonly expectedTurnId?: string;
}): void {
  const source = input.sourceContextStatus;
  const turn = input.turnContextSummary;
  if (input.expectedLocalAgentRef
      && (source?.localAgentRef !== undefined && source.localAgentRef !== input.expectedLocalAgentRef
        || turn?.localAgentRef !== undefined && turn.localAgentRef !== input.expectedLocalAgentRef)) {
    projectionError('localAgentRef correlation failed');
  }
  if (input.expectedConversationAnchorId && turn && turn.conversationAnchorId !== input.expectedConversationAnchorId) {
    projectionError('conversationAnchorId correlation failed');
  }
  if (input.expectedTurnId && turn && turn.turnId !== input.expectedTurnId) {
    projectionError('turnId correlation failed');
  }
  if (source && source.sourceRef && turn && turn.sourceRef
      && (source.snapshotHash !== turn.sourceSnapshotHash
        || source.worldContentHash !== turn.worldContentHash
        || source.materializationContextHash !== turn.materializationContextHash
        || !sourceRefsEqual(source.sourceRef, turn.sourceRef))) {
    projectionError('source and turn provenance correlation failed');
  }
}

function sourceRefsEqual(left: NimiRuntimeAgentSourceRef, right: NimiRuntimeAgentSourceRef): boolean {
  if (left.kind !== right.kind
      || left.id !== right.id
      || left.worldId !== right.worldId
      || left.sourceHash !== right.sourceHash) {
    return false;
  }
  if (left.kind === 'worldCharacter' && right.kind === 'worldCharacter') {
    return left.worldEntityRef.kind === right.worldEntityRef.kind
      && left.worldEntityRef.worldId === right.worldEntityRef.worldId
      && left.worldEntityRef.entityId === right.worldEntityRef.entityId;
  }
  return left.kind === 'personaCharacter'
    && right.kind === 'personaCharacter'
    && left.ownerAccountId === right.ownerAccountId;
}
