import type { Realm } from '@nimiplatform/sdk/realm';
import type { UserProfileDto } from '@nimiplatform/sdk/realm';
import { loadCreatorAgents } from './social-flow';

type DataSyncApiCaller = (task: (realm: Realm) => Promise<any>, fallbackMessage?: string) => Promise<any>;
type DataSyncErrorEmitter = (
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

// Module-level contacts cache (replaces legacy store contact reads)
let _cachedContacts: SocialContactSnapshot = {
  friends: [],
  agents: [],
  groups: [],
  pendingReceived: [],
  pendingSent: [],
  blocked: [],
};

function getCachedContacts(): SocialContactSnapshot {
  return _cachedContacts;
}

function updateCachedContacts(snapshot: SocialContactSnapshot) {
  _cachedContacts = { ...snapshot };
}

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
  if (fromAgentProfile) {
    return fromAgentProfile;
  }

  return null;
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
      const isAgent = profile.isAgent === true || handle.startsWith('~');
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

async function fetchPendingFriendRequests(
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
          isAgent: handle.startsWith('~'),
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

export async function loadCurrentUserProfile(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
) {
  try {
    const user = await callApi((realm) => realm.services.MeService.getMe(), '获取当前用户失败');
    return user;
  } catch (error) {
    emitDataSyncError('load-current-user', error);
    throw error;
  }
}

export async function updateCurrentUserProfile(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  data: Record<string, unknown>,
) {
  try {
    const user = await callApi((realm) => realm.services.MeService.updateMe(data), '更新用户资料失败');
    return user;
  } catch (error) {
    emitDataSyncError('update-user-profile', error);
    throw error;
  }
}

type MergedSocialContactSnapshot = SocialContactSnapshot;

function mergeWithLocalContacts(snapshot: SocialContactSnapshot): MergedSocialContactSnapshot {
  const cached = getCachedContacts();
  const currentFriends = cached.friends;
  const testUsers = currentFriends.filter((f) => String(f.id).startsWith('test-'));
  const fallbackUsers = currentFriends.filter((f) => {
    const fallbackUntil = Number(f.__localFallbackUntil || 0);
    return Number.isFinite(fallbackUntil) && fallbackUntil > Date.now();
  });

  const currentBlocked = cached.blocked;
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

  const existingIds = new Set(snapshot.friends.map((f) => String(f.id)));
  const mergedFriends = [...snapshot.friends];

  for (const testUser of testUsers) {
    const testId = String(testUser.id);
    if (!existingIds.has(testId)) {
      const isBlocked = mergedBlockedIds.has(testId);
      if (!isBlocked) {
        mergedFriends.push(testUser);
      }
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

export async function loadContactList(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
) {
  try {
    const snapshot = await loadSocialSnapshotInternal(callApi, emitDataSyncError);
    const mergedSnapshot = mergeWithLocalContacts(snapshot);
    updateCachedContacts(mergedSnapshot);
    return mergedSnapshot;
  } catch (error) {
    emitDataSyncError('load-contacts', error);
    throw error;
  }
}

export async function loadSocialSnapshot(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<MergedSocialContactSnapshot> {
  try {
    const snapshot = await loadSocialSnapshotInternal(callApi, emitDataSyncError);
    const mergedSnapshot = mergeWithLocalContacts(snapshot);
    updateCachedContacts(mergedSnapshot);
    return mergedSnapshot;
  } catch (error) {
    emitDataSyncError('load-social-snapshot', error);
    throw error;
  }
}

export async function loadPendingFriendRequests(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
) {
  return fetchPendingFriendRequests(callApi, emitDataSyncError);
}

export async function loadUserProfileById(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
  id: string,
): Promise<UserProfileDto> {
  try {
    const profile = await callApi(
      (realm) => realm.services.UserService.getUser(id),
      '获取用户资料失败',
    );
    return profile;
  } catch (error) {
    emitDataSyncError('load-user-profile', error, { id });
    throw error;
  }
}

export async function addFriendById(
  callApi: DataSyncApiCaller,
  userId: string,
) {
  if (!userId) {
    throw new Error('用户ID不能为空');
  }
  await callApi(
    (realm) => realm.services.UserService.addFriend(userId),
    '添加好友失败',
  );
  return { id: userId };
}

export async function removeFriendById(
  callApi: DataSyncApiCaller,
  userId: string,
) {
  if (!userId) {
    throw new Error('用户ID不能为空');
  }
  await callApi(
    (realm) => realm.services.UserService.removeFriend(userId),
    '删除好友失败',
  );
}

export async function addFriendByIdentifier(input: {
  callApi: DataSyncApiCaller;
  userId: string;
  reloadContacts: () => Promise<void>;
}) {
  await addFriendById(input.callApi, input.userId);
  await input.reloadContacts();
  return { id: String(input.userId || '') };
}

export async function requestOrAcceptFriend(input: {
  callApi: DataSyncApiCaller;
  userId: string;
  reloadContacts: () => Promise<void>;
}) {
  await addFriendById(input.callApi, input.userId);
  await input.reloadContacts();
  return { id: String(input.userId || '') };
}

export async function removeFriend(input: {
  callApi: DataSyncApiCaller;
  userId: string;
  reloadContacts: () => Promise<void>;
}) {
  await removeFriendById(input.callApi, input.userId);
  await input.reloadContacts();
}

export async function rejectOrRemoveFriend(input: {
  callApi: DataSyncApiCaller;
  userId: string;
  reloadContacts: () => Promise<void>;
}) {
  await removeFriendById(input.callApi, input.userId);
  await input.reloadContacts();
  return { id: String(input.userId || '') };
}

export async function blockUser(
  callApi: DataSyncApiCaller,
  contact: Record<string, unknown>,
  reloadContacts: () => Promise<void>,
) {
  const contactId = String(contact.id || '');
  if (!contactId) {
    throw new Error('用户ID不能为空');
  }
  const isTestUser = contactId.startsWith('test-');

  if (isTestUser) {
    const cached = getCachedContacts();
    const updatedFriends = cached.friends.filter((f) => String(f.id) !== contactId);
    updateCachedContacts({
      ...cached,
      friends: updatedFriends,
      blocked: [...cached.blocked, contact],
    });
  } else {
    await callApi(
      (realm) => realm.services.MeService.blockUser(contactId),
      '拉黑用户失败',
    );
    const cached = getCachedContacts();
    updateCachedContacts({
      ...cached,
      blocked: [...cached.blocked, contact],
    });
  }

  await reloadContacts();
  return { id: contactId };
}

export async function unblockUser(
  callApi: DataSyncApiCaller,
  contact: Record<string, unknown>,
  reloadContacts: () => Promise<void>,
) {
  const contactId = String(contact.id || '');
  if (!contactId) {
    throw new Error('用户ID不能为空');
  }
  const isTestUser = contactId.startsWith('test-');

  if (isTestUser) {
    const cached = getCachedContacts();
    updateCachedContacts({
      ...cached,
      friends: [...cached.friends, contact],
      blocked: cached.blocked.filter((b) => String(b.id) !== contactId),
    });
  } else {
    await callApi(
      (realm) => realm.services.MeService.unblockUser(contactId),
      '取消拉黑失败',
    );
    const cached = getCachedContacts();
    const updatedBlocked = cached.blocked.filter((b) => String(b.id) !== contactId);
    const hasFriend = cached.friends.some((friend) => String(friend.id || '') === contactId);
    if (!hasFriend) {
      const fallbackContact = {
        ...contact,
        __localFallbackUntil: Date.now() + 2 * 60 * 1000,
      };
      updateCachedContacts({
        ...cached,
        friends: [...cached.friends, fallbackContact],
        blocked: updatedBlocked,
      });

      try {
        await addFriendById(callApi, contactId);
      } catch {
        // May be restricted by privacy policy; keep short-term fallback
      }
    } else {
      updateCachedContacts({
        ...cached,
        blocked: updatedBlocked,
      });
    }
  }

  await reloadContacts();
  return { id: contactId };
}
