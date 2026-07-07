import type {
  WorldCharacter,
  WorldCharacterMediaAssets,
  WorldCharacterStats,
  WorldDetailData,
} from './world-detail-types.js';
import { toWorldListItem, type WorldListItem } from './world-list-model.js';
import type { WorldPrimaryDetailRecord, WorldPrimaryDisplayDetail } from './world-detail-query-types.js';
import {
  asRecord,
  readPublicMediaAsset,
  readPublicUrlValue,
  readString,
  readStringArray,
  readStringValue,
  type JsonRecord,
} from './world-detail-query-readers.js';

function readCharacterMediaAssets(record: JsonRecord): WorldCharacterMediaAssets | null {
  const mediaAssets = asRecord(record.mediaAssets);
  const avatar = readPublicMediaAsset(mediaAssets.avatar);
  const portrait = readPublicMediaAsset(mediaAssets.portrait);
  const profileCover = readPublicMediaAsset(mediaAssets.profileCover);
  const referenceImage = readPublicMediaAsset(mediaAssets.referenceImage);
  const voiceSample = readPublicMediaAsset(mediaAssets.voiceSample);
  if (!avatar && !portrait && !profileCover && !referenceImage && !voiceSample) {
    return null;
  }
  return {
    avatar,
    portrait,
    profileCover,
    referenceImage,
    voiceSample,
  };
}

function normalizeDisplayType(value: unknown): 'OASIS' | 'CREATOR' {
  return readStringValue(value) === 'OASIS' ? 'OASIS' : 'CREATOR';
}

function normalizeDisplayStatus(value: unknown): WorldDetailData['status'] {
  const normalized = readStringValue(value);
  return normalized === 'PUBLIC'
    || normalized === 'SYSTEM'
    || normalized === 'DISCOVERABLE'
    ? normalized
    : 'DISCOVERABLE';
}

function normalizeDisplayFreezeReason(value: unknown): WorldDetailData['freezeReason'] {
  const normalized = readStringValue(value);
  return normalized === 'QUOTA_OVERFLOW' || normalized === 'WORLD_INACTIVE' || normalized === 'GOVERNANCE_LOCK'
    ? normalized
    : null;
}

function worldListItemToDisplayData(listItem: WorldListItem): WorldDetailData {
  return {
    id: listItem.id,
    name: listItem.name || 'Unknown World',
    description: listItem.description,
    tagline: listItem.tagline ?? null,
    motto: listItem.motto ?? null,
    overview: listItem.overview ?? null,
    contentRating: listItem.contentRating ?? null,
    iconUrl: listItem.iconUrl,
    bannerUrl: listItem.bannerUrl,
    type: normalizeDisplayType(listItem.type),
    status: normalizeDisplayStatus(listItem.status),
    level: listItem.level,
    levelUpdatedAt: listItem.levelUpdatedAt,
    characterCount: listItem.characterCount,
    createdAt: listItem.createdAt,
    creatorId: listItem.creatorId,
    freezeReason: normalizeDisplayFreezeReason(listItem.freezeReason),
    scoreA: listItem.scoreA,
    scoreC: listItem.scoreC,
    scoreE: listItem.scoreE,
    scoreEwma: listItem.scoreEwma || listItem.computed.score.scoreEwma,
    scoreQ: listItem.scoreQ,
    flowRatio: listItem.computed.time.flowRatio,
    isPaused: listItem.computed.time.isPaused,
    genre: listItem.genre,
    era: listItem.era,
    themes: listItem.themes,
    currentWorldTime: listItem.computed.time.currentWorldTime,
    currentTimeLabel: listItem.computed.time.currentLabel,
    eraLabel: listItem.computed.time.eraLabel,
    entityCount: listItem.entityCount,
    relationshipCount: listItem.relationshipCount,
    personaCount: listItem.personaCount,
    sceneCount: listItem.sceneCount,
    systemCount: listItem.systemCount,
    timelineEventCount: listItem.timelineEventCount,
    primaryLanguage: listItem.computed.languages.primary,
    commonLanguages: listItem.computed.languages.common,
    recommendedCharacters: listItem.computed.entry.recommendedCharacters.map((character) => ({
      id: character.id,
      name: character.name,
      handle: character.handle ?? null,
      avatarUrl: character.avatarUrl ?? null,
      importance: null,
      display: null,
    })),
  };
}

export function toWorldDisplayData(detailValue: unknown): WorldDetailData {
  const listItem = toWorldListItem(asRecord(detailValue));
  return worldListItemToDisplayData(listItem);
}

export function toWorldDisplayFallback(world: WorldListItem): WorldDetailData {
  return worldListItemToDisplayData(world);
}

export function toWorldDisplayCharacter(characterValue: unknown, worldCreatedAt: string): WorldCharacter {
  const character = asRecord(characterValue);
  const display = asRecord(character.display);
  const stats = asRecord(character.stats);
  const importance = readStringValue(character.importance);
  const sourceRef = asRecord(character.sourceRef);
  const sourceKind = readString(sourceRef, 'kind');
  const sourceWorldId = readString(sourceRef, 'worldId');
  const sourceId = readString(sourceRef, 'sourceId');
  const sourceContentHash = readString(sourceRef, 'sourceContentHash');
  if (
    (sourceKind !== 'worldCharacter' && sourceKind !== 'realmPersona')
    || !sourceWorldId
    || !sourceId
    || !sourceContentHash
  ) {
    throw new Error('World source display requires a hash-bearing sourceRef');
  }
  const relation = asRecord(character.relation);
  const relationState = readString(relation, 'state');
  const projectedRelationState = relationState === 'connected'
    ? 'connected'
    : relationState === 'unavailable' ? 'unavailable' : 'connectable';
  const ownership = readString(character, 'ownership');
  const mediaAssets = readCharacterMediaAssets(character);
  return {
    id: readString(character, 'id'),
    name: readString(character, 'name', 'displayName') || 'Unknown',
    handle: readString(character, 'handle'),
    bio: readString(character, 'bio', 'description'),
    sourceRef: {
      kind: sourceKind,
      worldId: sourceWorldId,
      sourceId,
      sourceContentHash,
    },
    sourceKind,
    ownership: ownership === 'userOwned' ? 'userOwned' : 'worldOwned',
    relation: {
      state: projectedRelationState,
      connectionId: readString(relation, 'connectionId') || null,
      runtimeSourceRef: readString(relation, 'runtimeSourceRef') || null,
    },
    role: readString(display, 'role') || null,
    faction: readString(display, 'faction') || null,
    rank: readString(display, 'rank') || null,
    sceneName: readString(display, 'sceneName') || null,
    location: readString(display, 'location') || null,
    tags: readStringArray(display.tags),
    createdAt: readString(character, 'createdAt') || worldCreatedAt,
    avatarUrl: readPublicUrlValue(character.avatarUrl)
      || mediaAssets?.avatar?.url
      || mediaAssets?.portrait?.url
      || mediaAssets?.referenceImage?.url
      || null,
    portraitUrl: readPublicUrlValue(character.portraitUrl) || mediaAssets?.portrait?.url || null,
    profileCoverUrl: readPublicUrlValue(character.profileCoverUrl) || mediaAssets?.profileCover?.url || null,
    referenceImageUrl: readPublicUrlValue(character.referenceImageUrl) || mediaAssets?.referenceImage?.url || null,
    voiceSampleUrl: readPublicUrlValue(character.voiceSampleUrl) || mediaAssets?.voiceSample?.url || null,
    mediaAssets,
    importance: importance === 'SECONDARY' || importance === 'BACKGROUND' ? importance : 'PRIMARY',
    stats: Object.keys(stats).length > 0 ? stats as WorldCharacterStats : null,
  };
}

export function projectWorldPrimaryDisplayDetail(primary: WorldPrimaryDetailRecord): WorldPrimaryDisplayDetail {
  const world = toWorldDisplayData(primary);
  const characterRecords = Array.isArray(primary.characters) ? primary.characters : [];
  return {
    primary,
    world,
    characters: characterRecords.map((character) => toWorldDisplayCharacter(character, world.createdAt)),
  };
}
