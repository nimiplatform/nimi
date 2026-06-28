import { CoreClient, type CoreClientOptions, type CoreTransport } from '../core-client';
import { RealmTypedClient } from '../core-generated/realm-typed-client';
import { createNimiError, type CoreMetadata, type CoreResponseMetadataObserver } from '../types';

export type { CoreClientOptions, CoreTransport };
export * from './generated';
export * from './endpoint';
export * from './media-url';
export * from './oauth';
export * from './auth';
export * from './account-settings';
export * from './account-data';
export * from './permission-grants';
export * from './resource-upload';
export * from './group-chat';
export * from './feed';
export * from './social';
export * from './notifications';
export * from './fetch-transport';

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
  'getMyAppPermissionGrantView',
  'listMyAppPermissionGrants',
  'requestMyAppPermissionGrant',
  'grantMyAppPermissionGrant',
  'denyMyAppPermissionGrant',
  'expireMyAppPermissionGrant',
  'revokeMyAppPermissionGrant',
  'supersedeMyAppPermissionGrant',
] as const satisfies readonly RealmTypedMethodName[];

const REALM_PERMISSION_GRANT_METHOD_SET = new Set<string>(REALM_PERMISSION_GRANT_METHODS);

export const REALM_SOCIAL_METHODS = [
  'addFriend',
  'blockUser',
  'unblockUser',
  'removeFriend',
  'getMutualFriends',
  'getMutualFriendsCount',
  'getMyBlockedUsers',
  'getMyPendingFriendRequests',
  'getUser',
  'getUserByHandle',
  'getUserFriends',
  'listMyFriendIds',
  'listMyFriendsWithDetails',
  'listOnlineUsers',
  'searchHumanUsers',
  'searchIndexedUsers',
  'searchPosts',
  'createPost',
  'deletePost',
  'getExploreFeed',
  'getHomeFeed',
  'getPost',
  'getPublicPost',
  'getWorldPosts',
  'listLikedPosts',
  'likePost',
  'unlikePost',
  'updatePost',
] as const satisfies readonly RealmTypedMethodName[];

export const REALM_GROUP_CHAT_METHODS = [
  'createGroup',
  'listGroups',
  'getGroup',
  'updateGroup',
  'addGroupParticipant',
  'addGroupSourceParticipant',
  'commitRealmGroupSourceMessageCandidate',
  'removeGroupParticipant',
  'removeGroupSourceParticipant',
  'updateGroupParticipantRole',
  'sendGroupMessage',
  'editGroupMessage',
  'recallGroupMessage',
  'listGroupMessages',
  'syncGroupEvents',
  'markGroupRead',
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

export const REALM_RESOURCE_METHODS = [
  'createAudioDirectUpload',
  'createImageDirectUpload',
  'createVideoDirectUpload',
  'createTextResource',
  'deleteResource',
  'finalizeResource',
  'getResource',
  'listResources',
  'updateResource',
] as const satisfies readonly RealmTypedMethodName[];

export const REALM_NOTIFICATION_METHODS = [
  'getUnreadCount',
  'listNotifications',
  'markNotificationRead',
  'markNotificationsRead',
] as const satisfies readonly RealmTypedMethodName[];

export const REALM_WORLD_CORE_METHODS = [
  'worldCoreControllerBootstrapOasisWorld',
  'worldCoreControllerCreateRealmPersona',
  'worldCoreControllerCreateSourceMaterializationPacket',
  'worldCoreControllerCreateWorldCharacter',
  'worldCoreControllerCreateWorldCore',
  'worldCoreControllerCreateWorldEntity',
  'worldCoreControllerCreateWorldRelationship',
  'worldCoreControllerGetOasisWorld',
  'worldCoreControllerGetRealmPersona',
  'worldCoreControllerGetWorldCharacter',
  'worldCoreControllerGetWorldCore',
  'worldCoreControllerGetWorldEntity',
  'worldCoreControllerGetWorldRelationship',
  'worldCoreControllerListRealmPersonas',
  'worldCoreControllerListWorldCharacters',
  'worldCoreControllerListWorldCores',
  'worldCoreControllerListWorldEntities',
  'worldCoreControllerListWorldRelationships',
  'worldCoreControllerReplaceRealmPersona',
  'worldCoreControllerReplaceWorldCharacter',
  'worldCoreControllerReplaceWorldCore',
  'worldCoreControllerReplaceWorldEntity',
  'worldCoreControllerReplaceWorldRelationship',
] as const satisfies readonly RealmTypedMethodName[];

export const REALM_WORLD_PUBLIC_METHODS = [
  'worldPublicControllerGetWorld',
  'worldPublicControllerGetWorldDetailWithCharacters',
  'worldPublicControllerListWorldCharacters',
  'worldPublicControllerListWorlds',
] as const satisfies readonly RealmTypedMethodName[];

export const REALM_TRANSIT_METHODS = [
  'transitControllerAbandon',
  'transitControllerComplete',
  'transitControllerGetActiveTransit',
  'transitControllerGetTransit',
  'transitControllerListTransits',
] as const satisfies readonly RealmTypedMethodName[];

export type RealmAuthModule = RealmMethodModule<typeof REALM_AUTH_METHODS>;
export type RealmAccountModule = RealmMethodModule<typeof REALM_ACCOUNT_METHODS>;
export type RealmPermissionGrantModule = RealmMethodModule<typeof REALM_PERMISSION_GRANT_METHODS>;
export type RealmSocialModule = RealmMethodModule<typeof REALM_SOCIAL_METHODS>;
export type RealmGroupChatModule = RealmMethodModule<typeof REALM_GROUP_CHAT_METHODS>;
export type RealmHumanChatModule = RealmMethodModule<typeof REALM_HUMAN_CHAT_METHODS>;
export type RealmResourceModule = RealmMethodModule<typeof REALM_RESOURCE_METHODS>;
export type RealmNotificationModule = RealmMethodModule<typeof REALM_NOTIFICATION_METHODS>;
export type RealmWorldCoreModule = RealmMethodModule<typeof REALM_WORLD_CORE_METHODS>;
export type RealmWorldPublicModule = RealmMethodModule<typeof REALM_WORLD_PUBLIC_METHODS>;
export type RealmTransitModule = RealmMethodModule<typeof REALM_TRANSIT_METHODS>;

export interface RealmOptions extends CoreClientOptions {}

export interface RealmCoreOperationInput<Body = unknown> {
  readonly operationId: string;
  readonly body: Body;
  readonly metadata?: CoreMetadata;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly responseMetadataObserver?: CoreResponseMetadataObserver;
}

export class RealmCore {
  constructor(readonly core: CoreClient) {}

  operation<Response = unknown, Body = unknown>(input: RealmCoreOperationInput<Body>): Promise<Response> {
    return this.core.unary<Response, Body>({
      methodId: input.operationId,
      body: input.body,
      metadata: input.metadata,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
      responseMetadataObserver: input.responseMetadataObserver,
    });
  }
}

export class Realm {
  readonly core: CoreClient;
  readonly generated: RealmTypedClient;
  readonly auth: RealmAuthModule;
  readonly account: RealmAccountModule;
  private readonly permissionGrantModule: RealmPermissionGrantModule;
  readonly social: RealmSocialModule;
  readonly groupChat: RealmGroupChatModule;
  readonly humanChats: RealmHumanChatModule;
  readonly resources: RealmResourceModule;
  readonly notifications: RealmNotificationModule;
  readonly worldCore: RealmWorldCoreModule;
  readonly worldPublic: RealmWorldPublicModule;
  readonly transit: RealmTransitModule;

  constructor(options: RealmOptions | CoreClient | RealmTypedClient) {
    this.core = toCoreClient(options);
    const generated = options instanceof RealmTypedClient
      ? options
      : new RealmTypedClient(this.core);
    this.generated = createPublicRealmGeneratedClient(generated);
    this.auth = bindRealmModule(generated, REALM_AUTH_METHODS);
    this.account = bindRealmModule(generated, REALM_ACCOUNT_METHODS);
    this.permissionGrantModule = bindRealmModule(generated, REALM_PERMISSION_GRANT_METHODS);
    this.social = bindRealmModule(generated, REALM_SOCIAL_METHODS);
    this.groupChat = bindRealmModule(generated, REALM_GROUP_CHAT_METHODS);
    this.humanChats = bindRealmModule(generated, REALM_HUMAN_CHAT_METHODS);
    this.resources = bindRealmModule(generated, REALM_RESOURCE_METHODS);
    this.notifications = bindRealmModule(generated, REALM_NOTIFICATION_METHODS);
    this.worldCore = bindRealmModule(generated, REALM_WORLD_CORE_METHODS);
    this.worldPublic = bindRealmModule(generated, REALM_WORLD_PUBLIC_METHODS);
    this.transit = bindRealmModule(generated, REALM_TRANSIT_METHODS);
  }

  me(options = {}): ReturnType<RealmTypedClient['getMe']> {
    return this.account.getMe({ path: {} }, options);
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
    return (options as unknown as { readonly core: CoreClient }).core;
  }
  return new CoreClient(options);
}

function bindRealmModule<Keys extends readonly RealmTypedMethodName[]>(
  generated: RealmTypedClient,
  keys: Keys,
): RealmMethodModule<Keys> {
  const module = {} as Record<Keys[number], RealmTypedClient[Keys[number]]>;
  for (const key of keys) {
    const value = generated[key];
    if (typeof value !== 'function') {
      throw createNimiError({
        code: 'REALM_METHOD_UNAVAILABLE',
        reasonCode: 'REALM_METHOD_UNAVAILABLE',
        message: `Realm method is unavailable: ${key}`,
        source: 'sdk',
        retryable: false,
        actionHint: 'regenerate_realm_typed_client',
      });
    }
    (module as Record<string, unknown>)[key] = value.bind(generated);
  }
  return module as RealmMethodModule<Keys>;
}

function createPublicRealmGeneratedClient(generated: RealmTypedClient): RealmTypedClient {
  return new Proxy(generated, {
    get(target, property, receiver) {
      if (
        typeof property === 'string'
        && REALM_PERMISSION_GRANT_METHOD_SET.has(property)
        && property !== 'getMyAppPermissionGrant'
        && property !== 'getMyAppPermissionGrantStatus'
        && property !== 'getMyAppPermissionGrantView'
        && property !== 'listMyAppPermissionGrants'
        && property !== 'requestMyAppPermissionGrant'
        && property !== 'revokeMyAppPermissionGrant'
      ) {
        return undefined;
      }
      return Reflect.get(target, property, receiver);
    },
  });
}
