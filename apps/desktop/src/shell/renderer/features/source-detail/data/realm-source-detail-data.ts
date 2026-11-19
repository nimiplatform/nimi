import { projectWorldSummaryBatch } from '../../world/data/realm-world-data.js';
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
  projectWorldPublicSourceCard,
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
  const byWorld = new Map<string, string[]>();
  for (const [id, targetWorldId] of refs) {
    const ids = byWorld.get(targetWorldId) ?? [];
    ids.push(id);
    byWorld.set(targetWorldId, ids);
  }
  for (const [targetWorldId, ids] of byWorld) {
    for (let offset = 0; offset < ids.length; offset += 100) {
      const entityIds = ids.slice(offset, offset + 100);
      const rows = await realm.worldCore.worldCoreControllerGetRelationshipTargets({
        path: { worldId: targetWorldId }, body: { entityIds },
      }).catch(() => null);
      if (!rows) continue;
      const expected = new Set(entityIds);
      for (const row of rows) {
        if (row.worldId !== targetWorldId || !expected.delete(row.entityId)) {
          throw new Error('Relationship endpoint identity or world mismatch');
        }
        targets[row.entityId] = { kind: row.kind, name: row.name, ...(row.isCharacter ? { isCharacter: true } : {}) };
      }
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
  // Resolve the shared world banner with the same projection as World.
  let worldBannerUrl: string | null = null;
  let worldBannerMedia: unknown = null;
  // An unavailable optional image must not hide a successfully loaded
  // character. Validate successful replies outside the transport catch so
  // malformed or mismatched public projections still fail closed.
  const worlds = await realm.worldPublic.worldPublicControllerGetWorldCatalogByIds({
    path: {}, body: { worldIds: [source.worldId] },
  }).catch(() => null);
  if (worlds) {
    const [projected] = projectWorldSummaryBatch(worlds, [source.worldId]);
    worldBannerUrl = typeof projected?.bannerUrl === 'string' ? projected.bannerUrl : null;
    worldBannerMedia = projected?.bannerMedia ?? null;
  }
  return {
    ...projection,
    worldBannerUrl,
    worldBannerMedia,
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
    const [projection, relationshipTargets] = await Promise.all([
      loadProfileProjection(realm, persona.profile, publicSource, runtimeSourceRef),
      loadRelationshipTargets(realm, persona.profile, [], worldId),
    ]);
    return {
      id: persona.id,
      ...projection,
      relationshipTargets,
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
  const [projection, relationshipTargets] = await Promise.all([
    loadProfileProjection(realm, character.profile, publicSource, runtimeSourceRef),
    loadRelationshipTargets(realm, character.profile, relationships, worldId, entityId),
  ]);
  return {
    id: character.id,
    ...projection,
    entityId,
    entityContentHash: toNonEmptyString(entity.contentHash),
    entity,
    relationships,
    relationshipTargets,
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

// @nimi-authority: rule.nimi.desktop.product-surfaces.partner-source-navigation
export async function resolveCurrentPartnerSource(realm: Realm, captured: CharacterSourceRefV3) {
  const value = captured.kind === 'personaCharacter'
    ? await realm.worldCore.worldCoreControllerGetPersonaCharacter({ path: { personaCharacterId: captured.id } })
    : await realm.worldCore.worldCoreControllerGetWorldCharacter({ path: { characterId: captured.id } });
  const current = readCharacterSourceRefV3(captured.kind === 'personaCharacter'
    ? { kind: captured.kind, id: value.id, worldId: value.worldId, sourceHash: value.sourceHash,
        ownerAccountId: 'ownerAccountId' in value ? value.ownerAccountId : '' }
    : { kind: captured.kind, id: value.id, worldId: value.worldId, sourceHash: value.sourceHash,
        worldEntityRef: 'worldEntityRef' in value ? value.worldEntityRef : null });
  const matches = current && current.kind === captured.kind && current.id === captured.id && current.worldId === captured.worldId
    && (current.kind === 'personaCharacter' && captured.kind === 'personaCharacter' ? current.ownerAccountId === captured.ownerAccountId
      : current.kind === 'worldCharacter' && captured.kind === 'worldCharacter' && current.worldEntityRef.entityId === captured.worldEntityRef.entityId);
  if (!matches || !current) throw new Error('Current character identity no longer matches this partner source.');
  const card = await loadPublicSourceCard(realm, current);
  const display = projectWorldPublicSourceCard(card);
  const voice = display.mediaAssets?.voiceSample;
  return { sourceRef: current, displayName: card.displayName, worldName: card.worldName,
    summary: card.summary, media: card.media, updated: current.sourceHash !== captured.sourceHash,
    preview: {
      role: card.role ?? null,
      species: display.speciesDescription ?? null,
      topics: card.topics,
      voice: voice && display.voiceSampleUrl ? { url: display.voiceSampleUrl, durationSec: voice.durationSec ?? null } : null,
    } };
}
