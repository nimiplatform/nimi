import type { Realm } from '@nimiplatform/sdk/realm';
import { getRuntimeHookRuntime } from '@runtime/mod';
import {
  getOfflineCacheManager,
  getOfflineCoordinator,
  isRealmOfflineError,
} from '@runtime/offline';

type DataSyncApiCaller = (task: (realm: Realm) => Promise<any>, fallbackMessage?: string) => Promise<any>;
type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

// Module-level TTL cache for profile lookups.
const profileCache = new Map<string, { value: unknown; expiresAt: number }>();

function cacheGet(key: string): unknown | null {
  const entry = profileCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    profileCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key: string, value: unknown, ttlMs: number) {
  profileCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function applyAgentProfileReadFilters(input: {
  emitDataSyncError: DataSyncErrorEmitter;
  viewerUserId?: string;
  worldId?: string;
  profile: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const ownerAgentId = toNonEmptyString(input.profile.id);
  if (!ownerAgentId) {
    return {
      ...input.profile,
    };
  }
  try {
    return await getRuntimeHookRuntime().invokeAgentProfileReadFilters({
      viewerUserId: input.viewerUserId,
      ownerAgentId,
      worldId: input.worldId || toNonEmptyString(input.profile.worldId),
      profile: {
        ...input.profile,
      },
    });
  } catch (error) {
    input.emitDataSyncError('load-agent-details:profile-read-filter', error, {
      ownerAgentId,
      viewerUserId: input.viewerUserId || null,
    });
    return {
      ...input.profile,
      referenceImageUrl: null,
    };
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toNonEmptyString(value: unknown): string {
  return String(value || '').trim();
}

function hasLegacyHandlePrefix(value: string): boolean {
  return value.startsWith('@') || value.startsWith('~');
}

function toNullableString(value: unknown): string | null {
  const normalized = toNonEmptyString(value);
  return normalized || null;
}

function extractAgentWorldId(profile: Record<string, unknown>): string | null {
  const direct = toNonEmptyString(profile.worldId);
  if (direct) {
    return direct;
  }

  const agent = toRecord(profile.agent);
  const fromAgent = toNonEmptyString(agent?.worldId);
  if (fromAgent) {
    return fromAgent;
  }

  const agentProfile = toRecord(profile.agentProfile);
  const fromAgentProfile = toNonEmptyString(agentProfile?.worldId);
  if (fromAgentProfile) {
    return fromAgentProfile;
  }

  return null;
}

function extractWorldBannerUrl(profile: Record<string, unknown>): string | null {
  const direct = toNonEmptyString(profile.worldBannerUrl);
  if (direct) {
    return direct;
  }

  const world = toRecord(profile.world);
  const fromWorld = toNonEmptyString(world?.bannerUrl);
  if (fromWorld) {
    return fromWorld;
  }

  const agentProfile = toRecord(profile.agentProfile);
  const fromAgentProfile = toNonEmptyString(agentProfile?.worldBannerUrl);
  if (fromAgentProfile) {
    return fromAgentProfile;
  }

  return null;
}

function extractWorldName(profile: Record<string, unknown>): string | null {
  const direct = toNonEmptyString(profile.worldName);
  if (direct) {
    return direct;
  }

  const world = toRecord(profile.world);
  const fromWorld = toNonEmptyString(world?.name);
  if (fromWorld) {
    return fromWorld;
  }

  const agentProfile = toRecord(profile.agentProfile);
  const fromAgentProfile = toNonEmptyString(agentProfile?.worldName);
  if (fromAgentProfile) {
    return fromAgentProfile;
  }

  return null;
}

async function enrichAgentProfileWithWorldBanner(
  callApi: DataSyncApiCaller,
  profile: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const existingBannerUrl = extractWorldBannerUrl(profile);
  const existingWorldName = extractWorldName(profile);
  if (existingBannerUrl && existingWorldName) {
    return profile;
  }

  const worldId = extractAgentWorldId(profile);
  if (!worldId) {
    return profile;
  }

  try {
    const world = await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetWorld(worldId),
      'Failed to load world detail',
    );
    const worldRecord = toRecord(world);
    if (!worldRecord) {
      return profile;
    }

    return {
      ...profile,
      worldName: existingWorldName || toNullableString(worldRecord.name),
      worldBannerUrl: existingBannerUrl || toNullableString(worldRecord.bannerUrl),
      world: {
        ...(toRecord(profile.world) || {}),
        ...worldRecord,
        bannerUrl: existingBannerUrl || toNullableString(worldRecord.bannerUrl),
      },
    };
  } catch {
    return profile;
  }
}

function isAgentProfile(profile: Record<string, unknown>): boolean {
  if (profile.isAgent === true) {
    return true;
  }
  if (toRecord(profile.agent) || toRecord(profile.agentProfile)) {
    return true;
  }
  return false;
}

async function getProfileByHandle(
  callApi: DataSyncApiCaller,
  handleCandidate: string,
): Promise<Record<string, unknown> | null> {
  const normalized = toNonEmptyString(handleCandidate);
  if (!normalized) {
    return null;
  }
  try {
    const payload = await callApi(
      (realm) => realm.raw.request<unknown>({
        method: 'GET',
        path: `/api/agent/handle/${encodeURIComponent(normalized)}`,
      }),
      '按 handle 加载 Agent 资料失败',
    );
    return toRecord(payload);
  } catch {
    return null;
  }
}

async function getProfileById(
  callApi: DataSyncApiCaller,
  agentId: string,
): Promise<Record<string, unknown> | null> {
  const normalized = toNonEmptyString(agentId);
  if (!normalized) {
    return null;
  }
  try {
    const payload = await callApi(
      (realm) => realm.raw.request<unknown>({
        method: 'GET',
        path: `/api/agent/accounts/${encodeURIComponent(normalized)}`,
      }),
      '按 id 加载 Agent 资料失败',
    );
    return toRecord(payload);
  } catch {
    return null;
  }
}

export async function loadAgentDetails(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  agentIdentifier: string,
  context?: {
    viewerUserId?: string;
    worldId?: string;
  },
) {
  const normalizedIdentifier = toNonEmptyString(agentIdentifier);
  if (!normalizedIdentifier) {
    throw new Error('AGENT_ID_REQUIRED');
  }
  if (hasLegacyHandlePrefix(normalizedIdentifier)) {
    throw new Error('HANDLE_PREFIX_UNSUPPORTED');
  }

  try {
    const cacheKey = `agent-profile:${normalizedIdentifier}`;
    const cached = cacheGet(cacheKey);
    if (cached && typeof cached === 'object') {
      return applyAgentProfileReadFilters({
        emitDataSyncError,
        viewerUserId: context?.viewerUserId,
        worldId: context?.worldId,
        profile: cached as Record<string, unknown>,
      });
    }

    let profile: Record<string, unknown> | null = null;

    profile = await getProfileById(callApi, normalizedIdentifier);
    if (!profile) {
      profile = await getProfileByHandle(callApi, normalizedIdentifier);
    }

    if (!profile || !isAgentProfile(profile)) {
      throw new Error('AGENT_PROFILE_NOT_FOUND');
    }

    const enrichedProfile = await enrichAgentProfileWithWorldBanner(callApi, profile);

    const resolvedId = toNonEmptyString(enrichedProfile.id);
    if (resolvedId) {
      cacheSet(`agent-profile:${resolvedId}`, enrichedProfile, 5 * 60 * 1000);
    }
    const resolvedHandle = toNonEmptyString(enrichedProfile.handle);
    if (resolvedHandle) {
      cacheSet(`agent-profile:${resolvedHandle}`, enrichedProfile, 5 * 60 * 1000);
    }
    cacheSet(cacheKey, enrichedProfile, 5 * 60 * 1000);
    const cache = await getOfflineCacheManager();
    await cache.syncAgentMetadata(cacheKey, enrichedProfile);
    if (resolvedId) {
      await cache.syncAgentMetadata(`agent-profile:${resolvedId}`, enrichedProfile);
    }
    if (resolvedHandle) {
      await cache.syncAgentMetadata(`agent-profile:${resolvedHandle}`, enrichedProfile);
    }
    return applyAgentProfileReadFilters({
      emitDataSyncError,
      viewerUserId: context?.viewerUserId,
      worldId: context?.worldId,
      profile: enrichedProfile,
    });
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const cached = await (await getOfflineCacheManager()).getCachedAgentMetadata(`agent-profile:${normalizedIdentifier}`);
      if (cached) {
        getOfflineCoordinator().markCacheFallbackUsed();
        return applyAgentProfileReadFilters({
          emitDataSyncError,
          viewerUserId: context?.viewerUserId,
          worldId: context?.worldId,
          profile: cached,
        });
      }
    }
    emitDataSyncError('load-agent-details', error, { agentIdentifier: normalizedIdentifier });
    throw error;
  }
}
