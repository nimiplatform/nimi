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

async function applyRealmSourceProfileReadFilters(input: {
  emitRealmSourceDetailError: RealmDataErrorEmitter;
  viewerUserId?: string;
  worldId?: string;
  profile: JsonObject;
}): Promise<JsonObject> {
  void input.emitRealmSourceDetailError;
  void input.viewerUserId;
  void input.worldId;
  return {
    ...input.profile,
  };
}

function toNonEmptyString(value: unknown): string {
  return String(value || '').trim();
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

async function loadRealmSourceDetails(identifier: string): Promise<JsonObject> {
  const realm = getDesktopRealm();
  try {
    const persona = await realm.worldCore.worldCoreControllerGetRealmPersona({
      path: { personaId: identifier },
    });
    const core = asRecord(persona.core);
    return {
      ...core,
      id: persona.id,
      displayName: toNonEmptyString(core.displayName) || toNonEmptyString(core.name) || persona.id,
      handle: toNonEmptyString(core.handle),
      avatarUrl: toNonEmptyString(core.avatarUrl) || null,
      bio: toNonEmptyString(core.bio) || toNonEmptyString(core.description) || null,
      createdAt: persona.createdAt,
      updatedAt: persona.updatedAt,
      homeWorldId: persona.homeWorldId,
      ownerId: persona.ownerId,
      sourceKind: 'realmPersona',
      contentHash: persona.contentHash,
    };
  } catch {
    const character = await realm.worldCore.worldCoreControllerGetWorldCharacter({
      path: { characterId: identifier },
    });
    const core = asRecord(character.core);
    return {
      ...core,
      id: character.id,
      displayName: toNonEmptyString(core.displayName) || toNonEmptyString(core.name) || character.id,
      handle: toNonEmptyString(core.handle),
      avatarUrl: toNonEmptyString(core.avatarUrl) || null,
      bio: toNonEmptyString(core.bio) || toNonEmptyString(core.description) || null,
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
      worldId: character.worldId,
      sourceKind: 'worldCharacter',
      contentHash: character.contentHash,
    };
  }
}

export async function loadRealmSourceDetailsForDisplay(
  emitRealmSourceDetailError: RealmDataErrorEmitter,
  sourceIdentifier: string,
  context?: {
    viewerUserId?: string;
    worldId?: string;
  },
) {
  const normalizedIdentifier = toNonEmptyString(sourceIdentifier);

  try {
    const cacheKey = `source-profile:${normalizedIdentifier}`;
    const cached = cacheGet(cacheKey);
    if (cached && typeof cached === 'object') {
      return applyRealmSourceProfileReadFilters({
        emitRealmSourceDetailError,
        viewerUserId: context?.viewerUserId,
        worldId: context?.worldId,
        profile: cached as JsonObject,
      });
    }

    const enrichedProfile = await loadRealmSourceDetails(normalizedIdentifier);

    const resolvedId = toNonEmptyString(enrichedProfile.id);
    if (resolvedId) {
      cacheSet(`source-profile:${resolvedId}`, enrichedProfile, 5 * 60 * 1000);
    }
    const resolvedHandle = toNonEmptyString(enrichedProfile.handle);
    if (resolvedHandle) {
      cacheSet(`source-profile:${resolvedHandle}`, enrichedProfile, 5 * 60 * 1000);
    }
    cacheSet(cacheKey, enrichedProfile, 5 * 60 * 1000);
    const cache = await getOfflineCacheManager();
    await cache.syncProfileMetadata(cacheKey, enrichedProfile);
    if (resolvedId) {
      await cache.syncProfileMetadata(`source-profile:${resolvedId}`, enrichedProfile);
    }
    if (resolvedHandle) {
      await cache.syncProfileMetadata(`source-profile:${resolvedHandle}`, enrichedProfile);
    }
    return applyRealmSourceProfileReadFilters({
      emitRealmSourceDetailError,
      viewerUserId: context?.viewerUserId,
      worldId: context?.worldId,
      profile: enrichedProfile,
    });
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const cached = await (await getOfflineCacheManager()).getCachedProfileMetadata<JsonObject>(`source-profile:${normalizedIdentifier}`);
      if (cached) {
        getOfflineCoordinator().markCacheFallbackUsed();
        return applyRealmSourceProfileReadFilters({
          emitRealmSourceDetailError,
          viewerUserId: context?.viewerUserId,
          worldId: context?.worldId,
          profile: cached,
        });
      }
    }
    emitRealmSourceDetailError('load-realm-source-details', error, { sourceIdentifier: normalizedIdentifier });
    throw error;
  }
}

export const realmSourceDetailData = {
  loadRealmSourceDetailsForDisplay: (sourceIdentifier: string) =>
    loadRealmSourceDetailsForDisplay(emitRealmDataError, sourceIdentifier, {
      viewerUserId: String(useAppStore.getState().auth.user?.id || '').trim() || undefined,
    }),
};
