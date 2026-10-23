import type { JsonObject } from '@nimiplatform/sdk/types';
import {
  createSocialSnapshotStore,
  isFriendInContacts,
  type RealmApiCaller,
  type RealmDataErrorEmitter,
} from './social-snapshot';
import {
  blockUser,
  loadContactList,
  loadCurrentUserProfile,
  loadPendingFriendRequests,
  loadSocialSnapshot,
  loadUserProfileById,
  rejectOrRemoveFriend,
  removeFriend,
  requestOrAcceptFriend,
  unblockUser,
  updateCurrentUserProfile,
} from './profile-data';
import {
  isBlockedUser,
} from './blocked-content';
import {
  type RealmSocialOfflinePort,
} from './social-offline-port.js';

export type { SocialContactSnapshot } from './social-snapshot';

export function createRealmSocialData(input: {
  readonly callApi: RealmApiCaller;
  readonly emitDataError: RealmDataErrorEmitter;
  readonly now: () => number;
  readonly offline: RealmSocialOfflinePort;
}) {
  const snapshotStore = createSocialSnapshotStore();
  const blockedUserListeners = new Set<() => void>();
  const notifyBlockedUsersChanged = () => {
    for (const listener of blockedUserListeners) listener();
  };
  const reloadSocialSnapshot = async (): Promise<void> => {
    await loadSocialSnapshot(input.callApi, input.emitDataError, snapshotStore);
  };

  return Object.freeze({
    loadCurrentUser: () =>
      loadCurrentUserProfile(input.callApi, input.emitDataError),
    updateUserProfile: (data: JsonObject) =>
      updateCurrentUserProfile(input.callApi, input.emitDataError, data),
    loadContacts: () =>
      loadContactList(input.callApi, input.emitDataError, snapshotStore),
    loadSocialSnapshot: () =>
      loadSocialSnapshot(input.callApi, input.emitDataError, snapshotStore),
    loadFriendRequests: () =>
      loadPendingFriendRequests(input.callApi, input.emitDataError),
    loadUserProfile: (id: string) =>
      loadUserProfileById(input.callApi, input.emitDataError, input.offline, id),
    requestOrAcceptFriend: (userId: string, message?: string) =>
      requestOrAcceptFriend({
        callApi: input.callApi,
        offline: input.offline,
        userId,
        message,
        reloadContacts: reloadSocialSnapshot,
      }),
    removeFriend: (userId: string) =>
      removeFriend({
        callApi: input.callApi,
        offline: input.offline,
        userId,
        reloadContacts: reloadSocialSnapshot,
      }),
    rejectOrRemoveFriend: (userId: string) =>
      rejectOrRemoveFriend({
        callApi: input.callApi,
        offline: input.offline,
        userId,
        reloadContacts: reloadSocialSnapshot,
      }),
    async blockUser(contact: JsonObject) {
      const result = await blockUser(input.callApi, contact, reloadSocialSnapshot);
      notifyBlockedUsersChanged();
      return result;
    },
    async unblockUser(contact: JsonObject) {
      const result = await unblockUser(input.callApi, contact, reloadSocialSnapshot);
      notifyBlockedUsersChanged();
      return result;
    },
    subscribeBlockedUsers(listener: () => void) {
      blockedUserListeners.add(listener);
      return () => {
        blockedUserListeners.delete(listener);
      };
    },
    isFriend: (userId: string) => isFriendInContacts(snapshotStore.get(), userId),
    isBlockedUser: (userId: string) => isBlockedUser(snapshotStore.get(), userId),
    contacts: snapshotStore.get,
    dispose() {
      blockedUserListeners.clear();
      snapshotStore.reset();
    },
  });
}

export type RealmSocialData = ReturnType<typeof createRealmSocialData>;
