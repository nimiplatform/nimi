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
type WorldDetailWithCharactersDto = WorldDetailDto & { characters: WorldCharacterSummaryDto[] };
type WorldCharacterSummaryDto = {
  id: string;
  name: string;
  handle?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  createdAt?: string;
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

function requireWorldCoreDto(value: unknown, expectedWorldId?: string): WorldCoreDto {
  const record = requireRecord(
    value,
    'SDK_REALM_WORLD_CORE_CONTRACT_INVALID',
    'WorldCore payload must be an object',
  );
  const id = requireStringField(
    record,
    'id',
    'SDK_REALM_WORLD_CORE_CONTRACT_INVALID',
    'WorldCore payload is missing id',
  );
  if (expectedWorldId && id !== expectedWorldId) {
    failRealmWorldContract(
      'SDK_REALM_WORLD_CORE_ID_MISMATCH',
      `WorldCore payload id ${id} does not match requested world ${expectedWorldId}`,
    );
  }
  requireRecord(
    record.core,
    'SDK_REALM_WORLD_CORE_CONTRACT_INVALID',
    'WorldCore payload is missing core object',
  );
  return value as WorldCoreDto;
}

function requireWorldCharacterCoreDto(value: unknown): WorldCharacterCoreDto {
  const record = requireRecord(
    value,
    'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID',
    'WorldCharacterCore payload must be an object',
  );
  requireStringField(
    record,
    'id',
    'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID',
    'WorldCharacterCore payload is missing id',
  );
  requireRecord(
    record.core,
    'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID',
    'WorldCharacterCore payload is missing core object',
  );
  return value as WorldCharacterCoreDto;
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

function readNestedArray<T = unknown>(record: CoreRecord, key: string, nestedKey: string): T[] {
  return readArray<T>(asRecord(record[key]), nestedKey);
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

function normalizeCoreEnum(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.trim().replace(/[-\s]+/g, '_').toUpperCase()
    : null;
}

function resolveWorldType(core: WorldCoreDto, payload: CoreRecord): 'OASIS' | 'CREATOR' {
  const identity = asRecord(payload.identity);
  const origin = asRecord(core.origin);
  const candidates = [
    core.id,
    core.visibility,
    origin.kind,
    readString(identity, 'worldType', 'type'),
    readString(payload, 'worldType', 'type'),
  ].map(normalizeCoreEnum);
  return candidates.some((candidate) => candidate === 'OASIS' || candidate === 'SYSTEM' || candidate === 'SYSTEM_DEFAULT')
    ? 'OASIS'
    : 'CREATOR';
}

function resolveWorldStatus(core: WorldCoreDto, payload: CoreRecord): 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' | 'DRAFT' | 'PENDING_REVIEW' {
  const lifecycle = asRecord(payload.lifecycle);
  const explicit = normalizeCoreEnum(readString(lifecycle, 'status') ?? readString(payload, 'status'));
  if (
    explicit === 'ACTIVE'
    || explicit === 'SUSPENDED'
    || explicit === 'ARCHIVED'
    || explicit === 'DRAFT'
    || explicit === 'PENDING_REVIEW'
  ) {
    return explicit;
  }
  // WorldCore.visibility is an access scope, not an authoring lifecycle state.
  // A readable WorldCore is active unless its core.lifecycle explicitly says otherwise.
  return 'ACTIVE';
}

function countWorldCharacterEntities(payload: CoreRecord): number {
  return readArray<CoreRecord>(payload, 'entities').filter((entry) => {
    const kind = readString(asRecord(entry), 'kind', 'entityKind', 'type');
    return kind === 'worldCharacter' || normalizeCoreEnum(kind) === 'WORLD_CHARACTER';
  }).length;
}

function buildWorldComputed(payload: CoreRecord, characterCount: number): CoreRecord {
  const existing = asRecord(payload.computed);
  const existingTime = asRecord(existing.time);
  const timeModel = asRecord(payload.timeModel);
  const existingLanguages = asRecord(existing.languages);
  const languages = asRecord(payload.languages);
  const existingEntry = asRecord(existing.entry);
  const existingScore = asRecord(existing.score);
  const score = asRecord(payload.score);

  return {
    ...existing,
    time: {
      ...existingTime,
      currentWorldTime: readString(existingTime, 'currentWorldTime') ?? readString(timeModel, 'currentWorldTime', 'currentTime') ?? null,
      currentLabel: readString(existingTime, 'currentLabel') ?? readString(timeModel, 'currentLabel', 'currentTimeLabel') ?? null,
      eraLabel: readString(existingTime, 'eraLabel') ?? readString(timeModel, 'eraLabel', 'era') ?? null,
      flowRatio: readNumber(existingTime, 'flowRatio') ?? readNumber(timeModel, 'flowRatio') ?? 1,
      isPaused: readBoolean(existingTime, 'isPaused') ?? readBoolean(timeModel, 'isPaused') ?? false,
    },
    languages: {
      ...existingLanguages,
      primary: readString(existingLanguages, 'primary') ?? readString(languages, 'primary') ?? null,
      common: readArray<string>(existingLanguages, 'common').length
        ? readArray<string>(existingLanguages, 'common')
        : readArray<string>(languages, 'common'),
    },
    entry: {
      ...existingEntry,
      recommendedCharacters: readArray(existingEntry, 'recommendedCharacters'),
    },
    score: {
      ...existingScore,
      scoreEwma: readNumber(existingScore, 'scoreEwma') ?? readNumber(score, 'scoreEwma') ?? 0,
    },
    featuredCharacterCount: readNumber(existing, 'featuredCharacterCount') ?? characterCount,
  };
}

function projectWorldCore(core: WorldCoreDto): WorldDetailDto {
  const payload = asRecord(core.core);
  const identity = asRecord(payload.identity);
  const presentation = asRecord(payload.presentation);
  const timeModel = asRecord(payload.timeModel);
  const characterCount = readNumber(payload, 'characterCount') ?? countWorldCharacterEntities(payload);
  const worldType = resolveWorldType(core, payload);
  return {
    ...core,
    ...payload,
    id: core.id,
    name: readString(identity, 'name', 'title', 'displayName')
      ?? readString(presentation, 'title', 'displayName', 'name')
      ?? readString(payload, 'name', 'title', 'displayName')
      ?? core.id,
    description: readString(identity, 'summary', 'description')
      ?? readString(presentation, 'summary', 'description', 'tagline')
      ?? readString(payload, 'description', 'summary')
      ?? null,
    tagline: readString(presentation, 'tagline', 'profileLine')
      ?? readString(identity, 'tagline')
      ?? readString(payload, 'tagline')
      ?? null,
    motto: readString(payload, 'motto') ?? null,
    overview: readString(payload, 'overview') ?? null,
    contentRating: readString(payload, 'contentRating', 'content_rating') ?? null,
    genre: readString(payload, 'genre') ?? null,
    themes: readArray<string>(payload, 'themes').filter((item) => typeof item === 'string'),
    era: readString(payload, 'era') ?? readString(timeModel, 'era', 'eraLabel') ?? null,
    iconUrl: readString(presentation, 'iconUrl', 'icon_url') ?? readString(payload, 'iconUrl', 'icon_url') ?? null,
    bannerUrl: readString(presentation, 'bannerUrl', 'banner_url') ?? readString(payload, 'bannerUrl', 'banner_url') ?? null,
    type: worldType,
    status: resolveWorldStatus(core, payload),
    level: readNumber(payload, 'level') ?? 1,
    levelUpdatedAt: readString(payload, 'levelUpdatedAt', 'level_updated_at') ?? null,
    characterCount,
    createdAt: core.createdAt,
    updatedAt: core.updatedAt,
    creatorId: core.creatorId ?? null,
    freezeReason: readString(payload, 'freezeReason', 'freeze_reason') ?? null,
    lorebookEntryLimit: readNumber(payload, 'lorebookEntryLimit') ?? 0,
    nativeCharacterLimit: readNumber(payload, 'nativeCharacterLimit', 'nativeCharacterLimit') ?? 0,
    nativeCreationState: readString(payload, 'nativeCreationState') ?? 'OPEN',
    scoreA: readNumber(payload, 'scoreA') ?? 0,
    scoreC: readNumber(payload, 'scoreC') ?? 0,
    scoreE: readNumber(payload, 'scoreE') ?? 0,
    scoreEwma: readNumber(payload, 'scoreEwma') ?? 0,
    scoreQ: readNumber(payload, 'scoreQ') ?? 0,
    transitInLimit: readNumber(payload, 'transitInLimit') ?? 0,
    computed: buildWorldComputed(payload, characterCount),
  };
}

function projectWorldCharacter(character: WorldCharacterCoreDto): WorldCharacterSummaryDto {
  const payload = asRecord(character.core);
  const identity = asRecord(payload.identity);
  const presentation = asRecord(payload.presentation);
  const placement = asRecord(payload.placement);
  const stats = asRecord(payload.stats);
  return {
    id: character.id,
    name: readString(identity, 'name', 'displayName', 'title')
      ?? readString(presentation, 'displayName', 'name', 'title')
      ?? readString(payload, 'name', 'displayName', 'title')
      ?? character.id,
    handle: readString(identity, 'handle') ?? readString(presentation, 'handle') ?? readString(payload, 'handle'),
    bio: readString(identity, 'summary', 'description')
      ?? readString(presentation, 'shortBio', 'profileLine', 'bio', 'description')
      ?? readString(payload, 'bio', 'description')
      ?? null,
    avatarUrl: readString(presentation, 'avatarUrl', 'avatar_url', 'portraitUrl', 'portrait_url')
      ?? readString(payload, 'avatarUrl', 'avatar_url', 'portraitUrl', 'portrait_url'),
    createdAt: character.createdAt,
    display: {
      role: readString(presentation, 'role') ?? null,
      faction: readString(presentation, 'faction') ?? null,
      rank: readString(presentation, 'rank') ?? null,
      sceneName: readString(placement, 'sceneName') ?? null,
      location: readString(placement, 'location') ?? null,
    },
    stats: Object.keys(stats).length > 0 ? stats : null,
    importance: readString(presentation, 'importance') ?? null,
  };
}

async function listWorldCores(realm: Realm, status?: NimiRealmWorldStatus): Promise<WorldDetailDto[]> {
  const worlds = await realm.worldCore.worldCoreControllerListWorldCores({
    path: {},
    query: status ? { visibility: status } : {},
  });
  if (!Array.isArray(worlds)) {
    failRealmWorldContract(
      'SDK_REALM_WORLD_CORE_LIST_CONTRACT_INVALID',
      'WorldCore list payload must be an array',
    );
  }
  return worlds.map((world) => projectWorldCore(requireWorldCoreDto(world)));
}

async function getWorldCore(realm: Realm, worldId: string): Promise<WorldDetailDto | null> {
  if (!worldId) return null;
  const world = await realm.worldCore.worldCoreControllerGetWorldCore({
    path: { worldId },
  });
  return projectWorldCore(requireWorldCoreDto(world, worldId));
}

async function listWorldCharacters(realm: Realm, worldId: string): Promise<WorldCharacterSummaryDto[]> {
  const rows = await realm.worldCore.worldCoreControllerListWorldCharacters({
    path: { worldId },
    query: {},
  });
  if (!Array.isArray(rows)) {
    failRealmWorldContract(
      'SDK_REALM_WORLD_CHARACTER_CORE_LIST_CONTRACT_INVALID',
      'WorldCharacterCore list payload must be an array',
    );
  }
  return rows.map((row) => projectWorldCharacter(requireWorldCharacterCoreDto(row)));
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
      (realm) => realm.worldCore.worldCoreControllerGetOasisWorld({ path: {} }).then((row) =>
        projectWorldCore(requireWorldCoreDto(row, 'OASIS')),
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
        items: readArray<WorldLevelAuditEventDto>(asRecord(world?.core), 'history').length
          ? readArray<WorldLevelAuditEventDto>(asRecord(world?.core), 'history')
          : readNestedArray<WorldLevelAuditEventDto>(asRecord(world?.core), 'timeline', 'events'),
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
        const world = await getWorldCore(realm, normalizedWorldId);
        if (!world) return null;
        const characters = await listWorldCharacters(realm, normalizedWorldId);
        const fullCharacterCount = Math.max(
          readNumber(asRecord(world), 'characterCount') ?? 0,
          characters.length,
        );
        return {
          ...world,
          characterCount: fullCharacterCount,
          characters: typeof recommendedCharacterLimit === 'number'
            ? characters.slice(0, Math.max(0, Math.floor(recommendedCharacterLimit)))
            : characters,
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
      (realm) => getWorldCore(realm, worldId).then((world) => asRecord(asRecord(world?.core).semanticBundle ?? world?.core)),
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
  loadWorldLevelAudits: (worldId: string, limit = 20) =>
    loadWorldLevelAudits(callRealmApi, emitRealmDataError, worldId, limit),
  loadWorldCharacters: (worldId: string) =>
    loadWorldCharacters(callRealmApi, emitRealmDataError, worldId),
  loadWorldDetailWithCharacters: (worldId: string, recommendedCharacterLimit?: number) =>
    loadWorldDetailWithCharacters(callRealmApi, emitRealmDataError, worldId, recommendedCharacterLimit),
  loadWorldHistory: (worldId: string) =>
    loadWorldHistory(callRealmApi, emitRealmDataError, worldId),
  loadWorldLorebooks: (worldId: string) =>
    loadWorldLorebooks(callRealmApi, emitRealmDataError, worldId),
  loadWorldBindings: (worldId: string) =>
    loadWorldBindings(callRealmApi, emitRealmDataError, worldId),
  loadWorldScenes: (worldId: string) =>
    loadWorldScenes(callRealmApi, emitRealmDataError, worldId),
};
