import { readMediaDelivery } from '@nimiplatform/kit/features/media/headless';
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

function toPublicHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^https?:\/\//i.test(normalized) ? normalized : null;
}

const RELATIONSHIP_AVATAR_CATALOG_LIMIT = 100;
const RELATIONSHIP_AVATAR_FALLBACK_QUERY_CAP = 12;

async function attachRelationshipTargetAvatars(
  realm: Realm,
  targets: JsonObject,
  characterTargetsByWorld: ReadonlyMap<string, ReadonlyArray<{ entityId: string; name: string }>>,
): Promise<void> {
  if (typeof realm.worldPublic?.worldPublicControllerListCharacterCatalog !== 'function'
    || characterTargetsByWorld.size === 0) {
    return;
  }

  await Promise.all(Array.from(characterTargetsByWorld, async ([targetWorldId, characterTargets]) => {
    const remaining = new Map(characterTargets.map((item) => [item.entityId, item.name]));
    const applyPage = (page: unknown) => {
      const items = asRecord(page).items;
      if (!Array.isArray(items)) return;
      for (const raw of items) {
        const record = asRecord(raw);
        const ref = readCharacterSourceRefV3(record.sourceRef);
        if (!ref || ref.kind !== 'worldCharacter' || ref.worldId !== targetWorldId) continue;
        const entityId = ref.worldEntityRef.entityId;
        if (!remaining.has(entityId)) continue;
        const avatarMedia = readMediaDelivery(record.avatarMedia);
        const avatarUrl = toPublicHttpUrl(record.avatarUrl);
        if (avatarMedia || avatarUrl) {
          const existing = asRecord(targets[entityId]);
          targets[entityId] = {
            ...existing,
            ...(avatarUrl ? { avatarUrl } : {}),
            ...(avatarMedia ? { avatarMedia: avatarMedia as unknown as JsonObject } : {}),
          };
        }
        remaining.delete(entityId);
      }
    };

    const firstPage = await realm.worldPublic.worldPublicControllerListCharacterCatalog({
      path: {},
      query: { worldId: targetWorldId, limit: RELATIONSHIP_AVATAR_CATALOG_LIMIT },
    }).catch(() => null);
    if (!firstPage) return;
    applyPage(firstPage);

    if (firstPage.hasMore && remaining.size > 0) {
      const queries = [...new Set(Array.from(remaining.values(), (name) => name.trim()).filter(Boolean))]
        .slice(0, RELATIONSHIP_AVATAR_FALLBACK_QUERY_CAP);
      const pages = await Promise.all(queries.map((q) => realm.worldPublic.worldPublicControllerListCharacterCatalog({
        path: {},
        query: { worldId: targetWorldId, q, limit: 20 },
      }).catch(() => null)));
      for (const page of pages) {
        if (page) applyPage(page);
      }
    }
  }));
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
  const characterTargetsByWorld = new Map<string, Array<{ entityId: string; name: string }>>();
  for (const [id, targetWorldId] of refs) {
    const ids = byWorld.get(targetWorldId) ?? [];
    ids.push(id);
    byWorld.set(targetWorldId, ids);
  }
  for (const [targetWorldId, ids] of byWorld) {
    for (let offset = 0; offset < ids.length; offset += 100) {
      const entityIds = ids.slice(offset, offset + 100);
      let rows: Awaited<ReturnType<Realm['worldCore']['worldCoreControllerGetRelationshipTargets']>>;
      try {
        rows = await realm.worldCore.worldCoreControllerGetRelationshipTargets({
          path: { worldId: targetWorldId }, body: { entityIds },
        });
      } catch {
        continue;
      }
      if (!rows) continue;
      const expected = new Set(entityIds);
      for (const row of rows) {
        if (row.worldId !== targetWorldId || !expected.delete(row.entityId)) {
          throw new Error('Relationship endpoint identity or world mismatch');
        }
        targets[row.entityId] = { kind: row.kind, name: row.name, ...(row.isCharacter ? { isCharacter: true } : {}) };
        if (row.isCharacter) {
          const characterTargets = characterTargetsByWorld.get(targetWorldId) ?? [];
          characterTargets.push({ entityId: row.entityId, name: row.name });
          characterTargetsByWorld.set(targetWorldId, characterTargets);
        }
      }
    }
  }
  await attachRelationshipTargetAvatars(realm, targets, characterTargetsByWorld);
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

type PersonaCharacterRecord = Awaited<ReturnType<Realm['worldCore']['worldCoreControllerGetPersonaCharacter']>>;
type WorldCharacterRecord = Awaited<ReturnType<Realm['worldCore']['worldCoreControllerGetWorldCharacter']>>;

type PrefetchedPartnerSourcePayload =
  | {
    kind: 'personaCharacter';
    sourceRef: Extract<CharacterSourceRefV3, { kind: 'personaCharacter' }>;
    record: PersonaCharacterRecord;
    publicSource: WorldPublicSourceCardDto;
  }
  | {
    kind: 'worldCharacter';
    sourceRef: Extract<CharacterSourceRefV3, { kind: 'worldCharacter' }>;
    record: WorldCharacterRecord;
    publicSource: WorldPublicSourceCardDto;
  };

// Weakly binds verified records to the resolved PartnerSource projection cached
// in TanStack Query (already account/realm-scoped) so PartnerDetails can skip
// duplicate GetWorldCharacter / GetPersonaCharacter / GetCharacterSource hops.
const prefetchedPartnerSources = new WeakMap<object, PrefetchedPartnerSourcePayload>();

function readMatchingPrefetchedPersona(
  prefetchedSource: object | null | undefined,
  sourceRef: Extract<CharacterSourceRefV3, { kind: 'personaCharacter' }>,
): { persona: PersonaCharacterRecord; publicSource: WorldPublicSourceCardDto } | null {
  if (!prefetchedSource) return null;
  const cached = prefetchedPartnerSources.get(prefetchedSource);
  if (!cached || cached.kind !== 'personaCharacter') return null;
  if (characterSourceRefKey(cached.sourceRef) !== characterSourceRefKey(sourceRef)) return null;
  if (!cached.record.profile || typeof cached.record.profile !== 'object') return null;
  if (
    toNonEmptyString(cached.record.id) !== sourceRef.id
    || toNonEmptyString(cached.record.worldId) !== sourceRef.worldId
    || toNonEmptyString(cached.record.sourceHash) !== sourceRef.sourceHash
    || toNonEmptyString(cached.record.ownerAccountId) !== sourceRef.ownerAccountId
  ) {
    return null;
  }
  const returnedSourceRef = readCharacterSourceRefV3(cached.publicSource.sourceRef);
  if (!returnedSourceRef || characterSourceRefKey(returnedSourceRef) !== characterSourceRefKey(sourceRef)) {
    return null;
  }
  return { persona: cached.record, publicSource: cached.publicSource };
}

function readMatchingPrefetchedWorldCharacter(
  prefetchedSource: object | null | undefined,
  sourceRef: Extract<CharacterSourceRefV3, { kind: 'worldCharacter' }>,
): { character: WorldCharacterRecord; publicSource: WorldPublicSourceCardDto } | null {
  if (!prefetchedSource) return null;
  const cached = prefetchedPartnerSources.get(prefetchedSource);
  if (!cached || cached.kind !== 'worldCharacter') return null;
  if (characterSourceRefKey(cached.sourceRef) !== characterSourceRefKey(sourceRef)) return null;
  if (!cached.record.profile || typeof cached.record.profile !== 'object') return null;
  if (
    toNonEmptyString(cached.record.id) !== sourceRef.id
    || toNonEmptyString(cached.record.worldId) !== sourceRef.worldId
    || toNonEmptyString(cached.record.sourceHash) !== sourceRef.sourceHash
    || toNonEmptyString(cached.record.worldEntityRef?.entityId) !== sourceRef.worldEntityRef.entityId
  ) {
    return null;
  }
  const returnedSourceRef = readCharacterSourceRefV3(cached.publicSource.sourceRef);
  if (!returnedSourceRef || characterSourceRefKey(returnedSourceRef) !== characterSourceRefKey(sourceRef)) {
    return null;
  }
  return { character: cached.record, publicSource: cached.publicSource };
}

async function loadWorldBanner(
  realm: Realm,
  worldId: string,
): Promise<{ worldBannerUrl: string | null; worldBannerMedia: unknown }> {
  // Resolve the shared world banner with the same projection as World.
  // An unavailable optional image must not hide a successfully loaded
  // character. Validate successful replies outside the transport catch so
  // malformed or mismatched public projections still fail closed.
  let worlds: Awaited<ReturnType<Realm['worldPublic']['worldPublicControllerGetWorldCatalogByIds']>>;
  try {
    worlds = await realm.worldPublic.worldPublicControllerGetWorldCatalogByIds({
      path: {}, body: { worldIds: [worldId] },
    });
  } catch {
    return { worldBannerUrl: null, worldBannerMedia: null };
  }
  const [projected] = projectWorldSummaryBatch(worlds, [worldId]);
  return {
    worldBannerUrl: typeof projected?.bannerUrl === 'string' ? projected.bannerUrl : null,
    worldBannerMedia: projected?.bannerMedia ?? null,
  };
}

function buildProfileProjection(
  profile: CharacterProfileCoreDto,
  source: WorldPublicSourceCardDto,
  worldBanner: { worldBannerUrl: string | null; worldBannerMedia: unknown },
  runtimeSourceRef: string | null,
): JsonObject {
  const projection = projectCharacterSourceProfile(profile, source);
  return {
    ...projection,
    worldBannerUrl: worldBanner.worldBannerUrl,
    worldBannerMedia: worldBanner.worldBannerMedia,
    runtimeSourceRef: projection.viewerRelation.runtimeSourceRef ?? runtimeSourceRef,
  } as unknown as JsonObject;
}

async function loadRealmSourceDetailsBySourceRef(
  realm: Realm,
  sourceRef: CharacterSourceRefV3,
  context?: { runtimeSourceRef?: string | null; prefetchedSource?: object | null },
): Promise<JsonObject> {
  const runtimeSourceRef = toNonEmptyString(context?.runtimeSourceRef) || null;
  if (sourceRef.kind === 'personaCharacter') {
    const prefetched = readMatchingPrefetchedPersona(context?.prefetchedSource, sourceRef);
    const persona = prefetched
      ? prefetched.persona
      : await realm.worldCore.worldCoreControllerGetPersonaCharacter({
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
    const [publicSource, worldBanner, relationshipTargets] = await Promise.all([
      prefetched ? Promise.resolve(prefetched.publicSource) : loadPublicSourceCard(realm, sourceRef),
      loadWorldBanner(realm, worldId),
      loadRelationshipTargets(realm, persona.profile, [], worldId),
    ]);
    const projection = buildProfileProjection(persona.profile, publicSource, worldBanner, runtimeSourceRef);
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

  const prefetched = readMatchingPrefetchedWorldCharacter(context?.prefetchedSource, sourceRef);
  const character = prefetched
    ? prefetched.character
    : await realm.worldCore.worldCoreControllerGetWorldCharacter({
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
  const [entity, relationships, publicSource, worldBanner] = await Promise.all([
    loadBoundWorldEntityProjection(realm, character, worldId),
    loadWorldCharacterRelationshipProjections(realm, entityId, worldId),
    prefetched ? Promise.resolve(prefetched.publicSource) : loadPublicSourceCard(realm, sourceRef),
    loadWorldBanner(realm, worldId),
  ]);
  const relationshipTargets = await loadRelationshipTargets(
    realm,
    character.profile,
    relationships,
    worldId,
    entityId,
  );
  const projection = buildProfileProjection(character.profile, publicSource, worldBanner, runtimeSourceRef);
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
    context?: { runtimeSourceRef?: string | null; prefetchedSource?: object | null },
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
  const result = {
    sourceRef: current,
    displayName: card.displayName,
    worldName: card.worldName,
    summary: card.summary,
    media: card.media,
    updated: current.sourceHash !== captured.sourceHash,
    preview: {
      role: card.role ?? null,
      species: display.speciesDescription ?? null,
      topics: card.topics,
      voice: voice && display.voiceSampleUrl ? { url: display.voiceSampleUrl, durationSec: voice.durationSec ?? null } : null,
    },
  };
  if (current.kind === 'personaCharacter') {
    prefetchedPartnerSources.set(result, {
      kind: 'personaCharacter',
      sourceRef: current,
      record: value as PersonaCharacterRecord,
      publicSource: card,
    });
  } else {
    prefetchedPartnerSources.set(result, {
      kind: 'worldCharacter',
      sourceRef: current,
      record: value as WorldCharacterRecord,
      publicSource: card,
    });
  }
  return result;
}
