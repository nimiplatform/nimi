import type { DesktopChatRouteRequestDto } from '@runtime/chat';
import type { DesktopChatRouteResultDto } from '@runtime/chat';
import type { Realm } from '@nimiplatform/sdk/realm';
import type { CreatePostDto } from '@nimiplatform/sdk/realm';
import type { CreateReportDto } from '@nimiplatform/sdk/realm';
import type { MeTwoFactorPrepareOutput } from '@nimiplatform/sdk/realm';
import type { MeTwoFactorVerifyInput } from '@nimiplatform/sdk/realm';
import type { OAuthProvider } from '@nimiplatform/sdk/realm';
import type { RequestAccountDeletionInput } from '@nimiplatform/sdk/realm';
import type { RequestAccountDeletionOutput } from '@nimiplatform/sdk/realm';
import type { RequestDataExportInput } from '@nimiplatform/sdk/realm';
import type { RequestDataExportOutput } from '@nimiplatform/sdk/realm';
import type { SendMessageInputDto } from '@nimiplatform/sdk/realm';
import type { CreateReviewDto } from '@nimiplatform/sdk/realm';
import type { CreateSparkCheckoutDto } from '@nimiplatform/sdk/realm';
import type { CreateWithdrawalDto } from '@nimiplatform/sdk/realm';
import type { UpdatePasswordRequestDto } from '@nimiplatform/sdk/realm';
import type { UpdateUserNotificationSettingsDto } from '@nimiplatform/sdk/realm';
import type { UpdateUserSettingsDto } from '@nimiplatform/sdk/realm';
import type { PasswordAuthDebug } from './auth';
import { loginWithPassword, logoutWithCleanup, registerWithPassword } from './flows/auth-flow';
import {
  countPendingChatOutboxEntries,
  flushPendingChatOutbox,
  loadChatList,
  loadChatMessages,
  loadMoreChatList,
  loadMoreChatMessages,
  markChatAsRead,
  sendChatMessage,
  syncChatEventWindow,
  startChatWithTarget,
} from './flows/chat-flow';
import {
  countPendingSocialMutations,
  flushPendingSocialMutations,
} from './offline-social-outbox';
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
} from './flows/profile-flow';
import { createMasterAgent, loadCreatorAgents, searchUserByIdentifier } from './flows/social-flow';
import type { CreateMasterAgentInput } from './flows/social-flow';
import { loadExploreFeedItems, loadMoreExploreFeedItems } from './flows/explore-flow';
import {
  loadAgentDetails,
  listAgentCoreMemories,
  listAgentE2EMemories,
  loadAgentMemoryStats,
  recallAgentMemoryForEntity,
  resolveChatRoute,
} from './flows/agent-runtime-flow';
import type {
  AgentMemoryRecord,
  AgentMemoryRecallQuery,
  AgentMemorySliceQuery,
} from './clients/agent-memory-client';
import {
  loadMainWorld,
  loadWorldDetailById,
  loadWorldLevelAudits,
  loadWorldList,
  loadWorldSemanticBundle,
  loadWorldAgents,
  loadWorldEvents,
  loadWorldDetailWithAgents,
} from './flows/world-flow';
import {
  abandonWorldTransit,
  addTransitCheckpoint,
  completeWorldTransit,
  getActiveWorldTransit,
  listWorldTransits,
  loadSceneQuota,
  startTransitSession,
  startWorldTransit,
  type SceneQuotaDto,
  type TransitCheckpointStatus,
  type TransitDetailDto,
  type TransitSessionDataDto,
  type TransitStatus,
  type TransitType,
} from './flows/transit-flow';
import {
  claimGift,
  createGiftReview,
  createSparkCheckout,
  createWithdrawal,
  loadGemTransactionHistory,
  loadGiftCatalog,
  loadSparkPackages,
  loadCurrencyBalances,
  loadNotificationUnreadCount,
  loadNotifications,
  loadSparkTransactionHistory,
  loadSubscriptionStatus,
  loadWithdrawalEligibility,
  loadWithdrawalHistory,
  markNotificationsRead,
  markNotificationRead,
  rejectGift,
  sendGift,
} from './flows/economy-notification-flow';
import type { MarkNotificationsReadInputDto } from '@nimiplatform/sdk/realm';
import type { RejectGiftDto } from '@nimiplatform/sdk/realm';
import type { SendGiftDto } from '@nimiplatform/sdk/realm';
import {
  createReport,
  createImageDirectUpload,
  createPost,
  createVideoDirectUpload,
  deletePost,
  likePost,
  loadPostFeed,
  unlikePost,
  updatePostVisibility,
} from './flows/post-media-flow';
import {
  disableTwoFactor,
  enableTwoFactor,
  linkOauth,
  loadMyCreatorEligibility,
  loadMyNotificationSettings,
  loadMySettings,
  prepareTwoFactor,
  requestAccountDeletion,
  requestDataExport,
  unlinkOauth,
  updatePassword,
  updateMyNotificationSettings,
  updateMySettings,
} from './flows/settings-flow';

export type DataSyncCallApi = (task: (realm: Realm) => Promise<any>, fallbackMessage?: string) => Promise<any>;
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
  setAuth: (user: Record<string, unknown> | null, token: string, refreshToken?: string) => void;
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
    loadChats: async (limit = 20) =>
      loadChatList(input.callApiTask, input.emitFacadeError, limit),
    loadMoreChats: async (cursor?: string) => loadMoreChatList(input.callApiTask, input.emitFacadeError, cursor),
    startChat: async (targetAccountId: string, initialMessage: string | null = null) =>
      startChatWithTarget(
        input.callApiTask,
        input.emitFacadeError,
        targetAccountId,
        initialMessage,
      ),
    loadMessages: async (
      chatId: string,
      limit = 50,
      markChatRead?: (chatId: string) => Promise<void>,
    ) =>
      loadChatMessages(
        input.callApiTask,
        input.emitFacadeError,
        chatId,
        limit,
        markChatRead,
      ),
    loadMoreMessages: async (chatId: string, cursor?: string) =>
      loadMoreChatMessages(input.callApiTask, input.emitFacadeError, chatId, cursor),
    sendMessage: async (
      chatId: string,
      content: string,
      options: Partial<SendMessageInputDto> = {},
    ) =>
      sendChatMessage(
        input.callApiTask,
        input.emitFacadeError,
        chatId,
        content,
        options,
      ),
    markChatRead: async (chatId: string) =>
      markChatAsRead(input.callApiTask, input.emitFacadeError, chatId),
    syncChatEvents: async (chatId: string, afterSeq: number, limit = 200) =>
      syncChatEventWindow(
        input.callApiTask,
        input.emitFacadeError,
        chatId,
        afterSeq,
        limit,
      ),
    flushChatOutbox: async (chatId?: string) =>
      flushPendingChatOutbox(
        input.callApiTask,
        input.emitFacadeError,
        chatId,
      ),
    flushSocialOutbox: async () =>
      flushPendingSocialMutations(
        input.callApiTask,
        input.emitFacadeError,
      ),
    countPendingRealmRecoveryWork: async () => {
      const [pendingChats, pendingSocial] = await Promise.all([
        countPendingChatOutboxEntries(),
        countPendingSocialMutations(),
      ]);
      return pendingChats + pendingSocial;
    },
    loadContacts,
    loadSocialSnapshot: async () => loadSocialSnapshot(input.callApiTask, input.emitFacadeError),
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
    requestOrAcceptFriend: async (userId: string) =>
      requestOrAcceptFriend({
        callApi: input.callApiTask,
        userId,
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
    loadWorldDetailWithAgents: async (worldId: string) =>
      loadWorldDetailWithAgents(input.callApiTask, input.emitFacadeError, worldId),
    loadWorldEvents: async (worldId: string) =>
      loadWorldEvents(input.callApiTask, input.emitFacadeError, worldId),
    loadSceneQuota: async (): Promise<SceneQuotaDto> =>
      loadSceneQuota(input.callApiTask, input.emitFacadeError),
    startWorldTransit: async (payload: {
      agentId: string;
      fromWorldId?: string;
      toWorldId: string;
      transitType: TransitType;
      reason?: string;
      carriedState?: Record<string, unknown>;
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
    startTransitSession: async (transitId: string): Promise<TransitSessionDataDto> =>
      startTransitSession(input.callApiTask, input.emitFacadeError, transitId),
    addTransitCheckpoint: async (
      transitId: string,
      payload: {
        name: string;
        status: TransitCheckpointStatus;
        data?: Record<string, unknown>;
      },
    ): Promise<TransitDetailDto> =>
      addTransitCheckpoint(input.callApiTask, input.emitFacadeError, transitId, payload),
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
    }) =>
      loadPostFeed(input.callApiTask, input.emitFacadeError, payload),
    createPost: async (payload: CreatePostDto) =>
      createPost(input.callApiTask, input.emitFacadeError, payload),
    createImageDirectUpload: async () =>
      createImageDirectUpload(input.callApiTask, input.emitFacadeError),
    createVideoDirectUpload: async () =>
      createVideoDirectUpload(input.callApiTask, input.emitFacadeError),
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
    loadCurrencyBalances: async () =>
      loadCurrencyBalances(input.callApiTask, input.emitFacadeError),
    loadSparkTransactionHistory: async (limit = 30, cursor?: string) =>
      loadSparkTransactionHistory(input.callApiTask, input.emitFacadeError, limit, cursor),
    loadGemTransactionHistory: async (limit = 30, cursor?: string) =>
      loadGemTransactionHistory(input.callApiTask, input.emitFacadeError, limit, cursor),
    loadSubscriptionStatus: async () =>
      loadSubscriptionStatus(input.callApiTask, input.emitFacadeError),
    loadSparkPackages: async () =>
      loadSparkPackages(input.callApiTask, input.emitFacadeError),
    createSparkCheckout: async (payload: CreateSparkCheckoutDto) =>
      createSparkCheckout(input.callApiTask, input.emitFacadeError, payload),
    loadWithdrawalEligibility: async () =>
      loadWithdrawalEligibility(input.callApiTask, input.emitFacadeError),
    loadWithdrawalHistory: async (limit = 20, cursor?: string) =>
      loadWithdrawalHistory(input.callApiTask, input.emitFacadeError, limit, cursor),
    createWithdrawal: async (payload: CreateWithdrawalDto) =>
      createWithdrawal(input.callApiTask, input.emitFacadeError, payload),
    loadGiftCatalog: async () =>
      loadGiftCatalog(input.callApiTask, input.emitFacadeError),
    sendGift: async (payload: SendGiftDto) =>
      sendGift(input.callApiTask, input.emitFacadeError, payload),
    claimGift: async (giftTransactionId: string) =>
      claimGift(input.callApiTask, input.emitFacadeError, giftTransactionId),
    rejectGift: async (giftTransactionId: string, payload: RejectGiftDto) =>
      rejectGift(input.callApiTask, input.emitFacadeError, giftTransactionId, payload),
    createGiftReview: async (payload: CreateReviewDto) =>
      createGiftReview(input.callApiTask, input.emitFacadeError, payload),
    loadNotificationUnreadCount: async () =>
      loadNotificationUnreadCount(input.callApiTask, input.emitFacadeError),
    loadNotifications: async (
      options?: {
        type?: 'SYSTEM' | 'INTERACTION' | 'POST_LIKE' | 'POST_COMMENT' | 'MENTION';
        unreadOnly?: boolean;
        limit?: number;
        cursor?: string;
      },
    ) =>
      loadNotifications(input.callApiTask, input.emitFacadeError, options),
    markNotificationsRead: async (payload: MarkNotificationsReadInputDto) =>
      markNotificationsRead(input.callApiTask, input.emitFacadeError, payload),
    markNotificationRead: async (notificationId: string) =>
      markNotificationRead(input.callApiTask, input.emitFacadeError, notificationId),
    loadMySettings: async () =>
      loadMySettings(input.callApiTask, input.emitFacadeError),
    updateMySettings: async (payload: UpdateUserSettingsDto) =>
      updateMySettings(input.callApiTask, input.emitFacadeError, payload),
    loadMyNotificationSettings: async () =>
      loadMyNotificationSettings(input.callApiTask, input.emitFacadeError),
    updateMyNotificationSettings: async (payload: UpdateUserNotificationSettingsDto) =>
      updateMyNotificationSettings(input.callApiTask, input.emitFacadeError, payload),
    loadMyCreatorEligibility: async () =>
      loadMyCreatorEligibility(input.callApiTask, input.emitFacadeError),
    updatePassword: async (payload: UpdatePasswordRequestDto) =>
      updatePassword(input.callApiTask, input.emitFacadeError, payload),
    prepareTwoFactor: async (): Promise<MeTwoFactorPrepareOutput> =>
      prepareTwoFactor(input.callApiTask, input.emitFacadeError),
    enableTwoFactor: async (payload: MeTwoFactorVerifyInput) =>
      enableTwoFactor(input.callApiTask, input.emitFacadeError, payload),
    disableTwoFactor: async (payload: MeTwoFactorVerifyInput) =>
      disableTwoFactor(input.callApiTask, input.emitFacadeError, payload),
    linkOauth: async (provider: OAuthProvider, accessToken: string) =>
      linkOauth(input.callApiTask, input.emitFacadeError, provider, accessToken),
    unlinkOauth: async (provider: OAuthProvider) =>
      unlinkOauth(input.callApiTask, input.emitFacadeError, provider),
    requestDataExport: async (payload: RequestDataExportInput): Promise<RequestDataExportOutput> =>
      requestDataExport(input.callApiTask, input.emitFacadeError, payload),
    requestAccountDeletion: async (
      payload: RequestAccountDeletionInput,
    ): Promise<RequestAccountDeletionOutput> =>
      requestAccountDeletion(input.callApiTask, input.emitFacadeError, payload),
    loadAgentDetails: async (agentIdentifier: string) =>
      loadAgentDetails(input.callApiTask, input.emitFacadeError, agentIdentifier, {
        viewerUserId: String(input.getCurrentUser()?.id || '').trim() || undefined,
      }),
    recallAgentMemoryForEntity: async (inputPayload: {
      agentId: string;
      entityId: string;
      query?: AgentMemoryRecallQuery;
    }) =>
      recallAgentMemoryForEntity(input.callApiTask, input.emitFacadeError, inputPayload),
    listAgentCoreMemories: async (inputPayload: {
      agentId: string;
      query?: AgentMemorySliceQuery;
    }): Promise<AgentMemoryRecord[]> =>
      listAgentCoreMemories(input.callApiTask, input.emitFacadeError, inputPayload),
    listAgentE2EMemories: async (inputPayload: {
      agentId: string;
      entityId: string;
      query?: AgentMemorySliceQuery;
    }): Promise<AgentMemoryRecord[]> =>
      listAgentE2EMemories(input.callApiTask, input.emitFacadeError, inputPayload),
    loadAgentMemoryStats: async (agentId: string) =>
      loadAgentMemoryStats(input.callApiTask, input.emitFacadeError, agentId),
    resolveChatRoute: async (data: DesktopChatRouteRequestDto): Promise<DesktopChatRouteResultDto> =>
      resolveChatRoute(input.callApiTask, data, input.emitFacadeError),
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
