import {
  readCharacterSourceRefV3,
  type CharacterSourceRefV3,
} from '../../realm-source/realm-source-identity.js';
import type { RealmModel } from '@nimiplatform/sdk/realm/generated';

export type WorldPublicItemDto = RealmModel<'WorldPublicItemDto'>;
export type WorldPublicDetailDto = RealmModel<'WorldPublicDetailDto'>;
export type WorldPublicDetailWithCharactersDto = RealmModel<'WorldPublicDetailWithCharactersDto'>;
export type WorldPublicAssetDto = RealmModel<'WorldPublicAssetDto'>;
export type WorldPublicSceneDto = RealmModel<'WorldPublicSceneDto'>;
export type WorldPublicSourceCardDto = RealmModel<'WorldPublicSourceCardDto'>;

export type CoreRecord = Record<string, unknown>;
export type WorldDetailDto = CoreRecord;
export type WorldLevelAuditEventDto = CoreRecord;
export type WorldDetailWithCharactersDto = WorldDetailDto & { characters: WorldCharacterSummaryDto[] };
export type WorldCharacterSummaryDto = {
  id: string;
  name: string;
  handle?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  portraitUrl?: string | null;
  profileCoverUrl?: string | null;
  referenceImageUrl?: string | null;
  voiceSampleUrl?: string | null;
  mediaAssets?: {
    avatar?: WorldPublicAssetDto | null;
    portrait?: WorldPublicAssetDto | null;
    profileCover?: WorldPublicAssetDto | null;
    referenceImage?: WorldPublicAssetDto | null;
    voiceSample?: WorldPublicAssetDto | null;
  } | null;
  createdAt?: string;
  sourceRef: CharacterSourceRefV3;
  sourceKind?: CharacterSourceRefV3['kind'];
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

export function asRecord(value: unknown): CoreRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as CoreRecord
    : {};
}

export function failRealmWorldContract(reasonCode: string, message: string): never {
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

export function readString(record: CoreRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readPublicUrlValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return /^https?:\/\//i.test(normalized) ? normalized : null;
}

function readPublicUrl(record: CoreRecord, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = readPublicUrlValue(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

export function readNumber(record: CoreRecord, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

export function readArray<T = unknown>(record: CoreRecord, key: string): T[] {
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

function readPublicAssetDto(value: unknown): WorldPublicAssetDto | null {
  const record = asRecord(value);
  const id = readString(record, 'id');
  const kind = readString(record, 'kind');
  const url = readPublicUrl(record, 'url');
  if (!id || !kind || !url) {
    return null;
  }
  return {
    ...(record as unknown as WorldPublicAssetDto),
    id,
    kind: kind as WorldPublicAssetDto['kind'],
    url,
  };
}

function readPublicAssetFromRecord(record: CoreRecord, key: string): WorldPublicAssetDto | null {
  return readPublicAssetDto(record[key]);
}

function requirePublicAssetDto(value: unknown, context: string): WorldPublicAssetDto {
  const asset = readPublicAssetDto(value);
  if (!asset) {
    failRealmWorldContract(
      'SDK_REALM_WORLD_PUBLIC_SCENE_CONTRACT_INVALID',
      `${context} must be a public asset with id, kind, and url`,
    );
  }
  return asset;
}

function projectWorldPublicEntityCard(value: unknown, context: string): CoreRecord {
  const record = requireRecord(
    value,
    'SDK_REALM_WORLD_PUBLIC_SCENE_CONTRACT_INVALID',
    `${context} must be an object`,
  );
  const id = requireStringField(
    record,
    'id',
    'SDK_REALM_WORLD_PUBLIC_SCENE_CONTRACT_INVALID',
    `${context} is missing id`,
  );
  const kind = requireStringField(
    record,
    'kind',
    'SDK_REALM_WORLD_PUBLIC_SCENE_CONTRACT_INVALID',
    `${context} is missing kind`,
  );
  return {
    ...record,
    id,
    kind,
    label: readString(record, 'label'),
    summary: readString(record, 'summary'),
  };
}

function projectWorldPublicScene(value: unknown, index: number): CoreRecord {
  const context = `World public scene ${index + 1}`;
  const record = requireRecord(
    value,
    'SDK_REALM_WORLD_PUBLIC_SCENE_CONTRACT_INVALID',
    `${context} must be an object`,
  );
  const sceneId = requireStringField(
    record,
    'sceneId',
    'SDK_REALM_WORLD_PUBLIC_SCENE_CONTRACT_INVALID',
    `${context} is missing sceneId`,
  );
  const name = requireStringField(
    record,
    'name',
    'SDK_REALM_WORLD_PUBLIC_SCENE_CONTRACT_INVALID',
    `${context} ${sceneId} is missing name`,
  );
  const summary = requireStringField(
    record,
    'summary',
    'SDK_REALM_WORLD_PUBLIC_SCENE_CONTRACT_INVALID',
    `${context} ${sceneId} is missing summary`,
  );
  return {
    ...record,
    sceneId,
    name,
    summary,
    media: requireArrayField(
      record,
      'media',
      'SDK_REALM_WORLD_PUBLIC_SCENE_CONTRACT_INVALID',
      `${context} ${sceneId} is missing media`,
    ).map((asset, assetIndex) => requirePublicAssetDto(asset, `${context} ${sceneId} media ${assetIndex + 1}`)),
    activeEntities: requireArrayField(
      record,
      'activeEntities',
      'SDK_REALM_WORLD_PUBLIC_SCENE_CONTRACT_INVALID',
      `${context} ${sceneId} is missing activeEntities`,
    ).map((entity, entityIndex) => projectWorldPublicEntityCard(entity, `${context} ${sceneId} activeEntities ${entityIndex + 1}`)),
    relatedCharacters: requireArrayField(
      record,
      'relatedCharacters',
      'SDK_REALM_WORLD_PUBLIC_SCENE_CONTRACT_INVALID',
      `${context} ${sceneId} is missing relatedCharacters`,
    ),
    relatedEvents: requireArrayField(
      record,
      'relatedEvents',
      'SDK_REALM_WORLD_PUBLIC_SCENE_CONTRACT_INVALID',
      `${context} ${sceneId} is missing relatedEvents`,
    ),
    relatedResources: requireArrayField(
      record,
      'relatedResources',
      'SDK_REALM_WORLD_PUBLIC_SCENE_CONTRACT_INVALID',
      `${context} ${sceneId} is missing relatedResources`,
    ),
    counts: requireRecord(
      record.counts,
      'SDK_REALM_WORLD_PUBLIC_SCENE_CONTRACT_INVALID',
      `${context} ${sceneId} is missing counts`,
    ),
  };
}

export function requireWorldPublicItemDto(value: unknown, expectedWorldId?: string): WorldPublicItemDto {
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
  requireStringField(record, 'name', 'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID', `World public payload ${id} is missing name`);
  requireStringField(record, 'summary', 'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID', `World public payload ${id} is missing summary`);
  const type = requireStringField(record, 'type', 'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID', `World public payload ${id} is missing type`);
  if (!['OASIS', 'CREATOR'].includes(type)) {
    failRealmWorldContract('SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID', `World public payload ${id} has invalid type ${type}`);
  }
  const visibility = requireStringField(record, 'visibility', 'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID', `World public payload ${id} is missing visibility`);
  if (!['public', 'system'].includes(visibility)) {
    failRealmWorldContract('SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID', `World public payload ${id} has invalid visibility ${visibility}`);
  }
  requireRecord(record.media, 'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID', `World public payload ${id} is missing media`);
  requireRecord(record.stats, 'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID', `World public payload ${id} is missing stats`);
  requireArrayField(record, 'entityKinds', 'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID', `World public payload ${id} is missing entityKinds`);
  requireArrayField(record, 'relationshipTypes', 'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID', `World public payload ${id} is missing relationshipTypes`);
  requireRecord(record.time, 'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID', `World public payload ${id} is missing time`);
  requireStringField(record, 'createdAt', 'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID', `World public payload ${id} is missing createdAt`);
  requireStringField(record, 'updatedAt', 'SDK_REALM_WORLD_PUBLIC_CONTRACT_INVALID', `World public payload ${id} is missing updatedAt`);
  return value as WorldPublicItemDto;
}

export function requireWorldPublicDetailDto(value: unknown, expectedWorldId?: string): WorldPublicDetailDto {
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

export function requireWorldPublicSourceCardDto(value: unknown, expectedWorldId: string): WorldPublicSourceCardDto {
  const record = requireRecord(
    value,
    'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID',
    'World public source card must be an object',
  );
  const id = requireStringField(record, 'id', 'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID', 'World public source card is missing id');
  const worldId = requireStringField(record, 'worldId', 'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID', `World public source ${id} is missing worldId`);
  if (worldId !== expectedWorldId) {
    failRealmWorldContract(
      'SDK_REALM_WORLD_PUBLIC_SOURCE_WORLD_MISMATCH',
      `World public source ${id} worldId ${worldId} does not match requested world ${expectedWorldId}`,
    );
  }
  requireStringField(record, 'displayName', 'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID', `World public source ${id} is missing displayName`);
  requireStringField(record, 'summary', 'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID', `World public source ${id} is missing summary`);
  const sourceKind = requireStringField(record, 'sourceKind', 'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID', `World public source ${id} is missing sourceKind`);
  if (!['worldCharacter', 'personaCharacter'].includes(sourceKind)) {
    failRealmWorldContract('SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID', `World public source ${id} has invalid sourceKind ${sourceKind}`);
  }
  const sourceRef = readCharacterSourceRefV3(record.sourceRef);
  if (!sourceRef) {
    failRealmWorldContract('SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID', `World public source ${id} has invalid CharacterSourceRefV3`);
  }
  if (sourceRef.kind !== sourceKind || sourceRef.worldId !== worldId || sourceRef.id !== id) {
    failRealmWorldContract(
      'SDK_REALM_WORLD_PUBLIC_SOURCE_REF_MISMATCH',
      `World public source ${id} sourceRef must match sourceKind, worldId, and id`,
    );
  }
  requireRecord(record.media, 'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID', `World public source ${id} is missing media`);
  requireRecord(record.relation, 'SDK_REALM_WORLD_PUBLIC_SOURCE_CONTRACT_INVALID', `World public source ${id} is missing relation`);
  return value as WorldPublicSourceCardDto;
}

export function projectWorldPublicItem(world: WorldPublicItemDto): WorldDetailDto {
  const record = world as unknown as CoreRecord;
  const media = asRecord(world.media);
  const mediaAssetsRecord = asRecord(media.assets);
  const iconAsset = readPublicAssetFromRecord(mediaAssetsRecord, 'icon');
  const bannerAsset = readPublicAssetFromRecord(mediaAssetsRecord, 'banner');
  const heroAsset = readPublicAssetFromRecord(mediaAssetsRecord, 'hero');
  const highlightAssets = readArray<unknown>(mediaAssetsRecord, 'highlights')
    .map(readPublicAssetDto)
    .filter((asset): asset is WorldPublicAssetDto => Boolean(asset));
  const stats = asRecord(world.stats);
  const time = asRecord(world.time);
  const tags = Array.isArray(world.tags)
    ? world.tags.filter((item): item is string => typeof item === 'string')
    : [];
  const iconUrl = iconAsset?.url ?? readPublicUrl(media, 'iconUrl');
  const bannerUrl = bannerAsset?.url ?? readPublicUrl(media, 'bannerUrl') ?? heroAsset?.url ?? readPublicUrl(media, 'heroUrl');
  const heroUrl = heroAsset?.url ?? readPublicUrl(media, 'heroUrl');
  const highlightUrls = highlightAssets.length > 0
    ? highlightAssets.map((asset) => asset.url)
    : readArray<string>(media, 'highlightUrls')
      .map(readPublicUrlValue)
      .filter((item): item is string => Boolean(item));
  const projectedMedia = {
    ...media,
    iconUrl,
    bannerUrl,
    heroUrl,
    highlightUrls,
  };
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
    era: readString(record, 'era'),
    entityKinds: readArray<string>(record, 'entityKinds').filter((item) => typeof item === 'string'),
    relationshipTypes: readArray<string>(record, 'relationshipTypes').filter((item) => typeof item === 'string'),
    iconUrl,
    bannerUrl,
    heroUrl,
    highlightUrls,
    status: 'DISCOVERABLE',
    entityCount: readNumber(stats, 'entityCount') ?? 0,
    relationshipCount: readNumber(stats, 'relationshipCount') ?? 0,
    characterCount: readNumber(stats, 'characterCount') ?? 0,
    personaCount: readNumber(stats, 'personaCount') ?? 0,
    sceneCount: readNumber(stats, 'sceneCount') ?? 0,
    systemCount: readNumber(stats, 'systemCount') ?? 0,
    timelineEventCount: readNumber(stats, 'timelineEventCount') ?? 0,
    media: projectedMedia,
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
      languages: { primary: null, common: [] },
      entry: { recommendedCharacters: [] },
      score: { scoreEwma: 0 },
      featuredCharacterCount: readNumber(stats, 'characterCount') ?? 0,
    },
    createdAt: world.createdAt,
    updatedAt: world.updatedAt,
    creatorId: null,
  };
}

export function projectWorldPublicDetail(world: WorldPublicDetailDto): WorldDetailDto {
  const record = world as unknown as CoreRecord;
  return {
    ...projectWorldPublicItem(world),
    rules: readArray<string>(record, 'rules').filter((item) => typeof item === 'string'),
    systems: readArray<string>(record, 'systems').filter((item) => typeof item === 'string'),
    scenes: readArray<unknown>(record, 'scenes').map(projectWorldPublicScene),
    timeline: readArray<unknown>(record, 'timeline').map((item) => (
      typeof item === 'string' ? item : asRecord(item)
    )),
  };
}

export function projectWorldPublicSourceCard(source: WorldPublicSourceCardDto): WorldCharacterSummaryDto {
  const media = asRecord(source.media);
  const mediaAssetsRecord = asRecord(media.assets);
  const avatarAsset = readPublicAssetFromRecord(mediaAssetsRecord, 'avatar');
  const portraitAsset = readPublicAssetFromRecord(mediaAssetsRecord, 'portrait');
  const profileCoverAsset = readPublicAssetFromRecord(mediaAssetsRecord, 'profileCover');
  const referenceImageAsset = readPublicAssetFromRecord(mediaAssetsRecord, 'referenceImage');
  const voiceSampleAsset = readPublicAssetFromRecord(mediaAssetsRecord, 'voiceSample');
  const relation = asRecord(source.relation);
  const sourceRef = readCharacterSourceRefV3(source.sourceRef);
  if (!sourceRef
    || sourceRef.kind !== source.sourceKind
    || sourceRef.worldId !== source.worldId
    || sourceRef.id !== source.id) {
    failRealmWorldContract(
      'SDK_REALM_WORLD_PUBLIC_SOURCE_REF_MISMATCH',
      `World public source ${source.id} requires a matching CharacterSourceRefV3`,
    );
  }
  return {
    id: source.id,
    name: source.displayName,
    handle: source.handle ?? null,
    bio: source.summary,
    avatarUrl:
      avatarAsset?.url ??
      readPublicUrl(media, 'avatarUrl') ??
      portraitAsset?.url ??
      readPublicUrl(media, 'portraitUrl') ??
      referenceImageAsset?.url ??
      readPublicUrl(media, 'referenceImageUrl') ??
      null,
    portraitUrl: portraitAsset?.url ?? readPublicUrl(media, 'portraitUrl'),
    profileCoverUrl: profileCoverAsset?.url ?? readPublicUrl(media, 'profileCoverUrl'),
    referenceImageUrl: referenceImageAsset?.url ?? readPublicUrl(media, 'referenceImageUrl'),
    voiceSampleUrl: voiceSampleAsset?.url ?? readPublicUrl(media, 'voiceSampleUrl'),
    mediaAssets: {
      avatar: avatarAsset,
      portrait: portraitAsset,
      profileCover: profileCoverAsset,
      referenceImage: referenceImageAsset,
      voiceSample: voiceSampleAsset,
    },
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

function projectRecommendedCharacters(
  sources: readonly WorldCharacterSummaryDto[],
  recommendedCharacterLimit?: number,
): Array<{ id: string; name: string; handle: string | null; avatarUrl: string | null }> {
  const limit = Math.max(0, recommendedCharacterLimit ?? 4);
  return sources
    .filter((source) => source.id && source.name)
    .slice(0, limit)
    .map((source) => ({
      id: source.id,
      name: source.name,
      handle: source.handle ?? null,
      avatarUrl: source.avatarUrl ?? null,
    }));
}

export function attachWorldEntryRecommendations(
  world: WorldDetailDto,
  sources: readonly WorldCharacterSummaryDto[],
  recommendedCharacterLimit?: number,
): WorldDetailDto {
  const recommendedCharacters = projectRecommendedCharacters(sources, recommendedCharacterLimit);
  if (recommendedCharacters.length === 0) {
    return world;
  }
  const computed = asRecord(world.computed);
  const entry = asRecord(computed.entry);
  return {
    ...world,
    computed: {
      ...computed,
      entry: {
        ...entry,
        recommendedCharacters,
      },
      featuredCharacterCount: sources.length,
    },
  };
}

export function buildWorldPublicHistoryItems(world: CoreRecord): WorldHistoryPayload {
  return {
    items: readArray<unknown>(world, 'timeline').map((item, index) => {
      if (typeof item === 'string') {
        return {
          id: `world-timeline-${index + 1}`,
          eventId: `world-timeline-${index + 1}`,
          sequence: index + 1,
          title: item,
          summary: item,
          time: readString(asRecord(world.time), 'currentWorldTime') ?? world.updatedAt,
          eventType: 'worldSetting',
        };
      }
      const event = asRecord(item);
      const eventId = readString(event, 'eventId', 'id') || `world-timeline-${index + 1}`;
      return {
        ...event,
        id: eventId,
        eventId,
        sequence: readNumber(event, 'sequence') ?? index + 1,
        title: readString(event, 'title', 'name', 'summary') || eventId,
        summary: readString(event, 'summary') || null,
        time: readString(event, 'time', 'timestamp', 'startsAt') || readString(asRecord(world.time), 'currentWorldTime') || world.updatedAt,
        eventType: readString(event, 'eventType', 'type') || 'worldSetting',
      };
    }),
  };
}

export function buildWorldPublicSemanticBundle(world: CoreRecord): WorldSemanticBundle {
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

export function buildWorldPublicAssets(world: CoreRecord): WorldAssetListPayload {
  const media = asRecord(world.media);
  const mediaAssetsRecord = asRecord(media.assets);
  const structuredAssets = [
    readPublicAssetFromRecord(mediaAssetsRecord, 'icon'),
    readPublicAssetFromRecord(mediaAssetsRecord, 'banner'),
    readPublicAssetFromRecord(mediaAssetsRecord, 'hero'),
    ...readArray<unknown>(mediaAssetsRecord, 'highlights').map(readPublicAssetDto),
  ].filter((asset): asset is WorldPublicAssetDto => Boolean(asset));
  const fallbackExternalRefs = structuredAssets.length > 0
    ? []
    : [
        ['icon', readPublicUrl(media, 'iconUrl')],
        ['banner', readPublicUrl(media, 'bannerUrl')],
        ['hero', readPublicUrl(media, 'heroUrl')],
        ...readArray<string>(media, 'highlightUrls')
          .map((url, index) => [`highlight-${index + 1}`, readPublicUrlValue(url)] as const),
      ].flatMap(([kind, uri]) => uri ? [{ refId: `world-media-${kind}`, kind, uri }] : []);
  const structuredExternalRefs = structuredAssets.map((asset, index) => ({
    refId: asset.id || `world-media-${asset.kind}-${index + 1}`,
    kind: asset.kind,
    uri: asset.url,
  }));
  const structuredResourceRefs = structuredAssets.map((asset) => ({
    refId: asset.id,
    kind: asset.kind,
    purpose: asset.kind,
    label: null,
  }));
  return {
    resourceRefs: structuredResourceRefs,
    externalRefs: [...structuredExternalRefs, ...fallbackExternalRefs],
    intents: [],
  };
}

export function buildWorldPublicScenes(world: CoreRecord): WorldSceneListPayload {
  return {
    items: readArray<unknown>(world, 'scenes').map(projectWorldPublicScene),
  };
}
