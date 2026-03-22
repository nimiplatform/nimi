import { loadCreatorAgents } from './social-flow';
import type { Realm } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { isJsonObject, type JsonObject } from '@runtime/net/json';

type UserProfileDto = RealmModel<'UserProfileDto'>;
type EnrichedUserProfile = UserProfileDto & {
  worldName?: string | null;
  worldBannerUrl?: string | null;
  world?: JsonObject;
};

export type DataSyncApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
export type DataSyncErrorEmitter = (
  action: string,
  error: unknown,
  details?: JsonObject,
) => void;

type LoadSocialSnapshotOptions = {
  includeCreatorAgents?: boolean;
};

type PendingFriendRequestDto = {
  userId?: string;
  requestedAt?: string;
  requestMessage?: string;
};

type PendingFriendRequestListDto = {
  received?: PendingFriendRequestDto[];
  sent?: PendingFriendRequestDto[];
};

export type SocialContactSnapshot = {
  friends: JsonObject[];
  agents: JsonObject[];
  groups: JsonObject[];
  pendingReceived: JsonObject[];
  pendingSent: JsonObject[];
  blocked: JsonObject[];
};

type SocialContactRecord = JsonObject;

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

function extractAgentWorldId(profile: JsonObject): string | null {
  const direct = toNonEmptyString(profile.worldId);
  if (direct) {
    return direct;
  }

  const agent = isJsonObject(profile.agent)
    ? profile.agent
    : null;
  const fromAgent = toNonEmptyString(agent?.worldId);
  if (fromAgent) {
    return fromAgent;
  }

  const agentProfile = isJsonObject(profile.agentProfile)
    ? profile.agentProfile
    : null;
  const fromAgentProfile = toNonEmptyString(agentProfile?.worldId);
  return fromAgentProfile || null;
}

function extractWorldBannerUrl(profile: JsonObject): string | null {
  const direct = toNonEmptyString(profile.worldBannerUrl);
  if (direct) {
    return direct;
  }

  const world = isJsonObject(profile.world)
    ? profile.world
    : null;
  const fromWorld = toNonEmptyString(world?.bannerUrl);
  if (fromWorld) {
    return fromWorld;
  }

  const agentProfile = isJsonObject(profile.agentProfile)
    ? profile.agentProfile
    : null;
  return toNonEmptyString(agentProfile?.worldBannerUrl) || null;
}

function extractWorldName(profile: JsonObject): string | null {
  const direct = toNonEmptyString(profile.worldName);
  if (direct) {
    return direct;
  }

  const world = isJsonObject(profile.world)
    ? profile.world
    : null;
  const fromWorld = toNonEmptyString(world?.name);
  if (fromWorld) {
    return fromWorld;
  }

  const agentProfile = isJsonObject(profile.agentProfile)
    ? profile.agentProfile
    : null;
  return toNonEmptyString(agentProfile?.worldName) || null;
}

export async function enrichProfileWithWorldBanner(
  callApi: DataSyncApiCaller,
  profile: JsonObject,
): Promise<EnrichedUserProfile> {
  const typedProfile = profile as EnrichedUserProfile;
  const existingBannerUrl = extractWorldBannerUrl(profile);
  const existingWorldName = extractWorldName(profile);
  if (existingBannerUrl && existingWorldName) {
    return typedProfile;
  }

  const worldId = extractAgentWorldId(profile);
  if (!worldId) {
    return typedProfile;
  }

  try {
    const world = await callApi(
      (realm) => realm.services.WorldsService.worldControllerGetWorld(worldId),
      'Failed to load world detail',
    );
    const worldRecord = isJsonObject(world)
      ? world
      : null;
    if (!worldRecord) {
      return typedProfile;
    }

    return {
      ...typedProfile,
      worldName: existingWorldName || toNullableString(worldRecord.name),
      worldBannerUrl: existingBannerUrl || toNullableString(worldRecord.bannerUrl),
      world: isJsonObject(typedProfile.world)
        ? {
            ...typedProfile.world,
            ...worldRecord,
            bannerUrl: existingBannerUrl || toNullableString(worldRecord.bannerUrl),
          }
        : worldRecord,
    };
  } catch {
    return typedProfile;
  }
}

type PendingRequestMapValue = { requestedAt: string | null; requestMessage: string | null };

function toPendingRequestMap(items: PendingFriendRequestDto[] | undefined): Map<string, PendingRequestMapValue> {
  const normalized = new Map<string, PendingRequestMapValue>();
  for (const item of items || []) {
    const userId = toNonEmptyString(item.userId);
    if (!userId || normalized.has(userId)) {
      continue;
    }
    normalized.set(userId, {
      requestedAt: toNullableString(item.requestedAt),
      requestMessage: toNullableString(item.requestMessage),
    });
  }
  return normalized;
}

async function resolvePendingRequestProfiles(
  callApi: DataSyncApiCaller,
  userMap: Map<string, PendingRequestMapValue>,
  direction: 'received' | 'sent',
): Promise<SocialContactRecord[]> {
  const tasks = Array.from(userMap.entries()).map(async ([userId, { requestedAt, requestMessage }]) => {
    try {
      const profile = await callApi(
        (realm) => realm.services.UserService.getUser(userId),
        '加载好友请求用户资料失败',
      ) as JsonObject;
      const handle = toNonEmptyString(profile.handle);
      const isAgent = profile.isAgent === true;
      return {
        id: userId,
        userId,
        direction,
        requestedAt,
        requestMessage,
        displayName: toNonEmptyString(profile.displayName) || handle || userId,
        handle,
        avatarUrl: toNullableString(profile.avatarUrl),
        bio: toNullableString(profile.bio),
        isAgent,
        worldId: isAgent ? extractAgentWorldId(profile) : null,
      } as SocialContactRecord;
    } catch {
      return {
        id: userId,
        userId,
        direction,
        requestedAt,
        requestMessage,
        displayName: userId,
        handle: '',
        avatarUrl: null,
        bio: null,
        isAgent: false,
        worldId: null,
      } as SocialContactRecord;
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
    ) as PendingFriendRequestListDto;
  } catch (error) {
    emitDataSyncError('load-friend-requests', error);
    throw error;
  }
}

async function fetchBlockedUsers(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<SocialContactRecord[]> {
  try {
    const response = await callApi(
      (realm) => realm.services.MeService.getMyBlockedUsers(undefined, 100),
      '加载拉黑列表失败',
    );
    const items = Array.isArray(response?.items)
      ? (response.items as JsonObject[])
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
        } as SocialContactRecord;
      })
      .filter((item): item is SocialContactRecord => Boolean(item));
  } catch (error) {
    emitDataSyncError('load-blocked-users', error);
    return [];
  }
}

async function loadSocialSnapshotInternal(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  options: LoadSocialSnapshotOptions = {},
): Promise<SocialContactSnapshot> {
  const includeCreatorAgents = options.includeCreatorAgents !== false;
  const [friendsResult, pendingResult, creatorAgents, blockedUsers] = await Promise.all([
    callApi(
      (realm) => realm.services.MeService.listMyFriendsWithDetails(undefined, 100),
      '加载好友失败',
    ),
    fetchPendingFriendRequests(callApi, emitDataSyncError),
    includeCreatorAgents ? loadCreatorAgents(callApi) : Promise.resolve([]),
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
  options: LoadSocialSnapshotOptions = {},
): Promise<SocialContactSnapshot> {
  const snapshot = await loadSocialSnapshotInternal(callApi, emitDataSyncError, options);
  const mergedSnapshot = mergeWithLocalContacts(snapshot);
  cachedContacts = { ...mergedSnapshot };
  return mergedSnapshot;
}

export function getCachedContacts(): SocialContactSnapshot {
  return cachedContacts;
}

export function isPendingSentRequestInContacts(
  contacts: Pick<SocialContactSnapshot, 'pendingSent'> | undefined,
  userId: string,
): boolean {
  if (!contacts?.pendingSent?.length) return false;
  return contacts.pendingSent.some((req) => req.userId === userId);
}

export function updateCachedContacts(snapshot: SocialContactSnapshot) {
  cachedContacts = { ...snapshot };
}
