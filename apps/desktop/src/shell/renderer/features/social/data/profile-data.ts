import {
  addRealmFriendById,
  blockRealmUser,
  loadRealmCurrentUserProfile,
  loadRealmUserProfileById,
  removeRealmFriendById,
  unblockRealmUser,
  updateRealmCurrentUserProfile,
  type RealmModel,
} from '@nimiplatform/sdk/realm';
import {
  isRealmOfflineErrorLike as isRealmOfflineError,
  type JsonObject,
} from '@nimiplatform/sdk/types';
import {
  getOfflineCacheManager,
  getOfflineCoordinator,
} from '@renderer/infra/offline';
import {
  fetchAgentFriendLimit,
  fetchPendingFriendRequests,
  loadMergedSocialSnapshot,
  type RealmApiCaller,
  type RealmDataErrorEmitter,
  type SocialContactSnapshot,
} from './social-snapshot';
import { dispatchBlockedUsersUpdated } from './blocked-content';

type UserProfileDto = RealmModel<'UserProfileDto'>;

export type { SocialContactSnapshot } from './social-snapshot';

export async function loadCurrentUserProfile(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
) {
  return loadRealmCurrentUserProfile(callApi, emitRealmDataError);
}

export async function updateCurrentUserProfile(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
  data: JsonObject,
) {
  return updateRealmCurrentUserProfile(callApi, emitRealmDataError, data);
}

export async function loadContactList(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
): Promise<SocialContactSnapshot> {
  try {
    return await loadMergedSocialSnapshot(callApi, emitRealmDataError);
  } catch (error) {
    emitRealmDataError('load-contacts', error);
    throw error;
  }
}

export async function loadSocialSnapshot(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
): Promise<SocialContactSnapshot> {
  try {
    return await loadMergedSocialSnapshot(callApi, emitRealmDataError);
  } catch (error) {
    emitRealmDataError('load-social-snapshot', error);
    throw error;
  }
}

export async function loadPendingFriendRequests(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
) {
  return fetchPendingFriendRequests(callApi, emitRealmDataError);
}

export async function loadAgentFriendLimit(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
) {
  return fetchAgentFriendLimit(callApi, emitRealmDataError);
}

export async function loadUserProfileById(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
  id: string,
): Promise<UserProfileDto> {
  const normalizedId = String(id || '').trim();
  try {
    const enriched = await loadRealmUserProfileById(callApi, emitRealmDataError, normalizedId);
    const cache = await getOfflineCacheManager();
    await cache.syncAgentMetadata(`user:${normalizedId}`, enriched);
    return enriched;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const cache = await getOfflineCacheManager();
      const cached = await cache.getCachedAgentMetadata<UserProfileDto>(`user:${normalizedId}`);
      if (cached) {
        getOfflineCoordinator().markCacheFallbackUsed();
        return cached;
      }
    }
    throw error;
  }
}

export async function addFriendById(
  callApi: RealmApiCaller,
  userId: string,
  message?: string,
) {
  if (!userId) {
    throw new Error('用户ID不能为空');
  }
  return addRealmFriendById(callApi, userId, message);
}

export async function removeFriendById(
  callApi: RealmApiCaller,
  userId: string,
) {
  if (!userId) {
    throw new Error('用户ID不能为空');
  }
  await removeRealmFriendById(callApi, userId);
}

export async function addFriendByIdentifier(input: {
  callApi: RealmApiCaller;
  userId: string;
  reloadContacts: () => Promise<void>;
}) {
  await addFriendById(input.callApi, input.userId);
  await input.reloadContacts();
  return { id: String(input.userId || '') };
}

export async function requestOrAcceptFriend(input: {
  callApi: RealmApiCaller;
  userId: string;
  message?: string;
  reloadContacts: () => Promise<void>;
}) {
  try {
    await addFriendById(input.callApi, input.userId, input.message);
    await input.reloadContacts();
  } catch (error) {
    if (isRealmOfflineError(error)) {
      getOfflineCoordinator().markRealmRestReachable(false);
    }
    throw error;
  }
  return { id: String(input.userId || '') };
}

export async function removeFriend(input: {
  callApi: RealmApiCaller;
  userId: string;
  reloadContacts: () => Promise<void>;
}) {
  try {
    await removeFriendById(input.callApi, input.userId);
    await input.reloadContacts();
  } catch (error) {
    if (isRealmOfflineError(error)) {
      getOfflineCoordinator().markRealmRestReachable(false);
    }
    throw error;
  }
}

export async function rejectOrRemoveFriend(input: {
  callApi: RealmApiCaller;
  userId: string;
  reloadContacts: () => Promise<void>;
}) {
  try {
    await removeFriendById(input.callApi, input.userId);
    await input.reloadContacts();
  } catch (error) {
    if (isRealmOfflineError(error)) {
      getOfflineCoordinator().markRealmRestReachable(false);
    }
    throw error;
  }
  return { id: String(input.userId || '') };
}

export async function blockUser(
  callApi: RealmApiCaller,
  contact: JsonObject,
  reloadContacts: () => Promise<void>,
) {
  const contactId = String(contact.id || '');
  if (!contactId) {
    throw new Error('用户ID不能为空');
  }

  const result = await blockRealmUser(callApi, contactId);

  await reloadContacts();
  dispatchBlockedUsersUpdated();
  return result;
}

export async function unblockUser(
  callApi: RealmApiCaller,
  contact: JsonObject,
  reloadContacts: () => Promise<void>,
) {
  const contactId = String(contact.id || '');
  if (!contactId) {
    throw new Error('用户ID不能为空');
  }

  const result = await unblockRealmUser(callApi, contactId);

  await reloadContacts();
  dispatchBlockedUsersUpdated();
  return result;
}
