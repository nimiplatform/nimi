import { WORLD_DATA_API_CAPABILITIES, toRecord } from './runtime-bootstrap-utils';
import { registerCoreDataCapability, withRuntimeOpenApiContext } from './shared';

type RealmRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

type RealmRequestSpec = {
  method: RealmRequestMethod;
  url: string;
  path?: Record<string, string | number | boolean>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  mediaType?: string;
};

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

function resolveRequestPath(
  url: string,
  pathParams?: Record<string, string | number | boolean>,
): string {
  let resolved = String(url || '').trim();
  for (const [key, value] of Object.entries(pathParams || {})) {
    resolved = resolved.replaceAll(`{${key}}`, encodeURIComponent(String(value)));
  }
  return resolved;
}

async function requestRealm<T>(spec: RealmRequestSpec): Promise<T> {
  return withRuntimeOpenApiContext((realm) => realm.raw.request<T>({
    method: spec.method,
    path: resolveRequestPath(spec.url, spec.path),
    query: spec.query,
    body: spec.body,
    headers: spec.headers,
    timeoutMs: spec.timeoutMs,
  }));
}

async function requestObject(spec: RealmRequestSpec): Promise<Record<string, unknown>> {
  const payload = await requestRealm<unknown>(spec);
  return toObjectOr(payload, {});
}

async function requestObjectOrNull(spec: RealmRequestSpec): Promise<Record<string, unknown> | null> {
  try {
    const payload = await requestRealm<unknown>(spec);
    return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function registerWorldDataCapabilities(): Promise<void> {
  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.accessMe, async () => (
    requestObject({
      method: 'GET',
      url: '/api/world-control/access/me',
    })
  ));

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.oasisGet, async () => (
    requestObject({
      method: 'GET',
      url: '/api/world/oasis',
    })
  ));

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.landingResolve, async () => (
    requestObject({
      method: 'GET',
      url: '/api/world-control/landing',
    })
  ));

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.draftCreate, async (query) => (
    requestObject({
      method: 'POST',
      url: '/api/world-drafts',
      body: query,
      mediaType: 'application/json',
    })
  ));

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.draftGet, async (query) => {
    const draftId = String(toRecord(query).draftId || '').trim();
    if (!draftId) return null;
    return requestObjectOrNull({
      method: 'GET',
      url: '/api/world-drafts/{draftId}',
      path: { draftId },
    });
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.draftsList, async () => {
    try {
      return await requestObject({
        method: 'GET',
        url: '/api/world-drafts',
      });
    } catch {
      return { items: [] };
    }
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.draftUpdate, async (query) => {
    const record = toRecord(query);
    const draftId = String(record.draftId || '').trim();
    if (!draftId) throw new Error('WORLD_DRAFT_ID_REQUIRED');
    return requestObject({
      method: 'PATCH',
      url: '/api/world-drafts/{draftId}',
      path: { draftId },
      body: toRecord(record.patch),
      mediaType: 'application/json',
    });
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.draftPublish, async (query) => {
    const record = toRecord(query);
    const draftId = String(record.draftId || '').trim();
    if (!draftId) throw new Error('WORLD_DRAFT_ID_REQUIRED');
    return requestObject({
      method: 'POST',
      url: '/api/world-drafts/{draftId}/publish',
      path: { draftId },
      body: toRecord(record.payload),
      mediaType: 'application/json',
    });
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.maintenanceGet, async (query) => {
    const worldId = String(toRecord(query).worldId || '').trim();
    if (!worldId) return null;
    return requestObjectOrNull({
      method: 'GET',
      url: '/api/worlds/{worldId}/maintenance',
      path: { worldId },
    });
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.worldsMine, async () => {
    try {
      return await requestObject({
        method: 'GET',
        url: '/api/worlds/mine',
      });
    } catch {
      return { items: [] };
    }
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.maintenanceUpdate, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    return requestObject({
      method: 'PATCH',
      url: '/api/worlds/{worldId}/maintenance',
      path: { worldId },
      body: toRecord(record.patch),
      mediaType: 'application/json',
    });
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.lorebooksList, async (query) => {
    const worldId = String(toRecord(query).worldId || '').trim();
    if (!worldId) return { worldId: '', items: [] };
    const payload = await requestObject({
      method: 'GET',
      url: '/api/worlds/{worldId}/lorebooks',
      path: { worldId },
    });
    return toObjectOr(payload, { worldId, items: [] });
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.eventsList, async (query) => {
    const worldId = String(toRecord(query).worldId || '').trim();
    if (!worldId) return { worldId: '', items: [] };
    const payload = await requestObject({
      method: 'GET',
      url: '/api/worlds/{worldId}/events',
      path: { worldId },
    });
    return toObjectOr(payload, { worldId, items: [] });
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.mediaBindingsList, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    if (!worldId) return { worldId: '', items: [] };
    const payload = await requestObject({
      method: 'GET',
      url: '/api/worlds/{worldId}/media-bindings',
      path: { worldId },
      query: {
        ...(record.targetType ? { targetType: record.targetType } : {}),
        ...(record.targetId ? { targetId: record.targetId } : {}),
        ...(record.slot ? { slot: record.slot } : {}),
        ...(record.take != null ? { take: record.take } : {}),
      },
    });
    return toObjectOr(payload, { worldId, items: [] });
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.scenesList, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    if (!worldId) return { worldId: '', items: [] };
    const payload = await requestObject({
      method: 'GET',
      url: '/api/worlds/{worldId}/scenes',
      path: { worldId },
      query: {
        ...(toStringArray(record.sceneIds).length > 0
          ? { sceneIds: toStringArray(record.sceneIds) }
          : {}),
        ...(record.take != null ? { take: record.take } : {}),
      },
    });
    return toObjectOr(payload, { worldId, items: [] });
  });

  await registerCoreDataCapability(
    WORLD_DATA_API_CAPABILITIES.narrativeContextsList,
    async (query) => {
      const record = toRecord(query);
      const worldId = String(record.worldId || '').trim();
      if (!worldId) return { worldId: '', items: [] };
      const payload = await requestObject({
        method: 'GET',
        url: '/api/worlds/{worldId}/narrative-contexts',
        path: { worldId },
        query: {
          ...(record.storyId ? { storyId: record.storyId } : {}),
          ...(record.scope ? { scope: record.scope } : {}),
          ...(record.subjectType ? { subjectType: record.subjectType } : {}),
          ...(record.subjectId ? { subjectId: record.subjectId } : {}),
          ...(record.targetSubjectType ? { targetSubjectType: record.targetSubjectType } : {}),
          ...(record.targetSubjectId ? { targetSubjectId: record.targetSubjectId } : {}),
          ...(record.take != null ? { take: record.take } : {}),
        },
      });
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
      return requestObjectOrNull({
        method: 'GET',
        url: '/api/world/spine/by-world/{worldId}/by-story/{storyId}/by-agent/{agentId}',
        path: { worldId, storyId, agentId },
      });
    }
    return requestObject({
      method: 'POST',
      url: '/api/world/spine/by-world/{worldId}/by-story/{storyId}/by-agent/{agentId}',
      path: { worldId, storyId, agentId },
    });
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
    return requestObject({
      method: 'POST',
      url: '/api/world/spine/by-world/{worldId}/by-story/{storyId}/by-agent/{agentId}/publish',
      path: { worldId, storyId, agentId },
      body,
      mediaType: 'application/json',
    });
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.satellitesBySpineList, async (query) => {
    const spineId = String(toRecord(query).spineId || '').trim();
    if (!spineId) {
      throw new Error('SPINE_ID_REQUIRED');
    }
    const payload = await requestObject({
      method: 'GET',
      url: '/api/world/satellites/by-spine/{spineId}',
      path: { spineId },
    });
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
    return requestObject({
      method: 'POST',
      url: '/api/world/satellites',
      body,
      mediaType: 'application/json',
    });
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.lorebooksBatchUpsert, async (query) => {
    throw new Error('WORLD_LOREBOOK_PROJECTION_READ_ONLY');
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.eventsBatchUpsert, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    return requestObject({
      method: 'POST',
      url: '/api/worlds/{worldId}/events/batch-upsert',
      path: { worldId },
      body: toRecord(record.payload),
      mediaType: 'application/json',
    });
  });

  await registerCoreDataCapability(
    WORLD_DATA_API_CAPABILITIES.mediaBindingsBatchUpsert,
    async (query) => {
      const record = toRecord(query);
      const worldId = String(record.worldId || '').trim();
      if (!worldId) throw new Error('WORLD_ID_REQUIRED');
      return requestObject({
        method: 'POST',
        url: '/api/worlds/{worldId}/media-bindings/batch-upsert',
        path: { worldId },
        body: toRecord(record.payload),
        mediaType: 'application/json',
      });
    },
  );

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.lorebooksDelete, async (query) => {
    throw new Error('WORLD_LOREBOOK_PROJECTION_READ_ONLY');
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.eventsDelete, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    const eventId = String(record.eventId || '').trim();
    if (!worldId || !eventId) throw new Error('WORLD_ID_AND_EVENT_ID_REQUIRED');
    return requestObject({
      method: 'DELETE',
      url: '/api/worlds/{worldId}/events/{eventId}',
      path: { worldId, eventId },
    });
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.mediaBindingsDelete, async (query) => {
    const record = toRecord(query);
    const worldId = String(record.worldId || '').trim();
    const bindingId = String(record.bindingId || '').trim();
    if (!worldId || !bindingId) throw new Error('WORLD_ID_AND_BINDING_ID_REQUIRED');
    return requestObject({
      method: 'DELETE',
      url: '/api/worlds/{worldId}/media-bindings/{bindingId}',
      path: { worldId, bindingId },
    });
  });

  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.mutationsList, async (query) => {
    const worldId = String(toRecord(query).worldId || '').trim();
    if (!worldId) throw new Error('WORLD_ID_REQUIRED');
    const payload = await requestObject({
      method: 'GET',
      url: '/api/worlds/{worldId}/mutations',
      path: { worldId },
    });
    return toObjectOr(payload, { worldId, items: [] });
  });
}
