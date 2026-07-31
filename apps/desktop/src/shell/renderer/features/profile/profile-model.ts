import type { RealmModel } from '@nimiplatform/sdk/realm/generated';

export type HumanProfileTab = 'Posts' | 'Collections' | 'Likes' | 'Gifts' | 'FollowedWorlds';

export type HumanProfileData = {
  accessState: 'full' | 'restricted';
  id: string;
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  bio: string | null;
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
};

type UserProfileDto = RealmModel<'UserProfileDto'>;
type ProfileStatsLike = NonNullable<UserProfileDto['stats']> & {
  likesCount?: number;
  likeCount?: number;
};

export type HumanProfileSource = Partial<Omit<
  UserProfileDto,
  'createdAt' | 'gender' | 'giftStats' | 'stats'
>> & {
  id?: string;
  displayName?: string;
  handle?: string;
  avatarUrl?: string | null;
  profileCoverUrl?: string | null;
  bio?: string | null;
  createdAt?: string | null;
  gender?: string | null;
  languages?: readonly string[];
  tags?: readonly string[];
  stats?: ProfileStatsLike | null;
  giftStats?: Record<string, unknown> | null;
  likesCount?: number;
  likeCount?: number;
  isFriend?: boolean;
  isPendingFriendRequest?: boolean;
};

function assertHumanProfileSource(raw: HumanProfileSource): void {
  const payload = raw as Record<string, unknown>;
  const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(payload, key);
  if (
    hasOwn('isSource')
    || hasOwn('sourceRef')
    || hasOwn('runtimeSourceRef')
    || hasOwn('localAgentRef')
    || hasOwn('sourceKind')
    || hasOwn('sourceId')
    || hasOwn('source')
  ) {
    throw new Error('Human profile cannot consume Character Source or Runtime LocalAgent data');
  }
}

export function requireHumanAccountId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) {
    throw new Error('Human profile accountId is required');
  }
  if (id.startsWith('local-agent:') || id.startsWith('runtime-source:')) {
    throw new Error('Human profile accountId cannot be a Runtime LocalAgent reference');
  }
  return id;
}

export function toHumanProfileData(raw: HumanProfileSource): HumanProfileData {
  assertHumanProfileSource(raw);
  const id = requireHumanAccountId(raw.id);

  const parsedGiftStats: Record<string, number> = {};
  if (raw.giftStats) {
    for (const [key, value] of Object.entries(raw.giftStats)) {
      if (typeof value === 'number') {
        parsedGiftStats[key] = value;
      }
    }
  }

  const stats = raw.stats;
  return {
    accessState: 'full',
    id,
    displayName: String(raw.displayName || raw.handle || 'Unknown'),
    handle: String(raw.handle || ''),
    avatarUrl: typeof raw.avatarUrl === 'string' ? raw.avatarUrl : null,
    coverUrl: typeof raw.profileCoverUrl === 'string' ? raw.profileCoverUrl : null,
    bio: typeof raw.bio === 'string' ? raw.bio : null,
    isOnline: raw.isOnline === true,
    isFriend: raw.isFriend === true,
    isPendingFriendRequest: raw.isPendingFriendRequest === true,
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
  };
}

export function getProfileInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

export function formatProfileDate(
  dateStr: string,
  formatDate: (value: unknown, options?: Intl.DateTimeFormatOptions) => string,
): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  return formatDate(date, { year: 'numeric', month: 'long', day: 'numeric' });
}
