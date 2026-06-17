import { parseOptionalJsonObject, type JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { RealmPersonaSourceState } from '@renderer/features/explore/realm-persona-source-admission';

export type SourceDetailData = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: string;
  tags: string[];
  isOnline: boolean;
  state: string;
  category: string;
  origin: string;
  tier: string;
  wakeStrategy: string;
  accountVisibility: string | null;
  ownershipType: string;
  worldId: string | null;
  ownerWorldId: string | null;
  isFriend: boolean;
  sourceState: RealmPersonaSourceState;
  worldBannerUrl: string | null;
};

function readOptionalString(record: JsonObject | undefined, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}

export function toSourceDetailData(
  raw: JsonObject,
  sourceState: RealmPersonaSourceState,
): SourceDetailData {
  const sourceRecord = parseOptionalJsonObject(raw.agent);
  const sourceProfile = parseOptionalJsonObject(raw.agentProfile);
  const world = parseOptionalJsonObject(raw.world);

  return {
    id: String(raw.id || ''),
    displayName: String(raw.displayName || raw.handle || 'Unknown'),
    handle: String(raw.handle || ''),
    avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : null,
    bio: typeof raw.bio === 'string' ? raw.bio : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    isOnline: raw.isOnline === true,
    state: (sourceRecord && typeof sourceRecord.state === 'string' ? sourceRecord.state : 'UNKNOWN'),
    category: (sourceRecord && typeof sourceRecord.category === 'string' ? sourceRecord.category : 'GENERAL'),
    origin: (sourceRecord && typeof sourceRecord.origin === 'string' ? sourceRecord.origin : 'COMMUNITY'),
    tier: (sourceRecord && typeof sourceRecord.tier === 'string' ? sourceRecord.tier : 'COMMUNITY'),
    wakeStrategy: (sourceRecord && typeof sourceRecord.wakeStrategy === 'string' ? sourceRecord.wakeStrategy : 'PASSIVE'),
    accountVisibility: (
      (sourceRecord && typeof sourceRecord.accountVisibility === 'string' ? sourceRecord.accountVisibility : null)
      || readOptionalString(sourceProfile, 'accountVisibility')
    ),
    ownershipType: (
      (sourceRecord && typeof sourceRecord.ownershipType === 'string' ? sourceRecord.ownershipType : '')
      || readOptionalString(sourceProfile, 'ownershipType')
      || 'MASTER_OWNED'
    ),
    worldId: (
      (sourceRecord && typeof sourceRecord.worldId === 'string' ? sourceRecord.worldId : null)
      || readOptionalString(sourceProfile, 'worldId')
    ),
    ownerWorldId: (
      (sourceRecord && typeof sourceRecord.ownerWorldId === 'string' ? sourceRecord.ownerWorldId : null)
      || readOptionalString(sourceProfile, 'ownerWorldId')
    ),
    isFriend: raw.isFriend === true,
    sourceState,
    worldBannerUrl: (
      (typeof raw.worldBannerUrl === 'string' ? raw.worldBannerUrl : null)
      || readOptionalString(sourceProfile, 'worldBannerUrl')
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
