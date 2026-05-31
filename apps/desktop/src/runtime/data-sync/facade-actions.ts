import type { PasswordAuthDebug } from './auth';
import type { Realm } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { loginWithPassword, logoutWithCleanup, registerWithPassword } from './flows/auth-flow';
import {
  loadGroupChatList,
  loadGroupChat,
  loadGroupChatMessages,
  sendGroupChatMessage,
  commitRealmGroupMessageCandidateHandoff,
  markGroupChatRead,
  createGroupChat,
  syncGroupChatEvents,
  addGroupChatAgent,
  removeGroupChatAgent,
} from './flows/group-chat-flow';

type CreatePostDto = RealmModel<'CreatePostDto'>;
type CreateReportDto = RealmModel<'CreateReportDto'>;
type FinalizeResourceDto = RealmModel<'FinalizeResourceDto'>;
type GroupMessageViewDto = RealmModel<'GroupMessageViewDto'>;
type GroupParticipantDto = RealmModel<'GroupParticipantDto'>;
import {
  countPendingSocialMutations,
  flushPendingSocialMutations,
} from './offline-social-outbox';
import {
  blockUser,
  loadAgentFriendLimit,
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
} from './flows/profile-flow';
import { searchUserByIdentifier } from './flows/social-flow';
import { createMasterAgent, loadCreatorAgents } from './flows/agent-flow';
import type { CreateMasterAgentInput } from './flows/social-flow';
import { loadExploreAgents, loadExploreFeedItems, loadMoreExploreFeedItems, type LoadExploreAgentsInput } from './flows/explore-flow';
import {
  loadAgentDetails,
} from './flows/agent-runtime-flow';
import {
  loadMainWorld,
  loadWorldDetailById,
  loadWorldHistory,
  loadWorldLevelAudits,
  loadWorldList,
  loadWorldLorebooks,
  loadWorldBindings,
  loadWorldScenes,
  loadWorldSemanticBundle,
  loadWorldAgents,
  loadWorldDetailWithAgents,
} from './flows/world-flow';
import {
  abandonWorldTransit,
  completeWorldTransit,
  getActiveWorldTransit,
  listWorldTransits,
  startWorldTransit,
  type TransitDetailDto,
  type TransitStatus,
  type TransitType,
} from './flows/transit-flow';
import {
  createReport,
  createImageDirectUpload,
  createPost,
  createVideoDirectUpload,
  deletePost,
  finalizeResource,
  likePost,
  loadLikedPosts,
  loadPostById,
  loadPostFeed,
  unlikePost,
  uploadImageResourceFile,
  uploadVideoResourceFile,
  updatePostVisibility,
} from './flows/post-attachment-flow';
import type { PostFeedScope, UploadResourceFileOptions } from './flows/post-attachment-flow';

export type DataSyncCallApi = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
export type DataSyncEmitError = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

type CreateDataSyncActionsInput = {
  callApiTask: DataSyncCallApi;
  emitFacadeError: DataSyncEmitError;
  setToken: (token: string | null | undefined) => void;
  setRefreshToken: (token: string | null | undefined) => void;
  setAuth: (user: Record<string, unknown> | null | undefined, token: string, refreshToken?: string) => void;
  clearAuth: () => void;
  stopAllPolling: () => void;
  isFriend: (userId: string) => boolean;
  getCurrentUser: () => Record<string, unknown> | null;
};

export function createDataSyncActions(input: CreateDataSyncActionsInput) {
  const loadContacts = async () => loadContactList(input.callApiTask, input.emitFacadeError);

  return {
    loadCurrentUser: async () => loadCurrentUserProfile(input.callApiTask, input.emitFacadeError),
    updateUserProfile: async (data: Record<string, unknown>) =>
      updateCurrentUserProfile(input.callApiTask, input.emitFacadeError, data),
    loadGroupChats: async (limit = 20) =>
      loadGroupChatList(input.callApiTask, input.emitFacadeError, limit),
    loadGroupChat: async (chatId: string) =>
      loadGroupChat(input.callApiTask, input.emitFacadeError, chatId),
    loadGroupMessages: async (chatId: string, limit = 50) =>
      loadGroupChatMessages(input.callApiTask, input.emitFacadeError, chatId, limit),
    sendGroupMessage: async (chatId: string, content: string) =>
      sendGroupChatMessage(input.callApiTask, input.emitFacadeError, chatId, content),
    commitRealmGroupMessageCandidate: async (
      chatId: string,
      participant: GroupParticipantDto,
      triggerMessage: GroupMessageViewDto,
    ) =>
      commitRealmGroupMessageCandidateHandoff(
        input.callApiTask,
        input.emitFacadeError,
        input.getCurrentUser,
        chatId,
        participant,
        triggerMessage,
      ),
    markGroupRead: async (chatId: string) =>
      markGroupChatRead(input.callApiTask, input.emitFacadeError, chatId),
    createGroup: async (title: string, participantIds: string[], initialMessage?: string) =>
      createGroupChat(input.callApiTask, input.emitFacadeError, title, participantIds, initialMessage),
    syncGroupEvents: async (chatId: string, afterSeq: number, limit = 200) =>
      syncGroupChatEvents(input.callApiTask, input.emitFacadeError, chatId, afterSeq, limit),
    addGroupAgent: async (chatId: string, agentAccountId: string) =>
      addGroupChatAgent(input.callApiTask, input.emitFacadeError, chatId, agentAccountId),
    removeGroupAgent: async (chatId: string, agentAccountId: string) =>
      removeGroupChatAgent(input.callApiTask, input.emitFacadeError, chatId, agentAccountId),
    flushSocialOutbox: async () =>
      flushPendingSocialMutations(
        input.callApiTask,
        input.emitFacadeError,
      ),
    countPendingRealmRecoveryWork: async () => {
      return await countPendingSocialMutations();
    },
    loadContacts,
    loadSocialSnapshot: async () => loadSocialSnapshot(input.callApiTask, input.emitFacadeError),
    loadAgentFriendLimit: async () =>
      loadAgentFriendLimit(input.callApiTask, input.emitFacadeError),
    searchUser: async (identifierInput: string) =>
      searchUserByIdentifier(input.callApiTask, identifierInput, (userId) => input.isFriend(userId)),
    removeFriend: async (userId: string) =>
      removeFriend({
        callApi: input.callApiTask,
        userId,
        reloadContacts: async () => {
          await loadContacts();
        },
      }),
    requestOrAcceptFriend: async (userId: string, message?: string) =>
      requestOrAcceptFriend({
        callApi: input.callApiTask,
        userId,
        message,
        reloadContacts: async () => {
          await loadContacts();
        },
      }),
    rejectOrRemoveFriend: async (userId: string) =>
      rejectOrRemoveFriend({
        callApi: input.callApiTask,
        userId,
        reloadContacts: async () => {
          await loadContacts();
        },
      }),
    blockUser: async (contact: Record<string, unknown>) =>
      blockUser(
        input.callApiTask,
        contact,
        async () => {
          await loadContacts();
        },
      ),
    unblockUser: async (contact: Record<string, unknown>) =>
      unblockUser(
        input.callApiTask,
        contact,
        async () => {
          await loadContacts();
        },
      ),
    loadUserProfile: async (id: string) =>
      loadUserProfileById(input.callApiTask, input.emitFacadeError, id),
    loadMyAgents: async () => loadCreatorAgents(input.callApiTask),
    createAgent: async (agentInput: CreateMasterAgentInput) =>
      createMasterAgent(input.callApiTask, agentInput),
    loadFriendRequests: async () => loadPendingFriendRequests(input.callApiTask, input.emitFacadeError),
    loadExploreAgents: async (agentInput: LoadExploreAgentsInput = {}) =>
      loadExploreAgents(input.callApiTask, input.emitFacadeError, agentInput),
    loadExploreFeed: async (tag: string | null = null, limit = 20) =>
      loadExploreFeedItems(input.callApiTask, input.emitFacadeError, tag, limit),
    loadMoreExploreFeed: async (limit = 20, cursor?: string, tag?: string | null) =>
      loadMoreExploreFeedItems(input.callApiTask, input.emitFacadeError, limit, cursor, tag),
    loadWorlds: async (status?: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED') =>
      loadWorldList(input.callApiTask, input.emitFacadeError, status),
    loadWorldDetailById: async (worldId: string) =>
      loadWorldDetailById(input.callApiTask, input.emitFacadeError, worldId),
    loadWorldSemanticBundle: async (worldId: string) =>
      loadWorldSemanticBundle(input.callApiTask, input.emitFacadeError, worldId),
    loadMainWorld: async () =>
      loadMainWorld(input.callApiTask, input.emitFacadeError),
    loadWorldLevelAudits: async (worldId: string, limit = 20) =>
      loadWorldLevelAudits(input.callApiTask, input.emitFacadeError, worldId, limit),
    loadWorldAgents: async (worldId: string) =>
      loadWorldAgents(input.callApiTask, input.emitFacadeError, worldId),
    loadWorldDetailWithAgents: async (worldId: string, recommendedAgentLimit?: number) =>
      loadWorldDetailWithAgents(input.callApiTask, input.emitFacadeError, worldId, recommendedAgentLimit),
    loadWorldHistory: async (worldId: string) =>
      loadWorldHistory(input.callApiTask, input.emitFacadeError, worldId),
    loadWorldLorebooks: async (worldId: string) =>
      loadWorldLorebooks(input.callApiTask, input.emitFacadeError, worldId),
    loadWorldBindings: async (worldId: string) =>
      loadWorldBindings(input.callApiTask, input.emitFacadeError, worldId),
    loadWorldScenes: async (worldId: string) =>
      loadWorldScenes(input.callApiTask, input.emitFacadeError, worldId),
    startWorldTransit: async (payload: {
      agentId: string;
      fromWorldId?: string;
      toWorldId: string;
      transitType: TransitType;
      reason?: string;
      context?: Record<string, unknown>;
    }): Promise<TransitDetailDto> =>
      startWorldTransit(input.callApiTask, input.emitFacadeError, payload),
    listWorldTransits: async (query?: {
      agentId?: string;
      status?: TransitStatus;
      transitType?: TransitType;
    }): Promise<TransitDetailDto[]> =>
      listWorldTransits(input.callApiTask, input.emitFacadeError, query),
    getActiveWorldTransit: async (agentId: string): Promise<TransitDetailDto | null> =>
      getActiveWorldTransit(input.callApiTask, input.emitFacadeError, agentId),
    completeWorldTransit: async (transitId: string): Promise<TransitDetailDto> =>
      completeWorldTransit(input.callApiTask, input.emitFacadeError, transitId),
    abandonWorldTransit: async (transitId: string): Promise<TransitDetailDto> =>
      abandonWorldTransit(input.callApiTask, input.emitFacadeError, transitId),
    loadPostFeed: async (payload: {
      visibility?: 'PUBLIC' | 'FRIENDS' | 'PRIVATE';
      worldId?: string;
      authorId?: string;
      limit?: number;
      cursor?: string;
      scope?: PostFeedScope;
    }) =>
      loadPostFeed(input.callApiTask, input.emitFacadeError, payload),
    loadLikedPosts: async (profileId: string, limit = 20, cursor?: string) =>
      loadLikedPosts(input.callApiTask, input.emitFacadeError, profileId, limit, cursor),
    loadPostById: async (postId: string) =>
      loadPostById(input.callApiTask, input.emitFacadeError, postId),
    createPost: async (payload: CreatePostDto) =>
      createPost(input.callApiTask, input.emitFacadeError, payload),
    createImageDirectUpload: async () =>
      createImageDirectUpload(input.callApiTask, input.emitFacadeError),
    createVideoDirectUpload: async () =>
      createVideoDirectUpload(input.callApiTask, input.emitFacadeError),
    finalizeResource: async (resourceId: string, payload: FinalizeResourceDto) =>
      finalizeResource(input.callApiTask, input.emitFacadeError, resourceId, payload),
    uploadImageResourceFile: async (file: Blob, options?: UploadResourceFileOptions) =>
      uploadImageResourceFile(input.callApiTask, input.emitFacadeError, file, options),
    uploadVideoResourceFile: async (file: Blob, options?: UploadResourceFileOptions) =>
      uploadVideoResourceFile(input.callApiTask, input.emitFacadeError, file, options),
    deletePost: async (postId: string) =>
      deletePost(input.callApiTask, input.emitFacadeError, postId),
    updatePostVisibility: async (
      postId: string,
      visibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE',
    ) =>
      updatePostVisibility(input.callApiTask, input.emitFacadeError, postId, visibility),
    likePost: async (postId: string) =>
      likePost(input.callApiTask, input.emitFacadeError, postId),
    unlikePost: async (postId: string) =>
      unlikePost(input.callApiTask, input.emitFacadeError, postId),
    createReport: async (payload: CreateReportDto) =>
      createReport(input.callApiTask, input.emitFacadeError, payload),
    loadAgentDetails: async (agentIdentifier: string) =>
      loadAgentDetails(input.callApiTask, input.emitFacadeError, agentIdentifier, {
        viewerUserId: String(input.getCurrentUser()?.id || '').trim() || undefined,
      }),
    login: async (identifier: string, password: string, debug?: PasswordAuthDebug) =>
      loginWithPassword(
        input.callApiTask,
        (token) => input.setToken(token),
        identifier,
        password,
        debug,
        (token) => input.setRefreshToken(token),
        (user, token, refreshToken) => input.setAuth(user, token, refreshToken),
      ),
    register: async (email: string, password: string, debug?: PasswordAuthDebug) =>
      registerWithPassword(
        input.callApiTask,
        (token) => input.setToken(token),
        email,
        password,
        debug,
        (token) => input.setRefreshToken(token),
        (user, token, refreshToken) => input.setAuth(user, token, refreshToken),
      ),
    logout: async () =>
      logoutWithCleanup({
        callApi: input.callApiTask,
        clearAuth: () => input.clearAuth(),
        stopAllPolling: () => input.stopAllPolling(),
      }),
  };
}
