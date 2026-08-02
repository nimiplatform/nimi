import { type Realm } from '@nimiplatform/sdk/realm';
import { type JsonObject } from '@nimiplatform/sdk/types';
import {
  characterSourceRefKey,
  readCharacterSourceRefV3,
  type CharacterSourceRefV3,
} from '../../realm-source/realm-source-identity.js';
import {
  projectCharacterSourceProfile,
  type CharacterProfileCoreDto,
} from '../../realm-source/character-source-profile-projection.js';
import {
  requireWorldPublicSourceCardDto,
  type WorldPublicSourceCardDto,
} from '../../world/data/world-public-projection.js';

function toNonEmptyString(value: unknown): string {
  return String(value || '').trim();
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
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

async function loadPublicSourceCard(
  realm: Realm,
  sourceRef: CharacterSourceRefV3,
): Promise<WorldPublicSourceCardDto> {
  const source = requireWorldPublicSourceCardDto(
    await realm.worldPublic.worldPublicControllerGetCharacterSource({
      path: {},
      body: { sourceRef },
    }),
    sourceRef.worldId,
  );
  const returnedSourceRef = readCharacterSourceRefV3(source.sourceRef);
  if (!returnedSourceRef
    || characterSourceRefKey(returnedSourceRef) !== characterSourceRefKey(sourceRef)) {
    throw new Error('Public Character source projection returned a mismatched sourceRef');
  }
  return source;
}

function projectProfile(
  profile: CharacterProfileCoreDto,
  source: WorldPublicSourceCardDto,
  runtimeSourceRef: string | null,
): JsonObject {
  const projection = projectCharacterSourceProfile(profile, source);
  return {
    ...projection,
    runtimeSourceRef: projection.viewerRelation.runtimeSourceRef ?? runtimeSourceRef,
  } as unknown as JsonObject;
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
    if (toNonEmptyString(persona.id) !== sourceRef.id
      || worldId !== sourceRef.worldId
      || sourceHash !== sourceRef.sourceHash
      || ownerAccountId !== sourceRef.ownerAccountId) {
      throw new Error('PersonaCharacter sourceRef is stale or mismatched');
    }
    const publicSource = await loadPublicSourceCard(realm, sourceRef);
    return {
      id: persona.id,
      ...projectProfile(persona.profile, publicSource, runtimeSourceRef),
      createdAt: persona.createdAt,
      updatedAt: persona.updatedAt,
      visibility: persona.visibility,
      worldId,
      ownerId: persona.ownerAccountId,
      sourceKind: 'personaCharacter',
      sourceId: persona.id,
      contentHash: persona.contentHash,
      sourceHash,
      sourceRef,
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
  const entityId = toNonEmptyString(character.worldEntityRef.entityId);
  if (!entityId) {
    throw new Error('WorldCharacterCore source detail requires entityId');
  }
  const [entity, relationships, publicSource] = await Promise.all([
    loadBoundWorldEntityProjection(realm, character, worldId),
    loadWorldCharacterRelationshipProjections(realm, entityId, worldId),
    loadPublicSourceCard(realm, sourceRef),
  ]);
  return {
    id: character.id,
    ...projectProfile(character.profile, publicSource, runtimeSourceRef),
    entityId,
    entityContentHash: toNonEmptyString(entity.contentHash),
    entity,
    relationships,
    createdAt: character.createdAt,
    updatedAt: character.updatedAt,
    visibility: character.visibility,
    worldId,
    sourceKind: 'worldCharacter',
    sourceId: character.id,
    contentHash: character.contentHash,
    sourceHash,
    sourceRef,
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
