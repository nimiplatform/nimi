import { type Realm } from '@nimiplatform/sdk/realm';
import { type JsonObject } from '@nimiplatform/sdk/types';
import {
  characterSourceRefKey,
  readCharacterSourceRefV3,
  type CharacterSourceRefV3,
} from '../../realm-source/realm-source-identity.js';

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
  core: unknown;
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
  core: unknown;
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
    worldEntityRef?: { entityId?: string };
    worldId?: string;
  },
  worldId: string,
): Promise<JsonObject> {
  const entityId = toNonEmptyString(character.worldEntityRef?.entityId);
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
  sourceRef: CharacterSourceRefV3,
): Promise<JsonObject | null> {
  const detail = await realm.worldPublic.worldPublicControllerGetWorldDetailWithCharacters({
    path: { worldId: sourceRef.worldId },
    query: {},
  });
  const sources = asRecord(detail.sources);
  const sourceRows = [
    ...(Array.isArray(sources.characters) ? sources.characters : []),
    ...(Array.isArray(sources.personaCharacters) ? sources.personaCharacters : []),
  ].map(asRecord);
  const matched = sourceRows.find((source) => {
    const rowRef = readCharacterSourceRefV3(source.sourceRef);
    return rowRef !== null && characterSourceRefKey(rowRef) === characterSourceRefKey(sourceRef);
  });
  if (!matched) {
    return null;
  }
  return asRecord(matched.media);
}

function projectPersonaCharacterProfile(core: JsonObject, publicMedia: JsonObject | null = null): Pick<JsonObject, 'displayName' | 'handle' | 'avatarUrl' | 'portraitUrl' | 'profileCoverUrl' | 'referenceImageUrl' | 'voiceSampleUrl' | 'voiceSample' | 'media' | 'mediaAssets' | 'voiceDesign' | 'bio' | 'archetype' | 'pacing'> {
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
      'PersonaCharacter source detail requires presentation.displayName or identity.name',
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
      'PersonaCharacter source detail requires identity.summary or presentation profile copy',
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

async function loadRealmSourceDetailsBySourceRef(
  realm: Realm,
  sourceRef: CharacterSourceRefV3,
  context?: { runtimeSourceRef?: string | null },
): Promise<JsonObject> {
  const runtimeSourceRef = toNonEmptyString(context?.runtimeSourceRef) || null;
  if (sourceRef.kind === 'personaCharacter') {
    const persona = await realm.worldCore.worldCoreControllerGetPersonaCharacter({
      path: { personaCharacterId: sourceRef.id },
    });
    const worldId = toNonEmptyString(persona.worldId);
    const sourceHash = toNonEmptyString(persona.sourceHash);
    const ownerAccountId = toNonEmptyString(persona.ownerAccountId);
    if (worldId !== sourceRef.worldId
      || sourceHash !== sourceRef.sourceHash
      || ownerAccountId !== sourceRef.ownerAccountId) {
      throw new Error('PersonaCharacter sourceRef is stale or mismatched');
    }
    const core = asRecord(persona.profile);
    const publicMedia = await loadPublicSourceMedia(realm, sourceRef);
    return {
      id: persona.id,
      ...projectPersonaCharacterProfile(core, publicMedia),
      source: core,
      createdAt: persona.createdAt,
      updatedAt: persona.updatedAt,
      visibility: persona.visibility,
      homeWorldId: worldId,
      ownerId: persona.ownerAccountId,
      sourceKind: 'personaCharacter',
      sourceId: persona.id,
      contentHash: persona.contentHash,
      sourceHash,
      sourceRef,
      runtimeSourceRef,
    };
  }

  const character = await realm.worldCore.worldCoreControllerGetWorldCharacter({
    path: { characterId: sourceRef.id },
  });
  const worldId = toNonEmptyString(character.worldId);
  const sourceHash = toNonEmptyString(character.sourceHash);
  if (worldId !== sourceRef.worldId
    || sourceHash !== sourceRef.sourceHash
    || toNonEmptyString(character.worldEntityRef.entityId) !== sourceRef.worldEntityRef.entityId) {
    throw new Error('WorldCharacterCore sourceRef is stale or mismatched');
  }
  const core = asRecord(character.profile);
  const entityId = toNonEmptyString(character.worldEntityRef.entityId);
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
    contentHash: character.contentHash,
    sourceHash,
    sourceRef,
    runtimeSourceRef,
  };
}

export const realmSourceDetailData = {
  loadRealmSourceDetailsBySourceRef: (
    realm: Realm,
    sourceRef: CharacterSourceRefV3,
    context?: { runtimeSourceRef?: string | null },
  ) =>
    loadRealmSourceDetailsBySourceRef(realm, sourceRef, context),
};
