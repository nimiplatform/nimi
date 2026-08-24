import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { ExplorePersonaSourceCardData } from './explore-cards';
import { resolveCharacterSourceRefV3 } from '../realm-source/realm-source-identity.js';
import type { CharacterSourceViewerRelationProjection } from '../realm-source/character-source-profile-projection.js';

type SourceWorldProjection = {
  bannerUrl: string | null;
  name?: string;
};

export type SourceWorldProjectionMap = Map<string, SourceWorldProjection>;

function toRecord(value: unknown): JsonObject | null {
  return parseOptionalJsonObject(value) ?? null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readViewerRelation(value: unknown): CharacterSourceViewerRelationProjection {
  const relation = toRecord(value);
  const state = relation?.state;
  if (!relation || (state !== 'connectable' && state !== 'connected' && state !== 'unavailable')) {
    throw new Error('PersonaCharacter viewerRelation is missing or invalid');
  }
  return {
    state,
    connectionId: asString(relation.connectionId).trim() || null,
    runtimeSourceRef: asString(relation.runtimeSourceRef).trim() || null,
  };
}

function mapPersonaSource(raw: unknown, worldsMap: SourceWorldProjectionMap): ExplorePersonaSourceCardData | null {
  const source = toRecord(raw);
  if (!source) {
    return null;
  }
  const id = asString(source.id).trim();
  if (!id) {
    return null;
  }

  const stats = toRecord(source.stats);

  const displayName = asString(source.displayName).trim()
    || asString(source.name).trim()
    || asString(source.handle).trim()
    || 'Unknown Persona';
  const handle = asString(source.handle).trim()
    || displayName;
  const avatarUrl = asString(source.avatarUrl).trim()
    || null;
  const bio = asString(source.bio).trim()
    || null;
  const isOnline = source.isOnline === true;
  const sourceRef = resolveCharacterSourceRefV3(source);
  if (!sourceRef || sourceRef.kind !== 'personaCharacter') {
    throw new Error('PersonaCharacter sourceRef is missing, invalid, or mismatched');
  }
  if (sourceRef.id !== id) {
    throw new Error('PersonaCharacter sourceRef id mismatch');
  }
  const viewerRelation = readViewerRelation(source.viewerRelation);
  const role = asString(source.role).trim() || null;
  const archetype = asString(source.archetype).trim() || null;
  const cadence = asString(source.cadence).trim() || null;
  const ownership = source.ownership;
  if (ownership !== 'worldOwned' && ownership !== 'userOwned') {
    throw new Error('PersonaCharacter public ownership is missing or invalid');
  }
  const visibility = asString(source.visibility).trim() || null;

  const customTags = Array.isArray(source.tags)
    ? source.tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
  const tags = Array.from(new Set(customTags));

  const worldId = sourceRef.worldId;
  const worldName = asString(source.worldName).trim();
  if (!worldName) {
    throw new Error('PersonaCharacter public worldName is missing');
  }
  const worldData = worldsMap.get(worldId);
  const worldBannerUrl = worldData?.bannerUrl ?? null;

  const friendsCount = asNumber(stats?.friendsCount)
    ?? asNumber(source.friendsCount)
    ?? asNumber(source.friendCount);
  const postsCount = asNumber(stats?.postsCount)
    ?? asNumber(source.postsCount)
    ?? asNumber(source.postCount);
  const likesCount = asNumber(stats?.likesCount)
    ?? asNumber(source.likesCount)
    ?? asNumber(source.likeCount);

  return {
    id,
    name: displayName,
    handle,
    avatarUrl,
    bio,
    sourceRef,
    viewerRelation,
    worldId,
    worldName,
    worldBannerUrl,
    role,
    archetype,
    cadence,
    ownership,
    visibility,
    isOnline,
    tags,
    friendsCount,
    postsCount,
    likesCount,
  };
}

export function parsePersonaSources(personasResult: unknown, worldsMap: SourceWorldProjectionMap): ExplorePersonaSourceCardData[] {
  const payload = toRecord(personasResult);
  const raw = Array.isArray(payload?.items) ? payload.items : [];
  return raw
    .map((item) => mapPersonaSource(item, worldsMap))
    .filter((item): item is ExplorePersonaSourceCardData => item !== null);
}
