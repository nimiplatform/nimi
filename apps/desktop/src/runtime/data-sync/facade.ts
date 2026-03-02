import { withOpenApiContextLock } from '@runtime/context/openapi-context';
import type { DesktopChatRouteRequestDto, DesktopChatRouteResultDto } from '@runtime/chat';
import { Realm } from '@nimiplatform/sdk/realm';
import type { RealmTokenRefreshResult } from '@nimiplatform/sdk/realm';
import type { CreatePostDto } from '@nimiplatform/sdk/realm';
import type { CreateReviewDto } from '@nimiplatform/sdk/realm';
import type { CreateWithdrawalDto } from '@nimiplatform/sdk/realm';
import type { RejectGiftDto } from '@nimiplatform/sdk/realm';
import type { SendMessageInputDto } from '@nimiplatform/sdk/realm';
import type { SendGiftDto } from '@nimiplatform/sdk/realm';
import type { ChatSyncResultDto } from '@nimiplatform/sdk/realm';
import type { UpdateUserNotificationSettingsDto } from '@nimiplatform/sdk/realm';
import type { UpdateUserSettingsDto } from '@nimiplatform/sdk/realm';
import type { UserNotificationSettingsDto } from '@nimiplatform/sdk/realm';
import type { UserSettingsDto } from '@nimiplatform/sdk/realm';
import type { WorldLevelAuditEventDto } from '@nimiplatform/sdk/realm';
import { emitRuntimeLog } from '@runtime/telemetry/logger';
import type { DataSyncApiConfig, FetchImpl } from './api-core';
import { normalizeRealmBaseUrl, normalizeApiError, tryParseJsonLike } from './api-core';
import type { PasswordAuthDebug } from './auth';
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

const DATA_SYNC_HOT_STATE_KEY = '__NIMI_DATA_SYNC_API_CONFIG__' as const;
type DataSyncHotState = {
  realmBaseUrl: string;
  accessToken: string;
  refreshToken: string;
  fetchImpl: FetchImpl | null;
};
type DataSyncGlobalRef = typeof globalThis & {
  [DATA_SYNC_HOT_STATE_KEY]?: Partial<DataSyncHotState>;
};

function readDataSyncHotState(): DataSyncHotState | null {
  const snapshot = (globalThis as DataSyncGlobalRef)[DATA_SYNC_HOT_STATE_KEY];
  if (!snapshot || typeof snapshot !== 'object') {
    return null;
  }
  const realmBaseUrl = normalizeRealmBaseUrl(snapshot.realmBaseUrl);
  if (!realmBaseUrl) {
    return null;
  }
  return {
    realmBaseUrl,
    accessToken: String(snapshot.accessToken || ''),
    refreshToken: String(snapshot.refreshToken || ''),
    fetchImpl: typeof snapshot.fetchImpl === 'function' ? snapshot.fetchImpl : null,
  };
}

function writeDataSyncHotState(state: DataSyncHotState) {
  const globalRef = globalThis as DataSyncGlobalRef;
  globalRef[DATA_SYNC_HOT_STATE_KEY] = {
    realmBaseUrl: state.realmBaseUrl,
    accessToken: state.accessToken,
    refreshToken: state.refreshToken,
    fetchImpl: state.fetchImpl,
  };
}

export type DataSyncAuthCallbacks = {
  setAuth: (user: Record<string, unknown> | null, token: string, refreshToken?: string) => void;
  clearAuth: () => void;
  getCurrentUser: () => Record<string, unknown> | null;
  isFriend: (userId: string) => boolean;
};

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
  });

  constructor() {
    this.hydrateApiFromHotState();
  }

  setAuthCallbacks(callbacks: DataSyncAuthCallbacks) {
    this.authCallbacks = callbacks;
  }

  private hydrateApiFromHotState(): boolean {
    const hotState = readDataSyncHotState();
    if (!hotState) {
      return false;
    }
    this.realmBaseUrl = hotState.realmBaseUrl;
    this.accessToken = hotState.accessToken;
    this.refreshToken = hotState.refreshToken;
    this.fetchImpl = hotState.fetchImpl;
    return true;
  }

  private persistApiToHotState() {
    if (!this.realmBaseUrl) {
      return;
    }
    writeDataSyncHotState({
      realmBaseUrl: this.realmBaseUrl,
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      fetchImpl: this.fetchImpl,
    });
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
    if (!this.realmBaseUrl) {
      this.hydrateApiFromHotState();
    }
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
            emitRuntimeLog({
              level: 'warn',
              area: 'datasync',
              message: 'action:token-refresh:failed',
              details: {
                error: error instanceof Error ? error.message : String(error || ''),
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
      return normalized === undefined ? {} : normalized;
    } catch (error) {
      throw normalizeApiError(error, fallbackMessage);
    }
  }

  private emitDataSyncError(action: string, error: unknown, details: Record<string, unknown> = {}) {
    emitRuntimeLog({
      level: 'error',
      area: 'datasync',
      message: `action:${action}:failed`,
      details: {
        ...details,
        error: error instanceof Error ? error.message : String(error || ''),
      },
    });
  }

  async loadInitialData() {
    await this.loadCurrentUser();
    await this.loadChats();
    await this.loadContacts();
  }

  loadCurrentUser() { return this.actions.loadCurrentUser(); }
  updateUserProfile(data: Record<string, unknown>) { return this.actions.updateUserProfile(data); }
  loadChats(limit = 20) { return this.actions.loadChats(Math.min(limit, 100)); }
  loadMoreChats(cursor?: string) { return this.actions.loadMoreChats(cursor); }
  startChat(targetAccountId: string, initialMessage: string | null = null) {
    return this.actions.startChat(targetAccountId, initialMessage);
  }
  loadMessages(chatId: string, limit = 50) {
    return this.actions.loadMessages(chatId, Math.min(limit, 100), (id) => this.markChatRead(id));
  }
  loadMoreMessages(chatId: string, cursor?: string) { return this.actions.loadMoreMessages(chatId, cursor); }
  sendMessage(chatId: string, content: string, options: Partial<SendMessageInputDto> = {}) {
    return this.actions.sendMessage(chatId, content, options);
  }
  syncChatEvents(chatId: string, afterSeq: number, limit = 100): Promise<ChatSyncResultDto> {
    return this.actions.syncChatEvents(chatId, afterSeq, Math.min(limit, 100));
  }
  async flushChatOutbox(chatId?: string): Promise<void> {
    await this.actions.flushChatOutbox(chatId);
  }
  async markChatRead(chatId: string) { await this.actions.markChatRead(chatId); }
  async loadContacts() { await this.actions.loadContacts(); }
  loadSocialSnapshot() { return this.actions.loadSocialSnapshot(); }
  searchUser(identifierInput: string) { return this.actions.searchUser(identifierInput); }

  isFriend(userId: string): boolean {
    return this.authCallbacks?.isFriend(userId) ?? false;
  }

  async removeFriend(userId: string) { await this.actions.removeFriend(userId); }
  requestOrAcceptFriend(userId: string) { return this.actions.requestOrAcceptFriend(userId); }
  rejectOrRemoveFriend(userId: string) { return this.actions.rejectOrRemoveFriend(userId); }
  blockUser(contact: Record<string, unknown>) { return this.actions.blockUser(contact); }
  unblockUser(contact: Record<string, unknown>) { return this.actions.unblockUser(contact); }
  loadUserProfile(id: string) { return this.actions.loadUserProfile(id); }
  loadWorlds(status?: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED') {
    return this.actions.loadWorlds(status);
  }
  loadWorldDetailById(worldId: string) { return this.actions.loadWorldDetailById(worldId); }
  loadWorldSemanticBundle(worldId: string) { return this.actions.loadWorldSemanticBundle(worldId); }
  loadMainWorld() { return this.actions.loadMainWorld(); }
  loadWorldLevelAudits(worldId: string, limit = 20): Promise<WorldLevelAuditEventDto[]> {
    return this.actions.loadWorldLevelAudits(worldId, limit);
  }
  loadWorldAgents(worldId: string): Promise<Array<Record<string, unknown>>> {
    return this.actions.loadWorldAgents(worldId);
  }
  loadWorldEvents(worldId: string): Promise<Array<Record<string, unknown>>> {
    return this.actions.loadWorldEvents(worldId);
  }
  loadSceneQuota(): Promise<SceneQuotaDto> {
    return this.actions.loadSceneQuota();
  }
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
    scope?: 'all' | 'friends' | 'forYou';
    limit?: number;
    cursor?: string;
  }) { return this.actions.loadPostFeed(payload); }
  createPost(payload: CreatePostDto) { return this.actions.createPost(payload); }
  createImageDirectUpload() { return this.actions.createImageDirectUpload(); }
  createVideoDirectUpload() { return this.actions.createVideoDirectUpload(); }
  deletePost(postId: string) { return this.actions.deletePost(postId); }
  loadCurrencyBalances() { return this.actions.loadCurrencyBalances(); }
  loadSparkTransactionHistory(limit = 30, cursor?: string) {
    return this.actions.loadSparkTransactionHistory(limit, cursor);
  }
  loadGemTransactionHistory(limit = 30, cursor?: string) {
    return this.actions.loadGemTransactionHistory(limit, cursor);
  }
  loadSubscriptionStatus() { return this.actions.loadSubscriptionStatus(); }
  loadWithdrawalEligibility() { return this.actions.loadWithdrawalEligibility(); }
  loadWithdrawalHistory(limit = 20, cursor?: string) {
    return this.actions.loadWithdrawalHistory(limit, cursor);
  }
  createWithdrawal(payload: CreateWithdrawalDto) { return this.actions.createWithdrawal(payload); }
  loadGiftCatalog() { return this.actions.loadGiftCatalog(); }
  sendGift(payload: SendGiftDto) { return this.actions.sendGift(payload); }
  claimGift(giftTransactionId: string) { return this.actions.claimGift(giftTransactionId); }
  rejectGift(giftTransactionId: string, payload: RejectGiftDto) {
    return this.actions.rejectGift(giftTransactionId, payload);
  }
  createGiftReview(payload: CreateReviewDto) { return this.actions.createGiftReview(payload); }
  loadNotificationUnreadCount() { return this.actions.loadNotificationUnreadCount(); }
  loadNotifications(options?: {
    type?: 'SYSTEM' | 'INTERACTION' | 'POST_LIKE' | 'POST_COMMENT' | 'MENTION';
    unreadOnly?: boolean;
    limit?: number;
    cursor?: string;
  }) { return this.actions.loadNotifications(options); }
  markNotificationsRead(payload: { ids?: string[]; markAllBefore?: string }) {
    return this.actions.markNotificationsRead(payload);
  }
  markNotificationRead(notificationId: string) { return this.actions.markNotificationRead(notificationId); }
  loadMySettings(): Promise<UserSettingsDto> { return this.actions.loadMySettings(); }
  updateMySettings(payload: UpdateUserSettingsDto): Promise<UserSettingsDto> {
    return this.actions.updateMySettings(payload);
  }
  loadMyNotificationSettings(): Promise<UserNotificationSettingsDto> {
    return this.actions.loadMyNotificationSettings();
  }
  updateMyNotificationSettings(
    payload: UpdateUserNotificationSettingsDto,
  ): Promise<UserNotificationSettingsDto> {
    return this.actions.updateMyNotificationSettings(payload);
  }
  loadMyCreatorEligibility(): Promise<CreatorEligibility> {
    return this.actions.loadMyCreatorEligibility();
  }
  loadMyAgents() { return this.actions.loadMyAgents(); }
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
  resolveChatRoute(data: DesktopChatRouteRequestDto): Promise<DesktopChatRouteResultDto> {
    return this.actions.resolveChatRoute(data);
  }
  login(identifier: string, password: string, debug?: PasswordAuthDebug) {
    return this.actions.login(identifier, password, debug);
  }
  register(email: string, password: string, debug?: PasswordAuthDebug) {
    return this.actions.register(email, password, debug);
  }
  async logout() {
    await this.actions.logout();
    this.clearProactiveRefreshTimer();
  }
  startPolling(key: string, callback: () => void, intervalMs: number) { this.polling.start(key, callback, intervalMs); }
  stopPolling(key: string) { this.polling.stop(key); }
  stopAllPolling() { this.polling.stopAll(); }

  scheduleProactiveRefresh(accessToken: string) {
    this.clearProactiveRefreshTimer();
    if (!this.refreshToken) {
      return;
    }
    const expiry = Realm.decodeTokenExpiry(accessToken);
    if (!expiry) {
      return;
    }
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
      const fetchFn = this.fetchImpl || globalThis.fetch.bind(globalThis);
      const response = await fetchFn(`${this.realmBaseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });
      if (!response.ok) {
        throw new Error(`refresh failed: ${response.status}`);
      }
      const data = await response.json() as Record<string, unknown>;
      const tokens = (data.tokens || data) as Record<string, unknown>;
      const newAccessToken = String(tokens.accessToken || '').trim();
      if (!newAccessToken) {
        throw new Error('refresh response missing accessToken');
      }
      const newRefreshToken = String(tokens.refreshToken || '').trim() || undefined;
      this.accessToken = newAccessToken;
      if (newRefreshToken) {
        this.refreshToken = newRefreshToken;
      }
      this.persistApiToHotState();
      this.authCallbacks?.setAuth(
        this.authCallbacks?.getCurrentUser() ?? null,
        newAccessToken,
        newRefreshToken,
      );
      this.scheduleProactiveRefresh(newAccessToken);
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
    if (this.proactiveRefreshTimer) {
      clearTimeout(this.proactiveRefreshTimer);
      this.proactiveRefreshTimer = null;
    }
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
