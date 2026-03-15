import type { Realm, UserProfileDto } from '@nimiplatform/sdk/realm';
import { loadCreatorAgents } from './social-flow';

export type DataSyncApiCaller = (task: (realm: Realm) => Promise<any>, fallbackMessage?: string) => Promise<any>;
export type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

type PendingFriendRequestDto = {
  userId?: string;
  requestedAt?: string;
};

type PendingFriendRequestListDto = {
  received?: PendingFriendRequestDto[];
  sent?: PendingFriendRequestDto[];
};

export type SocialContactSnapshot = {
  friends: Array<Record<string, unknown>>;
  agents: Array<Record<string, unknown>>;
  groups: Array<Record<string, unknown>>;
  pendingReceived: Array<Record<string, unknown>>;
  pendingSent: Array<Record<string, unknown>>;
  blocked: Array<Record<string, unknown>>;
};

let cachedContacts: SocialContactSnapshot = {
  friends: [],
  agents: [],
  groups: [],
  pendingReceived: [],
  pendingSent: [],
  blocked: [],
};

function toNonEmptyString(value: unknown): string {
  return String(value || '').trim();
}

function toNullableString(value: unknown): string | null {
  const normalized = toNonEmptyString(value);
  return normalized || null;
}

function extractAgentWorldId(profile: Record<string, unknown>): string | null {
  const direct = toNonEmptyString(profile.worldId);
  if (direct) {
    return direct;
  }

  const agent = profile.agent && typeof profile.agent === 'object'
    ? (profile.agent as Record<string, unknown>)
    : null;
  const fromAgent = toNonEmptyString(agent?.worldId);
  if (fromAgent) {
    return fromAgent;
  }

  const agentProfile = profile.agentProfile && typeof profile.agentProfile === 'object'
    ? (profile.agentProfile as Record<string, unknown>)
    : null;
  const fromAgentProfile = toNonEmptyString(agentProfile?.worldId);
  return fromAgentProfile || null;
}

function extractWorldBannerUrl(profile: Record<string, unknown>): string | null {
  const direct = toNonEmptyString(profile.worldBannerUrl);
  if (direct) {
    return direct;
  }

  const world = profile.world && typeof profile.world === 'object'
    ? (profile.world as Record<string, unknown>)
    : null;
  const fromWorld = toNonEmptyString(world?.bannerUrl);
  if (fromWorld) {
    return fromWorld;
  }

  const agentProfile = profile.agentProfile && typeof profile.agentProfile === 'object'
    ? (profile.agentProfile as Record<string, unknown>)
    : null;
  return toNonEmptyString(agentProfile?.worldBannerUrl) || null;
}

function extractWorldName(profile: Record<string, unknown>): string | null {
  const direct = toNonEmptyString(profile.worldName);
  if (direct) {
    return direct;
  }

  const world = profile.world && typeof profile.world === 'object'
    ? (profile.world as Record<string, unknown>)
    : null;
  const fromWorld = toNonEmptyString(world?.name);
  if (fromWorld) {
    return fromWorld;
  }

  const agentProfile = profile.agentProfile && typeof profile.agentProfile === 'object'
    ? (profile.agentProfile as Record<string, unknown>)
    : null;
  return toNonEmptyString(agentProfile?.worldName) || null;
}

export async function enrichProfileWithWorldBanner(
  callApi: DataSyncApiCaller,
  profile: Record<string, unknown>,
): Promise<UserProfileDto> {
  const existingBannerUrl = extractWorldBannerUrl(profile);
  const existingWorldName = extractWorldName(profile);
  if (existingBannerUrl && existingWorldName) {
    return profile as UserProfileDto;
  }

  const worldId = extractAgentWorldId(profile);
  if (!worldId) {
    return profile as UserProfileDto;
  }

  try {
    const world = await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetWorld(worldId),
      'Failed to load world detail',
    );
    const worldRecord = world && typeof world === 'object' && !Array.isArray(world)
      ? (world as Record<string, unknown>)
      : null;
    if (!worldRecord) {
      return profile as UserProfileDto;
    }

    return {
      ...profile,
      worldName: existingWorldName || toNullableString(worldRecord.name),
      worldBannerUrl: existingBannerUrl || toNullableString(worldRecord.bannerUrl),
      world: profile.world && typeof profile.world === 'object'
        ? {
            ...(profile.world as Record<string, unknown>),
            ...worldRecord,
            bannerUrl: existingBannerUrl || toNullableString(worldRecord.bannerUrl),
          }
        : worldRecord,
    } as unknown as UserProfileDto;
  } catch {
    return profile as UserProfileDto;
  }
}

function toPendingRequestMap(items: PendingFriendRequestDto[] | undefined): Map<string, string | null> {
  const normalized = new Map<string, string | null>();
  for (const item of items || []) {
    const userId = toNonEmptyString(item.userId);
    if (!userId || normalized.has(userId)) {
      continue;
    }
    normalized.set(userId, toNullableString(item.requestedAt));
  }
  return normalized;
}

async function resolvePendingRequestProfiles(
  callApi: DataSyncApiCaller,
  userMap: Map<string, string | null>,
  direction: 'received' | 'sent',
): Promise<Array<Record<string, unknown>>> {
  const tasks = Array.from(userMap.entries()).map(async ([userId, requestedAt]) => {
    try {
      const profile = await callApi(
        (realm) => realm.services.UserService.getUser(userId),
        '加载好友请求用户资料失败',
      ) as Record<string, unknown>;
      const handle = toNonEmptyString(profile.handle);
      const isAgent = profile.isAgent === true;
      return {
        id: userId,
        userId,
        direction,
        requestedAt,
        displayName: toNonEmptyString(profile.displayName) || handle || userId,
        handle,
        avatarUrl: toNullableString(profile.avatarUrl),
        bio: toNullableString(profile.bio),
        isAgent,
        worldId: isAgent ? extractAgentWorldId(profile) : null,
      } as Record<string, unknown>;
    } catch {
      return {
        id: userId,
        userId,
        direction,
        requestedAt,
        displayName: userId,
        handle: '',
        avatarUrl: null,
        bio: null,
        isAgent: false,
        worldId: null,
      } as Record<string, unknown>;
    }
  });

  const rows = await Promise.all(tasks);
  rows.sort((a, b) => {
    const timeA = toNullableString(a.requestedAt);
    const timeB = toNullableString(b.requestedAt);
    if (!timeA && !timeB) return 0;
    if (!timeA) return 1;
    if (!timeB) return -1;
    return new Date(timeB).getTime() - new Date(timeA).getTime();
  });
  return rows;
}

export async function fetchPendingFriendRequests(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<PendingFriendRequestListDto> {
  try {
    return await callApi(
      (realm) => realm.services.MeService.getMyPendingFriendRequests(),
      '加载好友请求失败',
    );
  } catch (error) {
    emitDataSyncError('load-friend-requests', error);
    throw error;
  }
}

async function fetchBlockedUsers(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<Array<Record<string, unknown>>> {
  try {
    const response = await callApi(
      (realm) => realm.services.MeService.getMyBlockedUsers(undefined, 100),
      '加载拉黑列表失败',
    );
    const items = Array.isArray(response?.items)
      ? (response.items as Array<Record<string, unknown>>)
      : [];
    return items
      .map((item) => {
        const id = toNonEmptyString(item?.id);
        if (!id) {
          return null;
        }
        const handle = toNonEmptyString(item?.handle);
        const displayName = toNonEmptyString(item?.displayName) || handle || id;
        return {
          id,
          displayName,
          handle,
          avatarUrl: toNullableString(item?.avatarUrl),
          bio: toNullableString(item?.bio),
          isAgent: item?.isAgent === true,
          blockedAt: toNullableString(item?.blockedAt),
          reason: toNullableString(item?.reason),
        } as Record<string, unknown>;
      })
      .filter((item): item is Record<string, unknown> => Boolean(item));
  } catch (error) {
    emitDataSyncError('load-blocked-users', error);
    return [];
  }
}

async function loadSocialSnapshotInternal(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<SocialContactSnapshot> {
  const [friendsResult, pendingResult, creatorAgents, blockedUsers] = await Promise.all([
    callApi(
      (realm) => realm.services.MeService.listMyFriendsWithDetails(undefined, 100),
      '加载好友失败',
    ),
    fetchPendingFriendRequests(callApi, emitDataSyncError),
    loadCreatorAgents(callApi),
    fetchBlockedUsers(callApi, emitDataSyncError),
  ]);

  const pendingReceived = await resolvePendingRequestProfiles(
    callApi,
    toPendingRequestMap(pendingResult.received),
    'received',
  );
  const pendingSent = await resolvePendingRequestProfiles(
    callApi,
    toPendingRequestMap(pendingResult.sent),
    'sent',
  );

  return {
    friends: Array.isArray(friendsResult.items) ? friendsResult.items : [],
    agents: Array.isArray(creatorAgents) ? creatorAgents : [],
    groups: [],
    pendingReceived,
    pendingSent,
    blocked: blockedUsers,
  };
}

function mergeWithLocalContacts(snapshot: SocialContactSnapshot): SocialContactSnapshot {
  const currentFriends = cachedContacts.friends;
  const testUsers = currentFriends.filter((friend) => String(friend.id).startsWith('test-'));
  const fallbackUsers = currentFriends.filter((friend) => {
    const fallbackUntil = Number(friend.__localFallbackUntil || 0);
    return Number.isFinite(fallbackUntil) && fallbackUntil > Date.now();
  });

  const currentBlocked = cachedContacts.blocked;
  const mergedBlocked = [...snapshot.blocked];
  const mergedBlockedIds = new Set(mergedBlocked.map((item) => String(item.id || '')));

  for (const localBlocked of currentBlocked) {
    const localId = toNonEmptyString(localBlocked.id);
    const blockedAt = toNonEmptyString(localBlocked.blockedAt);
    const shouldKeepLocalBlocked = localId.startsWith('test-') || !blockedAt;
    if (!localId || !shouldKeepLocalBlocked || mergedBlockedIds.has(localId)) {
      continue;
    }
    mergedBlocked.push(localBlocked);
    mergedBlockedIds.add(localId);
  }

  const existingIds = new Set(snapshot.friends.map((friend) => String(friend.id)));
  const mergedFriends = [...snapshot.friends];

  for (const testUser of testUsers) {
    const testId = String(testUser.id);
    if (!existingIds.has(testId) && !mergedBlockedIds.has(testId)) {
      mergedFriends.push(testUser);
    }
  }

  for (const fallbackUser of fallbackUsers) {
    const fallbackId = String(fallbackUser.id || '');
    if (!fallbackId || existingIds.has(fallbackId) || mergedBlockedIds.has(fallbackId)) {
      continue;
    }
    mergedFriends.push(fallbackUser);
    existingIds.add(fallbackId);
  }

  return {
    ...snapshot,
    friends: mergedFriends,
    blocked: mergedBlocked,
  };
}

export async function loadMergedSocialSnapshot(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<SocialContactSnapshot> {
  const snapshot = await loadSocialSnapshotInternal(callApi, emitDataSyncError);
  const mergedSnapshot = mergeWithLocalContacts(snapshot);
  cachedContacts = { ...mergedSnapshot };
  return mergedSnapshot;
}

export function getCachedContacts(): SocialContactSnapshot {
  return cachedContacts;
}

export function isPendingSentRequestInContacts(
  contacts: { pendingSent?: Array<Record<string, unknown>> } | undefined,
  userId: string,
): boolean {
  if (!contacts?.pendingSent?.length) return false;
  return contacts.pendingSent.some((req) => req.userId === userId);
}

export function updateCachedContacts(snapshot: SocialContactSnapshot) {
  cachedContacts = { ...snapshot };
}
