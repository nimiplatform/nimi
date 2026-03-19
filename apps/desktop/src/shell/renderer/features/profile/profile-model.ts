import type { RealmModel } from '@nimiplatform/sdk/realm';

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
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  isAgent: boolean;
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
  agentState: string | null;
  agentCategory: string | null;
  agentOrigin: string | null;
  agentTier: string | null;
  agentAccountVisibility: string | null;
  agentWakeStrategy: string | null;
  agentOwnershipType: string | null;
  agentWorldId: string | null;
  agentOwnerWorldId: string | null;
  worldName: string | null;
  worldBannerUrl: string | null;
};

type UserProfileDto = RealmModel<'UserProfileDto'>;
type ProfileStatsLike = NonNullable<UserProfileDto['stats']> & {
  likesCount?: number;
  likeCount?: number;
};
type ProfileAgentLike = {
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
type ProfileAgentProfileLike = {
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
export type ProfileSource = Partial<Omit<UserProfileDto, 'stats' | 'giftStats' | 'agent' | 'agentProfile' | 'createdAt' | 'gender'>> & {
  createdAt?: string | null;
  displayName?: string;
  handle?: string;
  gender?: string | null;
  id?: string;
  isAgent?: boolean;
  isCreator?: boolean;
  isVerified?: boolean;
  followerCount?: number;
  followingCount?: number;
  avatarUrl?: string | null;
  bio?: string | null;
  city?: string | null;
  countryCode?: string | null;
  languages?: string[];
  postCount?: number;
  tags?: string[];
  isFriend?: boolean;
  isPendingFriendRequest?: boolean;
  worldId?: string | null;
  agentWorldId?: string | null;
  agentConfig?: object | null;
  worldName?: string | null;
  worldBannerUrl?: string | null;
  likesCount?: number;
  likeCount?: number;
  stats?: ProfileStatsLike | null;
  giftStats?: Record<string, number> | null;
  agent?: ProfileAgentLike | null;
  agentProfile?: ProfileAgentProfileLike | null;
  world?: ProfileWorldLike | null;
};

export function toProfileData(raw: ProfileSource): ProfileData {
  const agent = raw.agent ?? undefined;
  const stats = raw.stats;
  const giftStats = raw.giftStats;
  const agentProfile = raw.agentProfile ?? undefined;
  const world = raw.world;

  const parsedGiftStats: Record<string, number> = {};
  if (giftStats) {
    for (const [key, val] of Object.entries(giftStats)) {
      if (typeof val === 'number') parsedGiftStats[key] = val;
    }
  }

  return {
    id: String(raw.id || ''),
    displayName: String(raw.displayName || raw.handle || 'Unknown'),
    handle: String(raw.handle || ''),
    avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : null,
    bio: typeof raw.bio === 'string' ? raw.bio : null,
    isAgent: raw.isAgent === true,
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
    agentState: agent && typeof agent.state === 'string' ? agent.state : null,
    agentCategory: agent && typeof agent.category === 'string' ? agent.category : null,
    agentOrigin: agent && typeof agent.origin === 'string' ? agent.origin : null,
    agentTier: agent && typeof agent.tier === 'string' ? agent.tier : null,
    agentAccountVisibility: (
      (agent && typeof agent.accountVisibility === 'string' ? agent.accountVisibility : null)
      || (typeof agentProfile?.accountVisibility === 'string' ? agentProfile.accountVisibility : null)
    ),
    agentWakeStrategy: agent && typeof agent.wakeStrategy === 'string' ? agent.wakeStrategy : null,
    agentOwnershipType: (
      (agent && typeof agent.ownershipType === 'string' ? agent.ownershipType : null)
      || (typeof agentProfile?.ownershipType === 'string' ? agentProfile.ownershipType : null)
    ),
    agentWorldId: (
      (agent && typeof agent.worldId === 'string' ? agent.worldId : null)
      || (typeof agentProfile?.worldId === 'string' ? agentProfile.worldId : null)
    ),
    agentOwnerWorldId: (
      (agent && typeof agent.ownerWorldId === 'string' ? agent.ownerWorldId : null)
      || (typeof agentProfile?.ownerWorldId === 'string' ? agentProfile.ownerWorldId : null)
    ),
    worldName: (
      (typeof raw.worldName === 'string' ? raw.worldName : null)
      || (typeof agentProfile?.worldName === 'string' ? agentProfile.worldName : null)
      || (typeof world?.name === 'string' ? world.name : null)
    ),
    worldBannerUrl: (
      (typeof raw.worldBannerUrl === 'string' ? raw.worldBannerUrl : null)
      || (typeof agentProfile?.worldBannerUrl === 'string' ? agentProfile.worldBannerUrl : null)
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
