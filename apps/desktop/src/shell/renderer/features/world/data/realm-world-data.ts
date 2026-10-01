import type { Realm } from '@nimiplatform/sdk/realm';
import {
  isRealmOfflineErrorLike as isRealmOfflineError,
  type JsonObject,
} from '@nimiplatform/sdk/types';
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


export const WORLD_CATALOG_PAGE_LIMIT = 20;

export type RealmCatalogPage<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
};

export type RealmCatalogPageRequest = {
  q?: string;
  cursor?: string | null;
  limit?: number;
};

function requireCatalogPage(value: unknown, context: string): {
  items: unknown[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
} {
  const record = asRecord(value);
  const items = record.items;
  const nextCursor = record.nextCursor;
  const hasMore = record.hasMore;
  const totalCount = record.totalCount;
  if (
    !Array.isArray(items)
    || (nextCursor !== null && typeof nextCursor !== 'string')
    || typeof hasMore !== 'boolean'
    || hasMore !== (nextCursor !== null)
    || typeof totalCount !== 'number'
  ) {
    failRealmWorldContract('SDK_REALM_WORLD_CATALOG_CONTRACT_INVALID', `${context} page must carry items, nextCursor, hasMore and totalCount`);
  }
  return { items, nextCursor, hasMore, totalCount };
}

function catalogQuery(request: RealmCatalogPageRequest) {
  const q = request.q?.trim();
  return {
    ...(q ? { q } : {}),
    ...(request.cursor ? { cursor: request.cursor } : {}),
    limit: request.limit ?? WORLD_CATALOG_PAGE_LIMIT,
  };
}

async function listWorldCatalogPage(
  realm: Realm,
  request: RealmCatalogPageRequest,
): Promise<RealmCatalogPage<WorldDetailDto>> {
  const page = requireCatalogPage(
    await realm.worldPublic.worldPublicControllerListWorldCatalog({ path: {}, query: catalogQuery(request) }),
    'World catalog',
  );
  return {
    ...page,
    items: page.items.map((world) => projectWorldPublicItem(requireWorldPublicItemDto(world))),
  };
}

async function getWorldCore(realm: Realm, worldId: string): Promise<WorldDetailDto | null> {
  if (!worldId) return null;
  const world = await realm.worldPublic.worldPublicControllerGetWorld({
    path: { worldId },
  });
  return projectWorldPublicDetail(requireWorldPublicDetailDto(world, worldId));
}

async function listWorldCharacterCatalogPage(
  realm: Realm,
  worldId: string,
  request: RealmCatalogPageRequest,
): Promise<RealmCatalogPage<WorldCharacterSummaryDto>> {
  const page = requireCatalogPage(
    await realm.worldPublic.worldPublicControllerListWorldCharacterCatalog({
      path: { worldId },
      query: catalogQuery(request),
    }),
    'World character catalog',
  );
  return {
    ...page,
    items: page.items.map((row) => projectWorldPublicSourceCard(requireWorldPublicSourceCardDto(row, worldId))),
  };
}

async function listPersonaCharacterCatalogPage(
  realm: Realm,
  request: RealmCatalogPageRequest & { worldId?: string },
): Promise<RealmCatalogPage<WorldCharacterSummaryDto>> {
  const worldId = request.worldId?.trim();
  const page = requireCatalogPage(
    await realm.worldPublic.worldPublicControllerListPersonaCharacterCatalog({
      path: {},
      query: { ...catalogQuery(request), ...(worldId ? { worldId } : {}) },
    }),
    'Persona character catalog',
  );
  return {
    ...page,
    items: page.items.map((row) => {
      const cardWorldId = String(asRecord(row).worldId || '').trim();
      return projectWorldPublicSourceCard(requireWorldPublicSourceCardDto(row, worldId || cardWorldId));
    }),
  };
}

// Catalog pages are live reads only: an offline or failed read never returns a persisted list
// as the current result (callers keep already-loaded pages marked incomplete).
export async function loadWorldCatalogPage(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  request: RealmCatalogPageRequest,
): Promise<RealmCatalogPage<WorldDetailDto>> {
  try {
    return await callApi((realm) => listWorldCatalogPage(realm, request), 'Failed to load world catalog');
  } catch (error) {
    if (!isRealmOfflineError(error)) emitRealmWorldError('load-world-catalog', error);
    throw error;
  }
}

export async function loadPersonaCharacterCatalogPage(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  request: RealmCatalogPageRequest & { worldId?: string },
): Promise<RealmCatalogPage<WorldCharacterSummaryDto>> {
  try {
    return await callApi(
      (realm) => listPersonaCharacterCatalogPage(realm, request),
      'Failed to load persona character catalog',
    );
  } catch (error) {
    if (!isRealmOfflineError(error)) emitRealmWorldError('load-persona-character-catalog', error);
    throw error;
  }
}

export async function loadMainWorld(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
): Promise<WorldDetailDto> {
  try {
    return await callApi(
      (realm) => realm.worldPublic.worldPublicControllerGetWorld({ path: { worldId: 'OASIS' } }).then((row) =>
        projectWorldPublicDetail(requireWorldPublicDetailDto(row, 'OASIS')),
      ),
      'Failed to load main world',
    );
  } catch (error) {
    if (!isRealmOfflineError(error)) emitRealmWorldError('load-main-world', error);
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
    return await callApi(
      (realm) => getWorldCore(realm, normalizedWorldId),
      'Failed to load world detail',
    );
  } catch (error) {
    if (!isRealmOfflineError(error)) {
      emitRealmWorldError('load-world-detail', error, { worldId: normalizedWorldId });
    }
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

export async function loadWorldCharacterPage(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
  request: RealmCatalogPageRequest,
): Promise<RealmCatalogPage<WorldCharacterSummaryDto>> {
  const normalizedWorldId = String(worldId || '').trim();
  try {
    return await callApi(
      (realm) => listWorldCharacterCatalogPage(realm, normalizedWorldId, request),
      'Failed to load world characters',
    );
  } catch (error) {
    if (!isRealmOfflineError(error)) {
      emitRealmWorldError('load-world-characters', error, { worldId: normalizedWorldId });
    }
    throw error;
  }
}

export async function loadWorldDetailWithCharacters(
  callApi: RealmWorldApiCaller,
  emitRealmWorldError: RealmWorldErrorEmitter,
  worldId: string,
  recommendedCharacterLimit?: number,
): Promise<WorldDetailWithCharactersDto | null> {
  const normalizedWorldId = String(worldId || '').trim();
  try {
    return await callApi(
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
        const personaSources = readArray<unknown>(sourceSections, 'personaCharacters').map((row) =>
          projectWorldPublicSourceCard(requireWorldPublicSourceCardDto(row, normalizedWorldId)),
        );
        const characters = [...characterSources, ...personaSources];
        // Detail carries only the first bounded page of each section; totals come from stats.
        return {
          ...attachWorldEntryRecommendations(world, characters, recommendedCharacterLimit),
          characterCount: readNumber(asRecord(world), 'characterCount') ?? 0,
          personaCharacterCount: readNumber(asRecord(world), 'personaCharacterCount') ?? 0,
          charactersNextCursor: readNullableCursor(sourceSections.charactersNextCursor),
          personaCharactersNextCursor: readNullableCursor(sourceSections.personaCharactersNextCursor),
          characters,
        };
      },
      'Failed to load world detail with characters',
    );
  } catch (error) {
    if (!isRealmOfflineError(error)) {
      emitRealmWorldError('load-world-detail-with-characters', error, { worldId: normalizedWorldId });
    }
    throw error;
  }
}

function readNullableCursor(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value === 'string' && value) return value;
  return failRealmWorldContract(
    'SDK_REALM_WORLD_PUBLIC_DETAIL_CONTRACT_INVALID',
    'World detail source cursor must be a string or null',
  );
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
    loadWorldCatalogPage: (request: RealmCatalogPageRequest) =>
      loadWorldCatalogPage(callRealmApi, emitRealmDataError, request),
    loadPersonaCharacterCatalogPage: (request: RealmCatalogPageRequest & { worldId?: string }) =>
      loadPersonaCharacterCatalogPage(callRealmApi, emitRealmDataError, request),
    loadWorldDetailById: (worldId: string) =>
      loadWorldDetailById(callRealmApi, emitRealmDataError, worldId),
    loadWorldSemanticBundle: (worldId: string) =>
      loadWorldSemanticBundle(callRealmApi, emitRealmDataError, worldId),
    loadMainWorld: () =>
      loadMainWorld(callRealmApi, emitRealmDataError),
    loadWorldCharacterPage: (worldId: string, request: RealmCatalogPageRequest) =>
      loadWorldCharacterPage(callRealmApi, emitRealmDataError, worldId, request),
    loadWorldDetailWithCharacters: (worldId: string, recommendedCharacterLimit?: number) =>
      loadWorldDetailWithCharacters(callRealmApi, emitRealmDataError, worldId, recommendedCharacterLimit),
    loadWorldHistory: (worldId: string) =>
      loadWorldHistory(callRealmApi, emitRealmDataError, worldId),
    loadWorldAssets: (worldId: string) =>
      loadWorldAssets(callRealmApi, emitRealmDataError, worldId),
    loadWorldScenes: (worldId: string) =>
      loadWorldScenes(callRealmApi, emitRealmDataError, worldId),
  };
}

export type RealmWorldData = ReturnType<typeof createRealmWorldData>;
