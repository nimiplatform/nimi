import { store } from '@runtime/state';
import { withOpenApiContextLock } from '@runtime/context/openapi-context';
import type { AuthState } from '@runtime/state';
import type { DesktopChatRouteRequestDto, DesktopChatRouteResultDto } from '@runtime/chat';
import type { Realm } from '@nimiplatform/sdk/realm';
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
import { isFriendInContacts } from './flows/social-flow';
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
    fetchImpl: typeof snapshot.fetchImpl === 'function' ? snapshot.fetchImpl : null,
  };
}

function writeDataSyncHotState(state: DataSyncHotState) {
  const globalRef = globalThis as DataSyncGlobalRef;
  globalRef[DATA_SYNC_HOT_STATE_KEY] = {
    realmBaseUrl: state.realmBaseUrl,
    accessToken: state.accessToken,
    fetchImpl: state.fetchImpl,
  };
}

export class DataSync {
  private realmBaseUrl = '';
  private accessToken = '';
  private fetchImpl: FetchImpl | null = null;
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
    clearAuth: () => store.clearAuth(),
    stopAllPolling: () => this.stopAllPolling(),
    isFriend: (userId) => this.isFriend(userId),
  });

  constructor() {
    this.hydrateApiFromHotState();
    this.setupStoreListeners();
  }

  private hydrateApiFromHotState(): boolean {
    const hotState = readDataSyncHotState();
    if (!hotState) {
      return false;
    }
    this.realmBaseUrl = hotState.realmBaseUrl;
    this.accessToken = hotState.accessToken;
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
      fetchImpl: this.fetchImpl,
    });
  }

  initApi(config?: DataSyncApiConfig) {
    this.realmBaseUrl = normalizeRealmBaseUrl(config?.realmBaseUrl);
    this.accessToken = String(config?.accessToken || '');
    this.fetchImpl = typeof config?.fetchImpl === 'function' ? config.fetchImpl : null;
    this.persistApiToHotState();
    return this;
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
          fetchImpl: this.fetchImpl,
        },
        task,
      );
      const normalized = tryParseJsonLike(result);
      return normalized === undefined ? {} : normalized;
    } catch (error) {
      throw normalizeApiError(error, fallbackMessage);
    }
  }

  setupStoreListeners() {
    store.on('authChange', (auth: AuthState) => {
      if (auth.isAuthenticated) this.setToken(auth.token);
      else {
        this.setToken('');
        this.stopAllPolling();
      }
    });
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
  loadChats(limit = 20) { return this.actions.loadChats(limit); }
  loadMoreChats() { return this.actions.loadMoreChats(); }
  startChat(targetAccountId: string, initialMessage: string | null = null) {
    return this.actions.startChat(targetAccountId, initialMessage);
  }
  loadMessages(chatId: string, limit = 50) {
    return this.actions.loadMessages(chatId, limit, (id) => this.markChatRead(id));
  }
  loadMoreMessages(chatId: string) { return this.actions.loadMoreMessages(chatId); }
  sendMessage(chatId: string, content: string, options: Partial<SendMessageInputDto> = {}) {
    return this.actions.sendMessage(chatId, content, options);
  }
  syncChatEvents(chatId: string, afterSeq: number, limit = 200): Promise<ChatSyncResultDto> {
    return this.actions.syncChatEvents(chatId, afterSeq, limit);
  }
  flushChatOutbox(chatId?: string): Promise<void> {
    return this.actions.flushChatOutbox(chatId);
  }
  async markChatRead(chatId: string) { await this.actions.markChatRead(chatId); }
  async loadContacts() { await this.actions.loadContacts(); }
  loadSocialSnapshot() { return this.actions.loadSocialSnapshot(); }
  searchUser(identifierInput: string) { return this.actions.searchUser(identifierInput); }

  isFriend(userId: string): boolean {
    const contacts = store.getState('contacts') as { friends?: Array<Record<string, unknown>> } | undefined;
    return isFriendInContacts(contacts, userId);
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
  loadExploreFeed(tag: string | null = null, limit = 20) { return this.actions.loadExploreFeed(tag, limit); }
  loadMoreExploreFeed(limit = 20) { return this.actions.loadMoreExploreFeed(limit); }
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
  async logout() { await this.actions.logout(); }
  startPolling(key: string, callback: () => void, intervalMs: number) { this.polling.start(key, callback, intervalMs); }
  stopPolling(key: string) { this.polling.stop(key); }
  stopAllPolling() { this.polling.stopAll(); }

  destroy() {
    this.stopAllPolling();
    this.realmBaseUrl = '';
    this.accessToken = '';
    this.fetchImpl = null;
  }
}

export const dataSync = new DataSync();
