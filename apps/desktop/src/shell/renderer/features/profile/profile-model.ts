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
  agentIsPublic: boolean | null;
  agentWakeStrategy: string | null;
  agentOwnershipType: string | null;
  agentWorldId: string | null;
  agentOwnerWorldId: string | null;
  worldName: string | null;
  worldBannerUrl: string | null;
};

export function toProfileData(raw: Record<string, unknown>): ProfileData {
  const agent = raw.agent as Record<string, unknown> | undefined;
  const stats = raw.stats as Record<string, unknown> | undefined;
  const giftStats = raw.giftStats as Record<string, unknown> | undefined;

  const parsedGiftStats: Record<string, number> = {};
  if (giftStats && typeof giftStats === 'object') {
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
    isAgent: raw.isAgent === true || String(raw.handle || '').startsWith('~'),
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
    agentIsPublic: agent && typeof agent.isPublic === 'boolean' ? agent.isPublic : null,
    agentWakeStrategy: agent && typeof agent.wakeStrategy === 'string' ? agent.wakeStrategy : null,
    agentOwnershipType: (
      (agent && typeof agent.ownershipType === 'string' ? agent.ownershipType : null)
      || (
        raw.agentProfile
        && typeof raw.agentProfile === 'object'
        && typeof (raw.agentProfile as Record<string, unknown>).ownershipType === 'string'
          ? String((raw.agentProfile as Record<string, unknown>).ownershipType)
          : null
      )
    ),
    agentWorldId: (
      (agent && typeof agent.worldId === 'string' ? agent.worldId : null)
      || (
        raw.agentProfile
        && typeof raw.agentProfile === 'object'
        && typeof (raw.agentProfile as Record<string, unknown>).worldId === 'string'
          ? String((raw.agentProfile as Record<string, unknown>).worldId)
          : null
      )
    ),
    agentOwnerWorldId: (
      (agent && typeof agent.ownerWorldId === 'string' ? agent.ownerWorldId : null)
      || (
        raw.agentProfile
        && typeof raw.agentProfile === 'object'
        && typeof (raw.agentProfile as Record<string, unknown>).ownerWorldId === 'string'
          ? String((raw.agentProfile as Record<string, unknown>).ownerWorldId)
          : null
      )
    ),
    worldName: (
      (typeof raw.worldName === 'string' ? raw.worldName : null)
      || (
        raw.agentProfile
        && typeof raw.agentProfile === 'object'
        && typeof (raw.agentProfile as Record<string, unknown>).worldName === 'string'
          ? String((raw.agentProfile as Record<string, unknown>).worldName)
          : null
      )
      || (
        raw.world
        && typeof raw.world === 'object'
        && typeof (raw.world as Record<string, unknown>).name === 'string'
          ? String((raw.world as Record<string, unknown>).name)
          : null
      )
    ),
    worldBannerUrl: (
      (typeof raw.worldBannerUrl === 'string' ? raw.worldBannerUrl : null)
      || (
        raw.agentProfile
        && typeof raw.agentProfile === 'object'
        && typeof (raw.agentProfile as Record<string, unknown>).worldBannerUrl === 'string'
          ? String((raw.agentProfile as Record<string, unknown>).worldBannerUrl)
          : null
      )
      || (
        raw.world
        && typeof raw.world === 'object'
        && typeof (raw.world as Record<string, unknown>).bannerUrl === 'string'
          ? String((raw.world as Record<string, unknown>).bannerUrl)
          : null
      )
    ),
    isFriend: raw.isFriend === true,
  };
}

export function getProfileInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

export function formatProfileDate(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
