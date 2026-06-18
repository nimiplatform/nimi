import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { NimiRealmCoreSourceRef } from '@nimiplatform/sdk/realm';

export type ContactRecord = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  isSource: boolean;
  friendsSince: string | null;
  sourceOwnershipType?: 'MASTER_OWNED' | 'WORLD_OWNED' | null;
  sourceCreatorId?: string | null;
  sourceKind?: NimiRealmCoreSourceRef['kind'];
  sourceId?: string;
  sourceContentHash?: string;
  runtimeSourceRef?: string;
  sourceRef?: NimiRealmCoreSourceRef;
  // World info
  worldId?: string | null;
  worldName?: string | null;
  worldBannerUrl?: string | null;
  // Extended profile fields
  age?: number | null;
  gender?: 'male' | 'female' | 'other' | null;
  location?: string | null;
  tags?: string[];
};

type ContactPayload = JsonObject;

function hasRealmSourceIdentity(item: ContactPayload, sourceRecord: JsonObject | null): boolean {
  if (item.isSource === true) return true;
  if (typeof item.sourceRef === 'string' && item.sourceRef.trim()) return true;
  if (item.sourceRef && typeof item.sourceRef === 'object' && !Array.isArray(item.sourceRef)) return true;
  if (typeof item.runtimeSourceRef === 'string' && item.runtimeSourceRef.trim()) return true;
  if (typeof item.sourceKind === 'string' && item.sourceKind.trim()) return true;
  if (typeof item.originKind === 'string' && item.originKind.trim()) return true;
  return sourceRecord !== null;
}

function normalizeSourceKind(value: unknown): NimiRealmCoreSourceRef['kind'] | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized === 'worldCharacter' || normalized === 'WORLD_CHARACTER') {
    return 'worldCharacter';
  }
  if (normalized === 'realmPersona' || normalized === 'REALM_PERSONA') {
    return 'realmPersona';
  }
  return undefined;
}

function readStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === 'string' && entry.trim() ? entry.trim() : undefined;
}

function readSourceRef(value: unknown): NimiRealmCoreSourceRef | undefined {
  const kind = normalizeSourceKind(readStringField(value, 'kind'));
  const worldId = readStringField(value, 'worldId');
  const sourceId = readStringField(value, 'sourceId');
  const sourceContentHash = readStringField(value, 'sourceContentHash');
  if (!kind || !worldId || !sourceId || !sourceContentHash) {
    return undefined;
  }
  return { kind, worldId, sourceId, sourceContentHash };
}

export function toFriendContact(item: ContactPayload): ContactRecord {
  const handle = String(item.handle || '');
  
  const sourceRecord = parseOptionalJsonObject(item.source) ?? null;
  const isSource = hasRealmSourceIdentity(item, sourceRecord);
  const sourceRefFromPayload = readSourceRef(item.sourceRef);
  const sourceKind = sourceRefFromPayload?.kind ?? normalizeSourceKind(item.sourceKind || sourceRecord?.sourceKind);
  const ownershipRaw = String(item.ownershipType || sourceRecord?.ownershipType || '').trim();
  const sourceOwnershipType = ownershipRaw === 'MASTER_OWNED' || ownershipRaw === 'WORLD_OWNED'
    ? ownershipRaw
    : null;
  
  // Parse tags from various possible formats
  let tags: string[] | undefined;
  if (Array.isArray(item.tags)) {
    tags = item.tags.map((tag) => String(tag));
  } else if (typeof item.tags === 'string') {
    tags = item.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
  }
  
  // Parse age
  let age: number | null = null;
  if (typeof item.age === 'number' && item.age > 0) {
    age = item.age;
  } else if (typeof item.age === 'string') {
    const parsed = parseInt(item.age, 10);
    if (!isNaN(parsed) && parsed > 0) age = parsed;
  }
  
  // Parse gender
  let gender: ContactRecord['gender'] = null;
  const genderStr = String(item.gender || '').toLowerCase();
  if (genderStr === 'male' || genderStr === 'm') gender = 'male';
  else if (genderStr === 'female' || genderStr === 'f') gender = 'female';
  else if (genderStr === 'other' || genderStr === 'o') gender = 'other';
  
  // Parse world info
  const worldData = parseOptionalJsonObject(item.world) ?? null;
  const payloadWorldId = typeof item.worldId === 'string' && item.worldId.trim()
    ? item.worldId.trim()
    : typeof worldData?.id === 'string' && worldData.id.trim()
      ? worldData.id.trim()
      : null;
  const worldId = sourceRefFromPayload?.worldId ?? payloadWorldId;
  const worldName = typeof item.worldName === 'string' ? item.worldName : 
    typeof worldData?.name === 'string' ? worldData.name : null;
  const sourceId = sourceRefFromPayload?.sourceId ?? (String(item.sourceId || item.id || '').trim() || undefined);
  const sourceContentHash = sourceRefFromPayload?.sourceContentHash ?? (String(
    item.sourceContentHash
      || item.contentHash
      || sourceRecord?.sourceContentHash
      || sourceRecord?.contentHash
      || '',
  ).trim() || undefined);
  const sourceRef: NimiRealmCoreSourceRef | undefined = sourceRefFromPayload ?? (sourceKind && worldId && sourceId && sourceContentHash
    ? {
        kind: sourceKind,
        worldId,
        sourceId,
        sourceContentHash,
      }
    : undefined);
  const worldBannerUrl = typeof item.worldBannerUrl === 'string'
    ? item.worldBannerUrl
    : typeof sourceRecord?.worldBannerUrl === 'string'
      ? sourceRecord.worldBannerUrl
      : typeof worldData?.bannerUrl === 'string'
        ? worldData.bannerUrl
        : null;
  
  return {
    id: String(item.id || ''),
    displayName: String(item.displayName || handle || 'Unknown'),
    handle,
    avatarUrl: typeof item.avatarUrl === 'string' ? item.avatarUrl : null,
    bio: typeof item.bio === 'string' ? item.bio : null,
    isSource,
    sourceOwnershipType,
    sourceKind,
    sourceId,
    sourceContentHash,
    runtimeSourceRef: typeof item.runtimeSourceRef === 'string' ? item.runtimeSourceRef : undefined,
    sourceRef,
    friendsSince: typeof item.friendsSince === 'string' ? item.friendsSince : null,
    worldId,
    worldName,
    worldBannerUrl,
    age,
    gender,
    location: typeof item.location === 'string' ? item.location : null,
    tags,
  };
}
