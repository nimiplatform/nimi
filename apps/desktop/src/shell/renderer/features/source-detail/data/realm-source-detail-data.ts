import { type NimiRealmCoreSourceRef, type Realm } from '@nimiplatform/sdk/realm';
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

function readPublicUrlString(value: unknown): string | null {
  const normalized = toNonEmptyString(value);
  return /^https?:\/\//i.test(normalized) ? normalized : null;
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
      if (readPublicUrlString(uri)) return uri;
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

function readWorldStudioVoiceDesign(core: JsonObject): JsonObject | null {
  const authoring = asRecord(core.authoring);
  const extensions = asRecord(authoring.extensions);
  const worldStudioSettings = asRecord(extensions.worldStudioSettings);
  const voice = asRecord(worldStudioSettings.voice);
  return Object.keys(voice).length > 0 ? voice : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => toNonEmptyString(item)).filter(Boolean)
    : [];
}

function readEntityFacts(core: JsonObject): JsonObject[] {
  const facts = Array.isArray(core.facts) ? core.facts : [];
  return facts
    .map(asRecord)
    .filter((fact) => Object.keys(fact).length > 0);
}

function projectWorldEntityCore(entity: {
  id: string;
  kind: string;
  contentHash: string;
  core: Record<string, unknown>;
}): JsonObject {
  const core = asRecord(entity.core);
  const identity = asRecord(core.identity);
  const classification = asRecord(core.classification);
  const name = toNonEmptyString(identity.name);
  const kind = toNonEmptyString(entity.kind) || toNonEmptyString(identity.kind);
  const contentHash = toNonEmptyString(entity.contentHash);
  if (!name || !kind || !contentHash) {
    throw new Error('WorldEntityCore source detail requires identity.name, kind, and contentHash');
  }
  return {
    id: entity.id,
    kind,
    name,
    summary: toNonEmptyString(identity.summary) || null,
    contentHash,
    tags: readStringArray(classification.tags),
    facts: readEntityFacts(core),
  };
}

function projectWorldRelationshipCore(relationship: {
  id: string;
  type: string;
  worldId: string;
  sourceEntityId: string;
  targetEntityId: string;
  contentHash: string;
  core: Record<string, unknown>;
}): JsonObject {
  return {
    id: relationship.id,
    type: relationship.type,
    worldId: relationship.worldId,
    sourceEntityId: relationship.sourceEntityId,
    targetEntityId: relationship.targetEntityId,
    contentHash: relationship.contentHash,
    core: asRecord(relationship.core),
  };
}

async function loadBoundWorldEntityProjection(
  realm: Realm,
  character: {
    entityId?: string;
    worldId?: string;
  },
  worldId: string,
): Promise<JsonObject> {
  const entityId = toNonEmptyString(character.entityId);
  if (!entityId) {
    throw new Error('WorldCharacterCore source detail requires entityId');
  }
  const entity = await realm.worldCore.worldCoreControllerGetWorldEntity({
    path: { entityId },
  });
  const entityWorldId = toNonEmptyString(entity.worldId);
  if (entityWorldId !== worldId) {
    throw new Error('WorldCharacterCore entity world mismatch');
  }
  return projectWorldEntityCore(entity);
}

async function loadWorldCharacterRelationshipProjections(
  realm: Realm,
  entityId: string,
  worldId: string,
): Promise<JsonObject[]> {
  const relationships = await realm.worldCore.worldCoreControllerListWorldRelationships({
    path: { worldId },
    query: { entityId, take: 500 },
  });
  return relationships.map(projectWorldRelationshipCore);
}

function readPublicSourceMediaAsset(media: JsonObject | null, kind: string): JsonObject | null {
  const assets = asRecord(media?.assets);
  const asset = asRecord(assets[kind]);
  const id = toNonEmptyString(asset.id);
  const url = readPublicUrlString(asset.url);
  if (!id || !url) {
    return null;
  }
  return {
    ...asset,
    id,
    url,
  };
}

function readPublicSourceMediaUrl(media: JsonObject | null, kind: string, scalarKey: string): string | null {
  const asset = readPublicSourceMediaAsset(media, kind);
  return readPublicUrlString(asset?.url) ?? readPublicUrlString(media?.[scalarKey]);
}

function projectPublicSourceMedia(media: JsonObject | null): JsonObject {
  const avatarAsset = readPublicSourceMediaAsset(media, 'avatar');
  const portraitAsset = readPublicSourceMediaAsset(media, 'portrait');
  const profileCoverAsset = readPublicSourceMediaAsset(media, 'profileCover');
  const referenceImageAsset = readPublicSourceMediaAsset(media, 'referenceImage');
  const voiceSampleAsset = readPublicSourceMediaAsset(media, 'voiceSample');
  return {
    media: media ?? null,
    avatarUrl:
      readPublicSourceMediaUrl(media, 'avatar', 'avatarUrl') ??
      readPublicSourceMediaUrl(media, 'portrait', 'portraitUrl') ??
      readPublicSourceMediaUrl(media, 'referenceImage', 'referenceImageUrl'),
    portraitUrl: readPublicSourceMediaUrl(media, 'portrait', 'portraitUrl'),
    profileCoverUrl: readPublicSourceMediaUrl(media, 'profileCover', 'profileCoverUrl'),
    referenceImageUrl: readPublicSourceMediaUrl(media, 'referenceImage', 'referenceImageUrl'),
    voiceSampleUrl: readPublicSourceMediaUrl(media, 'voiceSample', 'voiceSampleUrl'),
    voiceSample: voiceSampleAsset,
    mediaAssets: {
      avatar: avatarAsset,
      portrait: portraitAsset,
      profileCover: profileCoverAsset,
      referenceImage: referenceImageAsset,
      voiceSample: voiceSampleAsset,
    },
  };
}

async function loadPublicSourceMedia(
  realm: Realm,
  sourceRef: NimiRealmCoreSourceRef,
): Promise<JsonObject | null> {
  const detail = await realm.worldPublic.worldPublicControllerGetWorldDetailWithCharacters({
    path: { worldId: sourceRef.worldId },
    query: {},
  });
  const sources = asRecord(detail.sources);
  const sourceRows = [
    ...(Array.isArray(sources.characters) ? sources.characters : []),
    ...(Array.isArray(sources.personas) ? sources.personas : []),
  ].map(asRecord);
  const matched = sourceRows.find((source) => {
    const rowRef = asRecord(source.sourceRef);
    return toNonEmptyString(rowRef.kind) === sourceRef.kind
      && toNonEmptyString(rowRef.worldId) === sourceRef.worldId
      && toNonEmptyString(rowRef.sourceId) === sourceRef.sourceId
      && toNonEmptyString(rowRef.sourceContentHash) === sourceRef.sourceContentHash;
  });
  if (!matched) {
    return null;
  }
  return asRecord(matched.media);
}

function projectRealmPersonaCore(core: JsonObject, publicMedia: JsonObject | null = null): Pick<JsonObject, 'displayName' | 'handle' | 'avatarUrl' | 'portraitUrl' | 'profileCoverUrl' | 'referenceImageUrl' | 'voiceSampleUrl' | 'voiceSample' | 'media' | 'mediaAssets' | 'voiceDesign' | 'bio' | 'archetype' | 'pacing'> {
  const identity = asRecord(core.identity);
  const presentation = asRecord(core.presentation);
  const personaStyle = asRecord(core.personaStyle);
  const media = projectPublicSourceMedia(publicMedia);
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
    media: media.media,
    mediaAssets: media.mediaAssets,
    portraitUrl: media.portraitUrl,
    voiceSampleUrl: media.voiceSampleUrl,
    voiceSample: media.voiceSample,
    avatarUrl: toNonEmptyString(media.avatarUrl)
      || readExternalAssetUri(core, ['avatar', 'referenceImage', 'portrait']),
    profileCoverUrl: toNonEmptyString(media.profileCoverUrl)
      || readExternalAssetUri(core, ['profileCover', 'cover']),
    referenceImageUrl: toNonEmptyString(media.referenceImageUrl)
      || readExternalAssetUri(core, ['referenceImage']),
    voiceDesign: readWorldStudioVoiceDesign(core),
    archetype: toNonEmptyString(personaStyle.archetype) || null,
    pacing: toNonEmptyString(personaStyle.pacing) || null,
    bio: requireProjectedText(
      bio,
      'RealmPersona source detail requires identity.summary or presentation profile copy',
    ),
  };
}

function projectWorldCharacterCore(core: JsonObject, publicMedia: JsonObject | null = null): Pick<JsonObject, 'displayName' | 'handle' | 'avatarUrl' | 'portraitUrl' | 'profileCoverUrl' | 'referenceImageUrl' | 'voiceSampleUrl' | 'voiceSample' | 'media' | 'mediaAssets' | 'voiceDesign' | 'bio'> {
  const identity = asRecord(core.identity);
  const presentation = asRecord(core.presentation);
  const media = projectPublicSourceMedia(publicMedia);
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
    media: media.media,
    mediaAssets: media.mediaAssets,
    portraitUrl: media.portraitUrl,
    voiceSampleUrl: media.voiceSampleUrl,
    voiceSample: media.voiceSample,
    avatarUrl: toNonEmptyString(media.avatarUrl)
      || readExternalAssetUri(core, ['avatar', 'referenceImage', 'portrait']),
    profileCoverUrl: toNonEmptyString(media.profileCoverUrl)
      || readExternalAssetUri(core, ['profileCover', 'cover']),
    referenceImageUrl: toNonEmptyString(media.referenceImageUrl)
      || readExternalAssetUri(core, ['referenceImage']),
    voiceDesign: readWorldStudioVoiceDesign(core),
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
    const publicMedia = await loadPublicSourceMedia(realm, sourceRef);
    return {
      id: persona.id,
      ...projectRealmPersonaCore(core, publicMedia),
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
  const entityId = toNonEmptyString(character.entityId);
  if (!entityId) {
    throw new Error('WorldCharacterCore source detail requires entityId');
  }
  const [entity, relationships] = await Promise.all([
    loadBoundWorldEntityProjection(realm, character, worldId),
    loadWorldCharacterRelationshipProjections(realm, entityId, worldId),
  ]);
  const publicMedia = await loadPublicSourceMedia(realm, sourceRef);
  return {
    id: character.id,
    ...projectWorldCharacterCore(core, publicMedia),
    source: core,
    entityId,
    entityContentHash: toNonEmptyString(entity.contentHash),
    entity,
    relationships,
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
    const worldId = toNonEmptyString(persona.homeWorldId);
    const contentHash = toNonEmptyString(persona.contentHash);
    const sourceRef: NimiRealmCoreSourceRef = {
      kind: 'realmPersona',
      worldId,
      sourceId: persona.id,
      sourceContentHash: contentHash,
    };
    const publicMedia = await loadPublicSourceMedia(realm, sourceRef);
    const projectedCore = projectRealmPersonaCore(core, publicMedia);
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
        ...sourceRef,
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
    const worldId = toNonEmptyString(character.worldId);
    const contentHash = toNonEmptyString(character.contentHash);
    const sourceRef: NimiRealmCoreSourceRef = {
      kind: 'worldCharacter',
      worldId,
      sourceId: character.id,
      sourceContentHash: contentHash,
    };
    const publicMedia = await loadPublicSourceMedia(realm, sourceRef);
    const projectedCore = projectWorldCharacterCore(core, publicMedia);
    const entityId = toNonEmptyString(character.entityId);
    if (!entityId) {
      throw new Error('WorldCharacterCore source detail requires entityId', { cause: error });
    }
    const [entity, relationships] = await Promise.all([
      loadBoundWorldEntityProjection(realm, character, worldId),
      loadWorldCharacterRelationshipProjections(realm, entityId, worldId),
    ]);
    return {
      id: character.id,
      ...projectedCore,
      source: core,
      entityId,
      entityContentHash: toNonEmptyString(entity.contentHash),
      entity,
      relationships,
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
      worldId,
      sourceKind: 'worldCharacter',
      sourceId: character.id,
      contentHash,
      sourceContentHash: contentHash,
      sourceRef: {
        ...sourceRef,
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
