import {
  AgentContextProjectionReasonCode,
  AgentLocalSourceContextSchemaVersion,
  AgentLocalSourceContextState,
  AgentLocalSourceCoverageSection,
  AgentLocalSourceCoverageState,
  AgentLocalSourceSnapshotSchemaVersion,
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
  uint32Default,
  version,
} from './runtime-agent-context-projection-validation';

export type NimiRuntimeAgentSourceKind = 'worldCharacter' | 'personaCharacter';

export type NimiRuntimeAgentWorldEntityRefV3 = {
  readonly kind: 'worldEntity';
  readonly worldId: string;
  readonly entityId: string;
};

export type NimiRuntimeAgentWorldCharacterSourceRefV3 = {
  readonly kind: 'worldCharacter';
  readonly id: string;
  readonly worldId: string;
  readonly worldEntityRef: NimiRuntimeAgentWorldEntityRefV3;
  readonly sourceHash: string;
};

export type NimiRuntimeAgentPersonaCharacterSourceRefV3 = {
  readonly kind: 'personaCharacter';
  readonly id: string;
  readonly worldId: string;
  readonly ownerAccountId: string;
  readonly sourceHash: string;
};

export type NimiRuntimeAgentSourceRef =
  | NimiRuntimeAgentWorldCharacterSourceRefV3
  | NimiRuntimeAgentPersonaCharacterSourceRefV3;

export type NimiRuntimeAgentSourceCoverageSection =
  | 'identity'
  | 'presentation'
  | 'biography'
  | 'psychology'
  | 'knowledge'
  | 'relationships'
  | 'capabilities'
  | 'interaction_profile'
  | 'assets'
  | 'authoring'
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

type NimiRuntimeAgentReadySourceContextStatus<SourceRef extends NimiRuntimeAgentSourceRef> = {
  readonly schemaVersion: 'v2';
  readonly ready: true;
  readonly state: 'ready';
  readonly reasonCode: 'none';
  readonly localAgentRef: string;
  readonly sourceRef: SourceRef;
  readonly sourceSchemaVersion: SourceRef extends NimiRuntimeAgentWorldCharacterSourceRefV3
    ? 'realm.world-character-core/v1'
    : 'realm.persona-character-core/v1';
  readonly snapshotSchemaVersion: 'v2';
  readonly snapshotHash: string;
  readonly capturedAt: string;
  readonly worldContentHash: string;
  readonly materializationContextHash: string;
  readonly coverageSections: readonly NimiRuntimeAgentSourceCoverageStatus[];
};

type NimiRuntimeAgentUnavailableSourceContextStatus = {
  readonly schemaVersion: 'v2';
  readonly ready: false;
  readonly state: 'not_materialized' | 'validating' | 'invalid' | 'deleted';
  readonly reasonCode: 'source_not_materialized' | 'source_validation_pending' | 'source_snapshot_invalid';
  readonly localAgentRef: string;
  readonly sourceRef: NimiRuntimeAgentSourceRef | null;
  readonly sourceSchemaVersion: 'realm.world-character-core/v1' | 'realm.persona-character-core/v1' | null;
  readonly snapshotSchemaVersion: 'v2' | null;
  readonly snapshotHash: string | null;
  readonly capturedAt: string | null;
  readonly worldContentHash: string | null;
  readonly materializationContextHash: string | null;
  readonly coverageSections: readonly NimiRuntimeAgentSourceCoverageStatus[];
};

/** A closed Character/Persona readiness union with explicit non-ready discriminants. */
export type NimiRuntimeAgentSourceContextStatus =
  | NimiRuntimeAgentReadySourceContextStatus<NimiRuntimeAgentWorldCharacterSourceRefV3>
  | NimiRuntimeAgentReadySourceContextStatus<NimiRuntimeAgentPersonaCharacterSourceRefV3>
  | NimiRuntimeAgentUnavailableSourceContextStatus;


const SOURCE_STATUS_FIELDS = new Set([
  'schemaVersion', 'schema_version', 'ready', 'state', 'reasonCode', 'reason_code',
  'localAgentRef', 'local_agent_ref', 'sourceRef', 'source_ref',
  'sourceSchemaVersion', 'source_schema_version', 'snapshotSchemaVersion', 'snapshot_schema_version',
  'snapshotHash', 'snapshot_hash', 'capturedAt', 'captured_at',
  'worldContentHash', 'world_content_hash', 'materializationContextHash', 'materialization_context_hash',
  'coverageSections', 'coverage_sections',
]);
const SOURCE_REF_FIELDS = new Set([
  'source', 'worldCharacter', 'world_character', 'personaCharacter', 'persona_character',
]);
const SOURCE_ONEOF_FIELDS = new Set(['oneofKind', 'worldCharacter', 'personaCharacter']);
const WORLD_CHARACTER_SOURCE_REF_FIELDS = new Set([
  'kind', 'id', 'worldId', 'world_id', 'worldEntityRef', 'world_entity_ref', 'sourceHash', 'source_hash',
]);
const PERSONA_CHARACTER_SOURCE_REF_FIELDS = new Set([
  'kind', 'id', 'worldId', 'world_id', 'ownerAccountId', 'owner_account_id', 'sourceHash', 'source_hash',
]);
const WORLD_ENTITY_REF_FIELDS = new Set(['kind', 'worldId', 'world_id', 'entityId', 'entity_id']);
const COVERAGE_FIELDS = new Set([
  'section', 'state', 'requiredCount', 'required_count', 'resolvedCount', 'resolved_count',
  'omittedCount', 'omitted_count',
]);
const SOURCE_KIND = new Map<unknown, NimiRuntimeAgentSourceKind>([
  [CharacterSourceKindV3.WORLD_CHARACTER, 'worldCharacter'],
  ['CHARACTER_SOURCE_KIND_V3_WORLD_CHARACTER', 'worldCharacter'],
  [CharacterSourceKindV3.PERSONA_CHARACTER, 'personaCharacter'],
  ['CHARACTER_SOURCE_KIND_V3_PERSONA_CHARACTER', 'personaCharacter'],
]);
const COVERAGE_SECTION = new Map<unknown, NimiRuntimeAgentSourceCoverageSection>([
  [AgentLocalSourceCoverageSection.IDENTITY, 'identity'],
  [AgentLocalSourceCoverageSection.PRESENTATION, 'presentation'],
  [AgentLocalSourceCoverageSection.BIOGRAPHY, 'biography'],
  [AgentLocalSourceCoverageSection.PSYCHOLOGY, 'psychology'],
  [AgentLocalSourceCoverageSection.KNOWLEDGE, 'knowledge'],
  [AgentLocalSourceCoverageSection.RELATIONSHIPS, 'relationships'],
  [AgentLocalSourceCoverageSection.CAPABILITIES, 'capabilities'],
  [AgentLocalSourceCoverageSection.INTERACTION_PROFILE, 'interaction_profile'],
  [AgentLocalSourceCoverageSection.ASSETS, 'assets'],
  [AgentLocalSourceCoverageSection.AUTHORING, 'authoring'],
  [AgentLocalSourceCoverageSection.WORLD_CORE, 'world_core'],
  [AgentLocalSourceCoverageSection.BOUND_ENTITY, 'bound_entity'],
  [AgentLocalSourceCoverageSection.DEPENDENCY_CLOSURE, 'dependency_closure'],
  ...Object.entries({
    IDENTITY: 'identity', PRESENTATION: 'presentation', BIOGRAPHY: 'biography',
    PSYCHOLOGY: 'psychology', KNOWLEDGE: 'knowledge', RELATIONSHIPS: 'relationships', CAPABILITIES: 'capabilities',
    INTERACTION_PROFILE: 'interaction_profile', ASSETS: 'assets', AUTHORING: 'authoring',
    WORLD_CORE: 'world_core', BOUND_ENTITY: 'bound_entity',
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

const WORLD_CHARACTER_REQUIRED_COVERAGE = new Set<NimiRuntimeAgentSourceCoverageSection>([
  'world_core', 'bound_entity', 'dependency_closure',
]);
const PERSONA_CHARACTER_REQUIRED_COVERAGE = new Set<NimiRuntimeAgentSourceCoverageSection>([
  'world_core', 'dependency_closure',
]);

export function decodeNimiRuntimeAgentSourceRef(value: unknown, label: string): NimiRuntimeAgentSourceRef {
  const input = record(value, label, SOURCE_REF_FIELDS);
  const wrapped = input.source === undefined ? null : record(input.source, `${label}.source`, SOURCE_ONEOF_FIELDS);
  if (wrapped && (aliased(input, 'worldCharacter', 'world_character') !== undefined
      || aliased(input, 'personaCharacter', 'persona_character') !== undefined)) {
    projectionError(`${label} mixes protobuf and protojson CharacterSourceRefV3 branches`);
  }
  if (wrapped && (wrapped.oneofKind === 'worldCharacter') !== (wrapped.worldCharacter !== undefined)) {
    projectionError(`${label}.source worldCharacter branch contradicts oneofKind`);
  }
  if (wrapped && (wrapped.oneofKind === 'personaCharacter') !== (wrapped.personaCharacter !== undefined)) {
    projectionError(`${label}.source personaCharacter branch contradicts oneofKind`);
  }
  const world = wrapped
    ? wrapped.oneofKind === 'worldCharacter' ? wrapped.worldCharacter : undefined
    : aliased(input, 'worldCharacter', 'world_character');
  const persona = wrapped
    ? wrapped.oneofKind === 'personaCharacter' ? wrapped.personaCharacter : undefined
    : aliased(input, 'personaCharacter', 'persona_character');
  if (wrapped && wrapped.oneofKind !== 'worldCharacter' && wrapped.oneofKind !== 'personaCharacter') {
    projectionError(`${label}.source.oneofKind is unknown or unspecified`);
  }
  if ((world === undefined) === (persona === undefined)) {
    projectionError(`${label} must contain exactly one CharacterSourceRefV3 branch`);
  }
  if (world !== undefined) {
    const branch = record(world, `${label}.worldCharacter`, WORLD_CHARACTER_SOURCE_REF_FIELDS);
    if (enumValue(branch.kind, SOURCE_KIND, `${label}.worldCharacter.kind`) !== 'worldCharacter') {
      projectionError(`${label}.worldCharacter.kind contradicts its oneof branch`);
    }
    const entity = record(
      aliased(branch, 'worldEntityRef', 'world_entity_ref'),
      `${label}.worldCharacter.worldEntityRef`,
      WORLD_ENTITY_REF_FIELDS,
    );
    if (entity.kind !== WorldEntityRefKindV3.WORLD_ENTITY
        && entity.kind !== 'WORLD_ENTITY_REF_KIND_V3_WORLD_ENTITY') {
      projectionError(`${label}.worldCharacter.worldEntityRef.kind is unknown or unspecified`);
    }
    const worldId = exactText(aliased(branch, 'worldId', 'world_id'), `${label}.worldCharacter.worldId`);
    const entityWorldId = exactText(
      aliased(entity, 'worldId', 'world_id'),
      `${label}.worldCharacter.worldEntityRef.worldId`,
    );
    if (worldId !== entityWorldId) {
      projectionError(`${label}.worldCharacter world binding is inconsistent`);
    }
    return {
      kind: 'worldCharacter',
      id: exactText(branch.id, `${label}.worldCharacter.id`),
      worldId,
      worldEntityRef: {
        kind: 'worldEntity',
        worldId: entityWorldId,
        entityId: exactText(aliased(entity, 'entityId', 'entity_id'), `${label}.worldCharacter.worldEntityRef.entityId`),
      },
      sourceHash: digest(aliased(branch, 'sourceHash', 'source_hash'), `${label}.worldCharacter.sourceHash`),
    };
  }
  const branch = record(persona, `${label}.personaCharacter`, PERSONA_CHARACTER_SOURCE_REF_FIELDS);
  if (enumValue(branch.kind, SOURCE_KIND, `${label}.personaCharacter.kind`) !== 'personaCharacter') {
    projectionError(`${label}.personaCharacter.kind contradicts its oneof branch`);
  }
  return {
    kind: 'personaCharacter',
    id: exactText(branch.id, `${label}.personaCharacter.id`),
    worldId: exactText(aliased(branch, 'worldId', 'world_id'), `${label}.personaCharacter.worldId`),
    ownerAccountId: exactText(
      aliased(branch, 'ownerAccountId', 'owner_account_id'),
      `${label}.personaCharacter.ownerAccountId`,
    ),
    sourceHash: digest(aliased(branch, 'sourceHash', 'source_hash'), `${label}.personaCharacter.sourceHash`),
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
    if ((state === 'complete' && resolvedCount < requiredCount)
      || (state === 'not_applicable' && (requiredCount !== 0 || resolvedCount !== 0 || omittedCount !== 0))
      || (state === 'optional_omitted' && (requiredCount !== 0 || omittedCount === 0))
      || (state === 'invalid' && resolvedCount >= requiredCount)) {
      projectionError(`coverageSections[${index}] counts contradict state`);
    }
    return { section, state, requiredCount, resolvedCount, omittedCount };
  });
  if (options.readySourceKind !== undefined) {
    const expected = options.readySourceKind === 'worldCharacter'
      ? WORLD_CHARACTER_REQUIRED_COVERAGE
      : PERSONA_CHARACTER_REQUIRED_COVERAGE;
    if (result.some((entry) => entry.state === 'invalid')
        || [...expected].some((section) => !seen.has(section))) {
      projectionError(`coverageSections is incomplete for ${options.readySourceKind}`);
    }
  }
  return result;
}

export function decodeNimiRuntimeAgentSourceContextStatus(value: unknown): NimiRuntimeAgentSourceContextStatus {
  const input = record(value, 'sourceContextStatus', SOURCE_STATUS_FIELDS);
  const sourceReady = input.ready === undefined ? false : input.ready;
  if (typeof sourceReady !== 'boolean') projectionError('sourceContextStatus.ready must be boolean');
  version(aliased(input, 'schemaVersion', 'schema_version'), AgentLocalSourceContextSchemaVersion.V2,
    'AGENT_LOCAL_SOURCE_CONTEXT_SCHEMA_VERSION_V2', 'sourceContextStatus.schemaVersion', 'v2');
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
    const projectedSourceRef = rawSourceRef ? decodeNimiRuntimeAgentSourceRef(rawSourceRef, 'sourceContextStatus.sourceRef') : null;
    const rawSourceSchema = optionalExactText(
      aliased(input, 'sourceSchemaVersion', 'source_schema_version'),
      'sourceContextStatus.sourceSchemaVersion',
    );
    const expectedSourceSchema = projectedSourceRef?.kind === 'worldCharacter'
      ? 'realm.world-character-core/v1'
      : projectedSourceRef?.kind === 'personaCharacter' ? 'realm.persona-character-core/v1' : null;
    const rawSnapshotVersion = aliased(input, 'snapshotSchemaVersion', 'snapshot_schema_version');
    const snapshotSchemaVersion = rawSnapshotVersion === undefined
      || rawSnapshotVersion === AgentLocalSourceSnapshotSchemaVersion.UNSPECIFIED
      || rawSnapshotVersion === 'AGENT_LOCAL_SOURCE_SNAPSHOT_SCHEMA_VERSION_UNSPECIFIED'
      ? null
      : version(rawSnapshotVersion, AgentLocalSourceSnapshotSchemaVersion.V2,
        'AGENT_LOCAL_SOURCE_SNAPSHOT_SCHEMA_VERSION_V2', 'sourceContextStatus.snapshotSchemaVersion', 'v2');
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
      schemaVersion: 'v2', ready: false, state: sourceState, reasonCode: sourceReason,
      localAgentRef, sourceRef: projectedSourceRef,
      sourceSchemaVersion: rawSourceSchema as NimiRuntimeAgentUnavailableSourceContextStatus['sourceSchemaVersion'],
      snapshotSchemaVersion, snapshotHash, capturedAt, worldContentHash, materializationContextHash,
      coverageSections,
    };
  }
  if (sourceReady !== true || sourceReason !== 'none') {
    projectionError('sourceContextStatus ready state is inconsistent');
  }
  const projectedSourceRef = decodeNimiRuntimeAgentSourceRef(aliased(input, 'sourceRef', 'source_ref'), 'sourceContextStatus.sourceRef');
  const sourceSchemaVersion = exactText(
    aliased(input, 'sourceSchemaVersion', 'source_schema_version'),
    'sourceContextStatus.sourceSchemaVersion',
  );
  const expectedSourceSchema = projectedSourceRef.kind === 'worldCharacter'
    ? 'realm.world-character-core/v1'
    : 'realm.persona-character-core/v1';
  if (sourceSchemaVersion !== expectedSourceSchema) projectionError('sourceContextStatus source kind/schema mismatch');
  const coverageSections = coverage(aliased(input, 'coverageSections', 'coverage_sections'), {
    readySourceKind: projectedSourceRef.kind,
  });
  return {
    schemaVersion: 'v2',
    ready: true,
    state: 'ready',
    reasonCode: 'none',
    localAgentRef,
    sourceRef: projectedSourceRef,
    sourceSchemaVersion: expectedSourceSchema,
    snapshotSchemaVersion: version(
      aliased(input, 'snapshotSchemaVersion', 'snapshot_schema_version'),
      AgentLocalSourceSnapshotSchemaVersion.V2,
      'AGENT_LOCAL_SOURCE_SNAPSHOT_SCHEMA_VERSION_V2',
      'sourceContextStatus.snapshotSchemaVersion',
      'v2',
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
