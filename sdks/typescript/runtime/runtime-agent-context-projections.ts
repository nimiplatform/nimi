import {
  AgentContextProjectionReasonCode,
  AgentConversationSummaryStatus,
  AgentLocalSourceContextSchemaVersion,
  AgentLocalSourceContextState,
  AgentLocalSourceCoverageSection,
  AgentLocalSourceCoverageState,
  AgentLocalSourceSnapshotSchemaVersion,
  AgentSourceCognitionStatus,
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
  'cognition_source',
  'canonical_memory',
  'conversation_summary',
  'conversation_history',
  'capability_context',
  'current_user_turn',
  'private_recall',
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
  readonly reservedReasoningTokens: string;
  readonly reservedSafetyTokens: string;
  readonly reservedAdapterTokens: string;
  readonly inputBudgetTokens: string;
  readonly usedTokens: string;
  readonly requiredInputTokens: string;
  readonly requiredContextWindowTokens: string;
};

export type NimiRuntimeAgentSourceCognitionSummary = {
  readonly adapterStatus: 'unconfigured' | 'building' | 'ready' | 'unavailable' | 'failure' | 'no_hits';
  readonly selectionStatus: 'unconfigured' | 'building' | 'ready' | 'unavailable' | 'failure' | 'no_hits' | 'no_result';
  readonly generation: string;
  readonly candidateCount: number;
  readonly includedUnitCount: number;
  readonly omittedUnitCount: number;
};

export type NimiRuntimeAgentConversationContextSummary = {
  readonly status: 'absent' | 'ready' | 'failed' | 'omitted' | 'unavailable';
  readonly revision: string;
  readonly coveredSequenceStart: string;
  readonly coveredSequenceEnd: string;
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
  readonly schemaVersion: 'v2';
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
  readonly sourceCognition: NimiRuntimeAgentSourceCognitionSummary;
  readonly conversationSummary: NimiRuntimeAgentConversationContextSummary;
  readonly privateRecallCount: number;
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
  readonly schemaVersion: 'v2';
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
  readonly sourceCognition: null;
  readonly conversationSummary: null;
  readonly privateRecallCount: 0;
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
  'sourceCognition', 'source_cognition', 'conversationSummary', 'conversation_summary',
  'privateRecallCount', 'private_recall_count',
]);
const LANE_FIELDS = new Set([
  'laneId', 'lane_id', 'state', 'includedItemCount', 'included_item_count',
  'omittedItemCount', 'omitted_item_count', 'truncatedItemCount', 'truncated_item_count',
  'allocatedTokens', 'allocated_tokens', 'usedTokens', 'used_tokens',
]);
const BUDGET_FIELDS = new Set([
  'contextWindowTokens', 'context_window_tokens', 'reservedOutputTokens', 'reserved_output_tokens',
  'reservedReasoningTokens', 'reserved_reasoning_tokens',
  'reservedSafetyTokens', 'reserved_safety_tokens', 'reservedAdapterTokens', 'reserved_adapter_tokens',
  'inputBudgetTokens', 'input_budget_tokens', 'usedTokens', 'used_tokens',
  'requiredInputTokens', 'required_input_tokens', 'requiredContextWindowTokens', 'required_context_window_tokens',
]);
const TRUNCATION_FIELDS = new Set([
  'reason', 'omittedItemCount', 'omitted_item_count', 'truncatedItemCount', 'truncated_item_count',
]);
const SOURCE_COGNITION_FIELDS = new Set([
  'adapterStatus', 'adapter_status', 'selectionStatus', 'selection_status', 'generation',
  'candidateCount', 'candidate_count', 'includedUnitCount', 'included_unit_count',
  'omittedUnitCount', 'omitted_unit_count',
]);
const CONVERSATION_SUMMARY_FIELDS = new Set([
  'status', 'revision', 'coveredSequenceStart', 'covered_sequence_start',
  'coveredSequenceEnd', 'covered_sequence_end',
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
const LANE_ID = new Map<unknown, NimiRuntimeAgentTurnContextLaneId>([
  [AgentTurnContextLaneId.RUNTIME_POLICY, 'runtime_policy'],
  [AgentTurnContextLaneId.OUTPUT_CONTRACT, 'output_contract'],
  [AgentTurnContextLaneId.SOURCE_IDENTITY, 'source_identity'],
  [AgentTurnContextLaneId.SOURCE_BEHAVIOR, 'source_behavior'],
  [AgentTurnContextLaneId.WORLD_CONTEXT, 'world_context'],
  [AgentTurnContextLaneId.RELATIONSHIP_CONTEXT, 'relationship_context'],
  [AgentTurnContextLaneId.SOURCE_KNOWLEDGE, 'source_knowledge'],
  [AgentTurnContextLaneId.COGNITION_SOURCE, 'cognition_source'],
  [AgentTurnContextLaneId.CANONICAL_MEMORY, 'canonical_memory'],
  [AgentTurnContextLaneId.CONVERSATION_SUMMARY, 'conversation_summary'],
  [AgentTurnContextLaneId.CONVERSATION_HISTORY, 'conversation_history'],
  [AgentTurnContextLaneId.CAPABILITY_CONTEXT, 'capability_context'],
  [AgentTurnContextLaneId.CURRENT_USER_TURN, 'current_user_turn'],
  [AgentTurnContextLaneId.PRIVATE_RECALL, 'private_recall'],
  ...NIMI_RUNTIME_AGENT_TURN_CONTEXT_LANE_ORDER.map((lane) => (
    [`AGENT_TURN_CONTEXT_LANE_ID_${lane.toUpperCase()}`, lane] as const
  )),
]);
const OPTIONAL_LANES = new Set<NimiRuntimeAgentTurnContextLaneId>([
  'cognition_source', 'conversation_summary', 'private_recall',
]);
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
const SOURCE_COGNITION_STATUS = new Map<unknown, NimiRuntimeAgentSourceCognitionSummary['selectionStatus']>([
  [AgentSourceCognitionStatus.UNCONFIGURED, 'unconfigured'], ['AGENT_SOURCE_COGNITION_STATUS_UNCONFIGURED', 'unconfigured'],
  [AgentSourceCognitionStatus.BUILDING, 'building'], ['AGENT_SOURCE_COGNITION_STATUS_BUILDING', 'building'],
  [AgentSourceCognitionStatus.READY, 'ready'], ['AGENT_SOURCE_COGNITION_STATUS_READY', 'ready'],
  [AgentSourceCognitionStatus.UNAVAILABLE, 'unavailable'], ['AGENT_SOURCE_COGNITION_STATUS_UNAVAILABLE', 'unavailable'],
  [AgentSourceCognitionStatus.FAILURE, 'failure'], ['AGENT_SOURCE_COGNITION_STATUS_FAILURE', 'failure'],
  [AgentSourceCognitionStatus.NO_HITS, 'no_hits'], ['AGENT_SOURCE_COGNITION_STATUS_NO_HITS', 'no_hits'],
  [AgentSourceCognitionStatus.NO_RESULT, 'no_result'], ['AGENT_SOURCE_COGNITION_STATUS_NO_RESULT', 'no_result'],
]);
const CONVERSATION_SUMMARY_STATUS = new Map<unknown, NimiRuntimeAgentConversationContextSummary['status']>([
  [AgentConversationSummaryStatus.ABSENT, 'absent'], ['AGENT_CONVERSATION_SUMMARY_STATUS_ABSENT', 'absent'],
  [AgentConversationSummaryStatus.READY, 'ready'], ['AGENT_CONVERSATION_SUMMARY_STATUS_READY', 'ready'],
  [AgentConversationSummaryStatus.FAILED, 'failed'], ['AGENT_CONVERSATION_SUMMARY_STATUS_FAILED', 'failed'],
  [AgentConversationSummaryStatus.OMITTED, 'omitted'], ['AGENT_CONVERSATION_SUMMARY_STATUS_OMITTED', 'omitted'],
  [AgentConversationSummaryStatus.UNAVAILABLE, 'unavailable'], ['AGENT_CONVERSATION_SUMMARY_STATUS_UNAVAILABLE', 'unavailable'],
]);

function sourceCognition(value: unknown): NimiRuntimeAgentSourceCognitionSummary {
  const input = record(value, 'turnContextSummary.sourceCognition', SOURCE_COGNITION_FIELDS);
  const adapterStatus = enumValue(
    aliased(input, 'adapterStatus', 'adapter_status'),
    SOURCE_COGNITION_STATUS,
    'turnContextSummary.sourceCognition.adapterStatus',
  );
  if (adapterStatus === 'no_result') projectionError('source cognition adapter status cannot be no_result');
  const selectionStatus = enumValue(
    aliased(input, 'selectionStatus', 'selection_status'),
    SOURCE_COGNITION_STATUS,
    'turnContextSummary.sourceCognition.selectionStatus',
  );
  const result = {
    adapterStatus: adapterStatus as NimiRuntimeAgentSourceCognitionSummary['adapterStatus'],
    selectionStatus,
    generation: uint64Default(input.generation, 'turnContextSummary.sourceCognition.generation'),
    candidateCount: uint32Default(aliased(input, 'candidateCount', 'candidate_count'), 'turnContextSummary.sourceCognition.candidateCount'),
    includedUnitCount: uint32Default(aliased(input, 'includedUnitCount', 'included_unit_count'), 'turnContextSummary.sourceCognition.includedUnitCount'),
    omittedUnitCount: uint32Default(aliased(input, 'omittedUnitCount', 'omitted_unit_count'), 'turnContextSummary.sourceCognition.omittedUnitCount'),
  };
  if (result.includedUnitCount + result.omittedUnitCount > result.candidateCount
    || (result.adapterStatus !== 'ready' && (result.candidateCount !== 0 || result.includedUnitCount !== 0 || result.omittedUnitCount !== 0))
    || (result.selectionStatus === 'no_hits' && result.candidateCount !== 0)
    || (result.selectionStatus === 'no_result' && (result.candidateCount === 0 || result.includedUnitCount !== 0))) {
    projectionError('turnContextSummary.sourceCognition counts contradict status');
  }
  return result;
}

function conversationSummary(value: unknown): NimiRuntimeAgentConversationContextSummary {
  const input = record(value, 'turnContextSummary.conversationSummary', CONVERSATION_SUMMARY_FIELDS);
  const result = {
    status: enumValue(input.status, CONVERSATION_SUMMARY_STATUS, 'turnContextSummary.conversationSummary.status'),
    revision: uint64Default(input.revision, 'turnContextSummary.conversationSummary.revision'),
    coveredSequenceStart: uint64Default(aliased(input, 'coveredSequenceStart', 'covered_sequence_start'), 'turnContextSummary.conversationSummary.coveredSequenceStart'),
    coveredSequenceEnd: uint64Default(aliased(input, 'coveredSequenceEnd', 'covered_sequence_end'), 'turnContextSummary.conversationSummary.coveredSequenceEnd'),
  };
  if (BigInt(result.coveredSequenceEnd) < BigInt(result.coveredSequenceStart)
    || (result.status === 'absent' && (result.revision !== '0' || result.coveredSequenceStart !== '0' || result.coveredSequenceEnd !== '0'))
    || (result.revision === '0' && (result.coveredSequenceStart !== '0' || result.coveredSequenceEnd !== '0'))
    || (result.revision !== '0' && result.coveredSequenceStart !== '0')
    || ((result.status === 'ready' || result.status === 'omitted') && result.revision === '0')) {
    projectionError('turnContextSummary.conversationSummary range contradicts status');
  }
  return result;
}

function lanes(value: unknown): readonly NimiRuntimeAgentTurnContextLaneSummary[] {
  if (!Array.isArray(value)) {
    projectionError('turnContextSummary.lanes must be an array');
  }
  let expectedIndex = 0;
  const projected = value.map((item, index) => {
    const input = record(item, `turnContextSummary.lanes[${index}]`, LANE_FIELDS);
    const laneId = enumValue(aliased(input, 'laneId', 'lane_id'), LANE_ID, `turnContextSummary.lanes[${index}].laneId`);
    while (expectedIndex < NIMI_RUNTIME_AGENT_TURN_CONTEXT_LANE_ORDER.length
      && OPTIONAL_LANES.has(NIMI_RUNTIME_AGENT_TURN_CONTEXT_LANE_ORDER[expectedIndex]!)
      && laneId !== NIMI_RUNTIME_AGENT_TURN_CONTEXT_LANE_ORDER[expectedIndex]) {
      expectedIndex += 1;
    }
    if (laneId !== NIMI_RUNTIME_AGENT_TURN_CONTEXT_LANE_ORDER[expectedIndex]) {
      projectionError(`turnContextSummary.lanes[${index}] violates fixed lane order`);
    }
    expectedIndex += 1;
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
  while (expectedIndex < NIMI_RUNTIME_AGENT_TURN_CONTEXT_LANE_ORDER.length
    && OPTIONAL_LANES.has(NIMI_RUNTIME_AGENT_TURN_CONTEXT_LANE_ORDER[expectedIndex]!)) {
    expectedIndex += 1;
  }
  if (expectedIndex !== NIMI_RUNTIME_AGENT_TURN_CONTEXT_LANE_ORDER.length) {
    projectionError('turnContextSummary.lanes is incomplete');
  }
  return projected;
}

function budget(
  value: unknown,
  state: 'ready' | 'context_capacity_exceeded',
): NimiRuntimeAgentTurnContextBudgetSummary {
  const input = record(value, 'turnContextSummary.budget', BUDGET_FIELDS);
  const result = {
    contextWindowTokens: uint64Default(aliased(input, 'contextWindowTokens', 'context_window_tokens'), 'turnContextSummary.budget.contextWindowTokens'),
    reservedOutputTokens: uint64Default(aliased(input, 'reservedOutputTokens', 'reserved_output_tokens'), 'turnContextSummary.budget.reservedOutputTokens'),
    reservedReasoningTokens: uint64Default(aliased(input, 'reservedReasoningTokens', 'reserved_reasoning_tokens'), 'turnContextSummary.budget.reservedReasoningTokens'),
    reservedSafetyTokens: uint64Default(aliased(input, 'reservedSafetyTokens', 'reserved_safety_tokens'), 'turnContextSummary.budget.reservedSafetyTokens'),
    reservedAdapterTokens: uint64Default(aliased(input, 'reservedAdapterTokens', 'reserved_adapter_tokens'), 'turnContextSummary.budget.reservedAdapterTokens'),
    inputBudgetTokens: uint64Default(aliased(input, 'inputBudgetTokens', 'input_budget_tokens'), 'turnContextSummary.budget.inputBudgetTokens'),
    usedTokens: uint64Default(aliased(input, 'usedTokens', 'used_tokens'), 'turnContextSummary.budget.usedTokens'),
    requiredInputTokens: uint64Default(aliased(input, 'requiredInputTokens', 'required_input_tokens'), 'turnContextSummary.budget.requiredInputTokens'),
    requiredContextWindowTokens: uint64Default(aliased(input, 'requiredContextWindowTokens', 'required_context_window_tokens'), 'turnContextSummary.budget.requiredContextWindowTokens'),
  };
  const contextWindow = BigInt(result.contextWindowTokens);
  const reserved = BigInt(result.reservedOutputTokens) + BigInt(result.reservedReasoningTokens)
    + BigInt(result.reservedSafetyTokens) + BigInt(result.reservedAdapterTokens);
  const expectedInputBudget = contextWindow > reserved ? contextWindow - reserved : 0n;
  const expectedRequiredWindow = BigInt(result.requiredInputTokens) + reserved;
  if (contextWindow === 0n
      || expectedInputBudget !== BigInt(result.inputBudgetTokens)
      || expectedRequiredWindow !== BigInt(result.requiredContextWindowTokens)
      || (state === 'ready' && (contextWindow <= reserved || BigInt(result.requiredInputTokens) > BigInt(result.inputBudgetTokens)))
      || (state === 'context_capacity_exceeded' && BigInt(result.requiredInputTokens) <= BigInt(result.inputBudgetTokens))) {
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
  version(aliased(input, 'schemaVersion', 'schema_version'), AgentTurnContextSummarySchemaVersion.V2,
    'AGENT_TURN_CONTEXT_SUMMARY_SCHEMA_VERSION_V2', 'turnContextSummary.schemaVersion', 'v2');
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
      || aliased(input, 'sourceCognition', 'source_cognition') !== undefined
      || aliased(input, 'conversationSummary', 'conversation_summary') !== undefined
      || uint32Default(aliased(input, 'privateRecallCount', 'private_recall_count'), 'turnContextSummary.privateRecallCount') !== 0
      || optionalExactText(aliased(input, 'routeDigest', 'route_digest'), 'turnContextSummary.routeDigest')
      || optionalExactText(aliased(input, 'catalogRevisionDigest', 'catalog_revision_digest'), 'turnContextSummary.catalogRevisionDigest')) {
      projectionError('turnContextSummary failure state is partial or inconsistent');
    }
    return {
      schemaVersion: 'v2', ready: false, state, reasonCode: reasonCode as NimiRuntimeAgentTurnContextFailureSummary['reasonCode'],
      manifestSchemaVersion: null, compilerSchemaVersion: null,
      manifestInstanceHash: null, contextContentHash: null, promptHash: null,
      sourceSnapshotHash, sourceRef: projectedSource, worldContentHash, materializationContextHash,
      lanes: [], budget: null, truncation: [], transcriptTurnCount: 0, memoryItemCount: 0, mediaCount: 0, toolCount: 0,
      routeDigest: null, catalogRevisionDigest: null, sourceCognition: null, conversationSummary: null,
      privateRecallCount: 0, ...identity,
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
  const currentUserLane = projectedLanes.find((lane) => lane.laneId === 'current_user_turn');
  if (currentUserLane?.state !== 'included' || currentUserLane.includedItemCount !== 1) {
    projectionError('turnContextSummary current_user_turn lane is not exactly one included item');
  }
  const projectedSourceCognition = sourceCognition(aliased(input, 'sourceCognition', 'source_cognition'));
  const projectedConversationSummary = conversationSummary(aliased(input, 'conversationSummary', 'conversation_summary'));
  const projectedPrivateRecallCount = uint32Default(
    aliased(input, 'privateRecallCount', 'private_recall_count'),
    'turnContextSummary.privateRecallCount',
  );
  const privateRecallLane = projectedLanes.find((lane) => lane.laneId === 'private_recall');
  if (projectedPrivateRecallCount > 1
    || (projectedPrivateRecallCount === 1 && (privateRecallLane?.state !== 'included' || privateRecallLane.includedItemCount !== 1))
    || (projectedPrivateRecallCount === 0 && privateRecallLane !== undefined)) {
    projectionError('turnContextSummary private recall count contradicts lane projection');
  }
  const common = {
    schemaVersion: 'v2' as const,
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
    sourceCognition: projectedSourceCognition,
    conversationSummary: projectedConversationSummary,
    privateRecallCount: projectedPrivateRecallCount,
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
