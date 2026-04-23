import type { RealmServiceArgs } from '@nimiplatform/sdk/realm';
import {
  recordDesktopWorldEvolutionCommitRequestCandidate,
  settleDesktopWorldEvolutionCommitRequestRecord,
} from '@runtime/world-evolution/commit-requests';
import {
  WORLD_DATA_API_CAPABILITIES,
  requireObjectArray,
  requireItemsPayload,
  requireObjectPayload,
  requireRecord,
  toRecord,
} from './runtime-bootstrap-utils';
import { registerCoreDataCapability, withRuntimeOpenApiContext } from './shared';

type CreateWorldDraftInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerCreateDraft'>[0];
type CommitWorldStateInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerCommitState'>[1];
type AppendWorldHistoryInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerAppendWorldHistory'>[1];
type BatchUpsertBindingsInput = RealmServiceArgs<
  'WorldControlService',
  'worldControlControllerBatchUpsertWorldBindings'
>[1];
type MutationCommitEnvelope = NonNullable<CommitWorldStateInput['commit']>;
type MutationActorRef = MutationCommitEnvelope['actorRefs'][number];
type MutationEvidenceRef = NonNullable<MutationCommitEnvelope['evidenceRefs']>[number];
type CommitWorldStateWrite = NonNullable<CommitWorldStateInput['writes']>[number];
type AppendWorldHistoryItem = NonNullable<AppendWorldHistoryInput['historyAppends']>[number];
type AppendWorldHistoryRelatedStateRef = NonNullable<AppendWorldHistoryItem['relatedStateRefs']>[number];
type AppendWorldHistoryEvidenceRef = NonNullable<AppendWorldHistoryItem['evidenceRefs']>[number];

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter((item) => item.length > 0);
  }
  const text = String(value || '').trim();
  if (!text) {
    return [];
  }
  return text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toOptionalString(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized ? normalized : undefined;
}

function requireStringValue(value: unknown, code: string): string {
  const normalized = toOptionalString(value);
  if (!normalized) {
    throw new Error(code);
  }
  return normalized;
}

function requireSourceType(value: unknown, code: string): CreateWorldDraftInput['sourceType'] {
  if (value === 'TEXT' || value === 'FILE') {
    return value;
  }
  throw new Error(code);
}

function requireMutationScope(value: unknown, code: string): MutationCommitEnvelope['scope'] {
  if (value === 'WORLD' || value === 'ENTITY' || value === 'RELATION') {
    return value;
  }
  throw new Error(code);
}

function requireHistoryVisibility(value: unknown, code: string): AppendWorldHistoryItem['visibility'] {
  if (value === 'PUBLIC' || value === 'WORLD' || value === 'RESTRICTED') {
    return value;
  }
  throw new Error(code);
}

function requireWorldRecordScope(value: unknown, code: string): CommitWorldStateWrite['scope'] {
  if (value === 'WORLD' || value === 'ENTITY' || value === 'RELATION') {
    return value;
  }
  throw new Error(code);
}

function requireMutationActorRefs(input: unknown, code: string): MutationActorRef[] {
  return requireObjectArray<Record<string, unknown>>(input, code).map((item) => {
    const actorId = String(item.actorId || '').trim();
    const actorType = String(item.actorType || '').trim();
    const role = toOptionalString(item.role);
    if (!actorId || !actorType) {
      throw new Error(code);
    }
    return {
      actorId,
      actorType,
      ...(role ? { role } : {}),
    };
  });
}

function requireMutationEvidenceRefs(input: unknown, code: string): MutationEvidenceRef[] {
  return requireObjectArray<Record<string, unknown>>(input, code).map((item) => {
    const kind = String(item.kind || '').trim();
    const refId = String(item.refId || '').trim();
    const uri = toOptionalString(item.uri);
    if (!kind || !refId) {
      throw new Error(code);
    }
    return {
      kind,
      refId,
      ...(uri ? { uri } : {}),
    };
  });
}

function requireMutationCommitEnvelope(input: unknown, code: string): MutationCommitEnvelope {
  const record = requireRecord(input, code);
  const worldId = String(record.worldId || '').trim();
  const appId = String(record.appId || '').trim();
  const sessionId = String(record.sessionId || '').trim();
  const schemaId = String(record.schemaId || '').trim();
  const schemaVersion = String(record.schemaVersion || '').trim();
  const scope = requireMutationScope(record.scope, code);
  const reason = String(record.reason || '').trim();
  const effectClass = record.effectClass;
  if (
    !worldId
    || !appId
    || !sessionId
    || !schemaId
    || !schemaVersion
    || !reason
    || (
      effectClass !== 'NONE'
      && effectClass !== 'STATE_ONLY'
      && effectClass !== 'STATE_AND_HISTORY'
    )
  ) {
    throw new Error(code);
  }
  const actorRefs = requireMutationActorRefs(record.actorRefs, code);
  const evidenceRefs = record.evidenceRefs === undefined
    ? undefined
    : requireMutationEvidenceRefs(record.evidenceRefs, code);
  return {
    worldId,
    appId,
    sessionId,
    effectClass,
    scope,
    schemaId,
    schemaVersion,
    actorRefs,
    reason,
    ...(evidenceRefs ? { evidenceRefs } : {}),
  };
}

function parseBatchUpsertBindingsInput(
  input: unknown,
  code: string,
): BatchUpsertBindingsInput {
  const record = requireRecord(input, code);
  return {
    bindingUpserts: requireObjectArray<Record<string, unknown>>(record.bindingUpserts, code) as BatchUpsertBindingsInput['bindingUpserts'],
  };
}

function requireCreateWorldDraftInput(input: unknown, code: string): CreateWorldDraftInput {
  const record = requireRecord(input, code);
  const sourceType = requireSourceType(record.sourceType, code);
  const draftPayload = record.draftPayload === undefined
    ? undefined
    : requireWorldDraftPayload(record.draftPayload, code);
  const sourceRef = toOptionalString(record.sourceRef);
  const targetWorldId = toOptionalString(record.targetWorldId);
  return {
    sourceType,
    ...(draftPayload ? { draftPayload } : {}),
    ...(sourceRef ? { sourceRef } : {}),
    ...(targetWorldId ? { targetWorldId } : {}),
  };
}

function requireWorldDraftPayload(
  input: unknown,
  code: string,
): NonNullable<CreateWorldDraftInput['draftPayload']> {
  const record = requireRecord(input, code);
  const importSource = requireRecord(record.importSource, code);
  const truthDraft = requireRecord(record.truthDraft, code);
  const stateDraft = requireRecord(record.stateDraft, code);
  const historyDraft = requireRecord(record.historyDraft, code);

  if (!Array.isArray(truthDraft.worldRules) || !Array.isArray(truthDraft.agentRules)) {
    throw new Error(code);
  }

  return {
    importSource,
    truthDraft: {
      ...truthDraft,
      worldRules: truthDraft.worldRules as NonNullable<
        NonNullable<CreateWorldDraftInput['draftPayload']>['truthDraft']
      >['worldRules'],
      agentRules: truthDraft.agentRules as NonNullable<
        NonNullable<CreateWorldDraftInput['draftPayload']>['truthDraft']
      >['agentRules'],
    },
    stateDraft: {
      ...stateDraft,
      worldState: requireRecord(stateDraft.worldState, code),
    },
    historyDraft: {
      ...historyDraft,
      events: requireRecord(historyDraft.events, code),
    },
  } as NonNullable<CreateWorldDraftInput['draftPayload']>;
}

function requireCommitWorldStateWrite(input: unknown, code: string): CommitWorldStateWrite {
  const item = requireRecord(input, code);
  return {
    scope: requireWorldRecordScope(item.scope, code),
    scopeKey: requireStringValue(item.scopeKey, code),
    targetPath: toOptionalString(item.targetPath),
    payload: requireRecord(item.payload, code),
    ...(item.metadata === undefined ? {} : { metadata: requireRecord(item.metadata, code) }),
  };
}

function requireAppendWorldHistoryRelatedStateRefs(
  input: unknown,
  code: string,
): AppendWorldHistoryRelatedStateRef[] {
  return requireObjectArray<Record<string, unknown>>(input, code).map((ref) => ({
    recordId: requireStringValue(ref.recordId, code),
    scope: requireWorldRecordScope(ref.scope, code),
    scopeKey: requireStringValue(ref.scopeKey, code),
    version: toOptionalString(ref.version),
  }));
}

function requireAppendWorldHistoryEvidenceRefs(
  input: unknown,
  code: string,
): AppendWorldHistoryEvidenceRef[] {
  return requireObjectArray<Record<string, unknown>>(input, code).map((ref) => ({
    segmentId: requireStringValue(ref.segmentId, code),
    offsetStart: Number(requireStringValue(ref.offsetStart, code)),
    offsetEnd: Number(requireStringValue(ref.offsetEnd, code)),
    excerpt: requireStringValue(ref.excerpt, code),
    ...(toOptionalString(ref.sourceType) ? { sourceType: toOptionalString(ref.sourceType) } : {}),
    ...(Number.isFinite(Number(ref.confidence)) ? { confidence: Number(ref.confidence) } : {}),
  }));
}

export function parseCommitWorldStateInput(input: unknown, code: string): CommitWorldStateInput {
  const record = requireRecord(input, code);
  const commit = requireMutationCommitEnvelope(record.commit, code);
  const ifSnapshotVersion = toOptionalString(record.ifSnapshotVersion);
  const reason = toOptionalString(record.reason);
  const writes = requireObjectArray<Record<string, unknown>>(record.writes, code)
    .map((item) => requireCommitWorldStateWrite(item, code));
  return {
    commit,
    writes,
    ...(ifSnapshotVersion ? { ifSnapshotVersion } : {}),
    ...(reason ? { reason } : {}),
  };
}

function requireAppendWorldHistoryItem(input: unknown, code: string): AppendWorldHistoryItem {
  const item = requireRecord(input, code);
  return {
    eventId: toOptionalString(item.eventId),
    eventType: requireStringValue(item.eventType, code),
    title: requireStringValue(item.title, code),
    happenedAt: requireStringValue(item.happenedAt, code),
    operation: item.operation === 'APPEND' || item.operation === 'SUPERSEDE' || item.operation === 'INVALIDATE'
      ? item.operation
      : (() => { throw new Error(code); })(),
    visibility: requireHistoryVisibility(item.visibility, code),
    summary: toOptionalString(item.summary),
    cause: toOptionalString(item.cause),
    process: toOptionalString(item.process),
    result: toOptionalString(item.result),
    timeRef: toOptionalString(item.timeRef),
    locationRefs: toStringArray(item.locationRefs),
    characterRefs: toStringArray(item.characterRefs),
    dependsOnEventIds: toStringArray(item.dependsOnEventIds),
    evidenceRefs: item.evidenceRefs === undefined
      ? undefined
      : requireAppendWorldHistoryEvidenceRefs(item.evidenceRefs, code),
    relatedStateRefs: requireAppendWorldHistoryRelatedStateRefs(item.relatedStateRefs, code),
    supersedes: toStringArray(item.supersedes),
    invalidates: toStringArray(item.invalidates),
    payload: item.payload === undefined ? undefined : requireRecord(item.payload, code),
  };
}

export function parseAppendWorldHistoryInput(input: unknown, code: string): AppendWorldHistoryInput {
  const record = requireRecord(input, code);
  const commit = requireMutationCommitEnvelope(record.commit, code);
  const historyAppends = requireObjectArray<Record<string, unknown>>(record.historyAppends, code)
    .map((item) => requireAppendWorldHistoryItem(item, code));
  const ifSnapshotVersion = toOptionalString(record.ifSnapshotVersion);
  const reason = toOptionalString(record.reason);
  return {
    commit,
    historyAppends,
    ...(ifSnapshotVersion ? { ifSnapshotVersion } : {}),
    ...(reason ? { reason } : {}),
  };
}

type WorldStateCommitExecutor = (
  worldId: string,
  input: CommitWorldStateInput,
) => Promise<unknown>;

async function defaultCommitWorldState(
  worldId: string,
  input: CommitWorldStateInput,
): Promise<unknown> {
  return withRuntimeOpenApiContext((realm) => (
    realm.services.WorldControlService.worldControlControllerCommitState(
      worldId,
      input,
    )
  ));
}

export async function handleWorldStateCommitDataCapability(
  query: unknown,
  options: {
    commitWorldState?: WorldStateCommitExecutor;
  } = {},
): Promise<unknown> {
  const record = toRecord(query);
  const worldId = String(record.worldId || '').trim();
  if (!worldId) throw new Error('WORLD_ID_REQUIRED');

  const parsedInput = parseCommitWorldStateInput(record.payload, 'WORLD_STATE_COMMIT_INPUT_REQUIRED');
  const commitRecord = recordDesktopWorldEvolutionCommitRequestCandidate({
    worldId: parsedInput.commit.worldId,
    appId: parsedInput.commit.appId,
    sessionId: parsedInput.commit.sessionId,
    effectClass: parsedInput.commit.effectClass,
    scope: parsedInput.commit.scope,
    schemaId: parsedInput.commit.schemaId,
    schemaVersion: parsedInput.commit.schemaVersion,
    actorRefs: parsedInput.commit.actorRefs.map((actorRef) => (
      actorRef.role
        ? {
          actorId: actorRef.actorId,
          actorType: actorRef.actorType,
          role: actorRef.role,
        }
        : {
          actorId: actorRef.actorId,
          actorType: actorRef.actorType,
        }
    )),
    reason: parsedInput.commit.reason,
    evidenceRefs: parsedInput.commit.evidenceRefs?.map((evidenceRef) => (
      evidenceRef.uri
        ? {
          kind: evidenceRef.kind,
          refId: evidenceRef.refId,
          uri: evidenceRef.uri,
        }
        : {
          kind: evidenceRef.kind,
          refId: evidenceRef.refId,
        }
    )),
  });

  try {
    const result = await (options.commitWorldState || defaultCommitWorldState)(worldId, parsedInput);
    if (commitRecord) {
      settleDesktopWorldEvolutionCommitRequestRecord({
        commitRequestRecordId: commitRecord.commitRequestRecordId,
        outcomeStatus: 'committed',
      });
    }
    return result;
  } catch (error) {
    if (commitRecord) {
      settleDesktopWorldEvolutionCommitRequestRecord({
        commitRequestRecordId: commitRecord.commitRequestRecordId,
        outcomeStatus: 'failed',
        outcomeReason: error instanceof Error ? error.message : String(error || 'unknown commit failure'),
      });
    }
    throw error;
  }
}

export async function registerWorldDataCapabilities(): Promise<void> {
  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.accessMe, async () => (
    withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerGetMyAccess()
    ))
  ));

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.oasisGet, async () => (
    withRuntimeOpenApiContext((realm) => (
      realm.services.WorldsService.worldControllerGetMainWorld()
    ))
  ));

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.landingResolve, async () => (
    withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerResolveLanding()
    ))
  ));

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.draftCreate, async (query) => (
    withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerCreateDraft(
        requireCreateWorldDraftInput(query, 'WORLD_DRAFT_CREATE_INPUT_REQUIRED'),
      )
    ))
  ));

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.draftGet, async (query) => {
    const draftId = String(toRecord(query).draftId || '').trim();
    if (!draftId) throw new Error('WORLD_DRAFT_ID_REQUIRED');
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerGetDraft(draftId)
    ));
    return requireObjectPayload(payload as Record<string, unknown>, 'WORLD_DRAFT_GET_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.draftsList, async () => (
    requireItemsPayload(
      await withRuntimeOpenApiContext((realm) => (
        realm.services.WorldControlService.worldControlControllerListDrafts()
      )) as { items?: unknown[] } & Record<string, unknown>,
      'WORLD_DRAFT_LIST_CONTRACT_INVALID',
    )
  ));

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.draftUpdate, async (query) => {
    const record = toRecord(query);
    const draftId = String(record.draftId || '').trim();
    if (!draftId) throw new Error('WORLD_DRAFT_ID_REQUIRED');
    return withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerUpdateDraft(
        draftId,
        requireRecord(record.patch, 'WORLD_DRAFT_PATCH_REQUIRED'),
      )
    ));
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.draftPublish, async (query) => {
    const record = toRecord(query);
    const draftId = String(record.draftId || '').trim();
    if (!draftId) throw new Error('WORLD_DRAFT_ID_REQUIRED');
    return withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerPublishDraft(
        draftId,
        requireRecord(record.payload, 'WORLD_DRAFT_PUBLISH_PAYLOAD_REQUIRED'),
      )
    ));
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.stateGet, async (query) => {
    const worldId = String(toRecord(query).worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerGetState(worldId)
    ));
    return requireObjectPayload(payload as Record<string, unknown>, 'WORLD_STATE_GET_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.worldsMine, async () => (
    requireItemsPayload(
      await withRuntimeOpenApiContext((realm) => (
        realm.services.WorldControlService.worldControlControllerListMyWorlds()
      )) as { items?: unknown[] } & Record<string, unknown>,
      'WORLD_MY_LIST_CONTRACT_INVALID',
    )
  ));

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.stateCommit, async (query) => {
    return handleWorldStateCommitDataCapability(query);
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.lorebooksList, async (query) => {
    const worldId = String(toRecord(query).worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerListWorldLorebooks(worldId)
    ));
    return requireItemsPayload(payload as { items?: unknown[] } & Record<string, unknown>, 'WORLD_LOREBOOK_LIST_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.historyList, async (query) => {
    const worldId = String(toRecord(query).worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerListWorldHistory(worldId)
    ));
    return requireItemsPayload(payload as { items?: unknown[] } & Record<string, unknown>, 'WORLD_HISTORY_LIST_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.bindingsList, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerListWorldBindings(
        worldId,
        typeof record.take === 'number' ? record.take : undefined,
        typeof record.bindingPoint === 'string' ? record.bindingPoint : undefined,
        typeof record.bindingKind === 'string' ? record.bindingKind : undefined,
        typeof record.hostId === 'string' ? record.hostId : undefined,
        typeof record.hostType === 'string' ? record.hostType : undefined,
        typeof record.objectId === 'string' ? record.objectId : undefined,
        typeof record.objectType === 'string' ? record.objectType : undefined,
      )
    ));
    return requireItemsPayload(payload as { items?: unknown[] } & Record<string, unknown>, 'WORLD_BINDING_LIST_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.bindingsBatchUpsert, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    return withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerBatchUpsertWorldBindings(
        worldId,
        parseBatchUpsertBindingsInput(
          record.payload,
          'WORLD_BINDING_BATCH_UPSERT_INPUT_REQUIRED',
        ),
      )
    ));
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.bindingsDelete, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    const bindingId = String(record.bindingId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    if (!bindingId) throw new Error('WORLD_BINDING_ID_REQUIRED');
    return withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerDeleteWorldBinding(
        worldId,
        bindingId,
      )
    ));
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.historyAppend, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    return withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerAppendWorldHistory(
        worldId,
        parseAppendWorldHistoryInput(record.payload, 'WORLD_HISTORY_APPEND_INPUT_REQUIRED'),
      )
    ));
  });
}
