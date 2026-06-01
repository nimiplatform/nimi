import { extractNimiErrorFields, ReasonCode } from '@nimiplatform/sdk/types';
import { toProfileData, type ProfileData, type ProfileSource } from '@renderer/features/profile/profile-model';

export type RestrictedContactProfileSeed = {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl?: string | null;
  bio?: string | null;
  isAgent: boolean;
  isOnline?: boolean;
  createdAt?: string | null;
  friendsSince?: string | null;
  tags?: string[];
  city?: string | null;
  countryCode?: string | null;
  gender?: string | null;
  worldName?: string | null;
  worldBannerUrl?: string | null;
  friendsCount?: number;
  postsCount?: number;
  likesCount?: number;
  giftStats?: Record<string, number>;
  agentState?: string | null;
  agentCategory?: string | null;
  agentOrigin?: string | null;
  agentTier?: string | null;
  agentWakeStrategy?: string | null;
  agentOwnershipType?: string | null;
  agentWorldId?: string | null;
  agentOwnerWorldId?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readStatus(value: unknown): number | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const details = asRecord(record.details);
  const direct = Number(record.status || record.statusCode || record.httpStatus);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }
  const nested = Number(details?.httpStatus || details?.status || details?.statusCode);
  return Number.isFinite(nested) && nested > 0 ? nested : null;
}

export function isPrivateProfileAccessError(error: unknown): boolean {
  const fields = extractNimiErrorFields(error);
  const reasonCode = String(fields.reasonCode || '').trim().toUpperCase();
  if (reasonCode === ReasonCode.PRINCIPAL_UNAUTHORIZED) {
    return true;
  }
  return readStatus(error) === 403;
}

function toStats(seed: RestrictedContactProfileSeed): ProfileSource['stats'] {
  const hasStats = typeof seed.friendsCount === 'number'
    || typeof seed.postsCount === 'number'
    || typeof seed.likesCount === 'number';
  if (!hasStats) {
    return null;
  }
  return {
    friendsCount: seed.friendsCount ?? 0,
    postsCount: seed.postsCount ?? 0,
    likesCount: seed.likesCount ?? 0,
  };
}

export function toRestrictedContactProfileData(seed: RestrictedContactProfileSeed): ProfileData {
  const profile = toProfileData({
    id: seed.id,
    displayName: seed.displayName,
    handle: seed.handle,
    avatarUrl: seed.avatarUrl ?? null,
    bio: seed.bio ?? null,
    isAgent: seed.isAgent,
    isOnline: seed.isOnline === true,
    createdAt: seed.createdAt || seed.friendsSince || '',
    tags: seed.tags ?? [],
    city: seed.city ?? null,
    countryCode: seed.countryCode ?? null,
    gender: seed.gender ?? null,
    worldName: seed.worldName ?? null,
    worldBannerUrl: seed.worldBannerUrl ?? null,
    stats: toStats(seed),
    giftStats: seed.giftStats ?? null,
    agent: {
      state: seed.agentState ?? null,
      category: seed.agentCategory ?? null,
      origin: seed.agentOrigin ?? null,
      tier: seed.agentTier ?? null,
      wakeStrategy: seed.agentWakeStrategy ?? null,
      ownershipType: seed.agentOwnershipType ?? null,
      worldId: seed.agentWorldId ?? null,
      ownerWorldId: seed.agentOwnerWorldId ?? null,
    },
    isFriend: true,
    isPendingFriendRequest: false,
  });
  return {
    ...profile,
    accessState: 'restricted',
  };
}
