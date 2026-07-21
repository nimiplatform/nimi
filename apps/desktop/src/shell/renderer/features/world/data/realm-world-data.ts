import type { Realm } from '@nimiplatform/sdk/realm';
import {
  isRealmOfflineErrorLike as isRealmOfflineError,
  type JsonObject,
} from '@nimiplatform/sdk/types';
import type { DesktopRendererOfflinePort } from '../../../renderer/offline-port.js';
import type { DesktopRendererSdkPort } from '../../../renderer/sdk-port.js';
import {
  asRecord,
  attachWorldEntryRecommendations,
  buildWorldPublicAssets,
  buildWorldPublicHistoryItems,
  buildWorldPublicScenes,
  buildWorldPublicSemanticBundle,
  failRealmWorldContract,
  projectWorldPublicDetail,
  projectWorldPublicItem,
  projectWorldPublicSourceCard,
  readArray,
  readNumber,
  requireWorldPublicDetailDto,
  requireWorldPublicItemDto,
  requireWorldPublicSourceCardDto,
  type NimiRealmWorldStatus,
  type WorldAssetListPayload,
  type WorldCharacterSummaryDto,
  type WorldDetailDto,
  type WorldDetailWithCharactersDto,
  type WorldHistoryPayload,
  type WorldPublicDetailWithCharactersDto,
  type WorldSceneListPayload,
  type WorldSemanticBundle,
} from './world-public-projection.js';

export type {
  NimiRealmWorldStatus,
  WorldAssetListPayload,
  WorldHistoryPayload,
  WorldSceneListPayload,
  WorldSemanticBundle,
} from './world-public-projection.js';

type RealmWorldApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type RealmWorldErrorEmitter = (
  action: string,
  error: unknown,
  details?: JsonObject,
) => void;

function requireOffline(
  offline: DesktopRendererOfflinePort | undefined,
): DesktopRendererOfflinePort {
  if (!offline) throw new Error('DESKTOP_REALM_WORLD_OFFLINE_PORT_REQUIRED');
  return offline;
}

async function listWorldCores(realm: Realm, status?: NimiRealmWorldStatus): Promise<WorldDetailDto[]> {
  const worlds = await realm.worldPublic.worldPublicControllerListWorlds({
    path: {},
    query: {},
  });
  if (!Array.isArray(worlds)) {
    failRealmWorldContract(
      'SDK_REALM_WORLD_PUBLIC_LIST_CONTRACT_INVALID',
      'World public list payload must be an array',
    );
  }
  return worlds
    .map((world) => projectWorldPublicItem(requireWorldPublicItemDto(world)))
    .filter((world) => !status || world.visibility === status);
}

async function getWorldCore(realm: Realm, worldId: string): Promise<WorldDetailDto | null> {
  if (!worldId) return null;
  const world = await realm.worldPublic.worldPublicControllerGetWorld({
    path: { worldId },
  });
  return projectWorldPublicDetail(requireWorldPublicDetailDto(world, worldId));
}

async function listWorldCharacters(realm: Realm, worldId: string): Promise<WorldCharacterSummaryDto[]> {
  const rows = await realm.worldPublic.worldPublicControllerListWorldCharacters({
    path: { worldId },
    query: {},
  });
  if (!Array.isArray(rows)) {
    failRealmWorldContract(
      'SDK_REALM_WORLD_PUBLIC_SOURCE_LIST_CONTRACT_INVALID',
      'World public source list payload must be an array',
    );
  }
  return rows.map((row) => projectWorldPublicSourceCard(requireWorldPublicSourceCardDto(row, worldId)));
}

function worldDetailWithCharactersCacheKey(worldId: string, recommendedCharacterLimit?: number): string {
  return `world-core:${worldId}:characters:${recommendedCharacterLimit ?? 'all'}`;
}

export async function loadWorldList(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  status?: NimiRealmWorldStatus,
  offline?: DesktopRendererOfflinePort,
): Promise<WorldDetailDto[]> {
  try {
    const normalized = await callApi(
      (realm) => listWorldCores(realm, status),
      'Failed to load world list',
    );
    if (offline) await offline.syncWorldList(normalized);
    return normalized;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const offlinePort = requireOffline(offline);
      offlinePort.markCacheFallbackUsed();
      return await offlinePort.getCachedWorldList<WorldDetailDto>();
    }
    emitRealmWorldError('load-world-list', error);
    throw error;
  }
}

export async function loadMainWorld(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  offline?: DesktopRendererOfflinePort,
): Promise<WorldDetailDto> {
  try {
    const world = await callApi(
      (realm) => realm.worldPublic.worldPublicControllerGetWorld({ path: { worldId: 'OASIS' } }).then((row) =>
        projectWorldPublicDetail(requireWorldPublicDetailDto(row, 'OASIS')),
      ),
      'Failed to load main world',
    );
    if (offline) await offline.syncWorldMetadata('main-world', world);
    return world;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const offlinePort = requireOffline(offline);
      const cached = await offlinePort.getCachedWorldMetadata<WorldDetailDto>('main-world');
      if (cached) {
        offlinePort.markCacheFallbackUsed();
        return cached;
      }
    }
    emitRealmWorldError('load-main-world', error);
    throw error;
  }
}

export async function loadWorldDetailById(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
  offline?: DesktopRendererOfflinePort,
): Promise<WorldDetailDto | null> {
  const normalizedWorldId = String(worldId || '').trim();
  try {
    const record = await callApi(
      (realm) => getWorldCore(realm, normalizedWorldId),
      'Failed to load world detail',
    );
    if (record && offline) {
      await offline.syncWorldMetadata(`world:${normalizedWorldId}`, record);
    }
    return record;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const offlinePort = requireOffline(offline);
      const cached = await offlinePort.getCachedWorldMetadata<WorldDetailDto>(`world:${normalizedWorldId}`);
      if (cached) {
        offlinePort.markCacheFallbackUsed();
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
      (realm) => getWorldCore(realm, worldId).then((world) => buildWorldPublicHistoryItems(asRecord(world))),
      'Failed to load world history',
    );
  } catch (error) {
    emitRealmWorldError('load-world-history', error, { worldId });
    throw error;
  }
}

export async function loadWorldAssets(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
): Promise<WorldAssetListPayload> {
  try {
    return await callApi(
      (realm) => getWorldCore(realm, worldId).then((world) => buildWorldPublicAssets(asRecord(world))),
      'Failed to load world assets',
    );
  } catch (error) {
    emitRealmWorldError('load-world-assets', error, { worldId });
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
      (realm) => getWorldCore(realm, worldId).then((world) => buildWorldPublicScenes(asRecord(world))),
      'Failed to load world scenes',
    );
  } catch (error) {
    emitRealmWorldError('load-world-scenes', error, { worldId });
    throw error;
  }
}

export async function loadWorldCharacters(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
): Promise<WorldCharacterSummaryDto[]> {
  try {
    return await callApi(
      (realm) => listWorldCharacters(realm, worldId),
      'Failed to load world characters',
    );
  } catch (error) {
    emitRealmWorldError('load-world-characters', error, { worldId });
    throw error;
  }
}

export async function loadWorldDetailWithCharacters(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
  recommendedCharacterLimit?: number,
  offline?: DesktopRendererOfflinePort,
): Promise<WorldDetailWithCharactersDto | null> {
  const normalizedWorldId = String(worldId || '').trim();
  const cacheKey = worldDetailWithCharactersCacheKey(normalizedWorldId, recommendedCharacterLimit);
  try {
    const detail = await callApi(
      async (realm) => {
        const response = await realm.worldPublic.worldPublicControllerGetWorldDetailWithCharacters({
          path: { worldId: normalizedWorldId },
          query: {},
        }) as unknown as WorldPublicDetailWithCharactersDto;
        const world = projectWorldPublicDetail(
          requireWorldPublicDetailDto(response.world, normalizedWorldId),
        );
        const sourceSections = asRecord(response.sources);
        const characterSources = readArray<unknown>(sourceSections, 'characters').map((row) =>
          projectWorldPublicSourceCard(requireWorldPublicSourceCardDto(row, normalizedWorldId)),
        );
        const personaSources = readArray<unknown>(sourceSections, 'personas').map((row) =>
          projectWorldPublicSourceCard(requireWorldPublicSourceCardDto(row, normalizedWorldId)),
        );
        const characters = [...characterSources, ...personaSources];
        const characterCount = readNumber(asRecord(world), 'characterCount') ?? characterSources.length;
        const personaCount = readNumber(asRecord(world), 'personaCount') ?? personaSources.length;
        return {
          ...attachWorldEntryRecommendations(world, characters, recommendedCharacterLimit),
          characterCount,
          personaCount,
          characters,
        };
      },
      'Failed to load world detail with characters',
    );
    if (detail && offline) {
      await offline.syncWorldMetadata(cacheKey, detail);
    }
    return detail;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const offlinePort = requireOffline(offline);
      const cached = await offlinePort.getCachedWorldMetadata<WorldDetailWithCharactersDto>(cacheKey);
      if (cached) {
        offlinePort.markCacheFallbackUsed();
        return cached;
      }
    }
    emitRealmWorldError('load-world-detail-with-characters', error, { worldId: normalizedWorldId });
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
      (realm) => getWorldCore(realm, worldId).then((world) => buildWorldPublicSemanticBundle(asRecord(world))),
      'Failed to load world core semantic bundle',
    );
  } catch (error) {
    emitRealmWorldError('load-world-semantic-bundle', error, { worldId });
    throw error;
  }
}

export function createRealmWorldData(sdk: DesktopRendererSdkPort) {
  const callRealmApi = sdk.socialData.callApi;
  const emitRealmDataError = sdk.socialData.emitDataError;
  return {
  loadWorlds: (status?: NimiRealmWorldStatus) =>
    loadWorldList(callRealmApi, emitRealmDataError, status, sdk.offline),
  loadWorldDetailById: (worldId: string) =>
    loadWorldDetailById(callRealmApi, emitRealmDataError, worldId, sdk.offline),
  loadWorldSemanticBundle: (worldId: string) =>
    loadWorldSemanticBundle(callRealmApi, emitRealmDataError, worldId),
  loadMainWorld: () =>
    loadMainWorld(callRealmApi, emitRealmDataError, sdk.offline),
  loadWorldCharacters: (worldId: string) =>
    loadWorldCharacters(callRealmApi, emitRealmDataError, worldId),
  loadWorldDetailWithCharacters: (worldId: string, recommendedCharacterLimit?: number) =>
    loadWorldDetailWithCharacters(callRealmApi, emitRealmDataError, worldId, recommendedCharacterLimit, sdk.offline),
  loadWorldHistory: (worldId: string) =>
    loadWorldHistory(callRealmApi, emitRealmDataError, worldId),
  loadWorldAssets: (worldId: string) =>
    loadWorldAssets(callRealmApi, emitRealmDataError, worldId),
  loadWorldScenes: (worldId: string) =>
    loadWorldScenes(callRealmApi, emitRealmDataError, worldId),
  };
}

export type RealmWorldData = ReturnType<typeof createRealmWorldData>;
