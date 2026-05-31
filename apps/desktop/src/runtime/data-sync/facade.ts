import { withRealmContextLock } from '@nimiplatform/sdk';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type { RealmTokenRefreshResult } from '@nimiplatform/sdk/realm';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { Realm, normalizeRealmBaseUrl } from '@nimiplatform/sdk/realm';
import { emitRuntimeLog } from '@runtime/telemetry/logger';
import { extractRuntimeErrorFields } from '@runtime/telemetry/error-fields';
import {
  getOfflineCoordinator,
  isRealmOfflineError,
} from '@runtime/offline';
import type { DataSyncApiConfig, FetchImpl } from './api-core';
import type {
  WorldHistoryPayload,
  WorldLorebookListPayload,
  WorldBindingListPayload,
  WorldSceneListPayload,
} from './flows/world-flow';
import { normalizeApiError, tryParseJsonLike } from './api-core';
import type { PasswordAuthDebug } from './auth';
import { readDataSyncHotState, writeDataSyncHotState } from './facade-hot-state';
import { DataSyncPollingManager } from './polling-manager';
import { isBlockedUser } from './blocked-content';
import type {
  TransitDetailDto,
  TransitStatus,
  TransitType,
} from './flows/transit-flow';
import { createDataSyncActions } from './facade-actions';
import type { CreateMasterAgentInput } from './flows/social-flow';
import type { PostFeedScope } from './flows/post-attachment-flow';
import {
  COURIER_POLLING_KEY,
  COURIER_POLL_INTERVAL_MS,
  runLocalAgentTerminationCourierPass,
  type LocalAgentTerminationCourierPassResult,
} from './local-agent-termination-courier';
import {
  COURIER_POLLING_KEY as PROVISION_COURIER_POLLING_KEY,
  COURIER_POLL_INTERVAL_MS as PROVISION_COURIER_POLL_INTERVAL_MS,
  runLocalAgentProvisionCourierPass,
  type LocalAgentProvisionCourierPassResult,
} from './local-agent-provision-courier';

type CreatePostDto = RealmModel<'CreatePostDto'>;
type CreateReportDto = RealmModel<'CreateReportDto'>;
type GroupMessageViewDto = RealmModel<'GroupMessageViewDto'>;
type GroupParticipantDto = RealmModel<'GroupParticipantDto'>;
type WorldLevelAuditEventDto = RealmModel<'WorldLevelAuditEventDto'>;
type WorldAgentSummaryDto = RealmModel<'WorldAgentSummaryDto'>;
type WorldDetailWithAgentsDto = RealmModel<'WorldDetailWithAgentsDto'>;

export type DataSyncAuthCallbacks = {
  setAuth: (user: Record<string, unknown> | null | undefined, token: string, refreshToken?: string) => void;
  clearAuth: () => void | Promise<void>;
  getCurrentUser: () => Record<string, unknown> | null;
  isFriend: (userId: string) => boolean;
};

export class DataSync {
  private realmBaseUrl = '';
  private accessToken = '';
  private accessTokenProvider: (() => string | Promise<string>) | null = null;
  private refreshToken = '';
  private fetchImpl: FetchImpl | null = null;
  private proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private authCallbacks: DataSyncAuthCallbacks | null = null;
  private readonly polling = new DataSyncPollingManager();
  private readonly callApiTask = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) =>
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
    this.accessToken = '';
    this.refreshToken = '';
    this.accessTokenProvider = null;
    this.fetchImpl = hotState.fetchImpl;
    return true;
  }

  private persistApiToHotState() {
    if (!this.realmBaseUrl) return;
    writeDataSyncHotState({ realmBaseUrl: this.realmBaseUrl, accessToken: '', refreshToken: '', fetchImpl: this.fetchImpl });
  }

  initApi(config?: DataSyncApiConfig) {
    const nextRealmBaseUrl = normalizeRealmBaseUrl(config?.realmBaseUrl);
    const nextFetchImpl = typeof config?.fetchImpl === 'function' ? config.fetchImpl : null;
    const nextAccessTokenProvider = typeof config?.accessTokenProvider === 'function' ? config.accessTokenProvider : null;
    this.realmBaseUrl = nextRealmBaseUrl;
    this.accessTokenProvider = nextAccessTokenProvider;
    this.accessToken = this.accessTokenProvider ? '' : String(config?.accessToken || '');
    this.refreshToken = this.accessTokenProvider ? '' : String(config?.refreshToken || '');
    this.fetchImpl = nextFetchImpl;
    this.persistApiToHotState();
    return this;
  }

  setRefreshToken(token: string | null | undefined) {
    if (this.accessTokenProvider) {
      this.refreshToken = '';
      this.persistApiToHotState();
      return;
    }
    this.refreshToken = String(token || '');
    this.persistApiToHotState();
  }

  setToken(token: string | null | undefined) {
    if (this.accessTokenProvider) {
      this.accessToken = '';
      this.persistApiToHotState();
      return;
    }
    this.accessToken = String(token || '');
    this.persistApiToHotState();
  }

  isApiConfigured(): boolean {
    if (!this.realmBaseUrl) {
      this.hydrateApiFromHotState();
    }
    return Boolean(this.realmBaseUrl);
  }

  assertApiConfigured() {
    if (!this.isApiConfigured()) throw new Error('API not initialized');
  }

  async callApi<T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string): Promise<T> {
    this.assertApiConfigured();
    try {
      const accessToken = this.accessTokenProvider
        ? String(await this.accessTokenProvider())
        : this.accessToken;
      const result = await withRealmContextLock({
        realmBaseUrl: this.realmBaseUrl,
        accessToken,
        refreshToken: this.accessTokenProvider ? undefined : this.refreshToken,
        fetchImpl: this.fetchImpl,
        onTokenRefreshed: (refreshResult) => this.handleTokenRefreshed(refreshResult),
        onRefreshFailed: (refreshError) => this.handleRefreshFailed(refreshError),
      }, task);
      const normalized = tryParseJsonLike(result);
      getOfflineCoordinator().markRealmRestReachable(true);
      return normalized;
    } catch (error) {
      const normalized = normalizeApiError(error, fallbackMessage);
      if (isRealmOfflineError(normalized)) {
        getOfflineCoordinator().markRealmRestReachable(false);
      }
      await this.handleAuthRequired(normalized);
      throw normalized;
    }
  }

  private handleTokenRefreshed(refreshResult: RealmTokenRefreshResult): void {
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
  }

  private handleRefreshFailed(error: unknown): void {
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
    this.accessToken = '';
    this.refreshToken = '';
    this.persistApiToHotState();
    this.authCallbacks?.clearAuth();
    this.stopAllPolling();
    this.clearProactiveRefreshTimer();
  }

  private isReauthenticationRequired(error: unknown): boolean {
    const errorFields = extractRuntimeErrorFields(error);
    const code = String(errorFields.code || '').trim().toUpperCase();
    const reasonCode = String(errorFields.reasonCode || '').trim().toUpperCase();
    return (
      code === ReasonCode.AUTH_TOKEN_INVALID
      || reasonCode === 'AUTH_REQUIRED'
      || reasonCode === ReasonCode.AUTH_TOKEN_INVALID
      || reasonCode === ReasonCode.AUTH_TOKEN_EXPIRED
      || reasonCode === ReasonCode.APP_TOKEN_EXPIRED
      || reasonCode === ReasonCode.SESSION_EXPIRED
    );
  }

  private async handleAuthRequired(error: unknown): Promise<void> {
    const errorFields = extractRuntimeErrorFields(error);
    const requiresReauthentication = this.isReauthenticationRequired(error);
    if (!requiresReauthentication) {
      return;
    }
    emitRuntimeLog({
      level: 'warn',
      area: 'datasync',
      message: 'action:auth-required:session-cleared',
      traceId: errorFields.traceId,
      details: {
        reasonCode: errorFields.reasonCode,
        actionHint: errorFields.actionHint,
        retryable: false,
        traceId: errorFields.traceId,
      },
    });
    this.accessToken = '';
    this.refreshToken = '';
    this.persistApiToHotState();
    await this.authCallbacks?.clearAuth();
    this.stopAllPolling();
    this.clearProactiveRefreshTimer();
  }

  private emitDataSyncError(action: string, error: unknown, details: Record<string, unknown> = {}) {
    const errorFields = extractRuntimeErrorFields(error);
    if (errorFields.reasonCode === ReasonCode.REALM_UNAVAILABLE || isRealmOfflineError(error)) {
      getOfflineCoordinator().markRealmRestReachable(false);
    }
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

  async loadInitialData() { await this.loadCurrentUser(); await this.loadContacts(); }

  loadCurrentUser() {
    return this.actions.loadCurrentUser();
  }
  updateUserProfile(data: Record<string, unknown>) { return this.actions.updateUserProfile(data); }
  async flushSocialOutbox(): Promise<void> {
    await this.actions.flushSocialOutbox();
  }
  async hasPendingOfflineRecoveryWork(): Promise<boolean> {
    return (await this.actions.countPendingRealmRecoveryWork()) > 0;
  }
  loadGroupChats(limit = 20) { return this.actions.loadGroupChats(Math.min(limit, 100)); }
  loadGroupChat(chatId: string) { return this.actions.loadGroupChat(chatId); }
  loadGroupMessages(chatId: string, limit = 50) { return this.actions.loadGroupMessages(chatId, Math.min(limit, 100)); }
  sendGroupMessage(chatId: string, content: string) { return this.actions.sendGroupMessage(chatId, content); }
  commitRealmGroupMessageCandidate(chatId: string, participant: GroupParticipantDto, triggerMessage: GroupMessageViewDto) {
    return this.actions.commitRealmGroupMessageCandidate(chatId, participant, triggerMessage);
  }
  async markGroupRead(chatId: string) { await this.actions.markGroupRead(chatId); }
  createGroup(title: string, participantIds: string[], initialMessage?: string) { return this.actions.createGroup(title, participantIds, initialMessage); }
  syncGroupEvents(chatId: string, afterSeq: number, limit = 100) { return this.actions.syncGroupEvents(chatId, afterSeq, Math.min(limit, 100)); }
  addGroupAgent(chatId: string, agentAccountId: string) { return this.actions.addGroupAgent(chatId, agentAccountId); }
  removeGroupAgent(chatId: string, agentAccountId: string) { return this.actions.removeGroupAgent(chatId, agentAccountId); }
  async loadContacts() {
    await this.actions.loadContacts();
  }
  loadSocialSnapshot() { return this.actions.loadSocialSnapshot(); }
  loadAgentFriendLimit() { return this.actions.loadAgentFriendLimit(); }
  searchUser(identifierInput: string) { return this.actions.searchUser(identifierInput); }

  isFriend(userId: string): boolean { return this.authCallbacks?.isFriend(userId) ?? false; }
  isBlockedUser(userId: string): boolean { return isBlockedUser(userId); }

  async removeFriend(userId: string) {
    await this.actions.removeFriend(userId);
    // R-SOC-008 triggered pass: a HUMAN_AGENT removal wrote an OPEN termination
    // intent in the same backend transaction; kick a courier pass so the common
    // same-device case converges within ~1s instead of waiting for the tick.
    // For a HUMAN_HUMAN removal the viewer-scoped list returns no new intent, so
    // the pass is a cheap no-op — the courier owns no decision about which
    // removals produce an intent.
    void this.runLocalAgentTerminationCourierPass().catch(() => {
      // Transport/offline failures are expected and telemetered by the courier;
      // the intent stays OPEN server-side for the periodic tick / next startup.
    });
  }
  async requestOrAcceptFriend(userId: string, message?: string) {
    const result = await this.actions.requestOrAcceptFriend(userId, message);
    // R-SOC-009 triggered pass: a HUMAN_AGENT add / accept-request wrote an OPEN
    // provision intent in the same backend transaction; kick a courier pass so
    // the common same-device case converges within ~1s instead of waiting for
    // the tick. For a HUMAN_HUMAN add the viewer-scoped list returns no new
    // intent, so the pass is a cheap no-op — the courier owns no decision about
    // which creations produce an intent.
    void this.runLocalAgentProvisionCourierPass().catch(() => {
      // Transport/offline failures are expected and telemetered by the courier;
      // the intent stays OPEN server-side for the periodic tick / next startup.
    });
    return result;
  }
  rejectOrRemoveFriend(userId: string) { return this.actions.rejectOrRemoveFriend(userId); }
  blockUser(contact: Record<string, unknown>) { return this.actions.blockUser(contact); }
  unblockUser(contact: Record<string, unknown>) { return this.actions.unblockUser(contact); }
  loadUserProfile(id: string) { return this.actions.loadUserProfile(id); }
  loadWorlds(status?: 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED') { return this.actions.loadWorlds(status); }
  loadWorldDetailById(worldId: string) { return this.actions.loadWorldDetailById(worldId); }
  loadWorldSemanticBundle(worldId: string) { return this.actions.loadWorldSemanticBundle(worldId); }
  loadMainWorld() { return this.actions.loadMainWorld(); }
  loadWorldLevelAudits(worldId: string, limit = 20): Promise<WorldLevelAuditEventDto[]> { return this.actions.loadWorldLevelAudits(worldId, limit); }
  loadWorldAgents(worldId: string): Promise<WorldAgentSummaryDto[]> { return this.actions.loadWorldAgents(worldId); }
  loadWorldDetailWithAgents(
    worldId: string,
    recommendedAgentLimit?: number,
  ): Promise<WorldDetailWithAgentsDto | null> {
    return this.actions.loadWorldDetailWithAgents(worldId, recommendedAgentLimit);
  }
  loadWorldHistory(worldId: string): Promise<WorldHistoryPayload> { return this.actions.loadWorldHistory(worldId); }
  loadWorldLorebooks(worldId: string): Promise<WorldLorebookListPayload> { return this.actions.loadWorldLorebooks(worldId); }
  loadWorldBindings(worldId: string): Promise<WorldBindingListPayload> { return this.actions.loadWorldBindings(worldId); }
  loadWorldScenes(worldId: string): Promise<WorldSceneListPayload> { return this.actions.loadWorldScenes(worldId); }
  startWorldTransit(input: {
    agentId: string;
    fromWorldId?: string;
    toWorldId: string;
    transitType: TransitType;
    reason?: string;
    context?: Record<string, unknown>;
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
    scope?: PostFeedScope;
  }) { return this.actions.loadPostFeed(payload); }
  loadLikedPosts(profileId: string, limit = 20, cursor?: string) {
    return this.actions.loadLikedPosts(profileId, limit, cursor);
  }
  loadPostById(postId: string) { return this.actions.loadPostById(postId); }
  createPost(payload: CreatePostDto) { return this.actions.createPost(payload); }
  deletePost(postId: string) { return this.actions.deletePost(postId); }
  updatePostVisibility(postId: string, visibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE') {
    return this.actions.updatePostVisibility(postId, visibility);
  }
  likePost(postId: string): Promise<void> { return this.actions.likePost(postId); }
  unlikePost(postId: string): Promise<void> { return this.actions.unlikePost(postId); }
  createReport(payload: CreateReportDto) { return this.actions.createReport(payload); }
  loadMyAgents() { return this.actions.loadMyAgents(); }
  createAgent(input: CreateMasterAgentInput) { return this.actions.createAgent(input); }
  loadFriendRequests() { return this.actions.loadFriendRequests(); }
  loadExploreAgents(input: { tag?: string | null; query?: string | null; limit?: number } = {}) {
    return this.actions.loadExploreAgents({ ...input, limit: Math.min(input.limit ?? 20, 100) });
  }
  loadExploreFeed(tag: string | null = null, limit = 20) { return this.actions.loadExploreFeed(tag, Math.min(limit, 100)); }
  loadMoreExploreFeed(limit = 20, cursor?: string, tag?: string | null) {
    return this.actions.loadMoreExploreFeed(Math.min(limit, 100), cursor, tag);
  }
  loadAgentDetails(agentIdentifier: string) { return this.actions.loadAgentDetails(agentIdentifier); }
  login(identifier: string, password: string, debug?: PasswordAuthDebug) {
    return this.actions.login(identifier, password, debug);
  }
  register(email: string, password: string, debug?: PasswordAuthDebug) {
    return this.actions.register(email, password, debug);
  }
  async logout() {
    await this.actions.logout();
    this.accessToken = '';
    this.refreshToken = '';
    this.accessTokenProvider = null;
    this.persistApiToHotState();
    this.clearProactiveRefreshTimer();
  }
  startPolling(key: string, callback: () => void, intervalMs: number) { this.polling.start(key, callback, intervalMs); }
  stopPolling(key: string) { this.polling.stop(key); }
  stopAllPolling() { this.polling.stopAll(); }

  /**
   * R-SOC-008 desktop reconciliation courier — run one stateless pass: pull the
   * viewer's OPEN LocalAgentTerminationIntents, deliver runtime.agent.terminateAgent
   * to the loopback runtime, ack the typed outcome. Pure transport; owns no
   * decision and drives no UI state.
   */
  runLocalAgentTerminationCourierPass(): Promise<LocalAgentTerminationCourierPassResult> {
    return runLocalAgentTerminationCourierPass({
      callApi: this.callApiTask,
      emitDataSyncError: this.emitFacadeError,
      getCurrentUser: () => this.authCallbacks?.getCurrentUser() || null,
    });
  }

  /**
   * Register the ~60s courier tick so an intent created by another device or
   * session while this device is already online still converges without a
   * restart. `stopAllPolling()` on auth-clear / refresh-failure halts it.
   */
  startLocalAgentTerminationCourier() {
    this.polling.start(
      COURIER_POLLING_KEY,
      () => {
        void this.runLocalAgentTerminationCourierPass().catch(() => {
          // Transport/offline failures are expected and already telemetered by
          // the courier; the intent stays OPEN server-side for the next tick.
        });
      },
      COURIER_POLL_INTERVAL_MS,
    );
  }

  stopLocalAgentTerminationCourier() {
    this.polling.stop(COURIER_POLLING_KEY);
  }

  /**
   * R-SOC-009 desktop reconciliation courier — run one stateless pass: pull the
   * viewer's OPEN LocalAgentProvisionIntents, deliver runtime.agent.initializeAgent
   * to the loopback runtime, ack the typed outcome. Pure transport; owns no
   * decision and drives no UI state.
   */
  runLocalAgentProvisionCourierPass(): Promise<LocalAgentProvisionCourierPassResult> {
    return runLocalAgentProvisionCourierPass({
      callApi: this.callApiTask,
      emitDataSyncError: this.emitFacadeError,
      getCurrentUser: () => this.authCallbacks?.getCurrentUser() || null,
    });
  }

  /**
   * Register the ~60s provision courier tick so an intent created by another
   * device or session while this device is already online still converges
   * without a restart. `stopAllPolling()` on auth-clear / refresh-failure halts
   * it.
   */
  startLocalAgentProvisionCourier() {
    this.polling.start(
      PROVISION_COURIER_POLLING_KEY,
      () => {
        void this.runLocalAgentProvisionCourierPass().catch(() => {
          // Transport/offline failures are expected and already telemetered by
          // the courier; the intent stays OPEN server-side for the next tick.
        });
      },
      PROVISION_COURIER_POLL_INTERVAL_MS,
    );
  }

  stopLocalAgentProvisionCourier() {
    this.polling.stop(PROVISION_COURIER_POLLING_KEY);
  }

  scheduleProactiveRefresh(accessToken: string) {
    this.clearProactiveRefreshTimer();
    if (!this.refreshToken) return;
    const expiry = Realm.decodeTokenExpiryUnsafe(accessToken);
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
      const refreshResult = await Realm.refreshAccessToken({
        authMode: 'external_principal',
        realmBaseUrl: this.realmBaseUrl,
        refreshToken: this.refreshToken,
        fetchImpl: this.fetchImpl || undefined,
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
      const errorFields = extractRuntimeErrorFields(error);
      emitRuntimeLog({
        level: 'warn',
        area: 'datasync',
        message: 'action:proactive-refresh:failed',
        traceId: errorFields.traceId,
        details: {
          reasonCode: errorFields.reasonCode,
          actionHint: errorFields.actionHint,
          retryable: errorFields.retryable,
          traceId: errorFields.traceId,
          error: errorFields.message || (error instanceof Error ? error.message : String(error || '')),
        },
      });
      await this.handleAuthRequired(error);
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
    this.accessTokenProvider = null;
    this.fetchImpl = null;
  }
}

export const dataSync = new DataSync();
