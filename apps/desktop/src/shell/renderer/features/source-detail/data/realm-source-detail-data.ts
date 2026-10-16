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
  projectWorldPublicItem,
  requireWorldPublicDetailDto,
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

// @nimi-authority: rule.nimi.desktop.product-surfaces.r033
// Resolve the actual endpoints, not names, id prefixes or relation-type guesses.
// Shared profile references work identically for Persona and World characters.
async function loadRelationshipTargets(
  realm: Realm,
  profile: CharacterProfileCoreDto,
  relationships: JsonObject[],
  worldId: string,
  selfEntityId?: string,
): Promise<JsonObject> {
  const refs = new Map<string, string>();
  const add = (id: string, targetWorldId: string) => {
    if (!id || id === selfEntityId) return;
    if (refs.has(id) && refs.get(id) !== targetWorldId) {
      throw new Error('Relationship endpoint world mismatch');
    }
    refs.set(id, targetWorldId);
  };
  for (const relation of profile.relationships ?? []) {
    add(relation.targetRef.entityId, relation.targetRef.worldId);
  }
  for (const relation of relationships) {
    add(toNonEmptyString(relation.sourceEntityId), worldId);
    add(toNonEmptyString(relation.targetEntityId), worldId);
  }
  const targets: JsonObject = {};
  // Bound concurrent reads for characters with many incident relationships.
  const entries = [...refs];
  for (let offset = 0; offset < entries.length; offset += 8) {
    await Promise.all(entries.slice(offset, offset + 8).map(async ([entityId, expectedWorldId]) => {
      const response = await realm.worldCore.worldCoreControllerGetWorldEntity({ path: { entityId } })
        .then(value => ({ value })).catch(() => null);
      // Unavailable endpoints remain unclassified background, never a person.
      if (!response) return;
      const entity = response.value;
      if (entity.id !== entityId || entity.worldId !== expectedWorldId) {
        throw new Error('Relationship endpoint identity or world mismatch');
      }
      const projected = projectWorldEntityCore(entity);
      targets[entityId] = { kind: projected.kind, name: projected.name };
    }));
  }
  // A character can have an authored species/entity kind rather than person.
  // Its public WorldCharacter binding is positive evidence; never guess from
  // a species name, entity-id prefix, relationship label or narrative prose.
  for (const targetWorldId of new Set(refs.values())) {
    const unresolved = new Set(entries.filter(([id, refWorld]) => (
      refWorld === targetWorldId && targets[id]
      && !['person', 'human'].includes(String(asRecord(targets[id]).kind))
    )).map(([id]) => id));
    if (unresolved.size === 0) continue;
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    while (unresolved.size > 0) {
      const response = await realm.worldPublic.worldPublicControllerListWorldCharacterCatalog({
        path: { worldId: targetWorldId }, query: { limit: 100, ...(cursor ? { cursor } : {}) },
      }).then(value => ({ value })).catch(() => null);
      if (!response) break;
      for (const item of response.value.items) {
        const card = requireWorldPublicSourceCardDto(item, targetWorldId);
        const ref = readCharacterSourceRefV3(card.sourceRef);
        if (!ref || ref.kind !== 'worldCharacter' || ref.worldId !== targetWorldId) {
          throw new Error('Relationship character catalog source mismatch');
        }
        const id = ref.worldEntityRef.entityId;
        if (unresolved.delete(id)) targets[id] = { ...asRecord(targets[id]), isCharacter: true };
      }
      if (!response.value.hasMore) break;
      const next = response.value.nextCursor;
      if (!next || seenCursors.has(next)) throw new Error('Relationship character catalog cursor did not advance');
      seenCursors.add(next);
      cursor = next;
    }
  }
  return targets;
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

async function loadProfileProjection(
  realm: Realm,
  profile: CharacterProfileCoreDto,
  source: WorldPublicSourceCardDto,
  runtimeSourceRef: string | null,
): Promise<JsonObject> {
  const projection = projectCharacterSourceProfile(profile, source);
  // The source card carries character media only. Resolve the world's public
  // banner when the character has no cover, using the same projection as World.
  let worldBannerUrl: string | null = null;
  if (!projection.profileCoverUrl) {
    // An unavailable optional image must not hide a successfully loaded
    // character. Validate successful replies outside the transport catch so
    // malformed or mismatched public projections still fail closed.
    const world = await realm.worldPublic.worldPublicControllerGetWorld({
      path: { worldId: source.worldId },
    }).then(value => ({ value })).catch(() => null);
    if (world !== null) {
      const banner = projectWorldPublicItem(requireWorldPublicDetailDto(world.value, source.worldId)).bannerUrl;
      worldBannerUrl = typeof banner === 'string' ? banner : null;
    }
  }
  return {
    ...projection,
    worldBannerUrl,
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
      ...await loadProfileProjection(realm, persona.profile, publicSource, runtimeSourceRef),
      relationshipTargets: await loadRelationshipTargets(realm, persona.profile, [], worldId),
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
    ...await loadProfileProjection(realm, character.profile, publicSource, runtimeSourceRef),
    entityId,
    entityContentHash: toNonEmptyString(entity.contentHash),
    entity,
    relationships,
    relationshipTargets: await loadRelationshipTargets(realm, character.profile, relationships, worldId, entityId),
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
