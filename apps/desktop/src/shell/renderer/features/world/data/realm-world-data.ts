import {
  buildNimiRealmWorldDetailWithAgentsCacheKey,
  loadNimiRealmMainWorld,
  loadNimiRealmWorldAgents,
  loadNimiRealmWorldBindings,
  loadNimiRealmWorldDetailById,
  loadNimiRealmWorldDetailWithAgents,
  loadNimiRealmWorldHistory,
  loadNimiRealmWorldLevelAudits,
  loadNimiRealmWorldList,
  loadNimiRealmWorldLorebooks,
  loadNimiRealmWorldScenes,
  loadNimiRealmWorldSemanticBundle,
  type NimiRealmWorldAgentSummary,
  type NimiRealmWorldBindingListPayload,
  type NimiRealmWorldDetail,
  type NimiRealmWorldDetailWithAgents,
  type NimiRealmWorldHistoryPayload,
  type NimiRealmWorldLevelAuditEvent,
  type NimiRealmWorldLorebookListPayload,
  type NimiRealmWorldSceneListPayload,
  type NimiRealmWorldSemanticBundle,
  type NimiRealmWorldStatus,
  type Realm,
} from '@nimiplatform/sdk/realm';
import {
  isRealmOfflineErrorLike as isRealmOfflineError,
  type JsonObject,
} from '@nimiplatform/sdk/types';
import { callRealmApi, emitRealmDataError } from '@renderer/infra/realm/realm-api';
import { getOfflineCacheManager } from '@renderer/infra/offline/cache-manager';
import { getOfflineCoordinator } from '@renderer/infra/offline/coordinator';

type WorldDetailDto = NimiRealmWorldDetail;
type WorldLevelAuditEventDto = NimiRealmWorldLevelAuditEvent;
type WorldDetailWithAgentsDto = NimiRealmWorldDetailWithAgents;
type WorldAgentSummaryDto = NimiRealmWorldAgentSummary;

type RealmWorldApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type RealmWorldErrorEmitter = (
  action: string,
  error: unknown,
  details?: JsonObject,
) => void;

export type WorldSemanticBundle = NimiRealmWorldSemanticBundle;
export type WorldHistoryPayload = NimiRealmWorldHistoryPayload;
export type WorldLorebookListPayload = NimiRealmWorldLorebookListPayload;
export type WorldBindingListPayload = NimiRealmWorldBindingListPayload;
export type WorldSceneListPayload = NimiRealmWorldSceneListPayload;

export async function loadWorldList(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  status?: NimiRealmWorldStatus,
): Promise<WorldDetailDto[]> {
  try {
    const normalized = await callApi(
      (realm) => loadNimiRealmWorldList(realm, status),
      'Failed to load world list',
    );
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
    const world = await callApi(
      (realm) => loadNimiRealmMainWorld(realm),
      'Failed to load main world',
    );
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
  try {
    return await callApi(
      (realm) => loadNimiRealmWorldLevelAudits(realm, worldId, limit),
      'Failed to load world level audits',
    );
  } catch (error) {
    emitRealmWorldError('load-world-level-audits', error, { worldId, limit });
    throw error;
  }
}

export async function loadWorldDetailById(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
): Promise<WorldDetailDto | null> {
  const normalizedWorldId = String(worldId || '').trim();
  try {
    const record = await callApi(
      (realm) => loadNimiRealmWorldDetailById(realm, normalizedWorldId),
      'Failed to load world detail',
    );
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
  try {
    return await callApi(
      (realm) => loadNimiRealmWorldHistory(realm, worldId),
      'Failed to load world history',
    );
  } catch (error) {
    emitRealmWorldError('load-world-history', error, { worldId });
    throw error;
  }
}

export async function loadWorldLorebooks(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
): Promise<WorldLorebookListPayload> {
  try {
    return await callApi(
      (realm) => loadNimiRealmWorldLorebooks(realm, worldId),
      'Failed to load world lorebooks',
    );
  } catch (error) {
    emitRealmWorldError('load-world-lorebooks', error, { worldId });
    throw error;
  }
}

export async function loadWorldBindings(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
): Promise<WorldBindingListPayload> {
  try {
    return await callApi(
      (realm) => loadNimiRealmWorldBindings(realm, worldId),
      'Failed to load world bindings',
    );
  } catch (error) {
    emitRealmWorldError('load-world-bindings', error, { worldId });
    throw error;
  }
}

export async function loadWorldScenes(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
): Promise<WorldSceneListPayload> {
  try {
    return await callApi(
      (realm) => loadNimiRealmWorldScenes(realm, worldId),
      'Failed to load world scenes',
    );
  } catch (error) {
    emitRealmWorldError('load-world-scenes', error, { worldId });
    throw error;
  }
}

export async function loadWorldAgents(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
): Promise<WorldAgentSummaryDto[]> {
  try {
    return await callApi(
      (realm) => loadNimiRealmWorldAgents(realm, worldId),
      'Failed to load world agents',
    );
  } catch (error) {
    emitRealmWorldError('load-world-agents', error, { worldId });
    throw error;
  }
}

export async function loadWorldDetailWithAgents(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
  recommendedAgentLimit?: number,
): Promise<WorldDetailWithAgentsDto | null> {
  const normalizedWorldId = String(worldId || '').trim();
  const cacheKey = buildNimiRealmWorldDetailWithAgentsCacheKey(normalizedWorldId, recommendedAgentLimit);
  try {
    const detail = await callApi(
      (realm) => loadNimiRealmWorldDetailWithAgents(realm, normalizedWorldId, recommendedAgentLimit),
      'Failed to load world detail with agents',
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
  try {
    return await callApi(
      (realm) => loadNimiRealmWorldSemanticBundle(realm, worldId),
      'Failed to load worldview',
    );
  } catch (error) {
    emitRealmWorldError('load-world-semantic-bundle', error, { worldId });
    throw error;
  }
}

export const realmWorldData = {
  loadWorlds: (status?: NimiRealmWorldStatus) =>
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
