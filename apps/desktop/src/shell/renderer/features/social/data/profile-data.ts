import {
  addNimiRealmFriendById,
  blockNimiRealmUser,
  loadNimiRealmCurrentUserProfile,
  loadNimiRealmUserProfileById,
  type NimiRealmSocialProfileView,
  removeNimiRealmFriendById,
  unblockNimiRealmUser,
  updateNimiRealmCurrentUserProfile,
} from '@nimiplatform/sdk/realm';
import {
  isRealmOfflineErrorLike as isRealmOfflineError,
  type JsonObject,
} from '@nimiplatform/sdk/types';
import { getOfflineCacheManager } from '../../../infra/offline/cache-manager';
import { getOfflineCoordinator } from '../../../infra/offline/coordinator';
import {
  fetchPendingFriendRequests,
  loadMergedSocialSnapshot,
  type RealmApiCaller,
  type RealmDataErrorEmitter,
  type SocialContactSnapshot,
} from './social-snapshot';
import { dispatchBlockedUsersUpdated } from './blocked-content';

type UserProfileProjection = NimiRealmSocialProfileView;

export type { SocialContactSnapshot } from './social-snapshot';

export async function loadCurrentUserProfile(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
) {
  return callApi(
    (realm) => loadNimiRealmCurrentUserProfile(realm, emitRealmDataError),
    'Failed to load Realm current user',
  );
}

export async function updateCurrentUserProfile(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
  data: JsonObject,
) {
  return callApi(
    (realm) => updateNimiRealmCurrentUserProfile(realm, emitRealmDataError, data),
    'Failed to update Realm current user',
  );
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

export async function loadUserProfileById(
  callApi: RealmApiCaller,
  emitRealmDataError: RealmDataErrorEmitter,
  id: string,
): Promise<UserProfileProjection> {
  const normalizedId = String(id || '').trim();
  try {
    const enriched = await callApi(
      (realm) => loadNimiRealmUserProfileById(realm, emitRealmDataError, normalizedId),
      'Failed to load Realm user profile',
    );
    const cache = await getOfflineCacheManager();
    await cache.syncProfileMetadata(`user:${normalizedId}`, enriched);
    return enriched;
  } catch (error) {
    if (isRealmOfflineError(error)) {
      const cache = await getOfflineCacheManager();
      const cached = await cache.getCachedProfileMetadata<UserProfileProjection>(`user:${normalizedId}`);
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
  return callApi(
    (realm) => addNimiRealmFriendById(realm, userId, message),
    'Failed to add Realm friend',
  );
}

export async function removeFriendById(
  callApi: RealmApiCaller,
  userId: string,
) {
  if (!userId) {
    throw new Error('用户ID不能为空');
  }
  await callApi(
    (realm) => removeNimiRealmFriendById(realm, userId),
    'Failed to remove Realm friend',
  );
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
      getOfflineCoordinator().markRealmRestReachability('unreachable');
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
      getOfflineCoordinator().markRealmRestReachability('unreachable');
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
      getOfflineCoordinator().markRealmRestReachability('unreachable');
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

  const result = await callApi(
    (realm) => blockNimiRealmUser(realm, contactId),
    'Failed to block Realm user',
  );

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

  const result = await callApi(
    (realm) => unblockNimiRealmUser(realm, contactId),
    'Failed to unblock Realm user',
  );

  await reloadContacts();
  dispatchBlockedUsersUpdated();
  return result;
}
