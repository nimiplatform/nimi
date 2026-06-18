import { type NimiRealmCoreSourceRef } from '@nimiplatform/sdk/realm';
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

function readExternalAssetUri(core: JsonObject, kinds: readonly string[]): string | null {
  const assets = asRecord(core.assets);
  const refs = Array.isArray(assets.externalRefs) ? assets.externalRefs : [];
  for (const ref of refs) {
    const record = asRecord(ref);
    const kind = toNonEmptyString(record.kind);
    if (kind && kinds.includes(kind)) {
      const uri = toNonEmptyString(record.uri);
      if (uri) return uri;
    }
  }
  return null;
}

function requireProjectedText(value: string | null, message: string): string {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function projectRealmPersonaCore(core: JsonObject): Pick<JsonObject, 'displayName' | 'handle' | 'avatarUrl' | 'bio' | 'archetype' | 'pacing'> {
  const identity = asRecord(core.identity);
  const presentation = asRecord(core.presentation);
  const personaStyle = asRecord(core.personaStyle);
  const displayName = toNonEmptyString(presentation.displayName)
    || toNonEmptyString(identity.name);
  const bio = toNonEmptyString(identity.summary)
    || toNonEmptyString(presentation.profileLine)
    || toNonEmptyString(presentation.shortBio);
  return {
    displayName: requireProjectedText(
      displayName,
      'RealmPersona source detail requires presentation.displayName or identity.name',
    ),
    handle: toNonEmptyString(identity.handle),
    avatarUrl: toNonEmptyString(presentation.avatarResourceRef)
      || readExternalAssetUri(core, ['avatar', 'referenceImage']),
    archetype: toNonEmptyString(personaStyle.archetype) || null,
    pacing: toNonEmptyString(personaStyle.pacing) || null,
    bio: requireProjectedText(
      bio,
      'RealmPersona source detail requires identity.summary or presentation profile copy',
    ),
  };
}

function projectWorldCharacterCore(core: JsonObject): Pick<JsonObject, 'displayName' | 'handle' | 'avatarUrl' | 'bio'> {
  const identity = asRecord(core.identity);
  const presentation = asRecord(core.presentation);
  const displayName = toNonEmptyString(presentation.displayName)
    || toNonEmptyString(identity.name);
  const bio = toNonEmptyString(identity.summary)
    || toNonEmptyString(presentation.profileLine)
    || toNonEmptyString(presentation.shortBio);
  return {
    displayName: requireProjectedText(
      displayName,
      'WorldCharacterCore source detail requires presentation.displayName or identity.name',
    ),
    handle: toNonEmptyString(identity.handle),
    avatarUrl: toNonEmptyString(presentation.avatarResourceRef)
      || readExternalAssetUri(core, ['avatar', 'referenceImage']),
    bio: requireProjectedText(
      bio,
      'WorldCharacterCore source detail requires identity.summary or presentation profile copy',
    ),
  };
}

function isTypedNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = error as Record<string, unknown>;
  if (record.status === 404 || record.statusCode === 404) {
    return true;
  }
  const reasonCode = toNonEmptyString(record.reasonCode);
  if (reasonCode && reasonCode.includes('NOT_FOUND')) {
    return true;
  }
  const message = toNonEmptyString(record.message).toLowerCase();
  return message.includes('not found');
}

async function loadRealmSourceDetailsBySourceRef(
  sourceRef: NimiRealmCoreSourceRef,
  context?: { runtimeSourceRef?: string | null },
): Promise<JsonObject> {
  const realm = getDesktopRealm();
  const runtimeSourceRef = toNonEmptyString(context?.runtimeSourceRef) || null;
  if (sourceRef.kind === 'realmPersona') {
    const persona = await realm.worldCore.worldCoreControllerGetRealmPersona({
      path: { personaId: sourceRef.sourceId },
    });
    const worldId = toNonEmptyString(persona.homeWorldId);
    const contentHash = toNonEmptyString(persona.contentHash);
    if (worldId !== sourceRef.worldId || contentHash !== sourceRef.sourceContentHash) {
      throw new Error('RealmPersona sourceRef is stale or mismatched');
    }
    const core = asRecord(persona.core);
    return {
      id: persona.id,
      ...projectRealmPersonaCore(core),
      source: core,
      createdAt: persona.createdAt,
      updatedAt: persona.updatedAt,
      visibility: persona.visibility,
      homeWorldId: worldId,
      ownerId: persona.ownerId,
      sourceKind: 'realmPersona',
      sourceId: persona.id,
      contentHash,
      sourceContentHash: contentHash,
      sourceRef: {
        kind: sourceRef.kind,
        worldId: sourceRef.worldId,
        sourceId: sourceRef.sourceId,
        sourceContentHash: sourceRef.sourceContentHash,
      },
      runtimeSourceRef,
    };
  }

  const character = await realm.worldCore.worldCoreControllerGetWorldCharacter({
    path: { characterId: sourceRef.sourceId },
  });
  const worldId = toNonEmptyString(character.worldId);
  const contentHash = toNonEmptyString(character.contentHash);
  if (worldId !== sourceRef.worldId || contentHash !== sourceRef.sourceContentHash) {
    throw new Error('WorldCharacterCore sourceRef is stale or mismatched');
  }
  const core = asRecord(character.core);
  return {
    id: character.id,
    ...projectWorldCharacterCore(core),
    source: core,
    createdAt: character.createdAt,
    updatedAt: character.updatedAt,
    worldId,
    sourceKind: 'worldCharacter',
    sourceId: character.id,
    contentHash,
    sourceContentHash: contentHash,
    sourceRef: {
      kind: sourceRef.kind,
      worldId: sourceRef.worldId,
      sourceId: sourceRef.sourceId,
      sourceContentHash: sourceRef.sourceContentHash,
    },
    runtimeSourceRef,
  };
}

async function loadRealmSourceDetails(identifier: string): Promise<JsonObject> {
  const realm = getDesktopRealm();
  try {
    const persona = await realm.worldCore.worldCoreControllerGetRealmPersona({
      path: { personaId: identifier },
    });
    const core = asRecord(persona.core);
    const projectedCore = projectRealmPersonaCore(core);
    const worldId = toNonEmptyString(persona.homeWorldId);
    const contentHash = toNonEmptyString(persona.contentHash);
    return {
      id: persona.id,
      ...projectedCore,
      source: core,
      createdAt: persona.createdAt,
      updatedAt: persona.updatedAt,
      visibility: persona.visibility,
      homeWorldId: worldId,
      ownerId: persona.ownerId,
      sourceKind: 'realmPersona',
      sourceId: persona.id,
      contentHash,
      sourceContentHash: contentHash,
      sourceRef: {
        kind: 'realmPersona',
        worldId,
        sourceId: persona.id,
        sourceContentHash: contentHash,
      },
      runtimeSourceRef: null,
    };
  } catch (error) {
    if (!isTypedNotFoundError(error)) {
      throw error;
    }
    const character = await realm.worldCore.worldCoreControllerGetWorldCharacter({
      path: { characterId: identifier },
    });
    const core = asRecord(character.core);
    const projectedCore = projectWorldCharacterCore(core);
    const worldId = toNonEmptyString(character.worldId);
    const contentHash = toNonEmptyString(character.contentHash);
    return {
      id: character.id,
      ...projectedCore,
      source: core,
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
      worldId,
      sourceKind: 'worldCharacter',
      sourceId: character.id,
      contentHash,
      sourceContentHash: contentHash,
      sourceRef: {
        kind: 'worldCharacter',
        worldId,
        sourceId: character.id,
        sourceContentHash: contentHash,
      },
      runtimeSourceRef: null,
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
  loadRealmSourceDetailsBySourceRef: (
    sourceRef: NimiRealmCoreSourceRef,
    context?: { runtimeSourceRef?: string | null },
  ) =>
    loadRealmSourceDetailsBySourceRef(sourceRef, context),
};
