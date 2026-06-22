import type { Realm, NimiRealmCoreSourceRef } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';
import {
  isRealmOfflineErrorLike as isRealmOfflineError,
  type JsonObject,
} from '@nimiplatform/sdk/types';
import { callRealmApi, emitRealmDataError } from '@renderer/infra/realm/realm-api';
import { getOfflineCacheManager } from '@renderer/infra/offline/cache-manager';
import { getOfflineCoordinator } from '@renderer/infra/offline/coordinator';

type WorldPublicItemDto = RealmModel<'WorldPublicItemDto'>;
type WorldPublicDetailDto = RealmModel<'WorldPublicDetailDto'>;
type WorldPublicDetailWithCharactersDto = RealmModel<'WorldPublicDetailWithCharactersDto'>;
type WorldPublicSourceCardDto = RealmModel<'WorldPublicSourceCardDto'>;

type CoreRecord = Record<string, unknown>;
type WorldDetailDto = CoreRecord;
type WorldLevelAuditEventDto = CoreRecord;
type WorldDetailWithCharactersDto = WorldDetailDto & { characters: WorldCharacterSummaryDto[] };
type WorldCharacterSummaryDto = {
  id: string;
  name: string;
  handle?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  profileCoverUrl?: string | null;
  createdAt?: string;
  sourceRef: NimiRealmCoreSourceRef;
  sourceKind?: 'worldCharacter' | 'realmPersona';
  ownership?: 'worldOwned' | 'userOwned';
  relation?: {
    state: 'connectable' | 'connected' | 'unavailable';
    connectionId?: string | null;
    runtimeSourceRef?: string | null;
  };
  display?: CoreRecord | null;
  stats?: CoreRecord | null;
  importance?: string | null;
};

type RealmWorldApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
type RealmWorldErrorEmitter = (
  action: string,
  error: unknown,
  details?: JsonObject,
) => void;

export type NimiRealmWorldStatus = WorldPublicItemDto['visibility'];
export type WorldSemanticBundle = CoreRecord;
export type WorldHistoryPayload = { items: WorldLevelAuditEventDto[]; [key: string]: unknown };
export type WorldSceneListPayload = { items: CoreRecord[]; [key: string]: unknown };
export type WorldAssetListPayload = {
  resourceRefs: CoreRecord[];
  externalRefs: CoreRecord[];
  intents: CoreRecord[];
  [key: string]: unknown;
};

function asRecord(value: unknown): CoreRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as CoreRecord
    : {};
}

function failRealmWorldContract(reasonCode: string, message: string): never {
  const error = new Error(message) as Error & { reasonCode?: string };
  error.reasonCode = reasonCode;
  throw error;
}

function requireRecord(value: unknown, reasonCode: string, message: string): CoreRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failRealmWorldContract(reasonCode, message);
  }
  return value as CoreRecord;
}

function requireStringField(record: CoreRecord, field: string, reasonCode: string, message: string): string {
  const value = record[field];
  if (typeof value !== 'string' || !value.trim()) {
    failRealmWorldContract(reasonCode, message);
  }
  return value.trim();
}

function requireArrayField(record: CoreRecord, field: string, reasonCode: string, message: string): unknown[] {
  const value = record[field];
  if (!Array.isArray(value)) {
    failRealmWorldContract(reasonCode, message);
  }
  return value;
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

function readBoolean(record: CoreRecord, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return null;
}

function requireWorldPublicItemDto(value: unknown, expectedWorldId?: string): WorldPublicItemDto {
  const record = requireRecord(
    value,
    'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID',
    'World public payload must be an object',
  );
  const id = requireStringField(
    record,
    'id',
    'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID',
    'World public payload is missing id',
  );
  if (expectedWorldId && id !== expectedWorldId) {
    failRealmWorldContract(
      'SDK_REALM_WORLD_PUBLIC_ID_MISMATCH',
      `World public payload id ${id} does not match requested world ${expectedWorldId}`,
    );
  }
  requireStringField(
    record,
    'name',
    'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID',
    `World public payload ${id} is missing name`,
  );
  requireStringField(
    record,
    'summary',
    'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID',
    `World public payload ${id} is missing summary`,
  );
  const type = requireStringField(
    record,
    'type',
    'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID',
    `World public payload ${id} is missing type`,
  );
  if (!['OASIS', 'CREATOR'].includes(type)) {
    failRealmWorldContract(
      'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID',
      `World public payload ${id} has invalid type ${type}`,
    );
  }
  const visibility = requireStringField(
    record,
    'visibility',
    'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID',
    `World public payload ${id} is missing visibility`,
  );
  if (!['public', 'system'].includes(visibility)) {
    failRealmWorldContract(
      'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID',
      `World public payload ${id} has invalid visibility ${visibility}`,
    );
  }
  requireRecord(
    record.media,
    'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID',
    `World public payload ${id} is missing media`,
  );
  requireRecord(
    record.stats,
    'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID',
    `World public payload ${id} is missing stats`,
  );
  requireArrayField(
    record,
    'entityKinds',
    'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID',
    `World public payload ${id} is missing entityKinds`,
  );
  requireArrayField(
    record,
    'relationshipTypes',
    'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID',
    `World public payload ${id} is missing relationshipTypes`,
  );
  requireRecord(
    record.time,
    'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID',
    `World public payload ${id} is missing time`,
  );
  requireStringField(
    record,
    'createdAt',
    'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID',
    `World public payload ${id} is missing createdAt`,
  );
  requireStringField(
    record,
    'updatedAt',
    'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID',
    `World public payload ${id} is missing updatedAt`,
  );
  return value as WorldPublicItemDto;
}

function requireWorldPublicDetailDto(value: unknown, expectedWorldId?: string): WorldPublicDetailDto {
  requireWorldPublicItemDto(value, expectedWorldId);
  const record = value as CoreRecord;
  for (const field of ['rules', 'systems', 'scenes', 'timeline']) {
    requireArrayField(
      record,
      field,
      'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID',
      `World public detail is missing ${field}`,
    );
  }
  return value as WorldPublicDetailDto;
}

function requireWorldPublicSourceCardDto(value: unknown, expectedWorldId: string): WorldPublicSourceCardDto {
  const record = requireRecord(
    value,
    'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID',
    'World public source card must be an object',
  );
  const id = requireStringField(
    record,
    'id',
    'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID',
    'World public source card is missing id',
  );
  const worldId = requireStringField(
    record,
    'worldId',
    'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID',
    `World public source ${id} is missing worldId`,
  );
  if (worldId !== expectedWorldId) {
    failRealmWorldContract(
      'SDK_REALM_WORLD_PUBLIC_SOURCE_WORLD_MISMATCH',
      `World public source ${id} worldId ${worldId} does not match requested world ${expectedWorldId}`,
    );
  }
  requireStringField(
    record,
    'displayName',
    'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID',
    `World public source ${id} is missing displayName`,
  );
  requireStringField(
    record,
    'summary',
    'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID',
    `World public source ${id} is missing summary`,
  );
  const sourceKind = requireStringField(
    record,
    'sourceKind',
    'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID',
    `World public source ${id} is missing sourceKind`,
  );
  if (!['worldCharacter', 'realmPersona'].includes(sourceKind)) {
    failRealmWorldContract(
      'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID',
      `World public source ${id} has invalid sourceKind ${sourceKind}`,
    );
  }
  requireRecord(
    record.sourceRef,
    'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID',
    `World public source ${id} is missing sourceRef`,
  );
  const sourceRef = asRecord(record.sourceRef);
  const sourceRefKind = requireStringField(
    sourceRef,
    'kind',
    'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID',
    `World public source ${id} is missing sourceRef.kind`,
  );
  const sourceRefWorldId = requireStringField(
    sourceRef,
    'worldId',
    'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID',
    `World public source ${id} is missing sourceRef.worldId`,
  );
  const sourceRefSourceId = requireStringField(
    sourceRef,
    'sourceId',
    'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID',
    `World public source ${id} is missing sourceRef.sourceId`,
  );
  requireStringField(
    sourceRef,
    'sourceContentHash',
    'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID',
    `World public source ${id} is missing sourceRef.sourceContentHash`,
  );
  if (sourceRefKind !== sourceKind || sourceRefWorldId !== worldId || sourceRefSourceId !== id) {
    failRealmWorldContract(
      'SDK_REALM_WORLD_PUBLIC_SOURCE_REF_MISMATCH',
      `World public source ${id} sourceRef must match sourceKind, worldId, and id`,
    );
  }
  requireRecord(
    record.media,
    'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID',
    `World public source ${id} is missing media`,
  );
  requireRecord(
    record.relation,
    'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID',
    `World public source ${id} is missing relation`,
  );
  return value as WorldPublicSourceCardDto;
}

function projectWorldPublicItem(world: WorldPublicItemDto): WorldDetailDto {
  const record = world as unknown as CoreRecord;
  const media = asRecord(world.media);
  const stats = asRecord(world.stats);
  const time = asRecord(world.time);
  const tags = Array.isArray(world.tags)
    ? world.tags.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    id: world.id,
    name: world.name,
    summary: world.summary,
    description: world.summary,
    tagline: world.tagline ?? null,
    type: world.type,
    visibility: world.visibility,
    tags,
    themes: tags,
    genre: tags[0] ?? null,
    entityKinds: readArray<string>(record, 'entityKinds').filter((item) => typeof item === 'string'),
    relationshipTypes: readArray<string>(record, 'relationshipTypes').filter((item) => typeof item === 'string'),
    iconUrl: readString(media, 'iconUrl'),
    bannerUrl: readString(media, 'bannerUrl') ?? readString(media, 'heroUrl'),
    heroUrl: readString(media, 'heroUrl'),
    highlightUrls: readArray<string>(media, 'highlightUrls').filter((item) => typeof item === 'string'),
    status: 'DISCOVERABLE',
    entityCount: readNumber(stats, 'entityCount') ?? 0,
    relationshipCount: readNumber(stats, 'relationshipCount') ?? 0,
    characterCount: readNumber(stats, 'characterCount') ?? 0,
    personaCount: readNumber(stats, 'personaCount') ?? 0,
    sceneCount: readNumber(stats, 'sceneCount') ?? 0,
    systemCount: readNumber(stats, 'systemCount') ?? 0,
    timelineEventCount: readNumber(stats, 'timelineEventCount') ?? 0,
    media: world.media,
    stats: world.stats,
    time: world.time,
    computed: {
      time: {
        currentWorldTime: readString(time, 'currentWorldTime'),
        currentLabel: readString(time, 'currentWorldTimeDisplay'),
        eraLabel: readString(time, 'anchorWorldStartedAtDisplay'),
        flowRatio: readNumber(time, 'flowRatio') ?? 1,
        isPaused: readBoolean(time, 'isPaused') ?? false,
      },
      languages: {
        primary: null,
        common: [],
      },
      entry: {
        recommendedCharacters: [],
      },
      score: {
        scoreEwma: 0,
      },
      featuredCharacterCount: readNumber(stats, 'characterCount') ?? 0,
    },
    createdAt: world.createdAt,
    updatedAt: world.updatedAt,
    creatorId: null,
  };
}

function projectWorldPublicDetail(world: WorldPublicDetailDto): WorldDetailDto {
  return {
    ...projectWorldPublicItem(world),
    rules: readArray<string>(world as unknown as CoreRecord, 'rules').filter((item) => typeof item === 'string'),
    systems: readArray<string>(world as unknown as CoreRecord, 'systems').filter((item) => typeof item === 'string'),
    scenes: readArray<string>(world as unknown as CoreRecord, 'scenes').filter((item) => typeof item === 'string'),
    timeline: readArray<string>(world as unknown as CoreRecord, 'timeline').filter((item) => typeof item === 'string'),
  };
}

function projectWorldPublicSourceCard(source: WorldPublicSourceCardDto): WorldCharacterSummaryDto {
  const media = asRecord(source.media);
  const relation = asRecord(source.relation);
  const sourceRef = source.sourceRef as unknown as NimiRealmCoreSourceRef;
  return {
    id: source.id,
    name: source.displayName,
    handle: source.handle ?? null,
    bio: source.summary,
    avatarUrl: readString(media, 'avatarUrl'),
    profileCoverUrl: readString(media, 'profileCoverUrl'),
    createdAt: source.updatedAt,
    sourceRef,
    sourceKind: source.sourceKind,
    ownership: source.ownership,
    relation: {
      state: readString(relation, 'state') === 'connected'
        ? 'connected'
        : readString(relation, 'state') === 'unavailable'
          ? 'unavailable'
          : 'connectable',
      connectionId: readString(relation, 'connectionId'),
      runtimeSourceRef: readString(relation, 'runtimeSourceRef'),
    },
    display: {
      role: source.role ?? null,
      tags: Array.isArray(source.tags)
        ? source.tags.filter((item): item is string => typeof item === 'string')
        : [],
      ownership: source.ownership,
      sourceKind: source.sourceKind,
      worldName: source.worldName,
    },
    stats: null,
    importance: source.sourceKind === 'worldCharacter' ? 'PRIMARY' : 'SECONDARY',
  };
}

function buildWorldPublicHistoryItems(world: CoreRecord): WorldHistoryPayload {
  return {
    items: readArray<string>(world, 'timeline').map((item, index) => ({
      id: `world-timeline-${index + 1}`,
      eventId: `world-timeline-${index + 1}`,
      sequence: index + 1,
      title: item,
      summary: item,
      time: readString(asRecord(world.time), 'currentWorldTime') ?? world.updatedAt,
      eventType: 'worldSetting',
    })),
  };
}

function buildWorldPublicSemanticBundle(world: CoreRecord): WorldSemanticBundle {
  return {
    title: readString(world, 'name'),
    description: readString(world, 'summary', 'description'),
    operation: {
      title: readString(world, 'name'),
      description: readString(world, 'summary', 'description'),
      rules: readArray<string>(world, 'rules').map((rule, index) => ({
        key: `rule-${index + 1}`,
        title: rule,
        value: rule,
      })),
    },
    coreSystem: {
      powerSystems: readArray<string>(world, 'systems').map((system, index) => ({
        name: system,
        description: system,
        levels: [],
        rules: [],
        id: `system-${index + 1}`,
      })),
      levels: [],
      taboos: [],
    },
    worldviewEvents: readArray<string>(world, 'timeline').map((event, index) => ({
      id: `worldview-event-${index + 1}`,
      title: event,
      summary: event,
      eventType: 'worldSetting',
      createdAt: readString(world, 'updatedAt'),
    })),
    worldviewSnapshots: [],
    timeModel: world.time,
  };
}

function buildWorldPublicAssets(world: CoreRecord): WorldAssetListPayload {
  const media = asRecord(world.media);
  const externalRefs = [
    ['icon', readString(media, 'iconUrl')],
    ['banner', readString(media, 'bannerUrl')],
    ['hero', readString(media, 'heroUrl')],
    ...readArray<string>(media, 'highlightUrls').map((url, index) => [`highlight-${index + 1}`, url] as const),
  ].flatMap(([kind, uri]) => uri ? [{ refId: `world-media-${kind}`, kind, uri }] : []);
  return {
    resourceRefs: [],
    externalRefs,
    intents: [],
  };
}

function buildWorldPublicScenes(world: CoreRecord): WorldSceneListPayload {
  return {
    items: readArray<string>(world, 'scenes').map((scene, index) => ({
      sceneId: `world-scene-${index + 1}`,
      name: scene,
      summary: scene,
      entityRefs: [],
    })),
  };
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
      (realm) => realm.worldPublic.worldPublicControllerGetWorld({ path: { worldId: 'OASIS' } }).then((row) =>
        projectWorldPublicDetail(requireWorldPublicDetailDto(row, 'OASIS')),
      ),
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
          ...world,
          characterCount,
          personaCount,
          characters,
        };
      },
      'Failed to load world detail with characters',
    );
    if (detail) {
      await (await getOfflineCacheManager()).syncWorldMetadata(cacheKey, detail);
    }
    return detail;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const cached = await (await getOfflineCacheManager()).getCachedWorldMetadata<WorldDetailWithCharactersDto>(cacheKey);
      if (cached) {
        getOfflineCoordinator().markCacheFallbackUsed();
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

export const realmWorldData = {
  loadWorlds: (status?: NimiRealmWorldStatus) =>
    loadWorldList(callRealmApi, emitRealmDataError, status),
  loadWorldDetailById: (worldId: string) =>
    loadWorldDetailById(callRealmApi, emitRealmDataError, worldId),
  loadWorldSemanticBundle: (worldId: string) =>
    loadWorldSemanticBundle(callRealmApi, emitRealmDataError, worldId),
  loadMainWorld: () =>
    loadMainWorld(callRealmApi, emitRealmDataError),
  loadWorldCharacters: (worldId: string) =>
    loadWorldCharacters(callRealmApi, emitRealmDataError, worldId),
  loadWorldDetailWithCharacters: (worldId: string, recommendedCharacterLimit?: number) =>
    loadWorldDetailWithCharacters(callRealmApi, emitRealmDataError, worldId, recommendedCharacterLimit),
  loadWorldHistory: (worldId: string) =>
    loadWorldHistory(callRealmApi, emitRealmDataError, worldId),
  loadWorldAssets: (worldId: string) =>
    loadWorldAssets(callRealmApi, emitRealmDataError, worldId),
  loadWorldScenes: (worldId: string) =>
    loadWorldScenes(callRealmApi, emitRealmDataError, worldId),
};
