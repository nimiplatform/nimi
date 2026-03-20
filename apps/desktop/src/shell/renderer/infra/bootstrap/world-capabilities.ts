import type { RealmServiceArgs } from '@nimiplatform/sdk/realm';
import {
  WORLD_DATA_API_CAPABILITIES,
  requireItemsPayload,
  requireObjectArray,
  requireObjectPayload,
  requireRecord,
  toRecord,
} from './runtime-bootstrap-utils';
import { registerCoreDataCapability, withRuntimeOpenApiContext } from './shared';

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

type DraftCreateInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerCreateDraft'>[0];
type DraftUpdateInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerUpdateDraft'>[1];
type DraftPublishInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerPublishDraft'>[1];
type MaintenanceUpdateInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerUpdateMaintenance'>[1];
type NarrativeSpinePublishInput = RealmServiceArgs<'NarrativeSpineService', 'narrativeSpineControllerPublishStorySpine'>[3];
type SatelliteCreateInput = RealmServiceArgs<'SatelliteNarrativeService', 'satelliteControllerCreate'>[0];
type BatchUpsertWorldEventsInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerBatchUpsertWorldEvents'>[1];
type BatchUpsertWorldMediaBindingsInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerBatchUpsertWorldMediaBindings'>[1];

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
        requireRecord(query, 'WORLD_DRAFT_CREATE_INPUT_REQUIRED') as DraftCreateInput,
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
        requireRecord(record.patch, 'WORLD_DRAFT_PATCH_REQUIRED') as DraftUpdateInput,
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
        requireRecord(record.payload, 'WORLD_DRAFT_PUBLISH_PAYLOAD_REQUIRED') as DraftPublishInput,
      )
    ));
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.maintenanceGet, async (query) => {
    const worldId = String(toRecord(query).worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerGetMaintenance(worldId)
    ));
    return requireObjectPayload(payload as Record<string, unknown>, 'WORLD_MAINTENANCE_GET_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.worldsMine, async () => (
    requireItemsPayload(
      await withRuntimeOpenApiContext((realm) => (
        realm.services.WorldControlService.worldControlControllerListMyWorlds()
      )) as { items?: unknown[] } & Record<string, unknown>,
      'WORLD_MY_LIST_CONTRACT_INVALID',
    )
  ));

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.maintenanceUpdate, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    return withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerUpdateMaintenance(
        worldId,
        requireRecord(record.patch, 'WORLD_MAINTENANCE_PATCH_REQUIRED') as MaintenanceUpdateInput,
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

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.eventsList, async (query) => {
    const worldId = String(toRecord(query).worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerListWorldEvents(worldId)
    ));
    return requireItemsPayload(payload as { items?: unknown[] } & Record<string, unknown>, 'WORLD_EVENT_LIST_CONTRACT_INVALID');
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

  await registerCoreDataCapability(
    WORLD_DATA_API_CAPABILITIES.narrativeContextsList,
    async (query) => {
      const record = toRecord(query);
      const worldId = String(record.worldId || '').trim();
      if (!worldId) throw new Error('WORLD_ID_REQUIRED');
      const payload = await withRuntimeOpenApiContext((realm) => (
        realm.services.WorldControlService.worldControlControllerListWorldNarrativeContexts(
          worldId,
          typeof record.take === 'number' ? record.take : undefined,
          typeof record.targetSubjectId === 'string' ? record.targetSubjectId : undefined,
          typeof record.targetSubjectType === 'string' ? record.targetSubjectType : undefined,
          typeof record.subjectId === 'string' ? record.subjectId : undefined,
          typeof record.subjectType === 'string' ? record.subjectType : undefined,
          typeof record.storyId === 'string' ? record.storyId : undefined,
          typeof record.scope === 'string' ? record.scope : undefined,
        )
      ));
      return requireItemsPayload(payload as { items?: unknown[] } & Record<string, unknown>, 'WORLD_NARRATIVE_CONTEXT_LIST_CONTRACT_INVALID');
    },
  );

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.narrativeSpineGetOrCreate, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    const storyId = String(record.storyId || '').trim();
    const agentId = String(record.agentId || '').trim();
    const createIfMissing = record.createIfMissing !== false;
    if (!worldId || !storyId || !agentId) {
      throw new Error('WORLD_ID_AND_STORY_ID_AND_AGENT_ID_REQUIRED');
    }
    if (!createIfMissing) {
      const payload = await withRuntimeOpenApiContext((realm) => (
        realm.services.NarrativeSpineService.narrativeSpineControllerFindSpine(worldId, storyId, agentId)
      ));
      return requireObjectPayload(payload as Record<string, unknown>, 'WORLD_NARRATIVE_SPINE_GET_CONTRACT_INVALID');
    }
    return withRuntimeOpenApiContext((realm) => (
      realm.services.NarrativeSpineService.narrativeSpineControllerGetOrCreateSpine(worldId, storyId, agentId)
    ));
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.narrativeSpinePublish, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    const storyId = String(record.storyId || '').trim();
    const agentId = String(record.agentId || '').trim();
    const body = requireRecord(record.body ?? record, 'WORLD_NARRATIVE_SPINE_PUBLISH_INPUT_REQUIRED');
    if (!worldId || !storyId || !agentId) {
      throw new Error('WORLD_ID_AND_STORY_ID_AND_AGENT_ID_REQUIRED');
    }
    return withRuntimeOpenApiContext((realm) => (
      realm.services.NarrativeSpineService.narrativeSpineControllerPublishStorySpine(
        worldId,
        storyId,
        agentId,
        body as NarrativeSpinePublishInput,
      )
    ));
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.satellitesBySpineList, async (query) => {
    const spineId = String(toRecord(query).spineId || '').trim();
    if (!spineId) {
      throw new Error('SPINE_ID_REQUIRED');
    }
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.SatelliteNarrativeService.satelliteControllerFindBySpine(spineId)
    ));
    return requireObjectArray(payload, 'WORLD_SATELLITE_LIST_CONTRACT_INVALID');
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.satellitesCreate, async (query) => {
    const record = toRecord(query);
    const body = requireRecord(record.body ?? record, 'WORLD_SATELLITE_CREATE_INPUT_REQUIRED');
    const worldId = String(body.worldId || '').trim();
    const content = String(body.content || '').trim();
    if (!worldId || !content) {
      throw new Error('WORLD_ID_AND_CONTENT_REQUIRED');
    }
    return withRuntimeOpenApiContext((realm) => (
      realm.services.SatelliteNarrativeService.satelliteControllerCreate(body as SatelliteCreateInput)
    ));
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.lorebooksBatchUpsert, async (_query) => {
    throw new Error('WORLD_LOREBOOK_PROJECTION_READ_ONLY');
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.eventsBatchUpsert, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    return withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerBatchUpsertWorldEvents(
        worldId,
        requireRecord(record.payload, 'WORLD_EVENT_BATCH_UPSERT_INPUT_REQUIRED') as BatchUpsertWorldEventsInput,
      )
    ));
  });

  await registerCoreDataCapability(
    WORLD_DATA_API_CAPABILITIES.mediaBindingsBatchUpsert,
    async (query) => {
      const record = toRecord(query);
      const worldId = String(record.worldId || '').trim();
      if (!worldId) throw new Error('WORLD_ID_REQUIRED');
      return withRuntimeOpenApiContext((realm) => (
        realm.services.WorldControlService.worldControlControllerBatchUpsertWorldMediaBindings(
          worldId,
          requireRecord(record.payload, 'WORLD_MEDIA_BINDING_BATCH_UPSERT_INPUT_REQUIRED') as BatchUpsertWorldMediaBindingsInput,
        )
      ));
    },
  );

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.lorebooksDelete, async (_query) => {
    throw new Error('WORLD_LOREBOOK_PROJECTION_READ_ONLY');
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.eventsDelete, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    const eventId = String(record.eventId || '').trim();
    if (!worldId || !eventId) throw new Error('WORLD_ID_AND_EVENT_ID_REQUIRED');
    return withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerDeleteWorldEvent(worldId, eventId)
    ));
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.mediaBindingsDelete, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    const bindingId = String(record.bindingId || '').trim();
    if (!worldId || !bindingId) throw new Error('WORLD_ID_AND_BINDING_ID_REQUIRED');
    return withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerDeleteWorldMediaBinding(worldId, bindingId)
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
