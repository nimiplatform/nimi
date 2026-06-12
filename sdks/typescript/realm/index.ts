import { CoreClient, type CoreClientOptions, type CoreTransport } from '../core-client';
import { RealmTypedClient } from '../core-generated/realm-typed-client';
import type { CoreStreamRequest, CoreUnaryRequest } from '../types';

export type { CoreClientOptions, CoreTransport };
export {
  normalizeNimiRealmBaseUrl,
  projectNimiRealmBaseUrl,
  projectNimiRealmRealtimeUrl,
} from './endpoint';
export type {
  NimiRealmBaseUrlProjectionInput,
  NimiRealmRealtimeUrlProjectionInput,
} from './endpoint';
export {
  resolveNimiRealmMediaUrl,
} from './media-url';
export type {
  NimiRealmMediaUrlProjectionInput,
} from './media-url';
export {
  ackNimiRealmLocalAgentProvisionIntent,
  ackNimiRealmLocalAgentTerminationIntent,
  listNimiRealmLocalAgentProvisionIntents,
  listNimiRealmLocalAgentTerminationIntents,
} from './local-agent-intents';
export type {
  NimiRealmLocalAgentIntentApiCaller,
  NimiRealmLocalAgentProvisionIntentAckDto,
  NimiRealmLocalAgentProvisionIntentDto,
  NimiRealmLocalAgentTerminationIntentAckDto,
  NimiRealmLocalAgentTerminationIntentDto,
} from './local-agent-intents';
export {
  uploadNimiRealmResourceFile,
} from './resource-upload';
export type {
  NimiRealmResourceUploadApi,
  NimiRealmResourceUploadDeliveryAccess,
  NimiRealmResourceUploadFinalizeInput,
  NimiRealmResourceUploadInput,
  NimiRealmResourceUploadKind,
  NimiRealmResourceUploadResource,
  NimiRealmResourceUploadResult,
  NimiRealmResourceUploadSession,
  NimiRealmResourceUploadTransportMode,
} from './resource-upload';
export {
  addNimiRealmGroupAgent,
  commitNimiRealmGroupMessageCandidate,
  createNimiRealmGroupChat,
  createNimiRealmGroupTextMessageInput,
  listNimiRealmGroupChats,
  loadNimiRealmGroupChat,
  loadNimiRealmGroupMessages,
  markNimiRealmGroupRead,
  removeNimiRealmGroupAgent,
  sendNimiRealmGroupMessage,
  syncNimiRealmGroupEvents,
} from './group-chat';
export type {
  NimiRealmGroupChatApi,
  NimiRealmGroupChatListResult,
  NimiRealmGroupChatSyncResult,
  NimiRealmGroupChatView,
  NimiRealmGroupCreateInput,
  NimiRealmGroupMessageCandidateCommitInput,
  NimiRealmGroupMessageCandidateCommitResult,
  NimiRealmGroupMessageListResult,
  NimiRealmGroupMessageType,
  NimiRealmGroupMessageView,
  NimiRealmGroupParticipant,
  NimiRealmGroupSendMessageInput,
} from './group-chat';
export {
  createNimiRealmMasterAgent,
  enrichNimiRealmAgentProfileWithWorldBanner,
  loadNimiRealmAgentDetails,
  loadNimiRealmCreatorAgents,
} from './agent-profile';
export type {
  NimiRealmAgentProfileApi,
  NimiRealmAgentProfileProjection,
  NimiRealmCreateMasterAgentInput,
  NimiRealmCreatorAgentProjection,
} from './agent-profile';
export {
  NIMI_REALM_OAUTH_LOGIN_STATE,
  NIMI_REALM_OAUTH_PROVIDER,
} from './oauth';
export type {
  NimiRealmOAuthLoginState,
  NimiRealmOAuthProvider,
} from './oauth';
export {
  checkNimiRealmAuthEmail,
  createNimiRealmWalletChallenge,
  isNimiRealmExpectedAnonymousSessionError,
  loginNimiRealmAuthPassword,
  loginNimiRealmOAuth,
  loginNimiRealmWallet,
  normalizeNimiRealmAuthTokens,
  normalizeNimiRealmCheckEmailResponse,
  normalizeNimiRealmEmailOtpRequestResult,
  normalizeNimiRealmOAuthLoginResult,
  normalizeNimiRealmWalletChallengeResult,
  requestNimiRealmEmailOtp,
  readNimiRealmOAuthLoginTokens,
  toNimiRealmAuthUserRecord,
  verifyNimiRealmEmailOtp,
  verifyNimiRealmTwoFactor,
} from './auth';
export type {
  NimiRealmAuthApi,
  NimiRealmAuthTokens,
  NimiRealmAuthUserRecord,
  NimiRealmCheckEmailResponse,
  NimiRealmEmailOtpRequestResult,
  NimiRealmOAuthLoginResult,
  NimiRealmWalletChallengeInput,
  NimiRealmWalletChallengeResult,
  NimiRealmWalletLoginInput,
} from './auth';
export {
  disableNimiRealmTwoFactor,
  enableNimiRealmTwoFactor,
  linkNimiRealmOAuth,
  loadNimiRealmCreatorEligibility,
  loadNimiRealmUserNotificationSettings,
  loadNimiRealmUserSettings,
  prepareNimiRealmTwoFactor,
  unlinkNimiRealmOAuth,
  updateNimiRealmPassword,
  updateNimiRealmUserNotificationSettings,
  updateNimiRealmUserSettings,
} from './account-settings';
export type {
  NimiRealmAccountSettingsApi,
  NimiRealmCreatorEligibility,
  NimiRealmOAuthLinkProjection,
  NimiRealmPasswordUpdateProjection,
  NimiRealmTwoFactorPrepareOutput,
  NimiRealmTwoFactorProjection,
  NimiRealmTwoFactorVerifyInput,
  NimiRealmUpdatePasswordInput,
  NimiRealmUpdateUserNotificationSettingsInput,
  NimiRealmUpdateUserSettingsInput,
  NimiRealmUserNotificationSettings,
  NimiRealmUserSettings,
} from './account-settings';
export {
  requestNimiRealmAccountDeletion,
  requestNimiRealmDataExport,
} from './account-data';
export type {
  NimiRealmAccountDataApi,
  NimiRealmAccountDataTaskStatus,
  NimiRealmRequestAccountDeletionInput,
  NimiRealmRequestAccountDeletionOutput,
  NimiRealmRequestDataExportInput,
  NimiRealmRequestDataExportOutput,
} from './account-data';
export {
  createNimiRealmPermissionTransport,
} from './permission-grants';
export type {
  NimiRealmPermissionGrantApi,
  NimiRealmPermissionGrantModule,
  NimiRealmPermissionTransportOptions,
} from './permission-grants';
export {
  buildNimiRealmWorldDetailWithAgentsCacheKey,
  buildNimiRealmWorldHistorySummary,
  formatNimiRealmWorldDisplayLabel,
  loadNimiRealmMainWorld,
  loadNimiRealmWorldAgents,
  loadNimiRealmWorldBindings,
  loadNimiRealmWorldDetailById,
  loadNimiRealmWorldDetailWithAgents,
  loadNimiRealmWorldHistory,
  loadNimiRealmWorldLevelAudits,
  loadNimiRealmWorldList,
  loadNimiRealmWorldLorebooks,
  loadNimiRealmWorldScenes,
  loadNimiRealmWorldSemanticBundle,
  mergeNimiRealmWorldPrimaryDetailTruth,
  normalizeNimiRealmWorldTruthAnchor,
  normalizeNimiRealmWorldTruthDetail,
  normalizeNimiRealmWorldTruthListItem,
  normalizeNimiRealmWorldTruthSummary,
  toNimiRealmWorldDisplayAgent,
  toNimiRealmWorldDisplayAuditItem,
  toNimiRealmWorldDisplayBindingItem,
  toNimiRealmWorldDisplayData,
  toNimiRealmWorldDisplayFallback,
  toNimiRealmWorldDisplayHistoryBundle,
  toNimiRealmWorldDisplayHistoryItem,
  toNimiRealmWorldDisplayLorebookItem,
  toNimiRealmWorldDisplaySceneItem,
  toNimiRealmWorldDisplaySemanticBundle,
} from './world-data';
export type {
  NimiRealmWorldAgent,
  NimiRealmWorldAgentStats,
  NimiRealmWorldAgentSummary,
  NimiRealmWorldApi,
  NimiRealmWorldAuditItem,
  NimiRealmWorldBindingItem,
  NimiRealmWorldBindingListPayload,
  NimiRealmWorldDetail,
  NimiRealmWorldDetailData,
  NimiRealmWorldDetailWithAgents,
  NimiRealmWorldDisplayComputed,
  NimiRealmWorldHistoryBundle,
  NimiRealmWorldHistoryEvidenceRef,
  NimiRealmWorldHistoryItem,
  NimiRealmWorldHistoryPayload,
  NimiRealmWorldHistorySummary,
  NimiRealmWorldLevelAuditEvent,
  NimiRealmWorldLorebookItem,
  NimiRealmWorldLorebookListPayload,
  NimiRealmWorldPrimaryDetailRecord,
  NimiRealmWorldPublicAssetsData,
  NimiRealmWorldRecommendedAgent,
  NimiRealmWorldRecommendedAgentDisplay,
  NimiRealmWorldSceneItem,
  NimiRealmWorldSceneListPayload,
  NimiRealmWorldSemanticBundle,
  NimiRealmWorldSemanticData,
  NimiRealmWorldSemanticLanguage,
  NimiRealmWorldSemanticLevel,
  NimiRealmWorldSemanticPowerSystem,
  NimiRealmWorldSemanticRealm,
  NimiRealmWorldSemanticRule,
  NimiRealmWorldSemanticSnapshotItem,
  NimiRealmWorldSemanticTaboo,
  NimiRealmWorldSemanticTimelineItem,
  NimiRealmWorldSemanticTopology,
  NimiRealmWorldStatus,
  NimiRealmWorldTruthAnchor,
  NimiRealmWorldTruthContentRating,
  NimiRealmWorldTruthDetail,
  NimiRealmWorldTruthListComputed,
  NimiRealmWorldTruthListItem,
  NimiRealmWorldTruthListRecommendedAgent,
  NimiRealmWorldTruthNativeCreationState,
  NimiRealmWorldTruthRecommendedAgent,
  NimiRealmWorldTruthSummary,
  NimiRealmWorldTruthWorldType,
  NimiRealmWorldTruthWorldview,
  NimiRealmWorldTruthWorldviewLifecycle,
  NimiRealmWorldviewDetail,
} from './world-data';
export {
  NIMI_REALM_FEED_SCOPES,
  isNimiRealmFeedScope,
} from './feed';
export type {
  NimiRealmFeedScope,
} from './feed';
export {
  addNimiRealmFriendById,
  blockNimiRealmUser,
  buildEmptyNimiRealmPostFeedResponse,
  createNimiRealmPost,
  createNimiRealmReport,
  deleteNimiRealmPost,
  enrichNimiRealmSocialProfileWithWorldBanner,
  executeNimiRealmSocialMutation,
  fetchNimiRealmAgentFriendLimit,
  fetchNimiRealmPendingFriendRequests,
  likeNimiRealmPost,
  loadNimiRealmCurrentUserProfile,
  loadNimiRealmExploreAgents,
  loadNimiRealmExploreFeedItems,
  loadNimiRealmLikedPosts,
  loadNimiRealmPostById,
  loadNimiRealmPostFeed,
  loadNimiRealmSocialSnapshot,
  loadNimiRealmUserProfileById,
  removeNimiRealmFriendById,
  unblockNimiRealmUser,
  unlikeNimiRealmPost,
  updateNimiRealmCurrentUserProfile,
  updateNimiRealmPostVisibility,
} from './social';
export type {
  LoadNimiRealmExploreAgentsInput,
  NimiRealmPendingFriendRequestDto,
  NimiRealmPendingFriendRequestListDto,
  NimiRealmPostFeedInput,
  NimiRealmSocialApi,
  NimiRealmSocialContactRecord,
  NimiRealmSocialContactSnapshot,
  NimiRealmSocialDataErrorEmitter,
  NimiRealmSocialMutationExecutionInput,
  NimiRealmSocialMutationKind,
  NimiRealmSocialProfileProjection,
} from './social';
export {
  loadNimiRealmNotificationUnreadCount,
  loadNimiRealmNotifications,
  markNimiRealmNotificationRead,
  markNimiRealmNotificationsRead,
  normalizeNimiRealmNotificationUnreadCount,
  toNimiRealmNotificationItemProjection,
  toNimiRealmNotificationListProjection,
} from './notifications';
export type {
  NimiRealmMarkNotificationsReadInput,
  NimiRealmNotification,
  NimiRealmNotificationApi,
  NimiRealmNotificationItemProjection,
  NimiRealmNotificationListOptions,
  NimiRealmNotificationListProjection,
  NimiRealmNotificationListResult,
  NimiRealmNotificationReadProjection,
  NimiRealmNotificationType,
  NimiRealmNotificationUnreadProjection,
  NimiRealmNotificationsReadProjection,
} from './notifications';
export {
  createRealmFetchTransport,
} from './fetch-transport';
export type {
  RealmFetchTransportOptions,
} from './fetch-transport';

export class RealmCore {
  constructor(private readonly client: CoreClient) {}

  operation<Response = unknown, Body = unknown>(request: RealmOperationRequest<Body>): Promise<Response> {
    return this.client.unary<Response, Body>({
      ...request,
      methodId: request.operationId,
    });
  }

  unsafeRaw(): CoreTransport {
    return this.client.unsafeRaw();
  }
}

export interface RealmOperationRequest<Body = unknown> extends Omit<CoreUnaryRequest<Body>, 'methodId'> {
  readonly operationId: string;
}

type RealmTypedMethodName = {
  readonly [Key in keyof RealmTypedClient]: RealmTypedClient[Key] extends (...args: never[]) => unknown ? Key : never;
}[keyof RealmTypedClient] & string;

type RealmMethodModule<Keys extends readonly RealmTypedMethodName[]> = Readonly<{
  [Key in Keys[number]]: RealmTypedClient[Key];
}>;

export const REALM_AUTH_METHODS = [
  'bindEmail',
  'bindWallet',
  'changeEmail',
  'checkEmail',
  'disable2Fa',
  'enable2Fa',
  'linkOauth',
  'logout',
  'oauthLogin',
  'passwordLogin',
  'prepare2Fa',
  'refreshToken',
  'requestEmailOtp',
  'unlinkOauth',
  'updatePassword',
  'verify2Fa',
  'verifyEmailOtp',
  'walletChallenge',
  'walletLogin',
] as const satisfies readonly RealmTypedMethodName[];

export const REALM_ACCOUNT_METHODS = [
  'getMe',
  'getMyCreatorEligibility',
  'getMyNotificationSettings',
  'getMySettings',
  'requestAccountDeletion',
  'requestDataExport',
  'updateMe',
  'updateMyNotificationSettings',
  'updateMySettings',
] as const satisfies readonly RealmTypedMethodName[];

export const REALM_PERMISSION_GRANT_METHODS = [
  'getMyAppPermissionGrant',
  'getMyAppPermissionGrantStatus',
  'listMyAppPermissionGrants',
  'requestMyAppPermissionGrant',
  'revokeMyAppPermissionGrant',
] as const satisfies readonly RealmTypedMethodName[];

export const REALM_SOCIAL_METHODS = [
  'addFriend',
  'blockUser',
  'unblockUser',
  'removeFriend',
  'listMyFriendIds',
  'listMyFriendsWithDetails',
  'listOnlineUsers',
  'createPost',
  'deletePost',
  'getPost',
  'listLikedPosts',
  'likePost',
  'unlikePost',
] as const satisfies readonly RealmTypedMethodName[];

export const REALM_GROUP_CHAT_METHODS = [
  'createGroup',
  'listGroups',
  'getGroup',
  'addGroupParticipant',
  'removeGroupParticipant',
  'addGroupAgent',
  'removeGroupAgent',
  'sendGroupMessage',
  'listGroupMessages',
  'syncGroupEvents',
  'markGroupRead',
  'commitRealmGroupMessageCandidate',
] as const satisfies readonly RealmTypedMethodName[];

export const REALM_HUMAN_CHAT_METHODS = [
  'getChatById',
  'listChats',
  'listMessages',
  'markChatRead',
  'sendMessage',
  'startChat',
  'syncChatEvents',
] as const satisfies readonly RealmTypedMethodName[];

export const REALM_AGENT_METHODS = [
  'agentControllerCheckHandle',
  'agentControllerCreate',
  'agentControllerDelete',
  'agentControllerGetRelationships',
  'agentControllerGetVisibility',
  'agentControllerMakePublic',
  'agentControllerRemoveRelationship',
  'agentControllerSelectAvatar',
  'agentControllerSetRelationship',
  'agentControllerUpdateDna',
  'agentControllerUpdateVisibility',
  'creatorControllerCreateAgent',
  'creatorControllerGetAgent',
  'creatorControllerListAgents',
  'creatorControllerUpdateAgent',
  'getAgent',
  'getAgentByHandle',
  'listMyRealmAgents',
] as const satisfies readonly RealmTypedMethodName[];

export const REALM_LOCAL_AGENT_INTENT_METHODS = [
  'ackMyLocalAgentProvisionIntent',
  'ackMyLocalAgentTerminationIntent',
  'listMyLocalAgentProvisionIntents',
  'listMyLocalAgentTerminationIntents',
] as const satisfies readonly RealmTypedMethodName[];

export const REALM_RESOURCE_METHODS = [
  'createAudioDirectUpload',
  'createImageDirectUpload',
  'createVideoDirectUpload',
  'createTextResource',
  'deleteResource',
  'finalizeResource',
  'listResources',
] as const satisfies readonly RealmTypedMethodName[];

export const REALM_NOTIFICATION_METHODS = [
  'getUnreadCount',
  'listNotifications',
  'markNotificationRead',
  'markNotificationsRead',
] as const satisfies readonly RealmTypedMethodName[];

export const REALM_WORLD_METHODS = [
  'getWorldScenes',
  'worldControlControllerAppendWorldHistory',
  'worldControlControllerBatchUpsertWorldBindings',
  'worldControlControllerCommitState',
  'worldControlControllerCreateDraft',
  'worldControlControllerDeleteWorldBinding',
  'worldControlControllerGetDraft',
  'worldControlControllerGetMyAccess',
  'worldControlControllerGetState',
  'worldControlControllerListDrafts',
  'worldControlControllerListMyWorlds',
  'worldControlControllerListWorldBindings',
  'worldControlControllerListWorldHistory',
  'worldControlControllerListWorldLorebooks',
  'worldControlControllerPublishDraft',
  'worldControlControllerResolveLanding',
  'worldControlControllerUpdateDraft',
  'worldControllerGetMainWorld',
  'worldControllerGetWorld',
  'worldControllerGetWorldAgents',
  'worldControllerGetWorldBindings',
  'worldControllerGetWorldDetailWithAgents',
  'worldControllerGetWorldHistory',
  'worldControllerGetWorldLevelAudits',
  'worldControllerGetWorldLorebooks',
  'worldControllerGetWorldview',
  'worldControllerListWorlds',
  'worldControllerReturnToMainWorld',
  'worldControllerTransitToWorld',
  'worldRulesControllerArchiveRule',
  'worldRulesControllerCheckPermission',
  'worldRulesControllerCreateRule',
  'worldRulesControllerDeprecateRule',
  'worldRulesControllerGetCreatorCapabilities',
  'worldRulesControllerGetRules',
  'worldRulesControllerUpdateRule',
  'worldRulesControllerValidateRules',
] as const satisfies readonly RealmTypedMethodName[];

export type RealmAuthModule = RealmMethodModule<typeof REALM_AUTH_METHODS>;
export type RealmAccountModule = RealmMethodModule<typeof REALM_ACCOUNT_METHODS>;
export type RealmPermissionGrantModule = RealmMethodModule<typeof REALM_PERMISSION_GRANT_METHODS>;
export type RealmSocialModule = RealmMethodModule<typeof REALM_SOCIAL_METHODS>;
export type RealmGroupChatModule = RealmMethodModule<typeof REALM_GROUP_CHAT_METHODS>;
export type RealmHumanChatModule = RealmMethodModule<typeof REALM_HUMAN_CHAT_METHODS>;
export type RealmAgentModule = RealmMethodModule<typeof REALM_AGENT_METHODS>;
export type RealmLocalAgentIntentModule = RealmMethodModule<typeof REALM_LOCAL_AGENT_INTENT_METHODS>;
export type RealmResourceModule = RealmMethodModule<typeof REALM_RESOURCE_METHODS>;
export type RealmNotificationModule = RealmMethodModule<typeof REALM_NOTIFICATION_METHODS>;
export type RealmWorldModule = RealmMethodModule<typeof REALM_WORLD_METHODS>;

export interface RealmOptions extends CoreClientOptions {}

export class Realm {
  readonly core: CoreClient;
  readonly generated: RealmTypedClient;
  readonly auth: RealmAuthModule;
  readonly account: RealmAccountModule;
  readonly permissionGrants: RealmPermissionGrantModule;
  readonly social: RealmSocialModule;
  readonly groupChat: RealmGroupChatModule;
  readonly humanChats: RealmHumanChatModule;
  readonly agents: RealmAgentModule;
  readonly localAgentIntents: RealmLocalAgentIntentModule;
  readonly resources: RealmResourceModule;
  readonly notifications: RealmNotificationModule;
  readonly world: RealmWorldModule;

  constructor(options: RealmOptions | CoreClient | RealmTypedClient) {
    this.core = toCoreClient(options);
    const generated = options instanceof RealmTypedClient
      ? options
      : new RealmTypedClient(this.core);
    this.generated = generated;
    this.auth = bindRealmModule(generated, REALM_AUTH_METHODS);
    this.account = bindRealmModule(generated, REALM_ACCOUNT_METHODS);
    this.permissionGrants = bindRealmModule(generated, REALM_PERMISSION_GRANT_METHODS);
    this.social = bindRealmModule(generated, REALM_SOCIAL_METHODS);
    this.groupChat = bindRealmModule(generated, REALM_GROUP_CHAT_METHODS);
    this.humanChats = bindRealmModule(generated, REALM_HUMAN_CHAT_METHODS);
    this.agents = bindRealmModule(generated, REALM_AGENT_METHODS);
    this.localAgentIntents = bindRealmModule(generated, REALM_LOCAL_AGENT_INTENT_METHODS);
    this.resources = bindRealmModule(generated, REALM_RESOURCE_METHODS);
    this.notifications = bindRealmModule(generated, REALM_NOTIFICATION_METHODS);
    this.world = bindRealmModule(generated, REALM_WORLD_METHODS);
  }

  me(options = {}): ReturnType<RealmTypedClient['getMe']> {
    return this.account.getMe({ path: {} }, options);
  }

  unsafeRawTransport(): CoreTransport {
    return this.core.unsafeRaw();
  }
}

export function createRealm(options: RealmOptions | CoreClient | RealmTypedClient): Realm {
  return new Realm(options);
}

function toCoreClient(options: RealmOptions | CoreClient | RealmTypedClient): CoreClient {
  if (options instanceof CoreClient) {
    return options;
  }
  if (options instanceof RealmTypedClient) {
    return extractCoreClient(options);
  }
  return new CoreClient(options);
}

function extractCoreClient(client: RealmTypedClient): CoreClient {
  const candidate = client as unknown as { readonly core?: unknown };
  if (candidate.core instanceof CoreClient) {
    return candidate.core;
  }
  throw new Error('RealmTypedClient was not constructed with the public CoreClient implementation');
}

function bindRealmModule<const Keys extends readonly RealmTypedMethodName[]>(
  client: RealmTypedClient,
  keys: Keys,
): RealmMethodModule<Keys> {
  const module: Partial<Record<RealmTypedMethodName, unknown>> = {};
  for (const key of keys) {
    const method = client[key];
    if (typeof method !== 'function') {
      throw new Error(`Realm generated client is missing typed method: ${key}`);
    }
    module[key] = method.bind(client);
  }
  return module as RealmMethodModule<Keys>;
}
