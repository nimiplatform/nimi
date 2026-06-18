import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { RealmPersonaSourceState } from '@renderer/features/explore/realm-persona-source-admission';
import type { NimiRealmCoreSourceRef } from '@nimiplatform/sdk/realm';

export type SourceDetailData = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: string;
  tags: string[];
  isOnline: boolean;
  state: string | null;
  archetype: string | null;
  origin: string | null;
  tier: string | null;
  pacing: string | null;
  visibility: string | null;
  ownershipType: string | null;
  worldId: string | null;
  sourceKind: NimiRealmCoreSourceRef['kind'] | null;
  sourceId: string | null;
  sourceContentHash: string | null;
  runtimeSourceRef: string | null;
  sourceRef: NimiRealmCoreSourceRef | null;
  isFriend: boolean;
  sourceState: RealmPersonaSourceState;
  worldBannerUrl: string | null;
};

function readOptionalString(record: JsonObject | null | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}

export function toSourceDetailData(
  raw: JsonObject,
  sourceState: RealmPersonaSourceState,
): SourceDetailData {
  const sourceRecord = parseOptionalJsonObject(raw.source);
  const world = parseOptionalJsonObject(raw.world);
  const personaStyle = parseOptionalJsonObject(sourceRecord?.personaStyle);
  const sourceKindRaw = String(raw.sourceKind || '').trim();
  const sourceKind: NimiRealmCoreSourceRef['kind'] | null = sourceKindRaw === 'worldCharacter' || sourceKindRaw === 'realmPersona'
    ? sourceKindRaw
    : null;
  const worldId = (
    (sourceRecord && typeof sourceRecord.worldId === 'string' ? sourceRecord.worldId : null)
    || (typeof raw.homeWorldId === 'string' ? raw.homeWorldId : null)
    || (typeof raw.worldId === 'string' ? raw.worldId : null)
  );
  const sourceId = typeof raw.sourceId === 'string' && raw.sourceId.trim()
    ? raw.sourceId.trim()
    : String(raw.id || '').trim() || null;
  const sourceContentHash = (
    (typeof raw.sourceContentHash === 'string' ? raw.sourceContentHash.trim() : '')
    || (typeof raw.contentHash === 'string' ? raw.contentHash.trim() : '')
    || readOptionalString(sourceRecord, 'sourceContentHash')
    || readOptionalString(sourceRecord, 'contentHash')
  );
  const sourceRef: NimiRealmCoreSourceRef | null = sourceKind && worldId && sourceId && sourceContentHash
    ? {
        kind: sourceKind,
        worldId,
        sourceId,
        sourceContentHash,
      }
    : null;
  const displayName = typeof raw.displayName === 'string' ? raw.displayName.trim() : '';
  if (!displayName) {
    throw new Error('Source detail projection requires displayName from Realm Core');
  }

  return {
    id: String(raw.id || ''),
    displayName,
    handle: String(raw.handle || ''),
    avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : null,
    bio: typeof raw.bio === 'string' ? raw.bio : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    isOnline: raw.isOnline === true,
    state: readOptionalString(sourceRecord, 'state'),
    archetype: (
      (typeof raw.archetype === 'string' ? raw.archetype : null)
      || readOptionalString(personaStyle, 'archetype')
    ),
    origin: readOptionalString(sourceRecord, 'origin'),
    tier: readOptionalString(sourceRecord, 'tier'),
    pacing: (
      (typeof raw.pacing === 'string' ? raw.pacing : null)
      || readOptionalString(personaStyle, 'pacing')
    ),
    visibility: (
      (typeof raw.visibility === 'string' ? raw.visibility : null)
      || (sourceRecord && typeof sourceRecord.visibility === 'string' ? sourceRecord.visibility : null)
    ),
    ownershipType: readOptionalString(sourceRecord, 'ownershipType'),
    worldId,
    sourceKind,
    sourceId,
    sourceContentHash,
    runtimeSourceRef: (
      (typeof raw.runtimeSourceRef === 'string' ? raw.runtimeSourceRef.trim() : '')
      || null
    ),
    sourceRef,
    isFriend: raw.isFriend === true,
    sourceState,
    worldBannerUrl: (
      (typeof raw.worldBannerUrl === 'string' ? raw.worldBannerUrl : null)
      || readOptionalString(sourceRecord, 'worldBannerUrl')
      || readOptionalString(world, 'bannerUrl')
    ),
  };
}

export function getSourceInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

export function getStateBadgeColor(state: string): { bg: string; text: string; dot: string } {
  switch (state) {
    case 'ACTIVE':
      return { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' };
    case 'READY':
      return { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500' };
    case 'INCUBATING':
      return { bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500' };
    case 'SUSPENDED':
      return { bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500' };
    case 'FAILED':
      return { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' };
    default:
      return { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' };
  }
}
