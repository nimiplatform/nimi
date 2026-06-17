import type { RealmModel } from '@nimiplatform/sdk/realm/generated';

export type ProfileTab = 'Posts' | 'Collections' | 'Likes' | 'Gifts';

export const PROFILE_TABS: ProfileTab[] = ['Posts', 'Collections', 'Likes', 'Gifts'];

export type GiftWallItem = {
  id: string;
  name: string;
  emoji: string;
  iconUrl: string | null;
  energyCost: string;
  count: number;
};

export type ProfileData = {
  accessState: 'full' | 'restricted';
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  isSource: boolean;
  isOnline: boolean;
  isFriend: boolean;
  isPendingFriendRequest: boolean;
  createdAt: string;
  tags: string[];
  languages: string[];
  city: string | null;
  countryCode: string | null;
  gender: string | null;
  stats: { friendsCount: number; postsCount: number; likesCount: number } | null;
  giftStats: Record<string, number>;
  sourceState: string | null;
  sourceCategory: string | null;
  sourceOrigin: string | null;
  sourceTier: string | null;
  sourceAccountVisibility: string | null;
  sourceWakeStrategy: string | null;
  sourceOwnershipType: string | null;
  sourceWorldId: string | null;
  sourceOwnerWorldId: string | null;
  worldName: string | null;
  worldBannerUrl: string | null;
};

type UserProfileDto = RealmModel<'UserProfileDto'>;
type ProfileStatsLike = NonNullable<UserProfileDto['stats']> & {
  likesCount?: number;
  likeCount?: number;
};
type ProfileSourceRecordLike = {
  activeWorldId?: string | null;
  accountVisibility?: string | null;
  category?: string | null;
  importance?: string | null;
  origin?: string | null;
  ownerWorldId?: string | null;
  ownershipType?: string | null;
  state?: string | null;
  tier?: string | null;
  wakeStrategy?: string | null;
  worldId?: string | null;
};
type ProfileSourceProfileLike = {
  activeWorldId?: string | null;
  accountVisibility?: string | null;
  category?: string | null;
  dna?: object | null;
  dnaConfirmedAt?: string | null;
  importance?: string | null;
  origin?: string | null;
  ownerWorldId?: string | null;
  ownershipType?: string | null;
  state?: string | null;
  stats?: object | null;
  tier?: string | null;
  wakeStrategy?: string | null;
  worldId?: string | null;
  worldName?: string | null;
  worldBannerUrl?: string | null;
};
type ProfileWorldLike = {
  name?: string | null;
  bannerUrl?: string | null;
};
type ProfileSourceGeneratedBase = Partial<Omit<
  UserProfileDto,
  | 'avatarUrl'
  | 'bio'
  | 'city'
  | 'countryCode'
  | 'createdAt'
  | 'displayName'
  | 'gender'
  | 'giftStats'
  | 'handle'
  | 'id'
  | 'isSource'
  | 'languages'
  | 'stats'
  | 'tags'
>>;
export type ProfileSource = ProfileSourceGeneratedBase & {
  createdAt?: string | null;
  displayName?: string;
  handle?: string;
  gender?: string | null;
  id?: string;
  isSource?: boolean;
  sourceRef?: string | null;
  runtimeSourceRef?: string | null;
  sourceKind?: string | null;
  originKind?: string | null;
  isCreator?: boolean;
  isVerified?: boolean;
  followerCount?: number;
  followingCount?: number;
  avatarUrl?: string | null;
  bio?: string | null;
  city?: string | null;
  countryCode?: string | null;
  languages?: readonly string[];
  postCount?: number;
  tags?: readonly string[];
  isFriend?: boolean;
  isPendingFriendRequest?: boolean;
  worldId?: string | null;
  sourceWorldId?: string | null;
  sourceConfig?: object | null;
  worldName?: string | null;
  worldBannerUrl?: string | null;
  likesCount?: number;
  likeCount?: number;
  stats?: ProfileStatsLike | null;
  giftStats?: Record<string, unknown> | null;
  source?: ProfileSourceRecordLike | null;
  sourceProfile?: ProfileSourceProfileLike | null;
  world?: ProfileWorldLike | null;
};

function hasRealmSourceIdentity(raw: ProfileSource): boolean {
  if (raw.isSource === true) return true;
  if (typeof raw.sourceRef === 'string' && raw.sourceRef.trim()) return true;
  if (typeof raw.runtimeSourceRef === 'string' && raw.runtimeSourceRef.trim()) return true;
  if (typeof raw.sourceKind === 'string' && raw.sourceKind.trim()) return true;
  if (typeof raw.originKind === 'string' && raw.originKind.trim()) return true;
  return Boolean(raw.source) || Boolean(raw.sourceProfile);
}

export function toProfileData(raw: ProfileSource): ProfileData {
  const sourceRecord = raw.source ?? undefined;
  const stats = raw.stats;
  const giftStats = raw.giftStats;
  const sourceProfile = raw.sourceProfile ?? undefined;
  const world = raw.world;

  const parsedGiftStats: Record<string, number> = {};
  if (giftStats) {
    for (const [key, val] of Object.entries(giftStats)) {
      if (typeof val === 'number') parsedGiftStats[key] = val;
    }
  }

  return {
    accessState: 'full',
    id: String(raw.id || ''),
    displayName: String(raw.displayName || raw.handle || 'Unknown'),
    handle: String(raw.handle || ''),
    avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : null,
    bio: typeof raw.bio === 'string' ? raw.bio : null,
    isSource: hasRealmSourceIdentity(raw),
    isOnline: raw.isOnline === true,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    languages: Array.isArray(raw.languages) ? raw.languages.map(String) : [],
    city: typeof raw.city === 'string' ? raw.city : null,
    countryCode: typeof raw.countryCode === 'string' ? raw.countryCode : null,
    gender: typeof raw.gender === 'string' ? raw.gender : null,
    stats: stats
      ? {
          friendsCount: typeof stats.friendsCount === 'number' ? stats.friendsCount : 0,
          postsCount: typeof stats.postsCount === 'number' ? stats.postsCount : 0,
          likesCount: typeof stats.likesCount === 'number'
            ? stats.likesCount
            : typeof stats.likeCount === 'number'
              ? stats.likeCount
              : typeof raw.likesCount === 'number'
                ? raw.likesCount
                : typeof raw.likeCount === 'number'
                  ? raw.likeCount
                  : 0,
        }
      : null,
    giftStats: parsedGiftStats,
    sourceState: sourceRecord && typeof sourceRecord.state === 'string' ? sourceRecord.state : null,
    sourceCategory: sourceRecord && typeof sourceRecord.category === 'string' ? sourceRecord.category : null,
    sourceOrigin: sourceRecord && typeof sourceRecord.origin === 'string' ? sourceRecord.origin : null,
    sourceTier: sourceRecord && typeof sourceRecord.tier === 'string' ? sourceRecord.tier : null,
    sourceAccountVisibility: (
      (sourceRecord && typeof sourceRecord.accountVisibility === 'string' ? sourceRecord.accountVisibility : null)
      || (typeof sourceProfile?.accountVisibility === 'string' ? sourceProfile.accountVisibility : null)
    ),
    sourceWakeStrategy: sourceRecord && typeof sourceRecord.wakeStrategy === 'string' ? sourceRecord.wakeStrategy : null,
    sourceOwnershipType: (
      (sourceRecord && typeof sourceRecord.ownershipType === 'string' ? sourceRecord.ownershipType : null)
      || (typeof sourceProfile?.ownershipType === 'string' ? sourceProfile.ownershipType : null)
    ),
    sourceWorldId: (
      (sourceRecord && typeof sourceRecord.worldId === 'string' ? sourceRecord.worldId : null)
      || (typeof sourceProfile?.worldId === 'string' ? sourceProfile.worldId : null)
    ),
    sourceOwnerWorldId: (
      (sourceRecord && typeof sourceRecord.ownerWorldId === 'string' ? sourceRecord.ownerWorldId : null)
      || (typeof sourceProfile?.ownerWorldId === 'string' ? sourceProfile.ownerWorldId : null)
    ),
    worldName: (
      (typeof raw.worldName === 'string' ? raw.worldName : null)
      || (typeof sourceProfile?.worldName === 'string' ? sourceProfile.worldName : null)
      || (typeof world?.name === 'string' ? world.name : null)
    ),
    worldBannerUrl: (
      (typeof raw.worldBannerUrl === 'string' ? raw.worldBannerUrl : null)
      || (typeof sourceProfile?.worldBannerUrl === 'string' ? sourceProfile.worldBannerUrl : null)
      || (typeof world?.bannerUrl === 'string' ? world.bannerUrl : null)
    ),
    isFriend: raw.isFriend === true,
    isPendingFriendRequest: raw.isPendingFriendRequest === true,
  };
}

import { formatLocaleDate } from '@renderer/i18n';

export function getProfileInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

export function formatProfileDate(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  return formatLocaleDate(date, { year: 'numeric', month: 'long', day: 'numeric' });
}
