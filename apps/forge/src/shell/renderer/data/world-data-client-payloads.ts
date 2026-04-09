import type { RealmServiceArgs } from '@nimiplatform/sdk/realm';
import type { JsonObject } from '@renderer/bridge/types.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';

type CreateWorldDraftInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerCreateDraft'>[0];
type UpdateWorldDraftInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerUpdateDraft'>[1];
type PublishWorldDraftInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerPublishDraft'>[1];
type CommitWorldStateInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerCommitState'>[1];
type AppendWorldHistoryInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerAppendWorldHistory'>[1];
type MutationCommitEnvelope = NonNullable<CommitWorldStateInput['commit']>;
type CreateCreatorAgentInput = RealmServiceArgs<'CreatorService', 'creatorControllerCreateAgent'>[0];
type CreateWorldRuleInput = RealmServiceArgs<'WorldRulesService', 'worldRulesControllerCreateRule'>[1];
type UpdateWorldRuleInput = RealmServiceArgs<'WorldRulesService', 'worldRulesControllerUpdateRule'>[2];
type CommitWorldStateWrite = NonNullable<CommitWorldStateInput['writes']>[number];
type AppendWorldHistoryItem = NonNullable<AppendWorldHistoryInput['historyAppends']>[number];
type AppendWorldHistoryRelatedStateRef = NonNullable<AppendWorldHistoryItem['relatedStateRefs']>[number];
type CreateAgentRuleInput = RealmServiceArgs<'AgentRulesService', 'agentRulesControllerCreateRule'>[2];
type UpdateAgentRuleInput = RealmServiceArgs<'AgentRulesService', 'agentRulesControllerUpdateRule'>[3];

export type ForgeDraftHistoryEvent = NonNullable<
  NonNullable<CreateWorldDraftInput['draftPayload']>['historyDraft']
>['events']['primary'][number];

export type ForgeWorldStateWriteInput = {
  scope: 'WORLD' | 'ENTITY' | 'RELATION';
  scopeKey: string;
  targetPath?: string;
  payload: JsonObject;
  metadata?: JsonObject;
};

export type ForgeWorldHistoryAppendInput = {
  eventId?: string;
  eventType: string;
  title: string;
  happenedAt: string;
  operation: 'APPEND' | 'SUPERSEDE' | 'INVALIDATE';
  visibility: 'PUBLIC' | 'WORLD' | 'RESTRICTED';
  summary?: string;
  cause?: string;
  process?: string;
  result?: string;
  timeRef?: string;
  locationRefs?: string[];
  characterRefs?: string[];
  dependsOnEventIds?: string[];
  evidenceRefs?: unknown[];
  relatedStateRefs: Array<{
    recordId: string;
    scope: 'WORLD' | 'ENTITY' | 'RELATION';
    scopeKey: string;
    version?: string;
  }>;
  supersedes?: string[];
  invalidates?: string[];
  payload?: JsonObject;
};

export type ForgeDraftImportSource = {
  sourceType: 'TEXT' | 'FILE';
  sourceRef?: string;
  sourceText?: string;
};

export type ForgeDraftTruthDraft = {
  worldRules: JsonObject[];
  agentRules: JsonObject[];
};

export type ForgeDraftStateDraft = {
  worldState: JsonObject;
};

export type ForgeDraftHistoryDraft = {
  events: {
    primary: ForgeDraftHistoryEvent[];
    secondary: ForgeDraftHistoryEvent[];
    futureHistorical?: ForgeDraftHistoryEvent[];
  };
};

export type ForgeDraftPayload = {
  importSource: ForgeDraftImportSource;
  truthDraft: ForgeDraftTruthDraft;
  stateDraft: ForgeDraftStateDraft;
  historyDraft: ForgeDraftHistoryDraft;
};

export type ForgeCreateWorldDraftInput = {
  sourceType: CreateWorldDraftInput['sourceType'];
  sourceRef?: string;
  targetWorldId?: string;
  draftPayload: ForgeDraftPayload;
};

export type ForgeUpdateWorldDraftInput = {
  status?: UpdateWorldDraftInput['status'];
  draftPayload?: ForgeDraftPayload;
};

export type ForgePublishWorldDraftInput = PublishWorldDraftInput;

export type ForgeCommitWorldStateInput = {
  writes?: ForgeWorldStateWriteInput[];
  reason: string;
  sessionId: string;
  ifSnapshotVersion?: string;
  commit?: MutationCommitEnvelope;
};

export type ForgeAppendWorldHistoryInput = {
  historyAppends?: ForgeWorldHistoryAppendInput[];
  reason: string;
  sessionId: string;
  ifSnapshotVersion?: string;
  commit?: MutationCommitEnvelope;
};

export type ForgeCreateWorldRuleInput = Partial<CreateWorldRuleInput>;
export type ForgeUpdateWorldRuleInput = UpdateWorldRuleInput;
export type ForgeCreateAgentRuleInput = Partial<CreateAgentRuleInput>;
export type ForgeUpdateAgentRuleInput = UpdateAgentRuleInput;

export type ForgeBatchCreateCreatorAgentsInput = {
  items: ForgeCreateWorldCreatorAgentInput[];
  continueOnError?: boolean;
};

export type ForgeCreateWorldCreatorAgentInput = Partial<CreateCreatorAgentInput> & {
  name?: string;
  displayName?: string;
  handle?: string;
  concept?: string;
};

function requireRecord(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as JsonObject;
}

function requireObjectArray<T extends JsonObject>(value: unknown, code: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(code);
  }
  return value.map((item) => requireRecord(item, code) as T);
}

function requireString(value: unknown, code: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(code);
  }
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized ? normalized : undefined;
}

function optionalStringArray(value: unknown, code: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(code);
  }
  return value
    .map((item) => String(item || '').trim())
    .filter((item) => item.length > 0);
}

function optionalStructured(value: unknown, code: string): JsonObject | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireRecord(value, code);
}

function requireNumber(value: unknown, code: string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    throw new Error(code);
  }
  return normalized;
}

function requireEnum<const Values extends readonly string[]>(
  value: unknown,
  allowed: Values,
  code: string,
): Values[number] {
  const normalized = requireString(value, code);
  if (!allowed.includes(normalized)) {
    throw new Error(code);
  }
  return normalized as Values[number];
}

export function buildForgeMutationCommit(input: {
  worldId: string;
  effectClass: MutationCommitEnvelope['effectClass'];
  schemaId: string;
  schemaVersion: string;
  reason: string;
  sessionId: string;
  existing?: MutationCommitEnvelope;
}): MutationCommitEnvelope {
  if (input.existing) {
    if (!Array.isArray(input.existing.actorRefs) || input.existing.actorRefs.length === 0) {
      throw new Error('FORGE_MUTATION_ACTOR_REFS_REQUIRED');
    }
    return input.existing;
  }
  const actorId = String(useAppStore.getState().auth?.user?.id || '').trim();
  if (!actorId) {
    throw new Error('FORGE_MUTATION_ACTOR_ID_REQUIRED');
  }
  return {
    worldId: input.worldId,
    appId: 'forge',
    sessionId: requireString(input.sessionId, 'FORGE_MUTATION_SESSION_ID_REQUIRED'),
    effectClass: input.effectClass,
    scope: 'WORLD',
    schemaId: input.schemaId,
    schemaVersion: requireString(input.schemaVersion, 'FORGE_MUTATION_SCHEMA_VERSION_REQUIRED'),
    actorRefs: [{ actorType: 'USER', actorId, role: 'creator' }],
    reason: requireString(input.reason, 'FORGE_MUTATION_REASON_REQUIRED'),
    evidenceRefs: [],
  };
}

export function buildHistoryAppend(value: unknown): AppendWorldHistoryItem {
  const record = requireRecord(value, 'FORGE_WORLD_HISTORY_APPEND_INVALID');
  const payload = record.payload === undefined
    ? undefined
    : requireRecord(record.payload, 'FORGE_WORLD_HISTORY_PAYLOAD_INVALID');
  const relatedStateRefs = requireObjectArray<JsonObject>(
    record.relatedStateRefs,
    'FORGE_WORLD_HISTORY_RELATED_STATE_REFS_INVALID',
  ).map<AppendWorldHistoryRelatedStateRef>((item) => ({
    recordId: requireString(item.recordId, 'FORGE_WORLD_HISTORY_RELATED_STATE_RECORD_REQUIRED'),
    scope: requireEnum(
      item.scope,
      ['WORLD', 'ENTITY', 'RELATION'] as const,
      'FORGE_WORLD_HISTORY_RELATED_STATE_SCOPE_REQUIRED',
    ),
    scopeKey: requireString(item.scopeKey, 'FORGE_WORLD_HISTORY_RELATED_STATE_SCOPE_KEY_REQUIRED'),
    version: optionalString(item.version),
  }));
  const evidenceRefs = record.evidenceRefs;
  if (evidenceRefs !== undefined && !Array.isArray(evidenceRefs)) {
    throw new Error('FORGE_WORLD_HISTORY_EVIDENCE_REFS_INVALID');
  }
  return {
    eventId: optionalString(record.eventId),
    eventType: requireString(record.eventType, 'FORGE_WORLD_HISTORY_EVENT_TYPE_REQUIRED'),
    title: requireString(record.title, 'FORGE_WORLD_HISTORY_TITLE_REQUIRED'),
    happenedAt: requireString(record.happenedAt, 'FORGE_WORLD_HISTORY_HAPPENED_AT_REQUIRED'),
    operation: requireEnum(
      record.operation,
      ['APPEND', 'SUPERSEDE', 'INVALIDATE'] as const,
      'FORGE_WORLD_HISTORY_OPERATION_INVALID',
    ),
    visibility: requireEnum(
      record.visibility,
      ['PUBLIC', 'WORLD', 'RESTRICTED'] as const,
      'FORGE_WORLD_HISTORY_VISIBILITY_INVALID',
    ),
    summary: optionalString(record.summary),
    process: optionalString(record.process),
    result: optionalString(record.result),
    cause: optionalString(record.cause),
    timeRef: optionalString(record.timeRef),
    locationRefs: optionalStringArray(record.locationRefs, 'FORGE_WORLD_HISTORY_LOCATION_REFS_INVALID'),
    characterRefs: optionalStringArray(record.characterRefs, 'FORGE_WORLD_HISTORY_CHARACTER_REFS_INVALID'),
    dependsOnEventIds: optionalStringArray(record.dependsOnEventIds, 'FORGE_WORLD_HISTORY_DEPENDS_ON_INVALID'),
    evidenceRefs: evidenceRefs as AppendWorldHistoryItem['evidenceRefs'],
    relatedStateRefs,
    supersedes: optionalStringArray(record.supersedes, 'FORGE_WORLD_HISTORY_SUPERSEDES_INVALID'),
    invalidates: optionalStringArray(record.invalidates, 'FORGE_WORLD_HISTORY_INVALIDATES_INVALID'),
    payload,
  };
}

export function buildStateWrite(value: unknown): CommitWorldStateWrite {
  const record = requireRecord(value, 'FORGE_WORLD_STATE_WRITE_INVALID');
  const payload = requireRecord(record.payload, 'FORGE_WORLD_STATE_PAYLOAD_REQUIRED');
  const metadata = record.metadata === undefined
    ? undefined
    : requireRecord(record.metadata, 'FORGE_WORLD_STATE_METADATA_INVALID');
  return {
    scope: requireEnum(record.scope, ['WORLD', 'ENTITY', 'RELATION'] as const, 'FORGE_WORLD_STATE_SCOPE_REQUIRED'),
    scopeKey: requireString(record.scopeKey, 'FORGE_WORLD_STATE_SCOPE_KEY_REQUIRED'),
    targetPath: optionalString(record.targetPath),
    payload,
    ...(metadata ? { metadata } : {}),
  };
}

function buildDraftHistoryEvent(value: unknown): ForgeDraftHistoryEvent {
  const record = requireRecord(value, 'FORGE_DRAFT_HISTORY_EVENT_INVALID');
  const evidenceRefs = record.evidenceRefs;
  if (evidenceRefs !== undefined && !Array.isArray(evidenceRefs)) {
    throw new Error('FORGE_DRAFT_HISTORY_EVIDENCE_REFS_INVALID');
  }
  return {
    eventId: optionalString(record.eventId),
    eventType: requireString(record.eventType, 'FORGE_DRAFT_HISTORY_EVENT_TYPE_REQUIRED'),
    title: requireString(record.title, 'FORGE_DRAFT_HISTORY_TITLE_REQUIRED'),
    happenedAt: requireString(record.happenedAt, 'FORGE_DRAFT_HISTORY_HAPPENED_AT_REQUIRED'),
    occurredAt: optionalString(record.occurredAt),
    timeRef: optionalString(record.timeRef),
    summary: optionalString(record.summary),
    cause: optionalString(record.cause),
    process: optionalString(record.process),
    result: optionalString(record.result),
    locationRefs: optionalStringArray(record.locationRefs, 'FORGE_DRAFT_HISTORY_LOCATION_REFS_INVALID'),
    characterRefs: optionalStringArray(record.characterRefs, 'FORGE_DRAFT_HISTORY_CHARACTER_REFS_INVALID'),
    dependsOnEventIds: optionalStringArray(record.dependsOnEventIds, 'FORGE_DRAFT_HISTORY_DEPENDS_ON_INVALID'),
    payload: record.payload === undefined
      ? undefined
      : requireRecord(record.payload, 'FORGE_DRAFT_HISTORY_PAYLOAD_INVALID'),
    ...(Array.isArray(evidenceRefs)
      ? { evidenceRefs: requireObjectArray(evidenceRefs, 'FORGE_DRAFT_HISTORY_EVIDENCE_REFS_INVALID') }
      : {}),
  };
}

export function buildDraftPayload(value: ForgeDraftPayload): NonNullable<CreateWorldDraftInput['draftPayload']> {
  const importSource = requireRecord(value.importSource, 'FORGE_DRAFT_IMPORT_SOURCE_REQUIRED');
  const truthDraft = requireRecord(value.truthDraft, 'FORGE_DRAFT_TRUTH_REQUIRED');
  const stateDraft = requireRecord(value.stateDraft, 'FORGE_DRAFT_STATE_REQUIRED');
  const historyDraft = requireRecord(value.historyDraft, 'FORGE_DRAFT_HISTORY_REQUIRED');
  const events = requireRecord(historyDraft.events, 'FORGE_DRAFT_HISTORY_EVENTS_REQUIRED');
  const worldState = requireRecord(stateDraft.worldState, 'FORGE_DRAFT_WORLD_STATE_REQUIRED');
  requireString(worldState.name, 'FORGE_DRAFT_WORLD_NAME_REQUIRED');
  const futureHistorical = Array.isArray(events.futureHistorical)
    ? events.futureHistorical.map((item) => buildDraftHistoryEvent(item))
    : [];

  return {
    importSource: {
      sourceType: requireEnum(importSource.sourceType, ['TEXT', 'FILE'] as const, 'FORGE_DRAFT_SOURCE_TYPE_REQUIRED'),
      sourceRef: optionalString(importSource.sourceRef),
      sourceText: optionalString(importSource.sourceText),
    },
    truthDraft: {
      worldRules: requireObjectArray(truthDraft.worldRules, 'FORGE_DRAFT_WORLD_RULES_REQUIRED'),
      agentRules: requireObjectArray(truthDraft.agentRules, 'FORGE_DRAFT_AGENT_RULES_REQUIRED'),
    },
    stateDraft: {
      worldState,
    },
    historyDraft: {
      events: {
        primary: requireObjectArray(events.primary, 'FORGE_DRAFT_PRIMARY_EVENTS_REQUIRED')
          .map((item) => buildDraftHistoryEvent(item)),
        secondary: requireObjectArray(events.secondary, 'FORGE_DRAFT_SECONDARY_EVENTS_REQUIRED')
          .map((item) => buildDraftHistoryEvent(item)),
        ...(futureHistorical.length > 0 ? { futureHistorical } : {}),
      },
    },
  };
}

export function buildWorldRuleInput(payload: ForgeCreateWorldRuleInput): CreateWorldRuleInput {
  return {
    category: requireEnum(payload.category, ['CONSTRAINT', 'MECHANISM', 'DEFINITION', 'RELATION', 'POLICY'] as const, 'FORGE_WORLD_RULE_CATEGORY_REQUIRED'),
    conflictsWith: optionalStringArray(payload.conflictsWith, 'FORGE_WORLD_RULE_CONFLICTS_INVALID'),
    dependsOn: optionalStringArray(payload.dependsOn, 'FORGE_WORLD_RULE_DEPENDS_ON_INVALID'),
    domain: requireEnum(payload.domain, ['AXIOM', 'PHYSICS', 'SOCIETY', 'ECONOMY', 'CHARACTER', 'NARRATIVE', 'META'] as const, 'FORGE_WORLD_RULE_DOMAIN_REQUIRED'),
    hardness: requireEnum(payload.hardness, ['HARD', 'FIRM', 'SOFT', 'AESTHETIC'] as const, 'FORGE_WORLD_RULE_HARDNESS_REQUIRED'),
    overrides: optionalString(payload.overrides),
    priority: requireNumber(payload.priority, 'FORGE_WORLD_RULE_PRIORITY_REQUIRED'),
    provenance: requireEnum(payload.provenance, ['SEED', 'CREATOR', 'MOJING_MERGED', 'RENDER_BACKFLOW', 'WORLD_STUDIO', 'SYSTEM'] as const, 'FORGE_WORLD_RULE_PROVENANCE_REQUIRED'),
    reasoning: optionalString(payload.reasoning),
    ruleKey: requireString(payload.ruleKey, 'FORGE_WORLD_RULE_KEY_REQUIRED'),
    scope: requireEnum(payload.scope, ['WORLD', 'REGION', 'FACTION', 'INDIVIDUAL', 'SCENE'] as const, 'FORGE_WORLD_RULE_SCOPE_REQUIRED'),
    sourceRef: optionalString(payload.sourceRef),
    statement: requireString(payload.statement, 'FORGE_WORLD_RULE_STATEMENT_REQUIRED'),
    structured: optionalStructured(payload.structured, 'FORGE_WORLD_RULE_STRUCTURED_INVALID'),
    title: requireString(payload.title, 'FORGE_WORLD_RULE_TITLE_REQUIRED'),
    validFrom: optionalString(payload.validFrom),
    validUntil: optionalString(payload.validUntil),
  };
}

export function buildAgentRuleInput(payload: ForgeCreateAgentRuleInput): CreateAgentRuleInput {
  return {
    category: requireEnum(payload.category, ['CONSTRAINT', 'MECHANISM', 'DEFINITION', 'RELATION', 'POLICY'] as const, 'FORGE_AGENT_RULE_CATEGORY_REQUIRED'),
    conflictsWith: optionalStringArray(payload.conflictsWith, 'FORGE_AGENT_RULE_CONFLICTS_INVALID'),
    dependsOn: optionalStringArray(payload.dependsOn, 'FORGE_AGENT_RULE_DEPENDS_ON_INVALID'),
    hardness: requireEnum(payload.hardness, ['HARD', 'FIRM', 'SOFT', 'AESTHETIC'] as const, 'FORGE_AGENT_RULE_HARDNESS_REQUIRED'),
    importance: requireNumber(payload.importance, 'FORGE_AGENT_RULE_IMPORTANCE_REQUIRED'),
    layer: requireEnum(payload.layer, ['DNA', 'BEHAVIORAL', 'RELATIONAL', 'CONTEXTUAL'] as const, 'FORGE_AGENT_RULE_LAYER_REQUIRED'),
    priority: requireNumber(payload.priority, 'FORGE_AGENT_RULE_PRIORITY_REQUIRED'),
    provenance: requireEnum(payload.provenance, ['CREATOR', 'WORLD_INHERITED', 'NARRATIVE_EMERGED', 'SYSTEM'] as const, 'FORGE_AGENT_RULE_PROVENANCE_REQUIRED'),
    reasoning: optionalString(payload.reasoning),
    ruleKey: requireString(payload.ruleKey, 'FORGE_AGENT_RULE_KEY_REQUIRED'),
    scope: requireEnum(payload.scope, ['SELF', 'DYAD', 'GROUP', 'WORLD'] as const, 'FORGE_AGENT_RULE_SCOPE_REQUIRED'),
    sourceRef: optionalString(payload.sourceRef),
    statement: requireString(payload.statement, 'FORGE_AGENT_RULE_STATEMENT_REQUIRED'),
    structured: optionalStructured(payload.structured, 'FORGE_AGENT_RULE_STRUCTURED_INVALID'),
    title: requireString(payload.title, 'FORGE_AGENT_RULE_TITLE_REQUIRED'),
    worldRuleRef: optionalString(payload.worldRuleRef),
  };
}

export function buildCreatorAgentInput(payload: ForgeCreateWorldCreatorAgentInput): CreateCreatorAgentInput {
  const handle = requireString(payload.handle, 'FORGE_CREATOR_AGENT_HANDLE_REQUIRED');
  const concept = requireString(payload.concept, 'FORGE_CREATOR_AGENT_CONCEPT_REQUIRED');
  const worldId = requireString(payload.worldId, 'FORGE_CREATOR_AGENT_WORLD_ID_REQUIRED');
  const displayName = optionalString(payload.displayName);
  if (!handle || !concept) {
    throw new Error('FORGE_CREATOR_AGENT_INPUT_INVALID');
  }
  const { name: _name, ...rest } = payload;
  return {
    ...rest,
    handle,
    concept,
    worldId,
    ...(displayName ? { displayName } : {}),
  };
}
