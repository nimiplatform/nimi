import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
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

function mapPersonaSource(raw: unknown, worldsMap: SourceWorldProjectionMap): ExplorePersonaSourceCardData | null {
  const source = toRecord(raw);
  if (!source) {
    return null;
  }
  const id = asString(source.id).trim();
  if (!id) {
    return null;
  }

  const sourceRecord = toRecord(source.agent);
  const sourceProfile = toRecord(source.sourceProfile);
  const stats = toRecord(source.stats);

  const displayName = asString(source.displayName).trim()
    || asString(source.name).trim()
    || asString(sourceProfile?.displayName).trim()
    || asString(source.handle).trim()
    || asString(sourceProfile?.handle).trim()
    || 'Unknown Persona';
  const handle = asString(source.handle).trim()
    || asString(sourceProfile?.handle).trim()
    || displayName;
  const avatarUrl = asString(source.avatarUrl).trim()
    || asString(sourceProfile?.avatarUrl).trim()
    || null;
  const bio = asString(source.bio).trim()
    || asString(sourceProfile?.bio).trim()
    || null;
  const isSource = source.isSource === true || Boolean(sourceRecord) || Boolean(sourceProfile);
  const isOnline = source.isOnline === true;

  const category = asString(sourceRecord?.category).trim()
    || asString(sourceProfile?.category).trim()
    || asString(source.category).trim();
  const origin = asString(sourceRecord?.origin).trim()
    || asString(sourceProfile?.origin).trim()
    || asString(source.origin).trim();
  const tier = asString(sourceRecord?.tier).trim()
    || asString(sourceProfile?.tier).trim()
    || asString(source.tier).trim();
  const state = asString(sourceRecord?.state).trim()
    || asString(sourceProfile?.state).trim()
    || asString(source.state).trim();
  const wakeStrategy = asString(sourceRecord?.wakeStrategy).trim()
    || asString(sourceProfile?.wakeStrategy).trim();
  const ownershipType = asString(sourceRecord?.ownershipType || sourceProfile?.ownershipType).trim();
  const accountVisibility = asString(source.accountVisibility).trim()
    || asString(sourceRecord?.accountVisibility).trim()
    || asString(sourceProfile?.accountVisibility).trim()
    || null;

  const customTags = Array.isArray(source.tags)
    ? source.tags.map(String).filter(Boolean)
    : [];
  const tags = [category, origin, wakeStrategy].filter(Boolean).concat(customTags);

  const worldId = asString(sourceRecord?.worldId).trim()
    || asString(sourceProfile?.worldId).trim()
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
    worldId,
    worldName,
    worldBannerUrl,
    category,
    origin,
    tier,
    state,
    ownershipType,
    wakeStrategy,
    accountVisibility,
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
    sourceCategory: source.category,
    sourceOrigin: source.origin,
    sourceTier: source.tier,
    sourceWakeStrategy: source.wakeStrategy,
    sourceOwnershipType: source.ownershipType,
    sourceWorldId: source.worldId,
  };
  return {
    profileId: source.id,
    profileSeed,
  };
}
