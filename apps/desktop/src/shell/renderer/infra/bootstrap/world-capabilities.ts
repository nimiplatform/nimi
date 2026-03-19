import type { RealmServiceArgs } from '@nimiplatform/sdk/realm';
import { WORLD_DATA_API_CAPABILITIES, toRecord } from './runtime-bootstrap-utils';
import { registerCoreDataCapability, withRuntimeOpenApiContext } from './shared';

function toObjectOr<T extends Record<string, unknown>>(value: unknown, fallback: T): T {
  return value && typeof value === 'object' ? (value as T) : fallback;
}

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
        toObjectOr(query, {} as Record<string, unknown>) as DraftCreateInput,
      )
    ))
  ));

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.draftGet, async (query) => {
    const draftId = String(toRecord(query).draftId || '').trim();
    if (!draftId) return null;
    try {
      const payload = await withRuntimeOpenApiContext((realm) => (
        realm.services.WorldControlService.worldControlControllerGetDraft(draftId)
      ));
      return payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
    } catch {
      return null;
    }
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.draftsList, async () => {
    try {
      return await withRuntimeOpenApiContext((realm) => (
        realm.services.WorldControlService.worldControlControllerListDrafts()
      ));
    } catch {
      return { items: [] };
    }
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.draftUpdate, async (query) => {
    const record = toRecord(query);
    const draftId = String(record.draftId || '').trim();
    if (!draftId) throw new Error('WORLD_DRAFT_ID_REQUIRED');
    return withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerUpdateDraft(
        draftId,
        toObjectOr(record.patch, {} as Record<string, unknown>) as DraftUpdateInput,
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
        toObjectOr(record.payload, {} as Record<string, unknown>) as DraftPublishInput,
      )
    ));
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.maintenanceGet, async (query) => {
    const worldId = String(toRecord(query).worldId || '').trim();
    if (!worldId) return null;
    try {
      const payload = await withRuntimeOpenApiContext((realm) => (
        realm.services.WorldControlService.worldControlControllerGetMaintenance(worldId)
      ));
      return payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
    } catch {
      return null;
    }
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.worldsMine, async () => {
    try {
      return await withRuntimeOpenApiContext((realm) => (
        realm.services.WorldControlService.worldControlControllerListMyWorlds()
      ));
    } catch {
      return { items: [] };
    }
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.maintenanceUpdate, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    return withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerUpdateMaintenance(
        worldId,
        toObjectOr(record.patch, {} as Record<string, unknown>) as MaintenanceUpdateInput,
      )
    ));
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.lorebooksList, async (query) => {
    const worldId = String(toRecord(query).worldId || '').trim();
    if (!worldId) return { worldId: '', items: [] };
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerListWorldLorebooks(worldId)
    ));
    return toObjectOr(payload, { worldId, items: [] });
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.eventsList, async (query) => {
    const worldId = String(toRecord(query).worldId || '').trim();
    if (!worldId) return { worldId: '', items: [] };
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerListWorldEvents(worldId)
    ));
    return toObjectOr(payload, { worldId, items: [] });
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.mediaBindingsList, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    if (!worldId) return { worldId: '', items: [] };
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerListWorldMediaBindings(
        worldId,
        typeof record.take === 'number' ? record.take : undefined,
        typeof record.slot === 'string' ? record.slot : undefined,
        typeof record.targetId === 'string' ? record.targetId : undefined,
        typeof record.targetType === 'string' ? record.targetType : undefined,
      )
    ));
    return toObjectOr(payload, { worldId, items: [] });
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.scenesList, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    if (!worldId) return { worldId: '', items: [] };
    const sceneIds = toStringArray(record.sceneIds);
    const payload = await withRuntimeOpenApiContext((realm) => (
      realm.services.WorldControlService.worldControlControllerListWorldScenes(
        worldId,
        typeof record.take === 'number' ? record.take : undefined,
        sceneIds.length > 0 ? sceneIds : undefined,
      )
    ));
    return toObjectOr(payload, { worldId, items: [] });
  });

  await registerCoreDataCapability(
    WORLD_DATA_API_CAPABILITIES.narrativeContextsList,
    async (query) => {
      const record = toRecord(query);
      const worldId = String(record.worldId || '').trim();
      if (!worldId) return { worldId: '', items: [] };
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
      return toObjectOr(payload, { worldId, items: [] });
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
      try {
        const payload = await withRuntimeOpenApiContext((realm) => (
          realm.services.NarrativeSpineService.narrativeSpineControllerFindSpine(worldId, storyId, agentId)
        ));
        return payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
      } catch {
        return null;
      }
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
    const body = toObjectOr(record.body, record);
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
    return toObjectOr(payload, { items: [] });
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.satellitesCreate, async (query) => {
    const record = toRecord(query);
    const body = toObjectOr(record.body, record);
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
        toObjectOr(record.payload, {} as Record<string, unknown>) as BatchUpsertWorldEventsInput,
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
          toObjectOr(record.payload, {} as Record<string, unknown>) as BatchUpsertWorldMediaBindingsInput,
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
    return toObjectOr(payload, { worldId, items: [] });
  });
}
