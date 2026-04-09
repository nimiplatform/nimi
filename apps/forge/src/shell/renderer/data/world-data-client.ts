/**
 * World Data Client — Forge adapter (FG-WORLD-002)
 *
 * Replaces World-Studio's hookClient.data.query() calls with
 * direct SDK realm client calls. Same function signatures as
 * World-Studio's data layer, enabling engine/generation code
 * to work unchanged.
 */

import { getPlatformClient } from '@nimiplatform/sdk';
import type { RealmServiceArgs, RealmServiceResult } from '@nimiplatform/sdk/realm';
import type { JsonObject } from '@renderer/bridge/types.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import type { CanonicalPublishableWorldPackage } from '../../../../../../../packages/nimi-forge/src/contracts/index.js';

function realm() {
  return getPlatformClient().realm;
}

export const FORGE_WORLD_WORKSPACE_TARGET_PATH = 'forge.workspace.world';
export const FORGE_WORLD_WORKSPACE_SCHEMA_ID = 'forge.world.workspace';
export const FORGE_WORLD_WORKSPACE_SCHEMA_VERSION = '1';
export const FORGE_WORLD_HISTORY_EVENT_TYPE = 'WORLD_EVENT';
export const FORGE_WORLD_HISTORY_SCHEMA_ID = 'world.history.append';
export const FORGE_WORLD_HISTORY_SCHEMA_VERSION = '1';

export type ForgeWorldAccessRecord = {
  id: string;
  userId: string;
  scopeType: 'CREATE' | 'MAINTAIN';
  scopeWorldId?: string;
  canCreateWorld: boolean;
  canMaintainWorld: boolean;
  maintainRole: 'OWNER' | 'MAINTAINER';
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'SUSPENDED';
  expiresAt?: string | null;
};

export type ForgeWorldAccessResult = {
  hasAccess: boolean;
  canCreateWorld: boolean;
  canMaintainWorld: boolean;
  records: ForgeWorldAccessRecord[];
};

export type ForgeWorldLandingResult = {
  target: 'NO_ACCESS' | 'CREATE' | 'MAINTAIN';
  worldId?: string | null;
  reason?: string;
};

type CreateWorldDraftInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerCreateDraft'>[0];
type UpdateWorldDraftInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerUpdateDraft'>[1];
type PublishWorldDraftInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerPublishDraft'>[1];
type CommitWorldStateInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerCommitState'>[1];
type AppendWorldHistoryInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerAppendWorldHistory'>[1];
type GetWorldTruthResult = RealmServiceResult<'WorldsService', 'worldControllerGetWorld'>;
type GetWorldviewTruthResult = RealmServiceResult<'WorldsService', 'worldControllerGetWorldview'>;
type MutationCommitEnvelope = NonNullable<CommitWorldStateInput['commit']>;
type ListWorldResourceBindingsQuery = {
  take?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldBindings'>[1];
  bindingPoint?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldBindings'>[2];
  bindingKind?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldBindings'>[3];
  hostId?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldBindings'>[4];
  hostType?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldBindings'>[5];
  objectId?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldBindings'>[6];
  objectType?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldBindings'>[7];
};
type BatchUpsertWorldResourceBindingsInput = RealmServiceArgs<
  'WorldControlService',
  'worldControlControllerBatchUpsertWorldBindings'
>[1];
type CreateCreatorAgentInput = RealmServiceArgs<'CreatorService', 'creatorControllerCreateAgent'>[0];
type BatchCreateCreatorAgentsInput = RealmServiceArgs<'CreatorService', 'creatorControllerBatchCreateAgents'>[0];
type CreateWorldRuleInput = RealmServiceArgs<'WorldRulesService', 'worldRulesControllerCreateRule'>[1];
type UpdateWorldRuleInput = RealmServiceArgs<'WorldRulesService', 'worldRulesControllerUpdateRule'>[2];
type CommitWorldStateWrite = NonNullable<CommitWorldStateInput['writes']>[number];
type AppendWorldHistoryItem = NonNullable<AppendWorldHistoryInput['historyAppends']>[number];
type AppendWorldHistoryRelatedStateRef = NonNullable<AppendWorldHistoryItem['relatedStateRefs']>[number];
export type ForgeDraftHistoryEvent = NonNullable<
  NonNullable<CreateWorldDraftInput['draftPayload']>['historyDraft']
>['events']['primary'][number];
type ListAgentRulesQuery = {
  layer?: RealmServiceArgs<'AgentRulesService', 'agentRulesControllerListRules'>[2];
  status?: RealmServiceArgs<'AgentRulesService', 'agentRulesControllerListRules'>[3];
};
type CreateAgentRuleInput = RealmServiceArgs<'AgentRulesService', 'agentRulesControllerCreateRule'>[2];
type UpdateAgentRuleInput = RealmServiceArgs<'AgentRulesService', 'agentRulesControllerUpdateRule'>[3];
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
export type ForgeBatchUpsertWorldResourceBindingsInput = BatchUpsertWorldResourceBindingsInput;
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
export type ForgePublishWorldPackageInput = {
  mode?: 'upsert-sync' | 'reset-init';
  package: CanonicalPublishableWorldPackage;
  governance: {
    officialOwnerId: string;
    editorialOperatorId: string;
    reviewerId: string;
    publisherId: string;
    publishActorId: string;
    sourceProvenance: 'forge-text-source' | 'forge-file-source' | 'release-rollback';
    reviewVerdict: 'approved' | 'changes-requested' | 'rejected';
    releaseTag?: string;
    releaseSummary?: string;
    changeSummary?: string;
  };
  operations?: {
    batchRunId?: string;
    batchItemId?: string;
    qualityGate?: {
      status: 'PASS' | 'WARN' | 'FAIL' | 'BYPASSED';
      score?: number | null;
      findingCount?: number | null;
      findings?: string[];
    };
    titleLineageReason?: string;
  };
};
export type ForgeWorldReleaseDiffSummary = {
  previousReleaseId?: string | null;
  rollbackTargetReleaseId?: string | null;
  worldRulesChanged: boolean;
  worldRuleDelta: number;
  agentRuleSnapshotsChanged: boolean;
  agentRuleSnapshotDelta: number;
  worldviewChanged: boolean;
  lorebookChanged: boolean;
  summaryText?: string | null;
};
export type ForgeWorldRelease = {
  id: string;
  worldId: string;
  version: number;
  tag?: string | null;
  description?: string | null;
  packageVersion?: string | null;
  releaseType: 'SNAPSHOT' | 'MILESTONE' | 'PUBLISH' | 'ROLLBACK';
  status: 'DRAFT' | 'FROZEN' | 'PUBLISHED' | 'SUPERSEDED';
  ruleCount: number;
  ruleChecksum: string;
  worldviewChecksum?: string | null;
  lorebookChecksum?: string | null;
  sourceProvenance?: 'forge-text-source' | 'forge-file-source' | 'release-rollback' | null;
  reviewVerdict?: 'approved' | 'changes-requested' | 'rejected' | null;
  officialOwnerId?: string | null;
  editorialOperatorId?: string | null;
  reviewerId?: string | null;
  publisherId?: string | null;
  publishActorId?: string | null;
  supersedesReleaseId?: string | null;
  rollbackFromReleaseId?: string | null;
  diffSummary?: ForgeWorldReleaseDiffSummary | null;
  frozenAt?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  createdBy: string;
};
export type ForgeOfficialFactoryQualityGateSummary = {
  status: 'PASS' | 'WARN' | 'FAIL' | 'BYPASSED';
  score?: number | null;
  findingCount?: number | null;
  findings?: string[];
};
export type ForgeOfficialFactoryBatchItem = {
  id: string;
  runId: string;
  worldId?: string | null;
  slug: string;
  sourceTitle: string;
  canonicalTitle: string;
  titleLineageKey: string;
  sourceMode: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  packageVersion?: string | null;
  releaseId?: string | null;
  releaseVersion?: number | null;
  qualityGateStatus?: 'PASS' | 'WARN' | 'FAIL' | 'BYPASSED' | null;
  qualityGateSummary?: ForgeOfficialFactoryQualityGateSummary | null;
  retryCount: number;
  lastError?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ForgeOfficialFactoryBatchRun = {
  id: string;
  name: string;
  requestKey?: string | null;
  requestedBy: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'PARTIAL' | 'CANCELLED';
  pipelineStages: string[];
  retryLimit: number;
  retryCount: number;
  batchItemCount: number;
  successCount: number;
  failureCount: number;
  qualityGateStatus?: 'PASS' | 'WARN' | 'FAIL' | 'BYPASSED' | null;
  qualityGateSummary?: ForgeOfficialFactoryQualityGateSummary | null;
  lastError?: string | null;
  lastReleaseId?: string | null;
  executionNotes?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  items: ForgeOfficialFactoryBatchItem[];
};
export type ForgeCreateOfficialFactoryBatchRunInput = {
  name: string;
  requestKey?: string;
  pipelineStages: string[];
  retryLimit?: number;
  executionNotes?: string;
  items: Array<{
    slug: string;
    sourceTitle: string;
    canonicalTitle: string;
    sourceMode: string;
    worldId?: string;
    qualityGate?: ForgeOfficialFactoryQualityGateSummary;
  }>;
};
export type ForgeReportOfficialFactoryBatchItemFailureInput = {
  reason?: string;
  qualityGate?: ForgeOfficialFactoryQualityGateSummary;
};
export type ForgeOfficialWorldTitleLineage = {
  id: string;
  worldId?: string | null;
  slug: string;
  sourceTitle: string;
  canonicalTitle: string;
  titleLineageKey: string;
  packageVersion?: string | null;
  releaseId?: string | null;
  runId?: string | null;
  itemId?: string | null;
  recordedBy: string;
  reason?: string | null;
  createdAt: string;
};
export type ForgePublishWorldPackageResult = {
  slug: string;
  worldId: string;
  worldName: string;
  packageVersion: string;
  mode: 'upsert-sync' | 'reset-init';
  actionCount: number;
  publishedBy: string;
  release: ForgeWorldRelease;
};
export type ForgeRollbackWorldReleaseInput = {
  governance: ForgePublishWorldPackageInput['governance'];
};
export type ForgeRollbackWorldReleaseResult = {
  worldId: string;
  rollbackTargetReleaseId: string;
  release: ForgeWorldRelease;
};

type RawAccessResponse = {
  hasActiveAccess?: unknown;
  canCreateWorld?: unknown;
  canMaintainWorld?: unknown;
  records?: unknown[];
};

function normalizeWorldAccessResponse(response: unknown): ForgeWorldAccessResult {
  const access = response && typeof response === 'object' && !Array.isArray(response)
    ? response as RawAccessResponse
    : null;

  if (!access || typeof access.hasActiveAccess !== 'boolean') {
    throw new Error('FORGE_WORLD_ACCESS_CONTRACT_INVALID');
  }

  const rawRecords = Array.isArray(access.records) ? access.records : [];
  const records: ForgeWorldAccessRecord[] = rawRecords
    .filter((r): r is Record<string, unknown> => r != null && typeof r === 'object')
    .map((r) => ({
      id: String(r.id || ''),
      userId: String(r.userId || ''),
      scopeType: (r.scopeType === 'CREATE' || r.scopeType === 'MAINTAIN') ? r.scopeType : 'MAINTAIN',
      scopeWorldId: r.scopeWorldId ? String(r.scopeWorldId) : undefined,
      canCreateWorld: Boolean(r.canCreateWorld),
      canMaintainWorld: Boolean(r.canMaintainWorld),
      maintainRole: r.maintainRole === 'OWNER' ? 'OWNER' : 'MAINTAINER',
      status: (['ACTIVE', 'REVOKED', 'EXPIRED', 'SUSPENDED'] as const).includes(r.status as any)
        ? r.status as ForgeWorldAccessRecord['status']
        : 'ACTIVE',
      expiresAt: r.expiresAt ? String(r.expiresAt) : null,
    }));

  return {
    hasAccess: access.hasActiveAccess,
    canCreateWorld: Boolean(access.canCreateWorld),
    canMaintainWorld: Boolean(access.canMaintainWorld),
    records,
  };
}

function normalizeWorldLandingResponse(response: unknown): ForgeWorldLandingResult {
  const landing = response && typeof response === 'object' && !Array.isArray(response)
    ? response as Record<string, unknown>
    : null;

  if (!landing || typeof landing.target !== 'string') {
    throw new Error('FORGE_WORLD_LANDING_CONTRACT_INVALID');
  }

  const target = (['NO_ACCESS', 'CREATE', 'MAINTAIN'] as const).includes(landing.target as any)
    ? landing.target as ForgeWorldLandingResult['target']
    : 'NO_ACCESS';

  return {
    target,
    worldId: landing.worldId ? String(landing.worldId) : null,
    reason: landing.reason ? String(landing.reason) : undefined,
  };
}

function buildForgeMutationCommit(input: {
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

function buildHistoryAppend(
  value: unknown,
): AppendWorldHistoryItem {
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

function buildStateWrite(
  value: unknown,
): CommitWorldStateWrite {
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
    ...(Array.isArray(evidenceRefs) ? { evidenceRefs: requireObjectArray(evidenceRefs, 'FORGE_DRAFT_HISTORY_EVIDENCE_REFS_INVALID') } : {}),
  };
}

function buildDraftPayload(value: ForgeDraftPayload): NonNullable<CreateWorldDraftInput['draftPayload']> {
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

function buildWorldRuleInput(payload: ForgeCreateWorldRuleInput): CreateWorldRuleInput {
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

function buildAgentRuleInput(payload: ForgeCreateAgentRuleInput): CreateAgentRuleInput {
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

function buildCreatorAgentInput(payload: ForgeCreateWorldCreatorAgentInput): CreateCreatorAgentInput {
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

function normalizeWorldRelease(value: unknown, codePrefix: string): ForgeWorldRelease {
  const releaseRecord = requireRecord(value, `${codePrefix}_INVALID`);
  const diffSummaryValue = releaseRecord.diffSummary;
  const diffSummaryRecord = diffSummaryValue == null
    ? null
    : requireRecord(diffSummaryValue, `${codePrefix}_DIFF_REQUIRED`);
  return {
    id: requireString(releaseRecord.id, `${codePrefix}_ID_REQUIRED`),
    worldId: requireString(releaseRecord.worldId, `${codePrefix}_WORLD_ID_REQUIRED`),
    version: requireNumber(releaseRecord.version, `${codePrefix}_VERSION_REQUIRED`),
    tag: releaseRecord.tag == null ? null : optionalString(releaseRecord.tag) ?? null,
    description: releaseRecord.description == null ? null : optionalString(releaseRecord.description) ?? null,
    packageVersion: releaseRecord.packageVersion == null ? null : optionalString(releaseRecord.packageVersion) ?? null,
    releaseType: requireEnum(
      releaseRecord.releaseType,
      ['SNAPSHOT', 'MILESTONE', 'PUBLISH', 'ROLLBACK'] as const,
      `${codePrefix}_TYPE_REQUIRED`,
    ),
    status: requireEnum(
      releaseRecord.status,
      ['DRAFT', 'FROZEN', 'PUBLISHED', 'SUPERSEDED'] as const,
      `${codePrefix}_STATUS_REQUIRED`,
    ),
    ruleCount: requireNumber(releaseRecord.ruleCount, `${codePrefix}_RULE_COUNT_REQUIRED`),
    ruleChecksum: requireString(releaseRecord.ruleChecksum, `${codePrefix}_RULE_CHECKSUM_REQUIRED`),
    worldviewChecksum: releaseRecord.worldviewChecksum == null ? null : optionalString(releaseRecord.worldviewChecksum) ?? null,
    lorebookChecksum: releaseRecord.lorebookChecksum == null ? null : optionalString(releaseRecord.lorebookChecksum) ?? null,
    sourceProvenance: releaseRecord.sourceProvenance == null
      ? null
      : requireEnum(
        releaseRecord.sourceProvenance,
        ['forge-text-source', 'forge-file-source', 'release-rollback'] as const,
        `${codePrefix}_SOURCE_PROVENANCE_REQUIRED`,
      ),
    reviewVerdict: releaseRecord.reviewVerdict == null
      ? null
      : requireEnum(
        releaseRecord.reviewVerdict,
        ['approved', 'changes-requested', 'rejected'] as const,
        `${codePrefix}_VERDICT_REQUIRED`,
      ),
    officialOwnerId: releaseRecord.officialOwnerId == null ? null : optionalString(releaseRecord.officialOwnerId) ?? null,
    editorialOperatorId: releaseRecord.editorialOperatorId == null ? null : optionalString(releaseRecord.editorialOperatorId) ?? null,
    reviewerId: releaseRecord.reviewerId == null ? null : optionalString(releaseRecord.reviewerId) ?? null,
    publisherId: releaseRecord.publisherId == null ? null : optionalString(releaseRecord.publisherId) ?? null,
    publishActorId: releaseRecord.publishActorId == null ? null : optionalString(releaseRecord.publishActorId) ?? null,
    supersedesReleaseId: releaseRecord.supersedesReleaseId == null ? null : optionalString(releaseRecord.supersedesReleaseId) ?? null,
    rollbackFromReleaseId: releaseRecord.rollbackFromReleaseId == null ? null : optionalString(releaseRecord.rollbackFromReleaseId) ?? null,
    diffSummary: diffSummaryRecord == null
      ? null
      : {
          previousReleaseId: diffSummaryRecord.previousReleaseId == null ? null : optionalString(diffSummaryRecord.previousReleaseId) ?? null,
          rollbackTargetReleaseId: diffSummaryRecord.rollbackTargetReleaseId == null ? null : optionalString(diffSummaryRecord.rollbackTargetReleaseId) ?? null,
          worldRulesChanged: Boolean(diffSummaryRecord.worldRulesChanged),
          worldRuleDelta: requireNumber(diffSummaryRecord.worldRuleDelta, `${codePrefix}_DIFF_WORLD_RULE_DELTA_REQUIRED`),
          agentRuleSnapshotsChanged: Boolean(diffSummaryRecord.agentRuleSnapshotsChanged),
          agentRuleSnapshotDelta: requireNumber(diffSummaryRecord.agentRuleSnapshotDelta, `${codePrefix}_DIFF_AGENT_DELTA_REQUIRED`),
          worldviewChanged: Boolean(diffSummaryRecord.worldviewChanged),
          lorebookChanged: Boolean(diffSummaryRecord.lorebookChanged),
          summaryText: diffSummaryRecord.summaryText == null ? null : optionalString(diffSummaryRecord.summaryText) ?? null,
        },
    frozenAt: releaseRecord.frozenAt == null ? null : optionalString(releaseRecord.frozenAt) ?? null,
    publishedAt: releaseRecord.publishedAt == null ? null : optionalString(releaseRecord.publishedAt) ?? null,
    createdAt: requireString(releaseRecord.createdAt, `${codePrefix}_CREATED_AT_REQUIRED`),
    createdBy: requireString(releaseRecord.createdBy, `${codePrefix}_CREATED_BY_REQUIRED`),
  };
}

function normalizeQualityGateSummary(value: unknown, codePrefix: string): ForgeOfficialFactoryQualityGateSummary {
  const record = requireRecord(value, `${codePrefix}_INVALID`);
  const findings = record.findings;
  return {
    status: requireEnum(record.status, ['PASS', 'WARN', 'FAIL', 'BYPASSED'] as const, `${codePrefix}_STATUS_REQUIRED`),
    score: record.score == null ? null : requireNumber(record.score, `${codePrefix}_SCORE_REQUIRED`),
    findingCount: record.findingCount == null ? null : requireNumber(record.findingCount, `${codePrefix}_FINDING_COUNT_REQUIRED`),
    findings: findings == null
      ? undefined
      : optionalStringArray(findings, `${codePrefix}_FINDINGS_REQUIRED`),
  };
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('FORGE_PACKAGE_PUBLISH_RESPONSE_INVALID');
  }
}

function normalizeOfficialFactoryBatchItem(
  value: unknown,
  codePrefix: string,
): ForgeOfficialFactoryBatchItem {
  const record = requireRecord(value, `${codePrefix}_INVALID`);
  return {
    id: requireString(record.id, `${codePrefix}_ID_REQUIRED`),
    runId: requireString(record.runId, `${codePrefix}_RUN_ID_REQUIRED`),
    worldId: record.worldId == null ? null : optionalString(record.worldId) ?? null,
    slug: requireString(record.slug, `${codePrefix}_SLUG_REQUIRED`),
    sourceTitle: requireString(record.sourceTitle, `${codePrefix}_SOURCE_TITLE_REQUIRED`),
    canonicalTitle: requireString(record.canonicalTitle, `${codePrefix}_CANONICAL_TITLE_REQUIRED`),
    titleLineageKey: requireString(record.titleLineageKey, `${codePrefix}_TITLE_LINEAGE_KEY_REQUIRED`),
    sourceMode: requireString(record.sourceMode, `${codePrefix}_SOURCE_MODE_REQUIRED`),
    status: requireEnum(record.status, ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED'] as const, `${codePrefix}_STATUS_REQUIRED`),
    packageVersion: record.packageVersion == null ? null : optionalString(record.packageVersion) ?? null,
    releaseId: record.releaseId == null ? null : optionalString(record.releaseId) ?? null,
    releaseVersion: record.releaseVersion == null ? null : requireNumber(record.releaseVersion, `${codePrefix}_RELEASE_VERSION_REQUIRED`),
    qualityGateStatus: record.qualityGateStatus == null
      ? null
      : requireEnum(record.qualityGateStatus, ['PASS', 'WARN', 'FAIL', 'BYPASSED'] as const, `${codePrefix}_QUALITY_GATE_STATUS_REQUIRED`),
    qualityGateSummary: record.qualityGateSummary == null
      ? null
      : normalizeQualityGateSummary(record.qualityGateSummary, `${codePrefix}_QUALITY_GATE_SUMMARY`),
    retryCount: requireNumber(record.retryCount, `${codePrefix}_RETRY_COUNT_REQUIRED`),
    lastError: record.lastError == null ? null : optionalString(record.lastError) ?? null,
    startedAt: record.startedAt == null ? null : optionalString(record.startedAt) ?? null,
    finishedAt: record.finishedAt == null ? null : optionalString(record.finishedAt) ?? null,
    createdAt: requireString(record.createdAt, `${codePrefix}_CREATED_AT_REQUIRED`),
    updatedAt: requireString(record.updatedAt, `${codePrefix}_UPDATED_AT_REQUIRED`),
  };
}

function normalizeOfficialFactoryBatchRun(value: unknown): ForgeOfficialFactoryBatchRun {
  const record = requireRecord(value, 'FORGE_WORLD_BATCH_RUN_INVALID');
  return {
    id: requireString(record.id, 'FORGE_WORLD_BATCH_RUN_ID_REQUIRED'),
    name: requireString(record.name, 'FORGE_WORLD_BATCH_RUN_NAME_REQUIRED'),
    requestKey: record.requestKey == null ? null : optionalString(record.requestKey) ?? null,
    requestedBy: requireString(record.requestedBy, 'FORGE_WORLD_BATCH_RUN_REQUESTED_BY_REQUIRED'),
    status: requireEnum(record.status, ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL', 'CANCELLED'] as const, 'FORGE_WORLD_BATCH_RUN_STATUS_REQUIRED'),
    pipelineStages: optionalStringArray(record.pipelineStages, 'FORGE_WORLD_BATCH_RUN_PIPELINE_STAGES_REQUIRED') ?? [],
    retryLimit: requireNumber(record.retryLimit, 'FORGE_WORLD_BATCH_RUN_RETRY_LIMIT_REQUIRED'),
    retryCount: requireNumber(record.retryCount, 'FORGE_WORLD_BATCH_RUN_RETRY_COUNT_REQUIRED'),
    batchItemCount: requireNumber(record.batchItemCount, 'FORGE_WORLD_BATCH_RUN_BATCH_ITEM_COUNT_REQUIRED'),
    successCount: requireNumber(record.successCount, 'FORGE_WORLD_BATCH_RUN_SUCCESS_COUNT_REQUIRED'),
    failureCount: requireNumber(record.failureCount, 'FORGE_WORLD_BATCH_RUN_FAILURE_COUNT_REQUIRED'),
    qualityGateStatus: record.qualityGateStatus == null
      ? null
      : requireEnum(record.qualityGateStatus, ['PASS', 'WARN', 'FAIL', 'BYPASSED'] as const, 'FORGE_WORLD_BATCH_RUN_QUALITY_GATE_STATUS_REQUIRED'),
    qualityGateSummary: record.qualityGateSummary == null
      ? null
      : normalizeQualityGateSummary(record.qualityGateSummary, 'FORGE_WORLD_BATCH_RUN_QUALITY_GATE_SUMMARY'),
    lastError: record.lastError == null ? null : optionalString(record.lastError) ?? null,
    lastReleaseId: record.lastReleaseId == null ? null : optionalString(record.lastReleaseId) ?? null,
    executionNotes: record.executionNotes == null ? null : optionalString(record.executionNotes) ?? null,
    startedAt: record.startedAt == null ? null : optionalString(record.startedAt) ?? null,
    finishedAt: record.finishedAt == null ? null : optionalString(record.finishedAt) ?? null,
    createdAt: requireString(record.createdAt, 'FORGE_WORLD_BATCH_RUN_CREATED_AT_REQUIRED'),
    updatedAt: requireString(record.updatedAt, 'FORGE_WORLD_BATCH_RUN_UPDATED_AT_REQUIRED'),
    items: Array.isArray(record.items)
      ? record.items.map((item) => normalizeOfficialFactoryBatchItem(item, 'FORGE_WORLD_BATCH_ITEM'))
      : [],
  };
}

function normalizeOfficialWorldTitleLineage(value: unknown): ForgeOfficialWorldTitleLineage {
  const record = requireRecord(value, 'FORGE_WORLD_TITLE_LINEAGE_INVALID');
  return {
    id: requireString(record.id, 'FORGE_WORLD_TITLE_LINEAGE_ID_REQUIRED'),
    worldId: record.worldId == null ? null : optionalString(record.worldId) ?? null,
    slug: requireString(record.slug, 'FORGE_WORLD_TITLE_LINEAGE_SLUG_REQUIRED'),
    sourceTitle: requireString(record.sourceTitle, 'FORGE_WORLD_TITLE_LINEAGE_SOURCE_TITLE_REQUIRED'),
    canonicalTitle: requireString(record.canonicalTitle, 'FORGE_WORLD_TITLE_LINEAGE_CANONICAL_TITLE_REQUIRED'),
    titleLineageKey: requireString(record.titleLineageKey, 'FORGE_WORLD_TITLE_LINEAGE_KEY_REQUIRED'),
    packageVersion: record.packageVersion == null ? null : optionalString(record.packageVersion) ?? null,
    releaseId: record.releaseId == null ? null : optionalString(record.releaseId) ?? null,
    runId: record.runId == null ? null : optionalString(record.runId) ?? null,
    itemId: record.itemId == null ? null : optionalString(record.itemId) ?? null,
    recordedBy: requireString(record.recordedBy, 'FORGE_WORLD_TITLE_LINEAGE_RECORDED_BY_REQUIRED'),
    reason: record.reason == null ? null : optionalString(record.reason) ?? null,
    createdAt: requireString(record.createdAt, 'FORGE_WORLD_TITLE_LINEAGE_CREATED_AT_REQUIRED'),
  };
}

function normalizePublishWorldPackageResult(value: unknown): ForgePublishWorldPackageResult {
  const record = requireRecord(value, 'FORGE_PACKAGE_PUBLISH_RESPONSE_INVALID');
  return {
    slug: requireString(record.slug, 'FORGE_PACKAGE_PUBLISH_SLUG_REQUIRED'),
    worldId: requireString(record.worldId, 'FORGE_PACKAGE_PUBLISH_WORLD_ID_REQUIRED'),
    worldName: requireString(record.worldName, 'FORGE_PACKAGE_PUBLISH_WORLD_NAME_REQUIRED'),
    packageVersion: requireString(record.packageVersion, 'FORGE_PACKAGE_PUBLISH_VERSION_REQUIRED'),
    mode: requireEnum(record.mode, ['upsert-sync', 'reset-init'] as const, 'FORGE_PACKAGE_PUBLISH_MODE_REQUIRED'),
    actionCount: requireNumber(record.actionCount, 'FORGE_PACKAGE_PUBLISH_ACTION_COUNT_REQUIRED'),
    publishedBy: requireString(record.publishedBy, 'FORGE_PACKAGE_PUBLISH_ACTOR_REQUIRED'),
    release: normalizeWorldRelease(record.release, 'FORGE_PACKAGE_PUBLISH_RELEASE'),
  };
}

function normalizeRollbackWorldReleaseResult(value: unknown): ForgeRollbackWorldReleaseResult {
  const record = requireRecord(value, 'FORGE_WORLD_RELEASE_ROLLBACK_RESPONSE_INVALID');
  return {
    worldId: requireString(record.worldId, 'FORGE_WORLD_RELEASE_ROLLBACK_WORLD_ID_REQUIRED'),
    rollbackTargetReleaseId: requireString(record.rollbackTargetReleaseId, 'FORGE_WORLD_RELEASE_ROLLBACK_TARGET_REQUIRED'),
    release: normalizeWorldRelease(record.release, 'FORGE_WORLD_RELEASE_ROLLBACK_RELEASE'),
  };
}

function getAdminAuthContext() {
  const realmBaseUrl = String(useAppStore.getState().runtimeDefaults?.realm?.realmBaseUrl || '').trim();
  if (!realmBaseUrl) {
    throw new Error('FORGE_REALM_BASE_URL_REQUIRED');
  }
  const token = String(useAppStore.getState().auth?.token || '').trim();
  if (!token) {
    throw new Error('FORGE_AUTH_TOKEN_REQUIRED');
  }
  return { realmBaseUrl, token };
}

async function requestAdminWorldGovernance(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const { realmBaseUrl, token } = getAdminAuthContext();
  const response = await fetch(`${realmBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const parsed = await parseJsonResponse(response);

  if (!response.ok) {
    const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
    const message = record && typeof record.message === 'string'
      ? record.message
      : `FORGE_WORLD_GOVERNANCE_REQUEST_FAILED:${response.status}`;
    throw new Error(message);
  }

  return parsed;
}

// ── Draft Queries ──────────────────────────────────────────

export async function getMyWorldAccess() {
  const response = await realm().services.WorldControlService.worldControlControllerGetMyAccess();
  return normalizeWorldAccessResponse(response);
}

export async function resolveWorldLanding(): Promise<ForgeWorldLandingResult> {
  const response = await realm().services.WorldControlService.worldControlControllerResolveLanding();
  return normalizeWorldLandingResponse(response);
}

export async function createWorldDraft(payload: ForgeCreateWorldDraftInput) {
  const draftPayload = buildDraftPayload(payload.draftPayload);
  const importSource = draftPayload.importSource as { sourceType: string };
  if (importSource.sourceType !== payload.sourceType) {
    throw new Error('FORGE_DRAFT_SOURCE_TYPE_MISMATCH');
  }
  return realm().services.WorldControlService.worldControlControllerCreateDraft({
    sourceType: payload.sourceType,
    sourceRef: payload.sourceRef,
    targetWorldId: payload.targetWorldId,
    draftPayload,
  });
}

export async function getWorldDraft(draftId: string) {
  return realm().services.WorldControlService.worldControlControllerGetDraft(draftId);
}

export async function listWorldDrafts() {
  return realm().services.WorldControlService.worldControlControllerListDrafts();
}

export async function updateWorldDraft(draftId: string, patch: ForgeUpdateWorldDraftInput) {
  return realm().services.WorldControlService.worldControlControllerUpdateDraft(draftId, {
    status: patch.status,
    draftPayload: patch.draftPayload ? buildDraftPayload(patch.draftPayload) : undefined,
  });
}

export async function publishWorldDraft(draftId: string, payload: ForgePublishWorldDraftInput = {}) {
  return realm().services.WorldControlService.worldControlControllerPublishDraft(draftId, payload);
}

export async function publishWorldPackage(
  payload: ForgePublishWorldPackageInput,
): Promise<ForgePublishWorldPackageResult> {
  const parsed = await requestAdminWorldGovernance('/api/admin/worlds/packages/publish', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return normalizePublishWorldPackageResult(parsed);
}

export async function listWorldReleases(worldId: string): Promise<ForgeWorldRelease[]> {
  const parsed = await requestAdminWorldGovernance(`/api/admin/worlds/${encodeURIComponent(worldId)}/releases`);
  if (!Array.isArray(parsed)) {
    throw new Error('FORGE_WORLD_RELEASE_LIST_INVALID');
  }
  return parsed.map((entry) => normalizeWorldRelease(entry, 'FORGE_WORLD_RELEASE_LIST_ITEM'));
}

export async function getWorldRelease(worldId: string, releaseId: string): Promise<ForgeWorldRelease> {
  const parsed = await requestAdminWorldGovernance(
    `/api/admin/worlds/${encodeURIComponent(worldId)}/releases/${encodeURIComponent(releaseId)}`,
  );
  return normalizeWorldRelease(parsed, 'FORGE_WORLD_RELEASE_DETAIL');
}

export async function rollbackWorldRelease(
  worldId: string,
  releaseId: string,
  payload: ForgeRollbackWorldReleaseInput,
): Promise<ForgeRollbackWorldReleaseResult> {
  const parsed = await requestAdminWorldGovernance(
    `/api/admin/worlds/${encodeURIComponent(worldId)}/releases/${encodeURIComponent(releaseId)}/rollback`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  return normalizeRollbackWorldReleaseResult(parsed);
}

export async function listOfficialFactoryBatchRuns(): Promise<ForgeOfficialFactoryBatchRun[]> {
  const parsed = await requestAdminWorldGovernance('/api/admin/worlds/operations/batch-runs');
  if (!Array.isArray(parsed)) {
    throw new Error('FORGE_WORLD_BATCH_RUN_LIST_INVALID');
  }
  return parsed.map((entry) => normalizeOfficialFactoryBatchRun(entry));
}

export async function createOfficialFactoryBatchRun(
  payload: ForgeCreateOfficialFactoryBatchRunInput,
): Promise<ForgeOfficialFactoryBatchRun> {
  const parsed = await requestAdminWorldGovernance('/api/admin/worlds/operations/batch-runs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return normalizeOfficialFactoryBatchRun(parsed);
}

export async function getOfficialFactoryBatchRun(runId: string): Promise<ForgeOfficialFactoryBatchRun> {
  const parsed = await requestAdminWorldGovernance(
    `/api/admin/worlds/operations/batch-runs/${encodeURIComponent(runId)}`,
  );
  return normalizeOfficialFactoryBatchRun(parsed);
}

export async function retryOfficialFactoryBatchRun(
  runId: string,
  payload: { reason?: string },
): Promise<ForgeOfficialFactoryBatchRun> {
  const parsed = await requestAdminWorldGovernance(
    `/api/admin/worlds/operations/batch-runs/${encodeURIComponent(runId)}/retry`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  return normalizeOfficialFactoryBatchRun(parsed);
}

export async function reportOfficialFactoryBatchItemFailure(
  runId: string,
  itemId: string,
  payload: ForgeReportOfficialFactoryBatchItemFailureInput,
): Promise<ForgeOfficialFactoryBatchRun> {
  const parsed = await requestAdminWorldGovernance(
    `/api/admin/worlds/operations/batch-runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}/fail`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  return normalizeOfficialFactoryBatchRun(parsed);
}

export async function listWorldTitleLineage(worldId: string): Promise<ForgeOfficialWorldTitleLineage[]> {
  const parsed = await requestAdminWorldGovernance(
    `/api/admin/worlds/${encodeURIComponent(worldId)}/title-lineage`,
  );
  if (!Array.isArray(parsed)) {
    throw new Error('FORGE_WORLD_TITLE_LINEAGE_LIST_INVALID');
  }
  return parsed.map((entry) => normalizeOfficialWorldTitleLineage(entry));
}

// ── State Queries ──────────────────────────────────────────

export async function getWorldState(worldId: string) {
  return realm().services.WorldControlService.worldControlControllerGetState(worldId);
}

export async function getWorldDetail(worldId: string): Promise<GetWorldTruthResult> {
  return realm().services.WorldsService.worldControllerGetWorld(worldId);
}

export async function getWorldTruth(worldId: string): Promise<GetWorldTruthResult> {
  return realm().services.WorldsService.worldControllerGetWorld(worldId);
}

export async function getWorldviewTruth(worldId: string): Promise<GetWorldviewTruthResult> {
  return realm().services.WorldsService.worldControllerGetWorldview(worldId);
}

export async function commitWorldState(worldId: string, patch: ForgeCommitWorldStateInput) {
  if (!Array.isArray(patch.writes)) {
    throw new Error('FORGE_WORLD_STATE_WRITES_REQUIRED');
  }
  return realm().services.WorldControlService.worldControlControllerCommitState(worldId, {
    ...patch,
    writes: patch.writes.map((item) => buildStateWrite(item)),
    commit: buildForgeMutationCommit({
      worldId,
      effectClass: 'STATE_ONLY',
      schemaId: FORGE_WORLD_WORKSPACE_SCHEMA_ID,
      schemaVersion: FORGE_WORLD_WORKSPACE_SCHEMA_VERSION,
      reason: patch.reason,
      sessionId: patch.sessionId,
      existing: patch.commit,
    }),
  });
}

export async function listMyWorlds() {
  return realm().services.WorldControlService.worldControlControllerListMyWorlds();
}

// ── History & Lorebooks ────────────────────────────────────

export async function listWorldHistory(worldId: string) {
  return realm().services.WorldControlService.worldControlControllerListWorldHistory(worldId);
}

export async function appendWorldHistory(worldId: string, payload: ForgeAppendWorldHistoryInput) {
  if (!Array.isArray(payload.historyAppends)) {
    throw new Error('FORGE_WORLD_HISTORY_APPENDS_REQUIRED');
  }
  return realm().services.WorldControlService.worldControlControllerAppendWorldHistory(worldId, {
    ...payload,
    historyAppends: payload.historyAppends.map((item) => buildHistoryAppend(item)),
    commit: buildForgeMutationCommit({
      worldId,
      effectClass: 'STATE_AND_HISTORY',
      schemaId: FORGE_WORLD_HISTORY_SCHEMA_ID,
      schemaVersion: FORGE_WORLD_HISTORY_SCHEMA_VERSION,
      reason: payload.reason,
      sessionId: payload.sessionId,
      existing: payload.commit,
    }),
  });
}

export async function listWorldLorebooks(worldId: string) {
  return realm().services.WorldControlService.worldControlControllerListWorldLorebooks(worldId);
}

// ── Visual Bindings ────────────────────────────────────────

export async function listWorldResourceBindings(worldId: string, query?: ListWorldResourceBindingsQuery) {
  return realm().services.WorldControlService.worldControlControllerListWorldBindings(
    worldId,
    query?.take,
    query?.bindingPoint,
    query?.bindingKind,
    query?.hostId,
    query?.hostType,
    query?.objectId,
    query?.objectType,
  );
}

export async function batchUpsertWorldResourceBindings(
  worldId: string,
  payload: BatchUpsertWorldResourceBindingsInput,
) {
  return realm().services.WorldControlService.worldControlControllerBatchUpsertWorldBindings(
    worldId,
    payload,
  );
}

export async function deleteWorldResourceBinding(worldId: string, bindingId: string) {
  return realm().services.WorldControlService.worldControlControllerDeleteWorldBinding(
    worldId,
    bindingId,
  );
}

// ── Creator Agents ─────────────────────────────────────────

export async function listCreatorAgents() {
  return realm().services.CreatorService.creatorControllerListAgents();
}

export async function createCreatorAgent(payload: ForgeCreateWorldCreatorAgentInput) {
  return realm().services.CreatorService.creatorControllerCreateAgent(buildCreatorAgentInput(payload));
}

export async function batchCreateCreatorAgents(payload: ForgeBatchCreateCreatorAgentsInput) {
  return realm().services.CreatorService.creatorControllerBatchCreateAgents({
    items: payload.items.map((item) => buildCreatorAgentInput(item)),
    continueOnError: payload.continueOnError ?? false,
  });
}

// ── Rule Truth CRUD ────────────────────────────────────────

export async function listWorldRules(worldId: string, status?: string) {
  return realm().services.WorldRulesService.worldRulesControllerGetRules(worldId, status);
}

export async function createWorldRule(worldId: string, payload: ForgeCreateWorldRuleInput) {
  return realm().services.WorldRulesService.worldRulesControllerCreateRule(
    worldId,
    buildWorldRuleInput(payload),
  );
}

export async function updateWorldRule(
  worldId: string,
  ruleId: string,
  payload: ForgeUpdateWorldRuleInput,
) {
  return realm().services.WorldRulesService.worldRulesControllerUpdateRule(worldId, ruleId, payload);
}

export async function deprecateWorldRule(worldId: string, ruleId: string) {
  return realm().services.WorldRulesService.worldRulesControllerDeprecateRule(worldId, ruleId);
}

export async function archiveWorldRule(worldId: string, ruleId: string) {
  return realm().services.WorldRulesService.worldRulesControllerArchiveRule(worldId, ruleId);
}

export async function listAgentRules(
  worldId: string,
  agentId: string,
  query?: ListAgentRulesQuery,
) {
  return realm().services.AgentRulesService.agentRulesControllerListRules(
    worldId,
    agentId,
    query?.layer,
    query?.status,
  );
}

export async function createAgentRule(
  worldId: string,
  agentId: string,
  payload: ForgeCreateAgentRuleInput,
) {
  return realm().services.AgentRulesService.agentRulesControllerCreateRule(
    worldId,
    agentId,
    buildAgentRuleInput(payload),
  );
}

export async function updateAgentRule(
  worldId: string,
  agentId: string,
  ruleId: string,
  payload: ForgeUpdateAgentRuleInput,
) {
  return realm().services.AgentRulesService.agentRulesControllerUpdateRule(
    worldId,
    agentId,
    ruleId,
    payload,
  );
}

export async function deprecateAgentRule(
  worldId: string,
  agentId: string,
  ruleId: string,
) {
  return realm().services.AgentRulesService.agentRulesControllerDeprecateRule(
    worldId,
    agentId,
    ruleId,
  );
}

export async function archiveAgentRule(
  worldId: string,
  agentId: string,
  ruleId: string,
) {
  return realm().services.AgentRulesService.agentRulesControllerArchiveRule(
    worldId,
    agentId,
    ruleId,
  );
}
