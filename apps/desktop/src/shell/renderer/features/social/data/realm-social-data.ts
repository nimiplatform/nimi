import type { JsonObject } from '@nimiplatform/sdk/types';
import {
  runLocalAgentProvisionCourierPass,
  runLocalAgentTerminationCourierPass,
} from '@renderer/infra/local-agent-courier';
import { callRealmApi, emitRealmDataError } from '@renderer/infra/realm/realm-api';
import {
  getCachedContacts,
  isFriendInContacts,
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
  createPost,
  createReport,
  deletePost,
  likePost,
  loadLikedPosts,
  loadPostById,
  loadPostFeed,
  unlikePost,
  updatePostVisibility,
  type LoadPostFeedInput,
} from './post-feed-data';
import {
  isBlockedUser,
} from './blocked-content';
import {
  countPendingSocialMutations,
  flushPendingSocialMutations,
} from './offline-social-outbox';

export type { SocialContactSnapshot } from './social-snapshot';
export type { PostFeedScope } from './post-feed-data';

const reloadSocialSnapshot = async (): Promise<void> => {
  await loadSocialSnapshot(callRealmApi, emitRealmDataError);
};

export const realmSocialData = {
  loadCurrentUser: () =>
    loadCurrentUserProfile(callRealmApi, emitRealmDataError),
  updateUserProfile: (data: JsonObject) =>
    updateCurrentUserProfile(callRealmApi, emitRealmDataError, data),
  loadContacts: () =>
    loadContactList(callRealmApi, emitRealmDataError),
  loadSocialSnapshot: () =>
    loadSocialSnapshot(callRealmApi, emitRealmDataError),
  loadFriendRequests: () =>
    loadPendingFriendRequests(callRealmApi, emitRealmDataError),
  loadUserProfile: (id: string) =>
    loadUserProfileById(callRealmApi, emitRealmDataError, id),
  requestOrAcceptFriend: (userId: string, message?: string) =>
    requestOrAcceptFriend({
      callApi: callRealmApi,
      userId,
      message,
      reloadContacts: reloadSocialSnapshot,
    }).then((result) => {
      void runLocalAgentProvisionCourierPass().catch(() => {});
      return result;
    }),
  removeFriend: (userId: string) =>
    removeFriend({
      callApi: callRealmApi,
      userId,
      reloadContacts: reloadSocialSnapshot,
    }).then((result) => {
      void runLocalAgentTerminationCourierPass().catch(() => {});
      return result;
    }),
  rejectOrRemoveFriend: (userId: string) =>
    rejectOrRemoveFriend({
      callApi: callRealmApi,
      userId,
      reloadContacts: reloadSocialSnapshot,
    }),
  blockUser: (contact: JsonObject) =>
    blockUser(callRealmApi, contact, reloadSocialSnapshot),
  unblockUser: (contact: JsonObject) =>
    unblockUser(callRealmApi, contact, reloadSocialSnapshot),
  isFriend: (userId: string) => isFriendInContacts(getCachedContacts(), userId),
  isBlockedUser,
  loadPostFeed: (input: LoadPostFeedInput) =>
    loadPostFeed(callRealmApi, emitRealmDataError, input),
  loadLikedPosts: (profileId: string, limit = 20, cursor?: string) =>
    loadLikedPosts(callRealmApi, emitRealmDataError, profileId, limit, cursor),
  loadPostById: (postId: string) =>
    loadPostById(callRealmApi, emitRealmDataError, postId),
  createPost: (payload: Parameters<typeof createPost>[2]) =>
    createPost(callRealmApi, emitRealmDataError, payload),
  deletePost: (postId: string) =>
    deletePost(callRealmApi, emitRealmDataError, postId),
  updatePostVisibility: (postId: string, visibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE') =>
    updatePostVisibility(callRealmApi, emitRealmDataError, postId, visibility),
  likePost: (postId: string) =>
    likePost(callRealmApi, emitRealmDataError, postId),
  unlikePost: (postId: string) =>
    unlikePost(callRealmApi, emitRealmDataError, postId),
  createReport: (payload: Parameters<typeof createReport>[2]) =>
    createReport(callRealmApi, emitRealmDataError, payload),
  hasPendingOfflineRecoveryWork: async () =>
    (await countPendingSocialMutations()) > 0,
  flushSocialOutbox: () =>
    flushPendingSocialMutations(callRealmApi, emitRealmDataError),
};
