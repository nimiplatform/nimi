import { MeService, UserService } from '@nimiplatform/sdk-realm';
import type { UserProfileDto } from '@nimiplatform/sdk-realm/models/UserProfileDto';
import { store } from '@runtime/state';
import { loadCreatorAgents } from './social-flow';

type DataSyncApiCaller = <T>(task: () => Promise<T>, fallbackMessage?: string) => Promise<T>;
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
        () => UserService.getUser(userId),
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
      () => MeService.getMyPendingFriendRequests(),
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
      () => MeService.getMyBlockedUsers(undefined, 100),
      '加载拉黑列表失败',
    );
    const items = Array.isArray(response?.items) ? response.items : [];
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
      () => MeService.listMyFriendsWithDetails(undefined, 100),
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
    const user = await callApi(() => MeService.getMe(), '获取当前用户失败');
    store.updateState('auth.user', user);
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
    const user = await callApi(() => MeService.updateMe(data), '更新用户资料失败');
    store.updateState('auth.user', user);
    return user;
  } catch (error) {
    emitDataSyncError('update-user-profile', error);
    throw error;
  }
}

type MergedSocialContactSnapshot = SocialContactSnapshot;

function mergeWithLocalContacts(snapshot: SocialContactSnapshot): MergedSocialContactSnapshot {
  // 获取本地的测试用户（ID 以 test- 开头）
  const currentFriends = store.getState<Array<Record<string, unknown>>>('contacts.friends') || [];
  const testUsers = currentFriends.filter((f) => String(f.id).startsWith('test-'));
  const fallbackUsers = currentFriends.filter((f) => {
    const fallbackUntil = Number(f.__localFallbackUntil || 0);
    return Number.isFinite(fallbackUntil) && fallbackUntil > Date.now();
  });

  // 后端 block 列表 + 本地兼容 block（test-* 或历史本地数据）
  const currentBlocked = store.getState<Array<Record<string, unknown>>>('contacts.blocked') || [];
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

  // 合并数据：API 好友 + 本地测试用户
  const existingIds = new Set(snapshot.friends.map((f) => String(f.id)));
  const mergedFriends = [...snapshot.friends];

  // 添加本地测试用户（如果不在 API 返回中且不在 blocked 列表中）
  for (const testUser of testUsers) {
    const testId = String(testUser.id);
    if (!existingIds.has(testId)) {
      // 检查是否在 blocked 列表中
      const isBlocked = mergedBlockedIds.has(testId);
      if (!isBlocked) {
        mergedFriends.push(testUser);
      }
    }
  }

  // 添加短期本地回填用户（用于兼容历史 block->unblock 场景下后端关系延迟恢复）
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
  store.setContactsLoading(true);
  try {
    const snapshot = await loadSocialSnapshotInternal(callApi, emitDataSyncError);
    const mergedSnapshot = mergeWithLocalContacts(snapshot);
    store.setContacts(mergedSnapshot);
    return mergedSnapshot;
  } catch (error) {
    emitDataSyncError('load-contacts', error);
    store.setContactsLoading(false);
    throw error;
  }
}

export async function loadSocialSnapshot(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<MergedSocialContactSnapshot> {
  store.setContactsLoading(true);
  try {
    const snapshot = await loadSocialSnapshotInternal(callApi, emitDataSyncError);
    const mergedSnapshot = mergeWithLocalContacts(snapshot);
    store.setContacts(mergedSnapshot);
    return mergedSnapshot;
  } catch (error) {
    emitDataSyncError('load-social-snapshot', error);
    store.setContactsLoading(false);
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
      () => UserService.getUser(id),
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
    () => UserService.addFriend(userId),
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
    () => UserService.removeFriend(userId),
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

  // 对于测试用户，直接从本地好友列表中移除
  if (isTestUser) {
    const currentFriends = store.getState<Array<Record<string, unknown>>>('contacts.friends') || [];
    const updatedFriends = currentFriends.filter((f) => String(f.id) !== contactId);
    store.setContacts({
      friends: updatedFriends,
      agents: store.getState<Array<Record<string, unknown>>>('contacts.agents') || [],
      pendingReceived: store.getState<Array<Record<string, unknown>>>('contacts.pendingReceived') || [],
      pendingSent: store.getState<Array<Record<string, unknown>>>('contacts.pendingSent') || [],
      blocked: store.getState<Array<Record<string, unknown>>>('contacts.blocked') || [],
    });
  } else {
    await callApi(
      () => MeService.blockUser(contactId),
      '拉黑用户失败',
    );
  }

  // 添加到拉黑列表
  store.addBlockedContact(contact);
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
    // 对于测试用户，直接从拉黑列表移除并回填到本地好友列表
    store.removeBlockedContact(contactId);

    // 对于测试用户，直接添加到本地好友列表
    const currentFriends = store.getState<Array<Record<string, unknown>>>('contacts.friends') || [];
    store.setContacts({
      friends: [...currentFriends, contact],
      agents: store.getState<Array<Record<string, unknown>>>('contacts.agents') || [],
      pendingReceived: store.getState<Array<Record<string, unknown>>>('contacts.pendingReceived') || [],
      pendingSent: store.getState<Array<Record<string, unknown>>>('contacts.pendingSent') || [],
      blocked: store.getState<Array<Record<string, unknown>>>('contacts.blocked') || [],
    });
  } else {
    await callApi(
      () => MeService.unblockUser(contactId),
      '取消拉黑失败',
    );
    store.removeBlockedContact(contactId);

    // 兼容历史本地 block 流程：后端关系可能仍为非 ACTIVE，短期回填以保证列表立即可见
    const currentFriends = store.getState<Array<Record<string, unknown>>>('contacts.friends') || [];
    const hasFriend = currentFriends.some((friend) => String(friend.id || '') === contactId);
    if (!hasFriend) {
      const fallbackContact = {
        ...contact,
        __localFallbackUntil: Date.now() + 2 * 60 * 1000,
      };
      store.setContacts({
        friends: [...currentFriends, fallbackContact],
        agents: store.getState<Array<Record<string, unknown>>>('contacts.agents') || [],
        pendingReceived: store.getState<Array<Record<string, unknown>>>('contacts.pendingReceived') || [],
        pendingSent: store.getState<Array<Record<string, unknown>>>('contacts.pendingSent') || [],
        blocked: store.getState<Array<Record<string, unknown>>>('contacts.blocked') || [],
      });

      // 尝试恢复好友关系（兼容旧版本“block 会 remove friend”的历史数据）
      try {
        await addFriendById(callApi, contactId);
      } catch {
        // 可能受对方隐私策略限制，保持前端短期回填，等待用户后续手动处理
      }
    }
  }

  await reloadContacts();
  return { id: contactId };
}
