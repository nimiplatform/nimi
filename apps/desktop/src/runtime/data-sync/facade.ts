import { withOpenApiContextLock } from '@runtime/context/openapi-context';
import type { DesktopChatRouteRequestDto, DesktopChatRouteResultDto } from '@runtime/chat';
import { Realm } from '@nimiplatform/sdk/realm';
import type {
  ChatSyncResultDto,
  CreatePostDto,
  CreateReportDto,
  FinalizeMediaAssetDto,
  MediaAssetDetailDto,
  CreateReviewDto,
  CreateSparkCheckoutDto,
  CreateWithdrawalDto,
  MeTwoFactorPrepareOutput,
  MeTwoFactorVerifyInput,
  NotificationDto,
  NotificationListResultDto,
  OAuthProvider,
  RealmTokenRefreshResult,
  RejectGiftDto,
  ReceivedGiftsResponseDto,
  RequestAccountDeletionInput,
  RequestAccountDeletionOutput,
  RequestDataExportInput,
  RequestDataExportOutput,
  SendGiftDto,
  SendMessageInputDto,
  SparkCheckoutSessionDto,
  SparkPackageDto,
  UnreadNotificationCountDto,
  UpdatePasswordRequestDto,
  UpdateUserNotificationSettingsDto,
  UpdateUserSettingsDto,
  UserNotificationSettingsDto,
  UserSettingsDto,
  WorldLevelAuditEventDto,
} from '@nimiplatform/sdk/realm';
import { emitRuntimeLog } from '@runtime/telemetry/logger';
import { extractRuntimeErrorFields } from '@runtime/telemetry/error-fields';
import {
  getOfflineCoordinator,
  isRealmOfflineError,
} from '@runtime/offline';
import type { DataSyncApiConfig, FetchImpl } from './api-core';
import { normalizeRealmBaseUrl, normalizeApiError, tryParseJsonLike } from './api-core';
import type { PasswordAuthDebug } from './auth';
import { readDataSyncHotState, writeDataSyncHotState } from './facade-hot-state';
import { refreshDataSyncAccessToken } from './facade-refresh';
import { DataSyncPollingManager } from './polling-manager';
import type { CreatorEligibility } from './flows/settings-flow';
import type {
  AgentMemoryRecallQuery,
  AgentMemorySliceQuery,
} from './clients/agent-memory-client';
import type {
  SceneQuotaDto,
  TransitCheckpointStatus,
  TransitDetailDto,
  TransitSessionDataDto,
  TransitStatus,
  TransitType,
} from './flows/transit-flow';
import { createDataSyncActions } from './facade-actions';
import type { CreateMasterAgentInput } from './flows/social-flow';

export type DataSyncAuthCallbacks = {
  setAuth: (user: Record<string, unknown> | null, token: string, refreshToken?: string) => void;
  clearAuth: () => void;
  getCurrentUser: () => Record<string, unknown> | null;
  isFriend: (userId: string) => boolean;
};

type DataSyncNotificationType = NonNullable<NotificationDto['type']>;

export class DataSync {
  private realmBaseUrl = '';
  private accessToken = '';
  private refreshToken = '';
  private fetchImpl: FetchImpl | null = null;
  private proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private authCallbacks: DataSyncAuthCallbacks | null = null;
  private readonly polling = new DataSyncPollingManager();
  private readonly callApiTask = (task: (realm: Realm) => Promise<any>, fallbackMessage?: string) =>
    this.callApi(task, fallbackMessage);
  private readonly emitFacadeError = (
    action: string,
    error: unknown,
    details: Record<string, unknown> = {},
  ) => this.emitDataSyncError(action, error, details);
  private readonly actions = createDataSyncActions({
    callApiTask: this.callApiTask,
    emitFacadeError: this.emitFacadeError,
    setToken: (token) => this.setToken(token),
    setRefreshToken: (token) => this.setRefreshToken(token),
    setAuth: (user, token, refreshToken) => this.authCallbacks?.setAuth(user, token, refreshToken),
    clearAuth: () => this.authCallbacks?.clearAuth(),
    stopAllPolling: () => this.stopAllPolling(),
    isFriend: (userId) => this.isFriend(userId),
    getCurrentUser: () => this.authCallbacks?.getCurrentUser() || null,
  });

  constructor() {
    this.hydrateApiFromHotState();
  }

  setAuthCallbacks(callbacks: DataSyncAuthCallbacks) { this.authCallbacks = callbacks; }

  private hydrateApiFromHotState(): boolean {
    const hotState = readDataSyncHotState();
    if (!hotState) return false;
    this.realmBaseUrl = hotState.realmBaseUrl;
    this.accessToken = hotState.accessToken;
    this.refreshToken = hotState.refreshToken;
    this.fetchImpl = hotState.fetchImpl;
    return true;
  }

  private persistApiToHotState() {
    if (!this.realmBaseUrl) return;
    writeDataSyncHotState({ realmBaseUrl: this.realmBaseUrl, accessToken: this.accessToken, refreshToken: this.refreshToken, fetchImpl: this.fetchImpl });
  }

  initApi(config?: DataSyncApiConfig) {
    this.realmBaseUrl = normalizeRealmBaseUrl(config?.realmBaseUrl);
    this.accessToken = String(config?.accessToken || '');
    this.refreshToken = String(config?.refreshToken || '');
    this.fetchImpl = typeof config?.fetchImpl === 'function' ? config.fetchImpl : null;
    this.persistApiToHotState();
    return this;
  }

  setRefreshToken(token: string | null | undefined) {
    this.refreshToken = String(token || '');
    this.persistApiToHotState();
  }

  setToken(token: string | null | undefined) {
    this.accessToken = String(token || '');
    this.persistApiToHotState();
  }

  assertApiConfigured() {
    if (!this.realmBaseUrl) this.hydrateApiFromHotState();
    if (!this.realmBaseUrl) throw new Error('API not initialized');
  }

  async callApi(task: (realm: Realm) => Promise<any>, fallbackMessage?: string): Promise<any> {
    this.assertApiConfigured();
    try {
      const result = await withOpenApiContextLock(
        {
          realmBaseUrl: this.realmBaseUrl,
          accessToken: this.accessToken,
          refreshToken: this.refreshToken,
          fetchImpl: this.fetchImpl,
          onTokenRefreshed: (refreshResult: RealmTokenRefreshResult) => {
            this.accessToken = refreshResult.accessToken;
            if (refreshResult.refreshToken) {
              this.refreshToken = refreshResult.refreshToken;
            }
            this.persistApiToHotState();
            this.authCallbacks?.setAuth(
              this.authCallbacks?.getCurrentUser() ?? null,
              refreshResult.accessToken,
              refreshResult.refreshToken,
            );
            this.scheduleProactiveRefresh(refreshResult.accessToken);
            emitRuntimeLog({
              level: 'info',
              area: 'datasync',
              message: 'action:token-refresh:success',
            });
          },
          onRefreshFailed: (error: unknown) => {
            const errorFields = extractRuntimeErrorFields(error);
            emitRuntimeLog({
              level: 'warn',
              area: 'datasync',
              message: 'action:token-refresh:failed',
              traceId: errorFields.traceId,
              details: {
                reasonCode: errorFields.reasonCode,
                actionHint: errorFields.actionHint,
                retryable: errorFields.retryable,
                traceId: errorFields.traceId,
                error: errorFields.message || (error instanceof Error ? error.message : String(error || '')),
              },
            });
            this.authCallbacks?.clearAuth();
            this.stopAllPolling();
            this.clearProactiveRefreshTimer();
          },
        },
        task,
      );
      const normalized = tryParseJsonLike(result);
      getOfflineCoordinator().markRealmRestReachable(true);
      return normalized === undefined ? {} : normalized;
    } catch (error) {
      const normalized = normalizeApiError(error, fallbackMessage);
      if (isRealmOfflineError(normalized)) {
        getOfflineCoordinator().markRealmRestReachable(false);
      }
      throw normalized;
    }
  }

  private emitDataSyncError(action: string, error: unknown, details: Record<string, unknown> = {}) {
    const errorFields = extractRuntimeErrorFields(error);
    emitRuntimeLog({
      level: 'error',
      area: 'datasync',
      message: `action:${action}:failed`,
      traceId: errorFields.traceId,
      details: {
        ...details,
        reasonCode: errorFields.reasonCode,
        actionHint: errorFields.actionHint,
        retryable: errorFields.retryable,
        traceId: errorFields.traceId,
        error: errorFields.message || (error instanceof Error ? error.message : String(error || '')),
      },
    });
  }

  async loadInitialData() { await this.loadCurrentUser(); await this.loadChats(); await this.loadContacts(); }

  loadCurrentUser() {
    return this.actions.loadCurrentUser();
  }
  updateUserProfile(data: Record<string, unknown>) { return this.actions.updateUserProfile(data); }
  loadChats(limit = 20) {
    return this.actions.loadChats(Math.min(limit, 100));
  }
  loadMoreChats(cursor?: string) { return this.actions.loadMoreChats(cursor); }
  startChat(targetAccountId: string, initialMessage: string | null = null) { return this.actions.startChat(targetAccountId, initialMessage); }
  loadMessages(chatId: string, limit = 50) {
    return this.actions.loadMessages(chatId, Math.min(limit, 100), (id) => this.markChatRead(id));
  }
  loadMoreMessages(chatId: string, cursor?: string) { return this.actions.loadMoreMessages(chatId, cursor); }
  sendMessage(chatId: string, content: string, options: Partial<SendMessageInputDto> = {}) { return this.actions.sendMessage(chatId, content, options); }
  syncChatEvents(chatId: string, afterSeq: number, limit = 100): Promise<ChatSyncResultDto> { return this.actions.syncChatEvents(chatId, afterSeq, Math.min(limit, 100)); }
  async flushChatOutbox(chatId?: string): Promise<void> {
    await this.actions.flushChatOutbox(chatId);
  }
  async flushSocialOutbox(): Promise<void> {
    await this.actions.flushSocialOutbox();
  }
  async hasPendingOfflineRecoveryWork(): Promise<boolean> {
    return (await this.actions.countPendingRealmRecoveryWork()) > 0;
  }
  async markChatRead(chatId: string) { await this.actions.markChatRead(chatId); }
  async loadContacts() {
    await this.actions.loadContacts();
  }
  loadSocialSnapshot() { return this.actions.loadSocialSnapshot(); }
  searchUser(identifierInput: string) { return this.actions.searchUser(identifierInput); }

  isFriend(userId: string): boolean { return this.authCallbacks?.isFriend(userId) ?? false; }

  async removeFriend(userId: string) { await this.actions.removeFriend(userId); }
  requestOrAcceptFriend(userId: string) { return this.actions.requestOrAcceptFriend(userId); }
  rejectOrRemoveFriend(userId: string) { return this.actions.rejectOrRemoveFriend(userId); }
  blockUser(contact: Record<string, unknown>) { return this.actions.blockUser(contact); }
  unblockUser(contact: Record<string, unknown>) { return this.actions.unblockUser(contact); }
  loadUserProfile(id: string) { return this.actions.loadUserProfile(id); }
  loadWorlds(status?: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED') { return this.actions.loadWorlds(status); }
  loadWorldDetailById(worldId: string) { return this.actions.loadWorldDetailById(worldId); }
  loadWorldSemanticBundle(worldId: string) { return this.actions.loadWorldSemanticBundle(worldId); }
  loadMainWorld() { return this.actions.loadMainWorld(); }
  loadWorldLevelAudits(worldId: string, limit = 20): Promise<WorldLevelAuditEventDto[]> { return this.actions.loadWorldLevelAudits(worldId, limit); }
  loadWorldAgents(worldId: string): Promise<Array<Record<string, unknown>>> { return this.actions.loadWorldAgents(worldId); }
  loadWorldDetailWithAgents(worldId: string): Promise<Record<string, unknown> | null> { return this.actions.loadWorldDetailWithAgents(worldId); }
  loadWorldEvents(worldId: string): Promise<Array<Record<string, unknown>>> { return this.actions.loadWorldEvents(worldId); }
  loadSceneQuota(): Promise<SceneQuotaDto> { return this.actions.loadSceneQuota(); }
  startWorldTransit(input: {
    agentId: string;
    fromWorldId?: string;
    toWorldId: string;
    transitType: TransitType;
    reason?: string;
    carriedState?: Record<string, unknown>;
  }): Promise<TransitDetailDto> {
    return this.actions.startWorldTransit(input);
  }
  listWorldTransits(query?: {
    agentId?: string;
    status?: TransitStatus;
    transitType?: TransitType;
  }): Promise<TransitDetailDto[]> {
    return this.actions.listWorldTransits(query);
  }
  getActiveWorldTransit(agentId: string): Promise<TransitDetailDto | null> {
    return this.actions.getActiveWorldTransit(agentId);
  }
  startTransitSession(transitId: string): Promise<TransitSessionDataDto> {
    return this.actions.startTransitSession(transitId);
  }
  addTransitCheckpoint(
    transitId: string,
    input: {
      name: string;
      status: TransitCheckpointStatus;
      data?: Record<string, unknown>;
    },
  ): Promise<TransitDetailDto> {
    return this.actions.addTransitCheckpoint(transitId, input);
  }
  completeWorldTransit(transitId: string): Promise<TransitDetailDto> {
    return this.actions.completeWorldTransit(transitId);
  }
  abandonWorldTransit(transitId: string): Promise<TransitDetailDto> {
    return this.actions.abandonWorldTransit(transitId);
  }
  loadPostFeed(payload: {
    visibility?: 'PUBLIC' | 'FRIENDS' | 'PRIVATE';
    worldId?: string;
    authorId?: string;
    limit?: number;
    cursor?: string;
  }) { return this.actions.loadPostFeed(payload); }
  createPost(payload: CreatePostDto) { return this.actions.createPost(payload); }
  createImageDirectUpload() { return this.actions.createImageDirectUpload(); }
  createVideoDirectUpload() { return this.actions.createVideoDirectUpload(); }
  finalizeMediaAsset(assetId: string, payload: FinalizeMediaAssetDto): Promise<MediaAssetDetailDto> {
    return this.actions.finalizeMediaAsset(assetId, payload);
  }
  deletePost(postId: string) { return this.actions.deletePost(postId); }
  updatePostVisibility(postId: string, visibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE') {
    return this.actions.updatePostVisibility(postId, visibility);
  }
  likePost(postId: string): Promise<void> { return this.actions.likePost(postId); }
  unlikePost(postId: string): Promise<void> { return this.actions.unlikePost(postId); }
  createReport(payload: CreateReportDto) { return this.actions.createReport(payload); }
  loadCurrencyBalances() { return this.actions.loadCurrencyBalances(); }
  loadSparkTransactionHistory(limit = 30, cursor?: string) {
    return this.actions.loadSparkTransactionHistory(limit, cursor);
  }
  loadGemTransactionHistory(limit = 30, cursor?: string) {
    return this.actions.loadGemTransactionHistory(limit, cursor);
  }
  loadSubscriptionStatus() { return this.actions.loadSubscriptionStatus(); }
  loadSparkPackages(): Promise<SparkPackageDto[]> { return this.actions.loadSparkPackages(); }
  createSparkCheckout(payload: CreateSparkCheckoutDto): Promise<SparkCheckoutSessionDto> { return this.actions.createSparkCheckout(payload); }
  loadWithdrawalEligibility() { return this.actions.loadWithdrawalEligibility(); }
  loadWithdrawalHistory(limit = 20, cursor?: string) {
    return this.actions.loadWithdrawalHistory(limit, cursor);
  }
  createWithdrawal(payload: CreateWithdrawalDto) { return this.actions.createWithdrawal(payload); }
  loadGiftCatalog() { return this.actions.loadGiftCatalog(); }
  loadGiftTransaction(id: string) { return this.actions.loadGiftTransaction(id); }
  loadReceivedGifts(limit = 20, cursor?: string): Promise<ReceivedGiftsResponseDto> {
    return this.actions.loadReceivedGifts(limit, cursor);
  }
  sendGift(payload: SendGiftDto) { return this.actions.sendGift(payload); }
  acceptGift(giftTransactionId: string) { return this.actions.acceptGift(giftTransactionId); }
  rejectGift(giftTransactionId: string, payload: RejectGiftDto) {
    return this.actions.rejectGift(giftTransactionId, payload);
  }
  createGiftReview(payload: CreateReviewDto) { return this.actions.createGiftReview(payload); }
  loadNotificationUnreadCount(): Promise<UnreadNotificationCountDto> { return this.actions.loadNotificationUnreadCount(); }
  loadNotifications(options?: {
    type?: DataSyncNotificationType;
    unreadOnly?: boolean;
    limit?: number;
    cursor?: string;
  }): Promise<NotificationListResultDto> { return this.actions.loadNotifications(options); }
  markNotificationsRead(payload: { ids?: string[]; markAllBefore?: string }) {
    return this.actions.markNotificationsRead(payload);
  }
  markNotificationRead(notificationId: string) { return this.actions.markNotificationRead(notificationId); }
  loadMySettings(): Promise<UserSettingsDto> { return this.actions.loadMySettings(); }
  updateMySettings(payload: UpdateUserSettingsDto): Promise<UserSettingsDto> { return this.actions.updateMySettings(payload); }
  loadMyNotificationSettings(): Promise<UserNotificationSettingsDto> { return this.actions.loadMyNotificationSettings(); }
  updateMyNotificationSettings(payload: UpdateUserNotificationSettingsDto): Promise<UserNotificationSettingsDto> { return this.actions.updateMyNotificationSettings(payload); }
  loadMyCreatorEligibility(): Promise<CreatorEligibility> { return this.actions.loadMyCreatorEligibility(); }
  updatePassword(payload: UpdatePasswordRequestDto): Promise<{ success: boolean }> { return this.actions.updatePassword(payload); }
  prepareTwoFactor(): Promise<MeTwoFactorPrepareOutput> { return this.actions.prepareTwoFactor(); }
  enableTwoFactor(payload: MeTwoFactorVerifyInput): Promise<{ enabled: boolean }> { return this.actions.enableTwoFactor(payload); }
  disableTwoFactor(payload: MeTwoFactorVerifyInput): Promise<{ enabled: boolean }> { return this.actions.disableTwoFactor(payload); }
  linkOauth(provider: OAuthProvider, accessToken: string): Promise<{ linked: boolean }> { return this.actions.linkOauth(provider, accessToken); }
  unlinkOauth(provider: OAuthProvider): Promise<{ linked: boolean }> { return this.actions.unlinkOauth(provider); }
  requestDataExport(payload: RequestDataExportInput): Promise<RequestDataExportOutput> { return this.actions.requestDataExport(payload); }
  requestAccountDeletion(payload: RequestAccountDeletionInput): Promise<RequestAccountDeletionOutput> { return this.actions.requestAccountDeletion(payload); }
  loadMyAgents() { return this.actions.loadMyAgents(); }
  createAgent(input: CreateMasterAgentInput) { return this.actions.createAgent(input); }
  loadFriendRequests() { return this.actions.loadFriendRequests(); }
  loadExploreFeed(tag: string | null = null, limit = 20) { return this.actions.loadExploreFeed(tag, Math.min(limit, 100)); }
  loadMoreExploreFeed(limit = 20, cursor?: string, tag?: string | null) {
    return this.actions.loadMoreExploreFeed(Math.min(limit, 100), cursor, tag);
  }
  loadAgentDetails(agentIdentifier: string) { return this.actions.loadAgentDetails(agentIdentifier); }
  recallAgentMemoryForEntity(input: {
    agentId: string;
    entityId: string;
    query?: AgentMemoryRecallQuery;
  }) {
    return this.actions.recallAgentMemoryForEntity(input);
  }
  listAgentCoreMemories(input: {
    agentId: string;
    query?: AgentMemorySliceQuery;
  }) {
    return this.actions.listAgentCoreMemories(input);
  }
  listAgentE2EMemories(input: {
    agentId: string;
    entityId: string;
    query?: AgentMemorySliceQuery;
  }) {
    return this.actions.listAgentE2EMemories(input);
  }
  loadAgentMemoryStats(agentId: string) { return this.actions.loadAgentMemoryStats(agentId); }
  resolveChatRoute(data: DesktopChatRouteRequestDto): Promise<DesktopChatRouteResultDto> { return this.actions.resolveChatRoute(data); }
  login(identifier: string, password: string, debug?: PasswordAuthDebug) {
    return this.actions.login(identifier, password, debug);
  }
  register(email: string, password: string, debug?: PasswordAuthDebug) {
    return this.actions.register(email, password, debug);
  }
  async logout() { await this.actions.logout(); this.clearProactiveRefreshTimer(); }
  startPolling(key: string, callback: () => void, intervalMs: number) { this.polling.start(key, callback, intervalMs); }
  stopPolling(key: string) { this.polling.stop(key); }
  stopAllPolling() { this.polling.stopAll(); }

  scheduleProactiveRefresh(accessToken: string) {
    this.clearProactiveRefreshTimer();
    if (!this.refreshToken) return;
    const expiry = Realm.decodeTokenExpiry(accessToken);
    if (!expiry) return;
    const PROACTIVE_REFRESH_BUFFER_MS = 60_000;
    const delayMs = Math.max(expiry.expiresInMs - PROACTIVE_REFRESH_BUFFER_MS, 1000);
    this.proactiveRefreshTimer = setTimeout(() => {
      this.proactiveRefreshTimer = null;
      this.doProactiveRefresh();
    }, delayMs);
    emitRuntimeLog({
      level: 'info',
      area: 'datasync',
      message: 'action:proactive-refresh:scheduled',
      details: {
        expiresAt: new Date(expiry.expiresAt).toISOString(),
        refreshInMs: delayMs,
      },
    });
  }

  private async doProactiveRefresh() {
    if (!this.refreshToken || !this.realmBaseUrl) {
      return;
    }
    try {
      const refreshResult = await refreshDataSyncAccessToken({
        realmBaseUrl: this.realmBaseUrl,
        refreshToken: this.refreshToken,
        fetchImpl: this.fetchImpl,
      });
      this.accessToken = refreshResult.accessToken;
      if (refreshResult.refreshToken) {
        this.refreshToken = refreshResult.refreshToken;
      }
      this.persistApiToHotState();
      this.authCallbacks?.setAuth(
        this.authCallbacks?.getCurrentUser() ?? null,
        refreshResult.accessToken,
        refreshResult.refreshToken,
      );
      this.scheduleProactiveRefresh(refreshResult.accessToken);
      emitRuntimeLog({
        level: 'info',
        area: 'datasync',
        message: 'action:proactive-refresh:success',
      });
    } catch (error) {
      emitRuntimeLog({
        level: 'warn',
        area: 'datasync',
        message: 'action:proactive-refresh:failed',
        details: {
          error: error instanceof Error ? error.message : String(error || ''),
        },
      });
      this.authCallbacks?.clearAuth();
      this.stopAllPolling();
      this.clearProactiveRefreshTimer();
    }
  }

  clearProactiveRefreshTimer() {
    if (!this.proactiveRefreshTimer) return;
    clearTimeout(this.proactiveRefreshTimer);
    this.proactiveRefreshTimer = null;
  }

  destroy() {
    this.stopAllPolling();
    this.clearProactiveRefreshTimer();
    this.realmBaseUrl = '';
    this.accessToken = '';
    this.refreshToken = '';
    this.fetchImpl = null;
  }
}

export const dataSync = new DataSync();
