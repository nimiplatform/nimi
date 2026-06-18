import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { NimiRealmCoreSourceRef } from '@nimiplatform/sdk/realm';
import type { ProfileDetailSeed } from '@renderer/features/relationship/profile-detail-modal.js';
import type { PostCardAuthorProfileTarget } from '../home/post-card';
import type { ExplorePersonaSourceCardData } from './explore-cards';

type SourceWorldProjection = {
  bannerUrl: string | null;
  scoreEwma: number;
  name?: string;
};

export type SourceWorldProjectionMap = Map<string, SourceWorldProjection>;

function toRecord(value: unknown): JsonObject | null {
  return parseOptionalJsonObject(value) ?? null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function toNumberMap(value: unknown): Record<string, number> | undefined {
  const record = parseOptionalJsonObject(value);
  if (!record) {
    return undefined;
  }
  const output: Record<string, number> = {};
  for (const [key, entry] of Object.entries(record)) {
    const numeric = asNumber(entry);
    if (numeric !== undefined) {
      output[key] = numeric;
    }
  }
  return output;
}

function toSourceKind(value: unknown): NimiRealmCoreSourceRef['kind'] | undefined {
  const normalized = asString(value).trim();
  if (normalized === 'worldCharacter' || normalized === 'WORLD_CHARACTER') {
    return 'worldCharacter';
  }
  if (normalized === 'realmPersona' || normalized === 'REALM_PERSONA') {
    return 'realmPersona';
  }
  return undefined;
}

function toRealmCoreSourceRef(value: unknown): NimiRealmCoreSourceRef | undefined {
  const record = toRecord(value);
  if (!record) {
    return undefined;
  }
  const kind = toSourceKind(record.kind);
  const worldId = asString(record.worldId).trim();
  const sourceId = asString(record.sourceId).trim();
  const sourceContentHash = asString(record.sourceContentHash).trim();
  if (!kind || !worldId || !sourceId || !sourceContentHash) {
    return undefined;
  }
  return { kind, worldId, sourceId, sourceContentHash };
}

function mapPersonaSource(raw: unknown, worldsMap: SourceWorldProjectionMap): ExplorePersonaSourceCardData | null {
  const source = toRecord(raw);
  if (!source) {
    return null;
  }
  const id = asString(source.id).trim();
  if (!id) {
    return null;
  }

  const sourceRecord = toRecord(source.source);
  const stats = toRecord(source.stats);

  const displayName = asString(source.displayName).trim()
    || asString(source.name).trim()
    || asString(source.handle).trim()
    || 'Unknown Persona';
  const handle = asString(source.handle).trim()
    || displayName;
  const avatarUrl = asString(source.avatarUrl).trim()
    || null;
  const bio = asString(source.bio).trim()
    || null;
  const isSource = source.isSource === true || Boolean(sourceRecord);
  const isOnline = source.isOnline === true;
  const sourceRef = toRealmCoreSourceRef(source.sourceRef);
  const sourceKind = toSourceKind(source.sourceKind) ?? sourceRef?.kind;
  const sourceId = asString(source.sourceId).trim() || sourceRef?.sourceId || id;
  const sourceContentHash = asString(source.sourceContentHash).trim()
    || asString(source.contentHash).trim()
    || sourceRef?.sourceContentHash
    || '';

  const personaStyle = toRecord(sourceRecord?.personaStyle);
  const archetype = asString(source.archetype).trim()
    || asString(personaStyle?.archetype).trim();
  const origin = asString(sourceRecord?.origin).trim()
    || asString(source.origin).trim();
  const tier = asString(sourceRecord?.tier).trim()
    || asString(source.tier).trim();
  const state = asString(sourceRecord?.state).trim()
    || asString(source.state).trim();
  const pacing = asString(source.pacing).trim()
    || asString(personaStyle?.pacing).trim();
  const ownershipType = asString(sourceRecord?.ownershipType).trim();
  const visibility = asString(source.visibility).trim()
    || asString(sourceRecord?.visibility).trim()
    || null;

  const customTags = Array.isArray(source.tags)
    ? source.tags.map(String).filter(Boolean)
    : [];
  const tags = [archetype, origin, pacing].filter(Boolean).concat(customTags);

  const worldId = asString(sourceRecord?.worldId).trim()
    || asString(source.worldId).trim()
    || asString(source.homeWorldId).trim()
    || sourceRef?.worldId
    || null;
  const worldData = worldId ? worldsMap.get(worldId) : null;
  const worldBannerUrl = worldData?.bannerUrl ?? null;
  const worldName = worldData?.name ?? null;
  const worldScoreEwma = worldData?.scoreEwma ?? 0;

  const friendsCount = asNumber(stats?.friendsCount)
    ?? asNumber(source.friendsCount)
    ?? asNumber(source.friendCount);
  const postsCount = asNumber(stats?.postsCount)
    ?? asNumber(source.postsCount)
    ?? asNumber(source.postCount);
  const likesCount = asNumber(stats?.likesCount)
    ?? asNumber(source.likesCount)
    ?? asNumber(source.likeCount);
  const giftStats = toNumberMap(source.giftStats);

  return {
    id,
    name: displayName,
    handle,
    avatarUrl,
    bio,
    isSource,
    sourceKind,
    sourceId,
    sourceContentHash,
    runtimeSourceRef: asString(source.runtimeSourceRef).trim() || undefined,
    ...(sourceRef ? { sourceRef } : {}),
    worldId,
    worldName,
    worldBannerUrl,
    archetype,
    origin,
    tier,
    state,
    ownershipType,
    pacing,
    visibility,
    isOnline,
    tags,
    friendsCount,
    postsCount,
    likesCount,
    giftStats,
    worldScoreEwma,
  };
}

export function parsePersonaSources(personasResult: unknown, worldsMap: SourceWorldProjectionMap): ExplorePersonaSourceCardData[] {
  const payload = toRecord(personasResult);
  const raw = Array.isArray(payload?.items) ? payload.items : [];
  return raw
    .map((item) => mapPersonaSource(item, worldsMap))
    .filter((item): item is ExplorePersonaSourceCardData => item !== null);
}

export function toProfileTargetFromPersonaSource(source: ExplorePersonaSourceCardData): PostCardAuthorProfileTarget {
  const profileSeed: ProfileDetailSeed = {
    id: source.id,
    displayName: source.name,
    handle: source.handle,
    avatarUrl: source.avatarUrl,
    bio: source.bio,
    isSource: source.isSource,
    isOnline: source.isOnline,
    tags: source.tags,
    worldName: source.worldName,
    worldBannerUrl: source.worldBannerUrl,
    friendsCount: source.friendsCount,
    postsCount: source.postsCount,
    likesCount: source.likesCount,
    giftStats: source.giftStats,
    sourceState: source.state,
    sourceArchetype: source.archetype,
    sourceOrigin: source.origin,
    sourceTier: source.tier,
    sourcePacing: source.pacing,
    sourceOwnershipType: source.ownershipType,
    sourceWorldId: source.worldId,
    sourceKind: source.sourceKind,
    sourceId: source.sourceId,
    sourceContentHash: source.sourceContentHash,
    runtimeSourceRef: source.runtimeSourceRef,
    sourceRef: source.sourceRef,
  };
  return {
    profileId: source.id,
    profileSeed,
  };
}
