import type { RealmServiceArgs } from '@nimiplatform/sdk/realm';
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
type MutationCommitEnvelope = NonNullable<CommitWorldStateInput['commit']>;
type MutationActorRef = MutationCommitEnvelope['actorRefs'][number];
type MutationEvidenceRef = NonNullable<MutationCommitEnvelope['evidenceRefs']>[number];

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
  const scope = String(record.scope || '').trim();
  const reason = String(record.reason || '').trim();
  const effectClass = record.effectClass;
  if (
    !worldId
    || !appId
    || !sessionId
    || !schemaId
    || !schemaVersion
    || !scope
    || !reason
    || (
      effectClass !== 'NONE'
      && effectClass !== 'MEMORY_ONLY'
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

function requireCreateWorldDraftInput(input: unknown, code: string): CreateWorldDraftInput {
  const record = requireRecord(input, code);
  const sourceType = requireSourceType(record.sourceType, code);
  const draftPayload = record.draftPayload === undefined
    ? undefined
    : requireWorldDraftPayload(record.draftPayload, code);
  const pipelineState = record.pipelineState === undefined
    ? undefined
    : requireRecord(record.pipelineState, code);
  const sourceRef = toOptionalString(record.sourceRef);
  const targetWorldId = toOptionalString(record.targetWorldId);
  return {
    sourceType,
    ...(draftPayload ? { draftPayload } : {}),
    ...(pipelineState ? { pipelineState } : {}),
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
  const workflowState = requireRecord(record.workflowState, code);
  const assetBindingsDraft = record.assetBindingsDraft === undefined
    ? undefined
    : requireRecord(record.assetBindingsDraft, code);

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
    workflowState,
    ...(assetBindingsDraft ? { assetBindingsDraft } : {}),
  } as NonNullable<CreateWorldDraftInput['draftPayload']>;
}

function requireCommitWorldStateInput(input: unknown, code: string): CommitWorldStateInput {
  const record = requireRecord(input, code);
  const commit = requireMutationCommitEnvelope(record.commit, code);
  const ifSnapshotVersion = toOptionalString(record.ifSnapshotVersion);
  const reason = toOptionalString(record.reason);
  const writes = requireObjectArray<Record<string, unknown>>(record.writes, code).map((item) => ({
    scope: item.scope === 'ENTITY' || item.scope === 'RELATION' ? item.scope : 'WORLD',
    scopeKey: requireStringValue(item.scopeKey, code),
    targetPath: toOptionalString(item.targetPath),
    payload: requireRecord(item.payload, code),
    ...(item.metadata === undefined ? {} : { metadata: requireRecord(item.metadata, code) }),
  })) as unknown[];
  return {
    commit,
    writes,
    ...(ifSnapshotVersion ? { ifSnapshotVersion } : {}),
    ...(reason ? { reason } : {}),
  } as unknown as CommitWorldStateInput;
}

function requireAppendWorldHistoryInput(input: unknown, code: string): AppendWorldHistoryInput {
  const record = requireRecord(input, code);
  const commit = requireMutationCommitEnvelope(record.commit, code);
  const historyAppends = requireObjectArray<Record<string, unknown>>(record.historyAppends, code).map((item) => ({
    eventId: toOptionalString(item.eventId),
    eventType: requireStringValue(item.eventType, code),
    title: requireStringValue(item.title, code),
    happenedAt: requireStringValue(item.happenedAt, code),
    visibility: item.visibility === 'WORLD' || item.visibility === 'RESTRICTED'
      ? item.visibility
      : item.visibility === 'PUBLIC'
        ? 'PUBLIC'
        : undefined,
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
      : requireObjectArray<Record<string, unknown>>(item.evidenceRefs, code),
    relatedStateRefs: item.relatedStateRefs === undefined
      ? undefined
      : requireObjectArray<Record<string, unknown>>(item.relatedStateRefs, code).map((ref) => ({
        recordId: requireStringValue(ref.recordId, code),
        scope: ref.scope === 'ENTITY' || ref.scope === 'RELATION' ? ref.scope : 'WORLD',
        scopeKey: requireStringValue(ref.scopeKey, code),
        version: toOptionalString(ref.version),
      })),
    supersedes: toStringArray(item.supersedes),
    invalidates: toStringArray(item.invalidates),
    payload: item.payload === undefined ? undefined : requireRecord(item.payload, code),
  })) as unknown as AppendWorldHistoryInput['historyAppends'];
  const ifSnapshotVersion = toOptionalString(record.ifSnapshotVersion);
  const reason = toOptionalString(record.reason);
  return {
    commit,
    historyAppends,
    ...(ifSnapshotVersion ? { ifSnapshotVersion } : {}),
    ...(reason ? { reason } : {}),
  } as unknown as AppendWorldHistoryInput;
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
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    return withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerCommitState(
        worldId,
        requireCommitWorldStateInput(record.payload, 'WORLD_STATE_COMMIT_INPUT_REQUIRED'),
      )
    ));
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

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.mediaBindingsList, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerListWorldMediaBindings(
        worldId,
        typeof record.take === 'number' ? record.take : undefined,
        typeof record.slot === 'string' ? record.slot : undefined,
        typeof record.targetId === 'string' ? record.targetId : undefined,
        typeof record.targetType === 'string' ? record.targetType : undefined,
      )
    ));
    return requireItemsPayload(payload as { items?: unknown[] } & Record<string, unknown>, 'WORLD_MEDIA_BINDING_LIST_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.scenesList, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    const sceneIds = toStringArray(record.sceneIds);
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerListWorldScenes(
        worldId,
        typeof record.take === 'number' ? record.take : undefined,
        sceneIds.length > 0 ? sceneIds : undefined,
      )
    ));
    return requireItemsPayload(payload as { items?: unknown[] } & Record<string, unknown>, 'WORLD_SCENE_LIST_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.historyAppend, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    return withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerAppendWorldHistory(
        worldId,
        requireAppendWorldHistoryInput(record.payload, 'WORLD_HISTORY_APPEND_INPUT_REQUIRED'),
      )
    ));
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.mutationsList, async (query) => {
    const worldId = String(toRecord(query).worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerListWorldMutations(worldId)
    ));
    return requireItemsPayload(payload as { items?: unknown[] } & Record<string, unknown>, 'WORLD_MUTATION_LIST_CONTRACT_INVALID');
  });
}
