import type { Realm, NimiRealmCoreSourceRef } from '@nimiplatform/sdk/realm';
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
  sourceRef: NimiRealmCoreSourceRef;
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

function requireNumberField(record: CoreRecord, field: string, reasonCode: string, message: string): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    failRealmWorldContract(reasonCode, message);
  }
  return value;
}

function requireBooleanField(record: CoreRecord, field: string, reasonCode: string, message: string): boolean {
  const value = record[field];
  if (typeof value !== 'boolean') {
    failRealmWorldContract(reasonCode, message);
  }
  return value;
}

function requireArrayField(record: CoreRecord, field: string, reasonCode: string, message: string): unknown[] {
  const value = record[field];
  if (!Array.isArray(value)) {
    failRealmWorldContract(reasonCode, message);
  }
  return value;
}

function requireCoreSection(core: CoreRecord, section: string, reasonCode: string, family: string): CoreRecord {
  return requireRecord(
    core[section],
    reasonCode,
    `${family} core is missing ${section} section`,
  );
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
  requireStringField(
    record,
    'contentHash',
    'SDK_REALM_WORLD_CORE_CONTRACT_INVALID',
    'WorldCore payload is missing contentHash',
  );
  requireNumberField(
    record,
    'contentRevision',
    'SDK_REALM_WORLD_CORE_CONTRACT_INVALID',
    'WorldCore payload is missing numeric contentRevision',
  );
  requireStringField(
    record,
    'schemaVersion',
    'SDK_REALM_WORLD_CORE_CONTRACT_INVALID',
    'WorldCore payload is missing schemaVersion',
  );
  requireStringField(
    record,
    'createdAt',
    'SDK_REALM_WORLD_CORE_CONTRACT_INVALID',
    'WorldCore payload is missing createdAt',
  );
  requireStringField(
    record,
    'updatedAt',
    'SDK_REALM_WORLD_CORE_CONTRACT_INVALID',
    'WorldCore payload is missing updatedAt',
  );
  const visibility = requireStringField(
    record,
    'visibility',
    'SDK_REALM_WORLD_CORE_CONTRACT_INVALID',
    'WorldCore payload is missing visibility',
  );
  if (!['private', 'unlisted', 'public', 'system'].includes(visibility)) {
    failRealmWorldContract(
      'SDK_REALM_WORLD_CORE_CONTRACT_INVALID',
      `WorldCore payload has invalid visibility ${visibility}`,
    );
  }
  const origin = requireRecord(
    record.origin,
    'SDK_REALM_WORLD_CORE_CONTRACT_INVALID',
    'WorldCore payload is missing origin object',
  );
  requireStringField(
    origin,
    'kind',
    'SDK_REALM_WORLD_CORE_CONTRACT_INVALID',
    'WorldCore origin is missing kind',
  );
  const core = requireRecord(
    record.core,
    'SDK_REALM_WORLD_CORE_CONTRACT_INVALID',
    'WorldCore payload is missing core object',
  );
  const identity = requireCoreSection(core, 'identity', 'SDK_REALM_WORLD_CORE_CONTRACT_INVALID', 'WorldCore');
  requireStringField(identity, 'name', 'SDK_REALM_WORLD_CORE_CONTRACT_INVALID', 'WorldCore identity is missing name');
  requireStringField(identity, 'summary', 'SDK_REALM_WORLD_CORE_CONTRACT_INVALID', 'WorldCore identity is missing summary');
  requireCoreSection(core, 'presentation', 'SDK_REALM_WORLD_CORE_CONTRACT_INVALID', 'WorldCore');
  const ontology = requireCoreSection(core, 'ontology', 'SDK_REALM_WORLD_CORE_CONTRACT_INVALID', 'WorldCore');
  requireArrayField(ontology, 'entityKinds', 'SDK_REALM_WORLD_CORE_CONTRACT_INVALID', 'WorldCore ontology is missing entityKinds');
  const timeModel = requireCoreSection(core, 'timeModel', 'SDK_REALM_WORLD_CORE_CONTRACT_INVALID', 'WorldCore');
  requireStringField(timeModel, 'mode', 'SDK_REALM_WORLD_CORE_CONTRACT_INVALID', 'WorldCore timeModel is missing mode');
  requireNumberField(timeModel, 'flowRatio', 'SDK_REALM_WORLD_CORE_CONTRACT_INVALID', 'WorldCore timeModel is missing flowRatio');
  requireBooleanField(timeModel, 'isPaused', 'SDK_REALM_WORLD_CORE_CONTRACT_INVALID', 'WorldCore timeModel is missing isPaused');
  const timeline = requireCoreSection(core, 'timeline', 'SDK_REALM_WORLD_CORE_CONTRACT_INVALID', 'WorldCore');
  requireArrayField(timeline, 'events', 'SDK_REALM_WORLD_CORE_CONTRACT_INVALID', 'WorldCore timeline is missing events');
  for (const section of ['entities', 'relationships', 'systems', 'scenes']) {
    requireArrayField(core, section, 'SDK_REALM_WORLD_CORE_CONTRACT_INVALID', `WorldCore core is missing ${section} array`);
  }
  requireCoreSection(core, 'assets', 'SDK_REALM_WORLD_CORE_CONTRACT_INVALID', 'WorldCore');
  requireCoreSection(core, 'authoring', 'SDK_REALM_WORLD_CORE_CONTRACT_INVALID', 'WorldCore');
  return value as WorldCoreDto;
}

function requireWorldCharacterCoreDto(value: unknown, expectedWorldId?: string): WorldCharacterCoreDto {
  const record = requireRecord(
    value,
    'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID',
    'WorldCharacterCore payload must be an object',
  );
  const id = requireStringField(
    record,
    'id',
    'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID',
    'WorldCharacterCore payload is missing id',
  );
  const worldId = requireStringField(
    record,
    'worldId',
    'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID',
    `WorldCharacterCore ${id} payload is missing worldId`,
  );
  if (expectedWorldId && worldId !== expectedWorldId) {
    failRealmWorldContract(
      'SDK_REALM_WORLD_CHARACTER_CORE_WORLD_MISMATCH',
      `WorldCharacterCore ${id} worldId ${worldId} does not match requested world ${expectedWorldId}`,
    );
  }
  requireStringField(
    record,
    'contentHash',
    'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID',
    `WorldCharacterCore ${id} payload is missing contentHash`,
  );
  requireNumberField(
    record,
    'contentRevision',
    'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID',
    `WorldCharacterCore ${id} payload is missing numeric contentRevision`,
  );
  requireStringField(
    record,
    'schemaVersion',
    'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID',
    `WorldCharacterCore ${id} payload is missing schemaVersion`,
  );
  requireStringField(
    record,
    'createdAt',
    'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID',
    `WorldCharacterCore ${id} payload is missing createdAt`,
  );
  requireStringField(
    record,
    'updatedAt',
    'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID',
    `WorldCharacterCore ${id} payload is missing updatedAt`,
  );
  const origin = requireRecord(
    record.origin,
    'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID',
    `WorldCharacterCore ${id} payload is missing origin object`,
  );
  requireStringField(
    origin,
    'kind',
    'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID',
    `WorldCharacterCore ${id} origin is missing kind`,
  );
  const core = requireRecord(
    record.core,
    'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID',
    'WorldCharacterCore payload is missing core object',
  );
  const identity = requireCoreSection(core, 'identity', 'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID', `WorldCharacterCore ${id}`);
  requireStringField(identity, 'name', 'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID', `WorldCharacterCore ${id} identity is missing name`);
  requireStringField(identity, 'summary', 'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID', `WorldCharacterCore ${id} identity is missing summary`);
  const presentation = requireCoreSection(core, 'presentation', 'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID', `WorldCharacterCore ${id}`);
  requireStringField(presentation, 'displayName', 'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID', `WorldCharacterCore ${id} presentation is missing displayName`);
  requireStringField(presentation, 'shortBio', 'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID', `WorldCharacterCore ${id} presentation is missing shortBio`);
  const placement = requireCoreSection(core, 'placement', 'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID', `WorldCharacterCore ${id}`);
  const placementWorldId = requireStringField(placement, 'worldId', 'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID', `WorldCharacterCore ${id} placement is missing worldId`);
  if (placementWorldId !== worldId) {
    failRealmWorldContract(
      'SDK_REALM_WORLD_CHARACTER_CORE_WORLD_MISMATCH',
      `WorldCharacterCore ${id} placement.worldId ${placementWorldId} does not match payload worldId ${worldId}`,
    );
  }
  requireArrayField(placement, 'sceneRefs', 'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID', `WorldCharacterCore ${id} placement is missing sceneRefs`);
  for (const section of ['biography', 'psychology', 'knowledge', 'capabilities', 'interactionProfile', 'assets', 'authoring']) {
    requireCoreSection(core, section, 'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID', `WorldCharacterCore ${id}`);
  }
  requireArrayField(core, 'relationships', 'SDK_REALM_WORLD_CHARACTER_CORE_CONTRACT_INVALID', `WorldCharacterCore ${id} core is missing relationships array`);
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

function readExternalAssetUri(payload: CoreRecord, ...kinds: string[]): string | null {
  const assets = asRecord(payload.assets);
  const refs = readArray<CoreRecord>(assets, 'externalRefs');
  for (const ref of refs) {
    const kind = readString(asRecord(ref), 'kind');
    if (kind && kinds.includes(kind)) {
      const uri = readString(asRecord(ref), 'uri');
      if (uri) return uri;
    }
  }
  return null;
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

function resolveWorldStatus(_core: WorldCoreDto, _payload: CoreRecord): 'ACTIVE' {
  // WorldCore.visibility is an access scope, not an authoring lifecycle state.
  // Lifecycle/readiness belongs to source read models, not canonical WorldCoreV1.
  return 'ACTIVE';
}

function countWorldCharacterEntities(payload: CoreRecord): number {
  return readArray<CoreRecord>(payload, 'entities').filter((entry) => {
    const kind = readString(asRecord(entry), 'kind', 'entityKind', 'type');
    return kind === 'worldCharacter' || normalizeCoreEnum(kind) === 'WORLD_CHARACTER';
  }).length;
}

function buildWorldComputed(payload: CoreRecord, characterCount: number): CoreRecord {
  const timeModel = asRecord(payload.timeModel);

  return {
    time: {
      currentWorldTime: readString(timeModel, 'currentWorldTime', 'currentTime') ?? null,
      currentLabel: readString(timeModel, 'currentLabel', 'currentTimeLabel') ?? null,
      eraLabel: readString(timeModel, 'eraLabel', 'era') ?? null,
      flowRatio: readNumber(timeModel, 'flowRatio') ?? 1,
      isPaused: readBoolean(timeModel, 'isPaused') ?? false,
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
    featuredCharacterCount: characterCount,
  };
}

function projectWorldCore(core: WorldCoreDto): WorldDetailDto {
  const payload = asRecord(core.core);
  const identity = asRecord(payload.identity);
  const presentation = asRecord(payload.presentation);
  const timeModel = asRecord(payload.timeModel);
  const characterCount = countWorldCharacterEntities(payload);
  const worldType = resolveWorldType(core, payload);
  return {
    ...core,
    id: core.id,
    name: readString(presentation, 'displayName', 'title')
      ?? requireStringField(identity, 'name', 'SDK_REALM_WORLD_CORE_CONTRACT_INVALID', `WorldCore ${core.id} identity is missing name`),
    description: readString(identity, 'summary')
      ?? requireStringField(identity, 'summary', 'SDK_REALM_WORLD_CORE_CONTRACT_INVALID', `WorldCore ${core.id} identity is missing summary`),
    tagline: readString(presentation, 'tagline')
      ?? readString(identity, 'tagline')
      ?? null,
    motto: null,
    overview: null,
    contentRating: null,
    genre: readString(identity, 'genre'),
    themes: readArray<string>(identity, 'themes').filter((item) => typeof item === 'string'),
    era: readString(identity, 'era') ?? readString(timeModel, 'era', 'eraLabel') ?? null,
    iconUrl: readString(presentation, 'iconResourceRef') ?? readExternalAssetUri(payload, 'icon') ?? null,
    bannerUrl: readString(presentation, 'bannerResourceRef') ?? readExternalAssetUri(payload, 'banner') ?? null,
    type: worldType,
    status: resolveWorldStatus(core, payload),
    level: 1,
    levelUpdatedAt: null,
    characterCount,
    createdAt: core.createdAt,
    updatedAt: core.updatedAt,
    creatorId: core.creatorId ?? null,
    freezeReason: null,
    lorebookEntryLimit: 0,
    nativeCharacterLimit: 0,
    nativeCreationState: 'OPEN',
    scoreA: 0,
    scoreC: 0,
    scoreE: 0,
    scoreEwma: 0,
    scoreQ: 0,
    transitInLimit: 0,
    computed: buildWorldComputed(payload, characterCount),
    core: payload,
  };
}

function projectWorldCharacter(character: WorldCharacterCoreDto): WorldCharacterSummaryDto {
  const payload = asRecord(character.core);
  const identity = asRecord(payload.identity);
  const presentation = asRecord(payload.presentation);
  const placement = asRecord(payload.placement);
  const stats = asRecord(payload.stats);
  const sourceRef: NimiRealmCoreSourceRef = {
    kind: 'worldCharacter',
    worldId: character.worldId,
    sourceId: character.id,
    sourceContentHash: character.contentHash,
  };
  return {
    id: character.id,
    name: readString(presentation, 'displayName')
      ?? readString(identity, 'name')
      ?? character.id,
    handle: null,
    bio: readString(presentation, 'shortBio')
      ?? readString(identity, 'summary')
      ?? null,
    avatarUrl: readString(presentation, 'avatarResourceRef')
      ?? readExternalAssetUri(payload, 'avatar', 'referenceImage'),
    createdAt: character.createdAt,
    sourceRef,
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
  return rows.map((row) => projectWorldCharacter(requireWorldCharacterCoreDto(row, worldId)));
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
        items: readNestedArray<WorldLevelAuditEventDto>(asRecord(world?.core), 'timeline', 'events'),
      })),
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
      (realm) => getWorldCore(realm, worldId).then((world) => {
        const assets = asRecord(asRecord(world?.core).assets);
        return {
          resourceRefs: readArray<CoreRecord>(assets, 'resourceRefs'),
          externalRefs: readArray<CoreRecord>(assets, 'externalRefs'),
          intents: readArray<CoreRecord>(assets, 'intents'),
        };
      }),
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
      (realm) => getWorldCore(realm, worldId).then((world) => asRecord(world?.core)),
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
