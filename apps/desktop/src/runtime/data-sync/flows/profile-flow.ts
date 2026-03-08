import type { UserProfileDto } from '@nimiplatform/sdk/realm';
import {
  enrichProfileWithWorldBanner,
  fetchPendingFriendRequests,
  getCachedContacts,
  loadMergedSocialSnapshot,
  updateCachedContacts,
  type DataSyncApiCaller,
  type DataSyncErrorEmitter,
  type SocialContactSnapshot,
} from './profile-flow-social';

export type { SocialContactSnapshot } from './profile-flow-social';

export async function loadCurrentUserProfile(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
) {
  try {
    return await callApi((realm) => realm.services.MeService.getMe(), '获取当前用户失败');
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
    return await callApi((realm) => realm.services.MeService.updateMe(data), '更新用户资料失败');
  } catch (error) {
    emitDataSyncError('update-user-profile', error);
    throw error;
  }
}

export async function loadContactList(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<SocialContactSnapshot> {
  try {
    return await loadMergedSocialSnapshot(callApi, emitDataSyncError);
  } catch (error) {
    emitDataSyncError('load-contacts', error);
    throw error;
  }
}

export async function loadSocialSnapshot(
  callApi: DataSyncApiCaller,
  emitDataSyncError: DataSyncErrorEmitter,
): Promise<SocialContactSnapshot> {
  try {
    return await loadMergedSocialSnapshot(callApi, emitDataSyncError);
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
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      return profile as UserProfileDto;
    }
    return enrichProfileWithWorldBanner(callApi, profile as Record<string, unknown>);
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

  if (contactId.startsWith('test-')) {
    const cached = getCachedContacts();
    updateCachedContacts({
      ...cached,
      friends: cached.friends.filter((friend) => String(friend.id) !== contactId),
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

  if (contactId.startsWith('test-')) {
    const cached = getCachedContacts();
    updateCachedContacts({
      ...cached,
      friends: [...cached.friends, contact],
      blocked: cached.blocked.filter((item) => String(item.id) !== contactId),
    });
  } else {
    await callApi(
      (realm) => realm.services.MeService.unblockUser(contactId),
      '取消拉黑失败',
    );
    const cached = getCachedContacts();
    const updatedBlocked = cached.blocked.filter((item) => String(item.id) !== contactId);
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
        // May be restricted by privacy policy; keep short-term fallback.
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
