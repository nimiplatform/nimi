import {
  AgentContextProjectionReasonCode,
  AgentLocalSourceContextSchemaVersion,
  AgentLocalSourceContextState,
  AgentLocalSourceCoverageSection,
  AgentLocalSourceCoverageState,
  AgentLocalSourceSnapshotSchemaVersion,
  AgentSourceMaterializationSourceKind,
  AgentTurnContextCompilerSchemaVersion,
  AgentTurnContextLaneId,
  AgentTurnContextLaneState,
  AgentTurnContextManifestSchemaVersion,
  AgentTurnContextState,
  AgentTurnContextSummarySchemaVersion,
  AgentTurnContextTruncationReason,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import { isRuntimeLocalAgentRef } from './agent-local-identity';

export type NimiRuntimeAgentSourceKind = 'worldCharacter' | 'realmPersona';

export type NimiRuntimeAgentSourceRef<Kind extends NimiRuntimeAgentSourceKind = NimiRuntimeAgentSourceKind> = {
  readonly kind: Kind;
  readonly worldId: string;
  readonly sourceId: string;
  readonly sourceContentHash: string;
};

export type NimiRuntimeAgentSourceCoverageSection =
  | 'identity'
  | 'presentation'
  | 'placement'
  | 'biography'
  | 'psychology'
  | 'knowledge'
  | 'relationships'
  | 'capabilities'
  | 'interaction_profile'
  | 'assets'
  | 'authoring'
  | 'persona_style'
  | 'content_profile'
  | 'world_core'
  | 'bound_entity'
  | 'dependency_closure';

export type NimiRuntimeAgentSourceCoverageStatus = {
  readonly section: NimiRuntimeAgentSourceCoverageSection;
  readonly state: 'complete' | 'not_applicable' | 'optional_omitted' | 'invalid';
  readonly requiredCount: number;
  readonly resolvedCount: number;
  readonly omittedCount: number;
};

type NimiRuntimeAgentReadySourceContextStatus<Kind extends NimiRuntimeAgentSourceKind> = {
  readonly schemaVersion: 'v1';
  readonly ready: true;
  readonly state: 'ready';
  readonly reasonCode: 'none';
  readonly localAgentRef: string;
  readonly sourceRef: NimiRuntimeAgentSourceRef<Kind>;
  readonly sourceSchemaVersion: Kind extends 'worldCharacter'
    ? 'realm.world-character-core/v1'
    : 'realm.persona/v1';
  readonly snapshotSchemaVersion: 'v1';
  readonly snapshotHash: string;
  readonly capturedAt: string;
  readonly worldContentHash: string;
  readonly materializationContextHash: string;
  readonly coverageSections: readonly NimiRuntimeAgentSourceCoverageStatus[];
};

type NimiRuntimeAgentUnavailableSourceContextStatus = {
  readonly schemaVersion: 'v1';
  readonly ready: false;
  readonly state: 'not_materialized' | 'validating' | 'invalid' | 'deleted';
  readonly reasonCode: 'source_not_materialized' | 'source_validation_pending' | 'source_snapshot_invalid';
  readonly localAgentRef: string;
  readonly sourceRef: NimiRuntimeAgentSourceRef | null;
  readonly sourceSchemaVersion: 'realm.world-character-core/v1' | 'realm.persona/v1' | null;
  readonly snapshotSchemaVersion: 'v1' | null;
  readonly snapshotHash: string | null;
  readonly capturedAt: string | null;
  readonly worldContentHash: string | null;
  readonly materializationContextHash: string | null;
  readonly coverageSections: readonly NimiRuntimeAgentSourceCoverageStatus[];
};

/** A closed Character/Persona readiness union with explicit non-ready discriminants. */
export type NimiRuntimeAgentSourceContextStatus =
  | NimiRuntimeAgentReadySourceContextStatus<'worldCharacter'>
  | NimiRuntimeAgentReadySourceContextStatus<'realmPersona'>
  | NimiRuntimeAgentUnavailableSourceContextStatus;

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

type UnknownRecord = Readonly<Record<string, unknown>>;

const SOURCE_STATUS_FIELDS = new Set([
  'schemaVersion', 'schema_version', 'ready', 'state', 'reasonCode', 'reason_code',
  'localAgentRef', 'local_agent_ref', 'sourceRef', 'source_ref',
  'sourceSchemaVersion', 'source_schema_version', 'snapshotSchemaVersion', 'snapshot_schema_version',
  'snapshotHash', 'snapshot_hash', 'capturedAt', 'captured_at',
  'worldContentHash', 'world_content_hash', 'materializationContextHash', 'materialization_context_hash',
  'coverageSections', 'coverage_sections',
]);
const SOURCE_REF_FIELDS = new Set([
  'kind', 'worldId', 'world_id', 'sourceId', 'source_id', 'sourceContentHash', 'source_content_hash',
]);
const COVERAGE_FIELDS = new Set([
  'section', 'state', 'requiredCount', 'required_count', 'resolvedCount', 'resolved_count',
  'omittedCount', 'omitted_count',
]);
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

function projectionError(message: string): never {
  throw createNimiError({
    message: `Runtime Agent bounded context projection ${message}.`,
    reasonCode: 'SDK_RUNTIME_AGENT_CONTEXT_PROJECTION_INVALID',
    actionHint: 'check_runtime_agent_bounded_context_projection',
    source: 'sdk',
  });
}

function record(value: unknown, label: string, allowed: ReadonlySet<string>): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    projectionError(`${label} must be an object`);
  }
  const result = value as UnknownRecord;
  const unknown = Object.keys(result).find((key) => !allowed.has(key));
  if (unknown) projectionError(`${label}.${unknown} is not admitted`);
  return result;
}

function aliased(input: UnknownRecord, camel: string, snake: string): unknown {
  if (camel === snake) return input[camel];
  const hasCamel = Object.prototype.hasOwnProperty.call(input, camel);
  const hasSnake = Object.prototype.hasOwnProperty.call(input, snake);
  if (hasCamel && hasSnake) projectionError(`${camel} is duplicated through aliases`);
  return hasCamel ? input[camel] : input[snake];
}

function exactText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    projectionError(`${label} must be a non-empty canonical string`);
  }
  return value;
}

function optionalExactText(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return exactText(value, label);
}

function digest(value: unknown, label: string): string {
  const result = exactText(value, label);
  if (!/^[a-f0-9]{64}$/u.test(result)) projectionError(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

function optionalDigest(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return digest(value, label);
}

function uint32(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    projectionError(`${label} must be a uint32`);
  }
  return value;
}

function uint32Default(value: unknown, label: string): number {
  return value === undefined || value === null ? 0 : uint32(value, label);
}

function uint64(value: unknown, label: string): string {
  const result = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : typeof value === 'string' ? value : '';
  if (!/^(?:0|[1-9][0-9]*)$/u.test(result) || BigInt(result) > 0xffff_ffff_ffff_ffffn) {
    projectionError(`${label} must be a canonical uint64 string`);
  }
  return result;
}

function uint64Default(value: unknown, label: string): string {
  return value === undefined || value === null ? '0' : uint64(value, label);
}

function version(
  value: unknown,
  numeric: number,
  jsonName: string,
  label: string,
): 'v1' {
  if (value !== numeric && value !== jsonName) projectionError(`${label} is unknown or unspecified`);
  return 'v1';
}

function enumValue<T extends string>(
  value: unknown,
  values: ReadonlyMap<unknown, T>,
  label: string,
): T {
  const result = values.get(value);
  if (!result) projectionError(`${label} is unknown or unspecified`);
  return result;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value === 'string') {
    const time = new Date(value);
    if (!value.endsWith('Z') || !Number.isFinite(time.getTime())) projectionError(`${label} is not RFC3339 UTC`);
    return time.toISOString();
  }
  const input = record(value, label, new Set(['seconds', 'nanos']));
  const seconds = uint64(input.seconds, `${label}.seconds`);
  const nanos = uint32(input.nanos, `${label}.nanos`);
  if (nanos > 999_999_999) projectionError(`${label}.nanos exceeds protobuf Timestamp range`);
  const millis = (BigInt(seconds) * 1000n) + BigInt(Math.floor(nanos / 1_000_000));
  if (millis > BigInt(Number.MAX_SAFE_INTEGER)) projectionError(`${label} exceeds JavaScript timestamp range`);
  const date = new Date(Number(millis));
  if (!Number.isFinite(date.getTime())) projectionError(`${label} is invalid`);
  return date.toISOString();
}

const SOURCE_KIND = new Map<unknown, NimiRuntimeAgentSourceKind>([
  [AgentSourceMaterializationSourceKind.WORLD_CHARACTER, 'worldCharacter'],
  ['AGENT_SOURCE_MATERIALIZATION_SOURCE_KIND_WORLD_CHARACTER', 'worldCharacter'],
  [AgentSourceMaterializationSourceKind.REALM_PERSONA, 'realmPersona'],
  ['AGENT_SOURCE_MATERIALIZATION_SOURCE_KIND_REALM_PERSONA', 'realmPersona'],
]);
const COVERAGE_SECTION = new Map<unknown, NimiRuntimeAgentSourceCoverageSection>([
  [AgentLocalSourceCoverageSection.IDENTITY, 'identity'],
  [AgentLocalSourceCoverageSection.PRESENTATION, 'presentation'],
  [AgentLocalSourceCoverageSection.PLACEMENT, 'placement'],
  [AgentLocalSourceCoverageSection.BIOGRAPHY, 'biography'],
  [AgentLocalSourceCoverageSection.PSYCHOLOGY, 'psychology'],
  [AgentLocalSourceCoverageSection.KNOWLEDGE, 'knowledge'],
  [AgentLocalSourceCoverageSection.RELATIONSHIPS, 'relationships'],
  [AgentLocalSourceCoverageSection.CAPABILITIES, 'capabilities'],
  [AgentLocalSourceCoverageSection.INTERACTION_PROFILE, 'interaction_profile'],
  [AgentLocalSourceCoverageSection.ASSETS, 'assets'],
  [AgentLocalSourceCoverageSection.AUTHORING, 'authoring'],
  [AgentLocalSourceCoverageSection.PERSONA_STYLE, 'persona_style'],
  [AgentLocalSourceCoverageSection.CONTENT_PROFILE, 'content_profile'],
  [AgentLocalSourceCoverageSection.WORLD_CORE, 'world_core'],
  [AgentLocalSourceCoverageSection.BOUND_ENTITY, 'bound_entity'],
  [AgentLocalSourceCoverageSection.DEPENDENCY_CLOSURE, 'dependency_closure'],
  ...Object.entries({
    IDENTITY: 'identity', PRESENTATION: 'presentation', PLACEMENT: 'placement', BIOGRAPHY: 'biography',
    PSYCHOLOGY: 'psychology', KNOWLEDGE: 'knowledge', RELATIONSHIPS: 'relationships', CAPABILITIES: 'capabilities',
    INTERACTION_PROFILE: 'interaction_profile', ASSETS: 'assets', AUTHORING: 'authoring', PERSONA_STYLE: 'persona_style',
    CONTENT_PROFILE: 'content_profile', WORLD_CORE: 'world_core', BOUND_ENTITY: 'bound_entity',
    DEPENDENCY_CLOSURE: 'dependency_closure',
  }).map(([name, projected]) => [
    `AGENT_LOCAL_SOURCE_COVERAGE_SECTION_${name}`,
    projected as NimiRuntimeAgentSourceCoverageSection,
  ] as const),
]);
const COVERAGE_STATE = new Map<unknown, NimiRuntimeAgentSourceCoverageStatus['state']>([
  [AgentLocalSourceCoverageState.COMPLETE, 'complete'],
  ['AGENT_LOCAL_SOURCE_COVERAGE_STATE_COMPLETE', 'complete'],
  [AgentLocalSourceCoverageState.NOT_APPLICABLE, 'not_applicable'],
  ['AGENT_LOCAL_SOURCE_COVERAGE_STATE_NOT_APPLICABLE', 'not_applicable'],
  [AgentLocalSourceCoverageState.OPTIONAL_OMITTED, 'optional_omitted'],
  ['AGENT_LOCAL_SOURCE_COVERAGE_STATE_OPTIONAL_OMITTED', 'optional_omitted'],
  [AgentLocalSourceCoverageState.INVALID, 'invalid'],
  ['AGENT_LOCAL_SOURCE_COVERAGE_STATE_INVALID', 'invalid'],
]);

const WORLD_CHARACTER_READY_COVERAGE = new Set<NimiRuntimeAgentSourceCoverageSection>([
  'identity',
  'presentation',
  'placement',
  'biography',
  'psychology',
  'knowledge',
  'relationships',
  'capabilities',
  'interaction_profile',
  'assets',
  'authoring',
  'world_core',
  'bound_entity',
  'dependency_closure',
]);

const REALM_PERSONA_READY_COVERAGE = new Set<NimiRuntimeAgentSourceCoverageSection>([
  'identity',
  'presentation',
  'interaction_profile',
  'assets',
  'authoring',
  'persona_style',
  'content_profile',
  'world_core',
  'dependency_closure',
]);

function sourceRef(value: unknown, label: string): NimiRuntimeAgentSourceRef {
  const input = record(value, label, SOURCE_REF_FIELDS);
  return {
    kind: enumValue(input.kind, SOURCE_KIND, `${label}.kind`),
    worldId: exactText(aliased(input, 'worldId', 'world_id'), `${label}.worldId`),
    sourceId: exactText(aliased(input, 'sourceId', 'source_id'), `${label}.sourceId`),
    sourceContentHash: digest(aliased(input, 'sourceContentHash', 'source_content_hash'), `${label}.sourceContentHash`),
  };
}

function coverage(value: unknown, options: {
  readonly readySourceKind?: NimiRuntimeAgentSourceKind;
}): readonly NimiRuntimeAgentSourceCoverageStatus[] {
  if (value === undefined && options.readySourceKind === undefined) return [];
  if (!Array.isArray(value) || (options.readySourceKind !== undefined && value.length === 0)) {
    projectionError('coverageSections must be an admitted array');
  }
  const seen = new Set<NimiRuntimeAgentSourceCoverageSection>();
  const result = value.map((item, index) => {
    const input = record(item, `coverageSections[${index}]`, COVERAGE_FIELDS);
    const section = enumValue(input.section, COVERAGE_SECTION, `coverageSections[${index}].section`);
    const state = enumValue(input.state, COVERAGE_STATE, `coverageSections[${index}].state`);
    const requiredCount = uint32Default(aliased(input, 'requiredCount', 'required_count'), `coverageSections[${index}].requiredCount`);
    const resolvedCount = uint32Default(aliased(input, 'resolvedCount', 'resolved_count'), `coverageSections[${index}].resolvedCount`);
    const omittedCount = uint32Default(aliased(input, 'omittedCount', 'omitted_count'), `coverageSections[${index}].omittedCount`);
    if (seen.has(section)) projectionError(`coverageSections contains duplicate ${section}`);
    seen.add(section);
    if ((state === 'complete' && resolvedCount !== requiredCount)
      || (state === 'not_applicable' && (requiredCount !== 0 || resolvedCount !== 0 || omittedCount !== 0))
      || (state === 'optional_omitted' && (requiredCount !== 0 || resolvedCount !== 0 || omittedCount === 0))
      || (state === 'invalid' && resolvedCount >= requiredCount)) {
      projectionError(`coverageSections[${index}] counts contradict state`);
    }
    return { section, state, requiredCount, resolvedCount, omittedCount };
  });
  if (options.readySourceKind !== undefined) {
    const expected = options.readySourceKind === 'worldCharacter'
      ? WORLD_CHARACTER_READY_COVERAGE
      : REALM_PERSONA_READY_COVERAGE;
    if (result.length !== expected.size
        || result.some((entry) => entry.state !== 'complete' || !expected.has(entry.section))
        || [...expected].some((section) => !seen.has(section))) {
      projectionError(`coverageSections does not exactly match complete ${options.readySourceKind} coverage`);
    }
  }
  return result;
}

export function decodeNimiRuntimeAgentSourceContextStatus(value: unknown): NimiRuntimeAgentSourceContextStatus {
  const input = record(value, 'sourceContextStatus', SOURCE_STATUS_FIELDS);
  const sourceReady = input.ready === undefined ? false : input.ready;
  if (typeof sourceReady !== 'boolean') projectionError('sourceContextStatus.ready must be boolean');
  version(aliased(input, 'schemaVersion', 'schema_version'), AgentLocalSourceContextSchemaVersion.V1,
    'AGENT_LOCAL_SOURCE_CONTEXT_SCHEMA_VERSION_V1', 'sourceContextStatus.schemaVersion');
  const sourceState = enumValue(aliased(input, 'state', 'state'), new Map<unknown,
    'not_materialized' | 'validating' | 'ready' | 'invalid' | 'deleted'>([
    [AgentLocalSourceContextState.NOT_MATERIALIZED, 'not_materialized' as const],
    ['AGENT_LOCAL_SOURCE_CONTEXT_STATE_NOT_MATERIALIZED', 'not_materialized' as const],
    [AgentLocalSourceContextState.VALIDATING, 'validating' as const],
    ['AGENT_LOCAL_SOURCE_CONTEXT_STATE_VALIDATING', 'validating' as const],
    [AgentLocalSourceContextState.READY, 'ready' as const],
    ['AGENT_LOCAL_SOURCE_CONTEXT_STATE_READY', 'ready' as const],
    [AgentLocalSourceContextState.INVALID, 'invalid' as const],
    ['AGENT_LOCAL_SOURCE_CONTEXT_STATE_INVALID', 'invalid' as const],
    [AgentLocalSourceContextState.DELETED, 'deleted' as const],
    ['AGENT_LOCAL_SOURCE_CONTEXT_STATE_DELETED', 'deleted' as const],
  ]), 'sourceContextStatus.state');
  const sourceReason = enumValue(aliased(input, 'reasonCode', 'reason_code'), new Map<unknown,
    'none' | 'source_not_materialized' | 'source_validation_pending' | 'source_snapshot_invalid'>([
    [AgentContextProjectionReasonCode.NONE, 'none' as const],
    ['AGENT_CONTEXT_PROJECTION_REASON_CODE_NONE', 'none' as const],
    [AgentContextProjectionReasonCode.SOURCE_NOT_MATERIALIZED, 'source_not_materialized' as const],
    ['AGENT_CONTEXT_PROJECTION_REASON_CODE_SOURCE_NOT_MATERIALIZED', 'source_not_materialized' as const],
    [AgentContextProjectionReasonCode.SOURCE_VALIDATION_PENDING, 'source_validation_pending' as const],
    ['AGENT_CONTEXT_PROJECTION_REASON_CODE_SOURCE_VALIDATION_PENDING', 'source_validation_pending' as const],
    [AgentContextProjectionReasonCode.SOURCE_SNAPSHOT_INVALID, 'source_snapshot_invalid' as const],
    ['AGENT_CONTEXT_PROJECTION_REASON_CODE_SOURCE_SNAPSHOT_INVALID', 'source_snapshot_invalid' as const],
  ]), 'sourceContextStatus.reasonCode');
  const localAgentRef = exactText(aliased(input, 'localAgentRef', 'local_agent_ref'), 'sourceContextStatus.localAgentRef');
  if (!isRuntimeLocalAgentRef(localAgentRef)) projectionError('sourceContextStatus.localAgentRef is not Runtime-owned');
  if (sourceState !== 'ready') {
    const reasonByState = {
      not_materialized: 'source_not_materialized',
      validating: 'source_validation_pending',
      invalid: 'source_snapshot_invalid',
      deleted: 'source_not_materialized',
    } as const;
    const rawSourceRef = aliased(input, 'sourceRef', 'source_ref');
    const projectedSourceRef = rawSourceRef ? sourceRef(rawSourceRef, 'sourceContextStatus.sourceRef') : null;
    const rawSourceSchema = optionalExactText(
      aliased(input, 'sourceSchemaVersion', 'source_schema_version'),
      'sourceContextStatus.sourceSchemaVersion',
    );
    const expectedSourceSchema = projectedSourceRef?.kind === 'worldCharacter'
      ? 'realm.world-character-core/v1'
      : projectedSourceRef?.kind === 'realmPersona' ? 'realm.persona/v1' : null;
    const rawSnapshotVersion = aliased(input, 'snapshotSchemaVersion', 'snapshot_schema_version');
    const snapshotSchemaVersion = rawSnapshotVersion === undefined
      || rawSnapshotVersion === AgentLocalSourceSnapshotSchemaVersion.UNSPECIFIED
      || rawSnapshotVersion === 'AGENT_LOCAL_SOURCE_SNAPSHOT_SCHEMA_VERSION_UNSPECIFIED'
      ? null
      : version(rawSnapshotVersion, AgentLocalSourceSnapshotSchemaVersion.V1,
        'AGENT_LOCAL_SOURCE_SNAPSHOT_SCHEMA_VERSION_V1', 'sourceContextStatus.snapshotSchemaVersion');
    const snapshotHash = optionalDigest(aliased(input, 'snapshotHash', 'snapshot_hash'), 'sourceContextStatus.snapshotHash');
    const rawCapturedAt = aliased(input, 'capturedAt', 'captured_at');
    const capturedAt = rawCapturedAt === undefined || rawCapturedAt === null ? null : timestamp(rawCapturedAt, 'sourceContextStatus.capturedAt');
    const worldContentHash = optionalDigest(aliased(input, 'worldContentHash', 'world_content_hash'), 'sourceContextStatus.worldContentHash');
    const materializationContextHash = optionalDigest(
      aliased(input, 'materializationContextHash', 'materialization_context_hash'),
      'sourceContextStatus.materializationContextHash',
    );
    const sourceGroup = [projectedSourceRef, rawSourceSchema];
    const snapshotGroup = [snapshotSchemaVersion, snapshotHash, capturedAt, worldContentHash, materializationContextHash];
    const coverageSections = coverage(aliased(input, 'coverageSections', 'coverage_sections'), {});
    if (sourceReady !== false || sourceReason !== reasonByState[sourceState]
      || sourceGroup.some(Boolean) && (!sourceGroup.every(Boolean) || rawSourceSchema !== expectedSourceSchema)
      || snapshotGroup.some(Boolean) && !snapshotGroup.every(Boolean)
      || snapshotGroup.some(Boolean) && !sourceGroup.every(Boolean)) {
      projectionError('sourceContextStatus non-ready state is partial or inconsistent');
    }
    return {
      schemaVersion: 'v1', ready: false, state: sourceState, reasonCode: sourceReason,
      localAgentRef, sourceRef: projectedSourceRef,
      sourceSchemaVersion: rawSourceSchema as NimiRuntimeAgentUnavailableSourceContextStatus['sourceSchemaVersion'],
      snapshotSchemaVersion, snapshotHash, capturedAt, worldContentHash, materializationContextHash,
      coverageSections,
    };
  }
  if (sourceReady !== true || sourceReason !== 'none') {
    projectionError('sourceContextStatus ready state is inconsistent');
  }
  const projectedSourceRef = sourceRef(aliased(input, 'sourceRef', 'source_ref'), 'sourceContextStatus.sourceRef');
  const sourceSchemaVersion = exactText(
    aliased(input, 'sourceSchemaVersion', 'source_schema_version'),
    'sourceContextStatus.sourceSchemaVersion',
  );
  const expectedSourceSchema = projectedSourceRef.kind === 'worldCharacter'
    ? 'realm.world-character-core/v1'
    : 'realm.persona/v1';
  if (sourceSchemaVersion !== expectedSourceSchema) projectionError('sourceContextStatus source kind/schema mismatch');
  const coverageSections = coverage(aliased(input, 'coverageSections', 'coverage_sections'), {
    readySourceKind: projectedSourceRef.kind,
  });
  return {
    schemaVersion: 'v1',
    ready: true,
    state: 'ready',
    reasonCode: 'none',
    localAgentRef,
    sourceRef: projectedSourceRef,
    sourceSchemaVersion: expectedSourceSchema,
    snapshotSchemaVersion: version(
      aliased(input, 'snapshotSchemaVersion', 'snapshot_schema_version'),
      AgentLocalSourceSnapshotSchemaVersion.V1,
      'AGENT_LOCAL_SOURCE_SNAPSHOT_SCHEMA_VERSION_V1',
      'sourceContextStatus.snapshotSchemaVersion',
    ),
    snapshotHash: digest(aliased(input, 'snapshotHash', 'snapshot_hash'), 'sourceContextStatus.snapshotHash'),
    capturedAt: timestamp(aliased(input, 'capturedAt', 'captured_at'), 'sourceContextStatus.capturedAt'),
    worldContentHash: digest(aliased(input, 'worldContentHash', 'world_content_hash'), 'sourceContextStatus.worldContentHash'),
    materializationContextHash: digest(
      aliased(input, 'materializationContextHash', 'materialization_context_hash'),
      'sourceContextStatus.materializationContextHash',
    ),
    coverageSections,
  } as NimiRuntimeAgentSourceContextStatus;
}

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
    'AGENT_TURN_CONTEXT_SUMMARY_SCHEMA_VERSION_V1', 'turnContextSummary.schemaVersion');
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
    const projectedSource = source ? sourceRef(source, 'turnContextSummary.sourceRef') : null;
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
    'AGENT_TURN_CONTEXT_MANIFEST_SCHEMA_VERSION_V1', 'turnContextSummary.manifestSchemaVersion');
  version(aliased(input, 'compilerSchemaVersion', 'compiler_schema_version'), AgentTurnContextCompilerSchemaVersion.V1,
    'AGENT_TURN_CONTEXT_COMPILER_SCHEMA_VERSION_V1', 'turnContextSummary.compilerSchemaVersion');
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
    sourceRef: sourceRef(aliased(input, 'sourceRef', 'source_ref'), 'turnContextSummary.sourceRef'),
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
        || source.sourceRef.kind !== turn.sourceRef.kind
        || source.sourceRef.worldId !== turn.sourceRef.worldId
        || source.sourceRef.sourceId !== turn.sourceRef.sourceId
        || source.sourceRef.sourceContentHash !== turn.sourceRef.sourceContentHash)) {
    projectionError('source and turn provenance correlation failed');
  }
}
