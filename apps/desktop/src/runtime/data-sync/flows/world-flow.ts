import type { Realm } from '@nimiplatform/sdk/realm';
import type { WorldDetailDto } from '@nimiplatform/sdk/realm';
import type { WorldLevelAuditEventDto } from '@nimiplatform/sdk/realm';
import {
  getOfflineCacheManager,
  getOfflineCoordinator,
  isRealmOfflineError,
} from '@runtime/offline';

type DataSyncApiCaller = (task: (realm: Realm) => Promise<any>, fallbackMessage?: string) => Promise<any>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

export type WorldSemanticBundle = {
  world: WorldDetailDto | null;
  worldview: Record<string, unknown> | null;
  worldviewEvents: Array<Record<string, unknown>>;
  worldviewSnapshots: Array<Record<string, unknown>>;
};

export type WorldEventsPayload = {
  items: Array<Record<string, unknown>>;
  eventGraphSummary: Record<string, unknown> | null;
};

export type WorldAssetListPayload = {
  worldId: string;
  items: Array<Record<string, unknown>>;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => item as Record<string, unknown>);
  }
  const payload = toRecord(value);
  if (!payload) {
    return [];
  }
  if (Array.isArray(payload.items)) {
    return toRecordArray(payload.items);
  }
  if (Array.isArray(payload.data)) {
    return toRecordArray(payload.data);
  }
  return [];
}

export async function loadWorldList(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  status?: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED',
): Promise<WorldDetailDto[]> {
  try {
    const worlds = await callApi(
      (realm) => realm.services.WorldsService.worldControllerListWorlds(status),
      'Failed to load world list',
    );
    const normalized = Array.isArray(worlds)
      ? worlds
        .filter((item) => item && typeof item === 'object')
        .map((item) => item as WorldDetailDto)
      : toRecordArray(worlds).map((item) => item as unknown as WorldDetailDto);
    await (await getOfflineCacheManager()).syncWorldList(
      normalized as unknown as Record<string, unknown>[],
    );
    return normalized;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      getOfflineCoordinator().markCacheFallbackUsed();
      return (await (await getOfflineCacheManager()).getCachedWorldList()) as WorldDetailDto[];
    }
    emitDataSyncError('load-world-list', error);
    throw error;
  }
}

export async function loadMainWorld(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<WorldDetailDto> {
  try {
    const world = await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetMainWorld(),
      'Failed to load main world',
    );
    if (world && typeof world === 'object' && !Array.isArray(world)) {
      await (await getOfflineCacheManager()).syncWorldMetadata(
        'main-world',
        world as Record<string, unknown>,
      );
    }
    return world;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const cached = await (await getOfflineCacheManager()).getCachedWorldMetadata('main-world');
      if (cached) {
        getOfflineCoordinator().markCacheFallbackUsed();
        return cached as WorldDetailDto;
      }
    }
    emitDataSyncError('load-main-world', error);
    throw error;
  }
}

export async function loadWorldLevelAudits(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
  limit = 20,
): Promise<WorldLevelAuditEventDto[]> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw new Error('WORLD_ID_REQUIRED');
  }
  const normalizedLimit = Number.isFinite(limit) && limit > 0
    ? Math.min(Math.floor(limit), 100)
    : 20;
  try {
    const payload = await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetWorldLevelAudits(normalizedWorldId, normalizedLimit),
      'Failed to load world level audits',
    );
    if (!Array.isArray(payload)) return [];
    return payload
      .filter((item) => item && typeof item === 'object')
      .map((item) => item as WorldLevelAuditEventDto);
  } catch (error) {
    emitDataSyncError('load-world-level-audits', error, {
      worldId: normalizedWorldId,
      limit: normalizedLimit,
    });
    throw error;
  }
}

export async function loadWorldDetailById(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
): Promise<WorldDetailDto | null> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw new Error('WORLD_ID_REQUIRED');
  }
  try {
    const payload = await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetWorld(normalizedWorldId),
      'Failed to load world detail',
    );
    const record = toRecord(payload);
    if (record) {
      await (await getOfflineCacheManager()).syncWorldMetadata(
        `world:${normalizedWorldId}`,
        record,
      );
    }
    return record ? (record as unknown as WorldDetailDto) : null;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const cached = await (await getOfflineCacheManager()).getCachedWorldMetadata(`world:${normalizedWorldId}`);
      if (cached) {
        getOfflineCoordinator().markCacheFallbackUsed();
        return cached as unknown as WorldDetailDto;
      }
    }
    emitDataSyncError('load-world-detail', error, { worldId: normalizedWorldId });
    throw error;
  }
}

export async function loadWorldEvents(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
): Promise<WorldEventsPayload> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw new Error('WORLD_ID_REQUIRED');
  }
  try {
    const payload = await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetWorldEvents(normalizedWorldId),
      'Failed to load world events',
    );
    const record = toRecord(payload);
    if (record && Array.isArray(record.items)) {
      return {
        items: toRecordArray(record.items),
        eventGraphSummary: toRecord(record.eventGraphSummary),
      };
    }
    return {
      items: toRecordArray(payload),
      eventGraphSummary: null,
    };
  } catch (error) {
    emitDataSyncError('load-world-events', error, { worldId: normalizedWorldId });
    throw error;
  }
}

async function loadWorldAssetList(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
  action: string,
  task: (realm: Realm, worldId: string) => Promise<unknown>,
): Promise<WorldAssetListPayload> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw new Error('WORLD_ID_REQUIRED');
  }
  try {
    const payload = await callApi(
      (realm) => task(realm, normalizedWorldId),
      `Failed to ${action}`,
    );
    const record = toRecord(payload);
    return {
      worldId: normalizedWorldId,
      items: record && Array.isArray(record.items) ? toRecordArray(record.items) : toRecordArray(payload),
    };
  } catch (error) {
    emitDataSyncError(action, error, { worldId: normalizedWorldId });
    throw error;
  }
}

export async function loadWorldLorebooks(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
): Promise<WorldAssetListPayload> {
  return loadWorldAssetList(
    callApi,
    emitDataSyncError,
    worldId,
    'load-world-lorebooks',
    (realm, normalizedWorldId) => realm.services.WorldsService.worldControllerGetWorldLorebooks(normalizedWorldId),
  );
}

export async function loadWorldScenes(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
): Promise<WorldAssetListPayload> {
  return loadWorldAssetList(
    callApi,
    emitDataSyncError,
    worldId,
    'load-world-scenes',
    (realm, normalizedWorldId) => realm.services.WorldsService.worldControllerGetWorldScenes(normalizedWorldId),
  );
}

export async function loadWorldMediaBindings(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
): Promise<WorldAssetListPayload> {
  return loadWorldAssetList(
    callApi,
    emitDataSyncError,
    worldId,
    'load-world-media-bindings',
    (realm, normalizedWorldId) => realm.services.WorldsService.worldControllerGetWorldMediaBindings(normalizedWorldId),
  );
}

export async function loadWorldMutations(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
): Promise<WorldAssetListPayload> {
  return loadWorldAssetList(
    callApi,
    emitDataSyncError,
    worldId,
    'load-world-mutations',
    (realm, normalizedWorldId) => realm.services.WorldsService.worldControllerGetWorldMutations(normalizedWorldId),
  );
}

export async function loadWorldAgents(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
): Promise<Array<Record<string, unknown>>> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw new Error('WORLD_ID_REQUIRED');
  }
  try {
    const payload = await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetWorldAgents(normalizedWorldId),
      'Failed to load world agents',
    );
    return toRecordArray(payload);
  } catch (error) {
    emitDataSyncError('load-world-agents', error, { worldId: normalizedWorldId });
    throw error;
  }
}

export async function loadWorldDetailWithAgents(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
  recommendedAgentLimit?: number,
): Promise<Record<string, unknown> | null> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw new Error('WORLD_ID_REQUIRED');
  }
  const normalizedRecommendedAgentLimit = Number.isFinite(recommendedAgentLimit) && (recommendedAgentLimit ?? 0) > 0
    ? Math.min(Math.floor(recommendedAgentLimit ?? 0), 12)
    : undefined;
  const cacheKey = normalizedRecommendedAgentLimit
    ? `world:${normalizedWorldId}:detail:recommended-agents:${normalizedRecommendedAgentLimit}`
    : `world:${normalizedWorldId}:detail`;
  try {
    const payload = await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetWorldDetailWithAgents(
        normalizedWorldId,
        normalizedRecommendedAgentLimit,
      ),
      'Failed to load world detail with agents',
    );
    const record = toRecord(payload);
    if (record) {
      await (await getOfflineCacheManager()).syncWorldMetadata(
        cacheKey,
        record,
      );
    }
    return record;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const cached = await (await getOfflineCacheManager()).getCachedWorldMetadata(cacheKey);
      if (cached) {
        getOfflineCoordinator().markCacheFallbackUsed();
        return cached;
      }
    }
    emitDataSyncError('load-world-detail-with-agents', error, { worldId: normalizedWorldId });
    throw error;
  }
}

export async function loadWorldSemanticBundle(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
): Promise<WorldSemanticBundle> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw new Error('WORLD_ID_REQUIRED');
  }

  try {
    const world = await loadWorldDetailById(callApi, emitDataSyncError, normalizedWorldId);
    const worldview = await (async () => {
      try {
        const payload = await callApi(
          (realm) => realm.services.WorldsService.worldControllerGetWorldview(normalizedWorldId),
          'Failed to load worldview',
        );
        return toRecord(payload);
      } catch {
        return null;
      }
    })();

    return {
      world,
      worldview,
      worldviewEvents: [],
      worldviewSnapshots: [],
    };
  } catch (error) {
    emitDataSyncError('load-world-semantic-bundle', error, { worldId: normalizedWorldId });
    throw error;
  }
}
