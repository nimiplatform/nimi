import type { PasswordAuthDebug } from './auth';
import type { Realm, RequestAccountDeletionInput, RequestAccountDeletionOutput, RequestDataExportInput, RequestDataExportOutput } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
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

type CreatePostDto = RealmModel<'CreatePostDto'>;
type CreateReportDto = RealmModel<'CreateReportDto'>;
type FinalizeResourceDto = RealmModel<'FinalizeResourceDto'>;
type MeTwoFactorPrepareOutput = RealmModel<'MeTwoFactorPrepareOutput'>;
type MeTwoFactorVerifyInput = RealmModel<'MeTwoFactorVerifyInput'>;
type OAuthProvider = RealmModel<'OAuthProvider'>;
type SendMessageInputDto = RealmModel<'SendMessageInputDto'>;
type CreateReviewDto = RealmModel<'CreateReviewDto'>;
type CreateSparkCheckoutDto = RealmModel<'CreateSparkCheckoutDto'>;
type CreateWithdrawalDto = RealmModel<'CreateWithdrawalDto'>;
type NotificationDto = RealmModel<'NotificationDto'>;
type NotificationListResultDto = RealmModel<'NotificationListResultDto'>;
type UpdatePasswordRequestDto = RealmModel<'UpdatePasswordRequestDto'>;
type UpdateUserNotificationSettingsDto = RealmModel<'UpdateUserNotificationSettingsDto'>;
type UpdateUserSettingsDto = RealmModel<'UpdateUserSettingsDto'>;
type UnreadNotificationCountDto = RealmModel<'UnreadNotificationCountDto'>;
type MarkNotificationsReadInputDto = RealmModel<'MarkNotificationsReadInputDto'>;
type RejectGiftDto = RealmModel<'RejectGiftDto'>;
type SendGiftDto = RealmModel<'SendGiftDto'>;
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
} from './flows/agent-runtime-flow';
import {
  loadMainWorld,
  loadWorldDetailById,
  loadWorldHistory,
  loadWorldLevelAudits,
  loadWorldList,
  loadWorldLorebooks,
  loadWorldBindings,
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
  acceptGift,
  createGiftReview,
  createSparkCheckout,
  createWithdrawal,
  loadGemTransactionHistory,
  loadGiftCatalog,
  loadGiftTransaction,
  loadReceivedGifts,
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
  updatePostVisibility,
} from './flows/post-attachment-flow';
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

type DataSyncNotificationType = NonNullable<NotificationDto['type']>;

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
    loadGiftTransaction: async (id: string) =>
      loadGiftTransaction(input.callApiTask, input.emitFacadeError, id),
    loadReceivedGifts: async (limit = 20, cursor?: string) =>
      loadReceivedGifts(input.callApiTask, input.emitFacadeError, limit, cursor),
    sendGift: async (payload: SendGiftDto) =>
      sendGift(input.callApiTask, input.emitFacadeError, payload),
    acceptGift: async (giftTransactionId: string) =>
      acceptGift(input.callApiTask, input.emitFacadeError, giftTransactionId),
    rejectGift: async (giftTransactionId: string, payload: RejectGiftDto) =>
      rejectGift(input.callApiTask, input.emitFacadeError, giftTransactionId, payload),
    createGiftReview: async (payload: CreateReviewDto) =>
      createGiftReview(input.callApiTask, input.emitFacadeError, payload),
    loadNotificationUnreadCount: async (): Promise<UnreadNotificationCountDto> =>
      loadNotificationUnreadCount(input.callApiTask, input.emitFacadeError),
    loadNotifications: async (
      options?: {
        type?: DataSyncNotificationType;
        unreadOnly?: boolean;
        limit?: number;
        cursor?: string;
      },
    ): Promise<NotificationListResultDto> =>
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
