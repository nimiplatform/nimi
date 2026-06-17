import type { Realm } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import {
  isRealmOfflineErrorLike as isRealmOfflineError,
  type JsonObject,
} from '@nimiplatform/sdk/types';
import { callRealmApi, emitRealmDataError } from '@renderer/infra/realm/realm-api';
import { getOfflineCacheManager } from '@renderer/infra/offline/cache-manager';
import { getOfflineCoordinator } from '@renderer/infra/offline/coordinator';

type WorldCoreDto = RealmModel<'WorldCoreDto'>;
type WorldCharacterCoreDto = RealmModel<'WorldCharacterCoreDto'>;

type CoreRecord = Record<string, unknown>;
type WorldDetailDto = WorldCoreDto & CoreRecord;
type WorldLevelAuditEventDto = CoreRecord;
type WorldDetailWithAgentsDto = WorldDetailDto & { agents: WorldAgentSummaryDto[] };
type WorldAgentSummaryDto = {
  id: string;
  name: string;
  handle?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  createdAt?: string;
};

type RealmWorldApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type RealmWorldErrorEmitter = (
  action: string,
  error: unknown,
  details?: JsonObject,
) => void;

export type NimiRealmWorldStatus = WorldCoreDto['visibility'];
export type WorldSemanticBundle = CoreRecord;
export type WorldHistoryPayload = { items: WorldLevelAuditEventDto[]; [key: string]: unknown };
export type WorldLorebookListPayload = { items: CoreRecord[]; [key: string]: unknown };
export type WorldBindingListPayload = { items: CoreRecord[]; [key: string]: unknown };
export type WorldSceneListPayload = { items: CoreRecord[]; [key: string]: unknown };

function asRecord(value: unknown): CoreRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as CoreRecord
    : {};
}

function readString(record: CoreRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readNumber(record: CoreRecord, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function readArray<T = unknown>(record: CoreRecord, key: string): T[] {
  const value = record[key];
  return Array.isArray(value) ? [...value] as T[] : [];
}

function projectWorldCore(core: WorldCoreDto): WorldDetailDto {
  const payload = asRecord(core.core);
  return {
    ...core,
    ...payload,
    id: core.id,
    name: readString(payload, 'name', 'title', 'displayName') ?? core.id,
    description: readString(payload, 'description', 'summary') ?? null,
    tagline: readString(payload, 'tagline') ?? null,
    motto: readString(payload, 'motto') ?? null,
    overview: readString(payload, 'overview') ?? null,
    contentRating: readString(payload, 'contentRating', 'content_rating') ?? null,
    genre: readString(payload, 'genre') ?? null,
    themes: readArray<string>(payload, 'themes').filter((item) => typeof item === 'string'),
    era: readString(payload, 'era') ?? null,
    iconUrl: readString(payload, 'iconUrl', 'icon_url') ?? null,
    bannerUrl: readString(payload, 'bannerUrl', 'banner_url') ?? null,
    type: readString(payload, 'type', 'worldType') ?? core.visibility,
    status: readString(payload, 'status') ?? core.visibility,
    level: readNumber(payload, 'level') ?? 1,
    levelUpdatedAt: readString(payload, 'levelUpdatedAt', 'level_updated_at') ?? null,
    agentCount: readNumber(payload, 'characterCount', 'agentCount') ?? 0,
    createdAt: core.createdAt,
    updatedAt: core.updatedAt,
    creatorId: core.creatorId ?? null,
    freezeReason: readString(payload, 'freezeReason', 'freeze_reason') ?? null,
    lorebookEntryLimit: readNumber(payload, 'lorebookEntryLimit') ?? 0,
    nativeAgentLimit: readNumber(payload, 'nativeCharacterLimit', 'nativeAgentLimit') ?? 0,
    nativeCreationState: readString(payload, 'nativeCreationState') ?? 'OPEN',
    scoreA: readNumber(payload, 'scoreA') ?? 0,
    scoreC: readNumber(payload, 'scoreC') ?? 0,
    scoreE: readNumber(payload, 'scoreE') ?? 0,
    scoreEwma: readNumber(payload, 'scoreEwma') ?? 0,
    scoreQ: readNumber(payload, 'scoreQ') ?? 0,
    transitInLimit: readNumber(payload, 'transitInLimit') ?? 0,
    computed: asRecord(payload.computed),
  };
}

function projectWorldCharacter(character: WorldCharacterCoreDto): WorldAgentSummaryDto {
  const payload = asRecord(character.core);
  return {
    id: character.id,
    name: readString(payload, 'name', 'displayName', 'title') ?? character.id,
    handle: readString(payload, 'handle'),
    bio: readString(payload, 'bio', 'description'),
    avatarUrl: readString(payload, 'avatarUrl', 'avatar_url', 'portraitUrl', 'portrait_url'),
    createdAt: character.createdAt,
  };
}

async function listWorldCores(realm: Realm, status?: NimiRealmWorldStatus): Promise<WorldDetailDto[]> {
  const worlds = await realm.worldCore.worldCoreControllerListWorldCores({
    path: {},
    query: status ? { visibility: status } : {},
  });
  return worlds.map(projectWorldCore);
}

async function getWorldCore(realm: Realm, worldId: string): Promise<WorldDetailDto | null> {
  if (!worldId) return null;
  return projectWorldCore(await realm.worldCore.worldCoreControllerGetWorldCore({
    path: { worldId },
  }));
}

async function listWorldCharacters(realm: Realm, worldId: string): Promise<WorldAgentSummaryDto[]> {
  const rows = await realm.worldCore.worldCoreControllerListWorldCharacters({
    path: { worldId },
    query: {},
  });
  return rows.map(projectWorldCharacter);
}

function worldDetailWithAgentsCacheKey(worldId: string, recommendedAgentLimit?: number): string {
  return `world-core:${worldId}:characters:${recommendedAgentLimit ?? 'all'}`;
}

export async function loadWorldList(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  status?: NimiRealmWorldStatus,
): Promise<WorldDetailDto[]> {
  try {
    const normalized = await callApi(
      (realm) => listWorldCores(realm, status),
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
      (realm) => realm.worldCore.worldCoreControllerGetOasisWorld({ path: {} }).then(projectWorldCore),
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
      (realm) => getWorldCore(realm, worldId).then((world) =>
        readArray<WorldLevelAuditEventDto>(asRecord(world?.core), 'levelAudits').slice(0, limit),
      ),
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
      (realm) => getWorldCore(realm, normalizedWorldId),
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
      (realm) => getWorldCore(realm, worldId).then((world) => ({
        items: readArray<WorldLevelAuditEventDto>(asRecord(world?.core), 'history'),
      })),
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
      (realm) => getWorldCore(realm, worldId).then((world) => ({
        items: readArray<CoreRecord>(asRecord(world?.core), 'lorebooks'),
      })),
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
      (realm) => getWorldCore(realm, worldId).then((world) => ({
        items: readArray<CoreRecord>(asRecord(world?.core), 'bindings'),
      })),
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
      (realm) => getWorldCore(realm, worldId).then((world) => ({
        items: readArray<CoreRecord>(asRecord(world?.core), 'scenes'),
      })),
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
      (realm) => listWorldCharacters(realm, worldId),
      'Failed to load world personas',
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
  const cacheKey = worldDetailWithAgentsCacheKey(normalizedWorldId, recommendedAgentLimit);
  try {
    const detail = await callApi(
      async (realm) => {
        const world = await getWorldCore(realm, normalizedWorldId);
        if (!world) return null;
        const agents = await listWorldCharacters(realm, normalizedWorldId);
        return {
          ...world,
          agents: typeof recommendedAgentLimit === 'number'
            ? agents.slice(0, Math.max(0, Math.floor(recommendedAgentLimit)))
            : agents,
        };
      },
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
      (realm) => getWorldCore(realm, worldId).then((world) => asRecord(asRecord(world?.core).semanticBundle ?? world?.core)),
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
