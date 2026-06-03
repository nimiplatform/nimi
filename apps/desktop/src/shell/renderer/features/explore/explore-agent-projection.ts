import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { ProfileDetailSeed } from '@renderer/features/relationship/profile-detail-modal.js';
import type { PostCardAuthorProfileTarget } from '../home/post-card';
import type { ExploreAgentCardData } from './explore-cards';

type AgentWorldProjection = {
  bannerUrl: string | null;
  scoreEwma: number;
  name?: string;
};

export type AgentWorldProjectionMap = Map<string, AgentWorldProjection>;

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

function mapAgent(raw: unknown, worldsMap: AgentWorldProjectionMap): ExploreAgentCardData | null {
  const source = toRecord(raw);
  if (!source) {
    return null;
  }
  const id = asString(source.id).trim();
  if (!id) {
    return null;
  }

  const agent = toRecord(source.agent);
  const agentProfile = toRecord(source.agentProfile);
  const stats = toRecord(source.stats);

  const displayName = asString(source.displayName).trim()
    || asString(source.name).trim()
    || asString(agentProfile?.displayName).trim()
    || asString(source.handle).trim()
    || asString(agentProfile?.handle).trim()
    || 'Unknown Agent';
  const handle = asString(source.handle).trim()
    || asString(agentProfile?.handle).trim()
    || displayName;
  const avatarUrl = asString(source.avatarUrl).trim()
    || asString(agentProfile?.avatarUrl).trim()
    || null;
  const bio = asString(source.bio).trim()
    || asString(agentProfile?.bio).trim()
    || null;
  const isAgent = source.isAgent === true || Boolean(agent) || Boolean(agentProfile);
  const isOnline = source.isOnline === true;

  const category = asString(agent?.category).trim()
    || asString(agentProfile?.category).trim()
    || asString(source.category).trim();
  const origin = asString(agent?.origin).trim()
    || asString(agentProfile?.origin).trim()
    || asString(source.origin).trim();
  const tier = asString(agent?.tier).trim()
    || asString(agentProfile?.tier).trim()
    || asString(source.tier).trim();
  const state = asString(agent?.state).trim()
    || asString(agentProfile?.state).trim()
    || asString(source.state).trim();
  const wakeStrategy = asString(agent?.wakeStrategy).trim()
    || asString(agentProfile?.wakeStrategy).trim();
  const ownershipType = asString(agent?.ownershipType || agentProfile?.ownershipType).trim();
  const accountVisibility = asString(source.accountVisibility).trim()
    || asString(agent?.accountVisibility).trim()
    || asString(agentProfile?.accountVisibility).trim()
    || null;

  const customTags = Array.isArray(source.tags)
    ? source.tags.map(String).filter(Boolean)
    : [];
  const tags = [category, origin, wakeStrategy].filter(Boolean).concat(customTags);

  const worldId = asString(agent?.worldId).trim()
    || asString(agentProfile?.worldId).trim()
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
    isAgent,
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

export function parseAgents(agentsResult: unknown, worldsMap: AgentWorldProjectionMap): ExploreAgentCardData[] {
  const payload = toRecord(agentsResult);
  const raw = Array.isArray(payload?.items) ? payload.items : [];
  return raw
    .map((item) => mapAgent(item, worldsMap))
    .filter((item): item is ExploreAgentCardData => item !== null);
}

export function toProfileTargetFromAgent(agent: ExploreAgentCardData): PostCardAuthorProfileTarget {
  const profileSeed: ProfileDetailSeed = {
    id: agent.id,
    displayName: agent.name,
    handle: agent.handle,
    avatarUrl: agent.avatarUrl,
    bio: agent.bio,
    isAgent: agent.isAgent,
    isOnline: agent.isOnline,
    tags: agent.tags,
    worldName: agent.worldName,
    worldBannerUrl: agent.worldBannerUrl,
    friendsCount: agent.friendsCount,
    postsCount: agent.postsCount,
    likesCount: agent.likesCount,
    giftStats: agent.giftStats,
    agentState: agent.state,
    agentCategory: agent.category,
    agentOrigin: agent.origin,
    agentTier: agent.tier,
    agentWakeStrategy: agent.wakeStrategy,
    agentOwnershipType: agent.ownershipType,
    agentWorldId: agent.worldId,
  };
  return {
    profileId: agent.id,
    profileSeed,
  };
}
