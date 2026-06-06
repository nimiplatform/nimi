import {
  loadNimiRealmAgentDetails,
} from '@nimiplatform/sdk/realm';
import {
  isRealmOfflineErrorLike as isRealmOfflineError,
  type JsonObject,
} from '@nimiplatform/sdk/types';
import { emitRealmDataError, type RealmDataErrorEmitter } from '@renderer/infra/realm/realm-api';
import { getDesktopRealm } from '@renderer/infra/sdk/desktop-nimi-client-session';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { getOfflineCacheManager } from '@renderer/infra/offline/cache-manager';
import { getOfflineCoordinator } from '@renderer/infra/offline/coordinator';

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
  emitRealmAgentDetailError: RealmDataErrorEmitter;
  viewerUserId?: string;
  worldId?: string;
  profile: JsonObject;
}): Promise<JsonObject> {
  void input.emitRealmAgentDetailError;
  void input.viewerUserId;
  void input.worldId;
  return {
    ...input.profile,
  };
}

function toNonEmptyString(value: unknown): string {
  return String(value || '').trim();
}

export async function loadAgentDetails(
  emitRealmAgentDetailError: RealmDataErrorEmitter,
  agentIdentifier: string,
  context?: {
    viewerUserId?: string;
    worldId?: string;
  },
) {
  const normalizedIdentifier = toNonEmptyString(agentIdentifier);

  try {
    const cacheKey = `agent-profile:${normalizedIdentifier}`;
    const cached = cacheGet(cacheKey);
    if (cached && typeof cached === 'object') {
      return applyAgentProfileReadFilters({
        emitRealmAgentDetailError,
        viewerUserId: context?.viewerUserId,
        worldId: context?.worldId,
        profile: cached as JsonObject,
      });
    }

    const enrichedProfile = await loadNimiRealmAgentDetails(getDesktopRealm(), normalizedIdentifier);

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
      emitRealmAgentDetailError,
      viewerUserId: context?.viewerUserId,
      worldId: context?.worldId,
      profile: enrichedProfile,
    });
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const cached = await (await getOfflineCacheManager()).getCachedAgentMetadata<JsonObject>(`agent-profile:${normalizedIdentifier}`);
      if (cached) {
        getOfflineCoordinator().markCacheFallbackUsed();
        return applyAgentProfileReadFilters({
          emitRealmAgentDetailError,
          viewerUserId: context?.viewerUserId,
          worldId: context?.worldId,
          profile: cached,
        });
      }
    }
    emitRealmAgentDetailError('load-agent-details', error, { agentIdentifier: normalizedIdentifier });
    throw error;
  }
}

export const realmAgentDetailData = {
  loadAgentDetails: (agentIdentifier: string) =>
    loadAgentDetails(emitRealmDataError, agentIdentifier, {
      viewerUserId: String(useAppStore.getState().auth.user?.id || '').trim() || undefined,
    }),
};
