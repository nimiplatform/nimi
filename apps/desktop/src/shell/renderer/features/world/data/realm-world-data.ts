import type { Realm, RealmModel, RealmServiceResult } from '@nimiplatform/sdk/realm';
import {
  buildRealmWorldDetailWithAgentsCacheKey,
  loadRealmMainWorld,
  loadRealmWorldAgents,
  loadRealmWorldBindings,
  loadRealmWorldDetailById,
  loadRealmWorldDetailWithAgents,
  loadRealmWorldHistory,
  loadRealmWorldLevelAudits,
  loadRealmWorldList,
  loadRealmWorldLorebooks,
  loadRealmWorldScenes,
  loadRealmWorldSemanticBundle,
  type RealmWorldBindingListPayload,
  type RealmWorldHistoryPayload,
  type RealmWorldLorebookListPayload,
  type RealmWorldSceneListPayload,
  type RealmWorldSemanticBundle,
} from '@nimiplatform/sdk/realm';
import {
  isRealmOfflineErrorLike as isRealmOfflineError,
  type JsonObject,
} from '@nimiplatform/sdk/types';
import { callRealmApi, emitRealmDataError } from '@renderer/infra/realm/realm-api';
import {
  getOfflineCacheManager,
  getOfflineCoordinator,
} from '@renderer/infra/offline';

type WorldDetailDto = RealmModel<'WorldDetailDto'>;
type WorldLevelAuditEventDto = RealmModel<'WorldLevelAuditEventDto'>;
type WorldDetailWithAgentsDto = RealmServiceResult<'WorldsService', 'worldControllerGetWorldDetailWithAgents'>;
type WorldAgentSummaryDto = RealmServiceResult<'WorldsService', 'worldControllerGetWorldAgents'>[number];

type RealmWorldApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type RealmWorldErrorEmitter = (
  action: string,
  error: unknown,
  details?: JsonObject,
) => void;

export type WorldSemanticBundle = RealmWorldSemanticBundle;
export type WorldHistoryPayload = RealmWorldHistoryPayload;
export type WorldLorebookListPayload = RealmWorldLorebookListPayload;
export type WorldBindingListPayload = RealmWorldBindingListPayload;
export type WorldSceneListPayload = RealmWorldSceneListPayload;

const silentWorldErrorEmitter: RealmWorldErrorEmitter = () => undefined;

export async function loadWorldList(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  status?: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED',
): Promise<WorldDetailDto[]> {
  try {
    const normalized = await loadRealmWorldList(callApi, silentWorldErrorEmitter, status);
    await (await getOfflineCacheManager()).syncWorldList(normalized);
    return normalized;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      getOfflineCoordinator().markCacheFallbackUsed();
      return await (await getOfflineCacheManager()).getCachedWorldList<WorldDetailDto>();
    }
    emitRealmWorldError('load-world-list', error);
    throw error;
  }
}

export async function loadMainWorld(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
): Promise<WorldDetailDto> {
  try {
    const world = await loadRealmMainWorld(callApi, silentWorldErrorEmitter);
    await (await getOfflineCacheManager()).syncWorldMetadata('main-world', world);
    return world;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const cached = await (await getOfflineCacheManager()).getCachedWorldMetadata<WorldDetailDto>('main-world');
      if (cached) {
        getOfflineCoordinator().markCacheFallbackUsed();
        return cached;
      }
    }
    emitRealmWorldError('load-main-world', error);
    throw error;
  }
}

export async function loadWorldLevelAudits(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
  limit = 20,
): Promise<WorldLevelAuditEventDto[]> {
  return loadRealmWorldLevelAudits(callApi, emitRealmWorldError, worldId, limit);
}

export async function loadWorldDetailById(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
): Promise<WorldDetailDto | null> {
  const normalizedWorldId = String(worldId || '').trim();
  try {
    const record = await loadRealmWorldDetailById(callApi, silentWorldErrorEmitter, normalizedWorldId);
    if (record) {
      await (await getOfflineCacheManager()).syncWorldMetadata(
        `world:${normalizedWorldId}`,
        record,
      );
    }
    return record;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const cached = await (await getOfflineCacheManager()).getCachedWorldMetadata<WorldDetailDto>(`world:${normalizedWorldId}`);
      if (cached) {
        getOfflineCoordinator().markCacheFallbackUsed();
        return cached;
      }
    }
    emitRealmWorldError('load-world-detail', error, { worldId: normalizedWorldId });
    throw error;
  }
}

export async function loadWorldHistory(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
): Promise<WorldHistoryPayload> {
  return loadRealmWorldHistory(callApi, emitRealmWorldError, worldId);
}

export async function loadWorldLorebooks(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
): Promise<WorldLorebookListPayload> {
  return loadRealmWorldLorebooks(callApi, emitRealmWorldError, worldId);
}

export async function loadWorldBindings(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
): Promise<WorldBindingListPayload> {
  return loadRealmWorldBindings(callApi, emitRealmWorldError, worldId);
}

export async function loadWorldScenes(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
): Promise<WorldSceneListPayload> {
  return loadRealmWorldScenes(callApi, emitRealmWorldError, worldId);
}

export async function loadWorldAgents(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
): Promise<WorldAgentSummaryDto[]> {
  return loadRealmWorldAgents(callApi, emitRealmWorldError, worldId);
}

export async function loadWorldDetailWithAgents(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
  recommendedAgentLimit?: number,
): Promise<WorldDetailWithAgentsDto | null> {
  const normalizedWorldId = String(worldId || '').trim();
  const cacheKey = buildRealmWorldDetailWithAgentsCacheKey(normalizedWorldId, recommendedAgentLimit);
  try {
    const detail = await loadRealmWorldDetailWithAgents(
      callApi,
      silentWorldErrorEmitter,
      normalizedWorldId,
      recommendedAgentLimit,
    );
    if (detail) {
      await (await getOfflineCacheManager()).syncWorldMetadata(cacheKey, detail);
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
    emitRealmWorldError('load-world-detail-with-agents', error, { worldId: normalizedWorldId });
    throw error;
  }
}

export async function loadWorldSemanticBundle(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
): Promise<WorldSemanticBundle> {
  return loadRealmWorldSemanticBundle(callApi, emitRealmWorldError, worldId);
}

export const realmWorldData = {
  loadWorlds: (status?: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED') =>
    loadWorldList(callRealmApi, emitRealmDataError, status),
  loadWorldDetailById: (worldId: string) =>
    loadWorldDetailById(callRealmApi, emitRealmDataError, worldId),
  loadWorldSemanticBundle: (worldId: string) =>
    loadWorldSemanticBundle(callRealmApi, emitRealmDataError, worldId),
  loadMainWorld: () =>
    loadMainWorld(callRealmApi, emitRealmDataError),
  loadWorldLevelAudits: (worldId: string, limit = 20) =>
    loadWorldLevelAudits(callRealmApi, emitRealmDataError, worldId, limit),
  loadWorldAgents: (worldId: string) =>
    loadWorldAgents(callRealmApi, emitRealmDataError, worldId),
  loadWorldDetailWithAgents: (worldId: string, recommendedAgentLimit?: number) =>
    loadWorldDetailWithAgents(callRealmApi, emitRealmDataError, worldId, recommendedAgentLimit),
  loadWorldHistory: (worldId: string) =>
    loadWorldHistory(callRealmApi, emitRealmDataError, worldId),
  loadWorldLorebooks: (worldId: string) =>
    loadWorldLorebooks(callRealmApi, emitRealmDataError, worldId),
  loadWorldBindings: (worldId: string) =>
    loadWorldBindings(callRealmApi, emitRealmDataError, worldId),
  loadWorldScenes: (worldId: string) =>
    loadWorldScenes(callRealmApi, emitRealmDataError, worldId),
};
