import type { Realm, RealmModel, RealmServiceResult } from '@nimiplatform/sdk/realm';
import { isJsonObject, type JsonObject } from '@runtime/net/json';
import {
  getOfflineCacheManager,
  getOfflineCoordinator,
  isRealmOfflineError,
} from '@runtime/offline';

type WorldDetailDto = RealmModel<'WorldDetailDto'>;
type WorldLevelAuditEventDto = RealmModel<'WorldLevelAuditEventDto'>;
type WorldviewDetailDto = RealmServiceResult<'WorldsService', 'worldControllerGetWorldview'>;
type WorldDetailWithAgentsDto = RealmServiceResult<'WorldsService', 'worldControllerGetWorldDetailWithAgents'>;
type WorldAgentSummaryDto = RealmServiceResult<'WorldsService', 'worldControllerGetWorldAgents'>[number];
type PublicWorldHistoryPayload = RealmServiceResult<'WorldsService', 'worldControllerGetWorldHistory'>;
export type WorldLorebookListPayload = RealmServiceResult<'WorldsService', 'worldControllerGetWorldLorebooks'>;
export type WorldMediaBindingListPayload = RealmServiceResult<'WorldsService', 'worldControllerGetWorldMediaBindings'>;
export type WorldSceneListPayload = RealmServiceResult<'WorldsService', 'worldControllerGetWorldScenes'>;

type DataSyncApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: JsonObject,
) => void;

export type WorldSemanticBundle = {
  world: WorldDetailDto | null;
  worldview: WorldviewDetailDto | null;
  worldviewEvents: JsonObject[];
  worldviewSnapshots: JsonObject[];
};

export type WorldHistoryPayload = PublicWorldHistoryPayload;

function toRecord(value: unknown): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

function requireRecord(value: unknown, errorCode: string): JsonObject {
  const record = toRecord(value);
  if (!record) {
    throw new Error(errorCode);
  }
  return record;
}

function toRecordArray(value: unknown): JsonObject[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is JsonObject => isJsonObject(item));
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

function requireRecordArray(value: unknown, errorCode: string): JsonObject[] {
  if (!Array.isArray(value) || value.some((item) => !isJsonObject(item))) {
    throw new Error(errorCode);
  }
  return value;
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
        .filter((item): item is WorldDetailDto => isJsonObject(item))
        .map((item) => item)
      : toRecordArray(worlds).map((item) => item as WorldDetailDto);
    await (await getOfflineCacheManager()).syncWorldList(normalized);
    return normalized;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      getOfflineCoordinator().markCacheFallbackUsed();
      return await (await getOfflineCacheManager()).getCachedWorldList<WorldDetailDto>();
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
    const payload = await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetMainWorld(),
      'Failed to load main world',
    );
    const world = requireRecord(payload, 'MAIN_WORLD_CONTRACT_INVALID') as WorldDetailDto;
    await (await getOfflineCacheManager()).syncWorldMetadata(
      'main-world',
      world,
    );
    return world;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const cached = await (await getOfflineCacheManager()).getCachedWorldMetadata<WorldDetailDto>('main-world');
      if (cached) {
        getOfflineCoordinator().markCacheFallbackUsed();
        return cached;
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
        record as WorldDetailDto,
      );
    }
    return record ? (record as WorldDetailDto) : null;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const cached = await (await getOfflineCacheManager()).getCachedWorldMetadata<WorldDetailDto>(`world:${normalizedWorldId}`);
      if (cached) {
        getOfflineCoordinator().markCacheFallbackUsed();
        return cached;
      }
    }
    emitDataSyncError('load-world-detail', error, { worldId: normalizedWorldId });
    throw error;
  }
}

export async function loadWorldHistory(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
): Promise<WorldHistoryPayload> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw new Error('WORLD_ID_REQUIRED');
  }
  try {
    return await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetWorldHistory(normalizedWorldId),
      'Failed to load world history',
    );
  } catch (error) {
    emitDataSyncError('load-world-history', error, { worldId: normalizedWorldId });
    throw error;
  }
}

async function loadWorldAssetList<T extends { worldId: string; items: unknown[] }>(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
  action: string,
  task: (realm: Realm, worldId: string) => Promise<T>,
): Promise<T> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw new Error('WORLD_ID_REQUIRED');
  }
  try {
    return await callApi(
      (realm) => task(realm, normalizedWorldId),
      `Failed to ${action}`,
    );
  } catch (error) {
    emitDataSyncError(action, error, { worldId: normalizedWorldId });
    throw error;
  }
}

export async function loadWorldLorebooks(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
): Promise<WorldLorebookListPayload> {
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
): Promise<WorldSceneListPayload> {
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
): Promise<WorldMediaBindingListPayload> {
  return loadWorldAssetList(
    callApi,
    emitDataSyncError,
    worldId,
    'load-world-media-bindings',
    (realm, normalizedWorldId) => realm.services.WorldsService.worldControllerGetWorldMediaBindings(normalizedWorldId),
  );
}

export async function loadWorldAgents(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  worldId: string,
): Promise<WorldAgentSummaryDto[]> {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId) {
    throw new Error('WORLD_ID_REQUIRED');
  }
  try {
    const payload = await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetWorldAgents(normalizedWorldId),
      'Failed to load world agents',
    );
    return requireRecordArray(payload, 'WORLD_AGENT_LIST_CONTRACT_INVALID') as WorldAgentSummaryDto[];
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
): Promise<WorldDetailWithAgentsDto | null> {
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
    if (payload == null) {
      return null;
    }
    const detail = requireRecord(payload, 'WORLD_DETAIL_WITH_AGENTS_CONTRACT_INVALID') as WorldDetailWithAgentsDto;
    if (detail) {
      await (await getOfflineCacheManager()).syncWorldMetadata(
        cacheKey,
        detail,
      );
    }
    return detail;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const cached = await (await getOfflineCacheManager()).getCachedWorldMetadata<WorldDetailWithAgentsDto>(cacheKey);
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
    const worldview: WorldviewDetailDto | null = await (async () => {
      try {
        return await callApi(
          (realm) => realm.services.WorldsService.worldControllerGetWorldview(normalizedWorldId),
          'Failed to load worldview',
        );
      } catch {
        return null;
      }
    })();

    return {
      world: null,
      worldview,
      worldviewEvents: [],
      worldviewSnapshots: [],
    };
  } catch (error) {
    emitDataSyncError('load-world-semantic-bundle', error, { worldId: normalizedWorldId });
    throw error;
  }
}
