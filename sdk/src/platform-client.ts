import { asRecord, normalizeText, type JsonObject } from './internal/utils.js';
import { Realm } from './realm/client.js';
import type { RealmFetchImpl, RealmTokenRefreshResult } from './realm/client-types.js';
import type { RealmServiceArgs, RealmServiceResult } from './realm/generated/type-helpers.js';
import { createNimiError } from './runtime/errors.js';
import { Runtime } from './runtime/runtime.js';
import type { ListConnectorsRequest, ListConnectorsResponse } from './runtime/generated/runtime/v1/connector.js';
import type { RuntimeCallOptions, RuntimeClientDefaults, RuntimeOptions, RuntimeTransportConfig } from './runtime/types.js';
import { ReasonCode } from './types/index.js';

type PlatformSessionUser = JsonObject | null;
type RealmServices = Realm['services'];
type RuntimeConnectorModule = Runtime['connector'];
type RuntimeAuditModule = Runtime['audit'];
type ListConnectorsInput = ListConnectorsRequest;
type AuthPasswordLoginBody = RealmServiceArgs<'AuthService', 'passwordLogin'>[0];
type AuthPasswordLoginInput = {
  identifier?: string;
  email?: string;
  password: AuthPasswordLoginBody['password'];
};
type AuthPasswordLoginResult = RealmServiceResult<'AuthService', 'passwordLogin'>;
type ListMyFriendsResult = RealmServiceResult<'MeService', 'listMyFriendsWithDetails'>;
type CreateImageDirectUploadResult = RealmServiceResult<'MediaService', 'createImageDirectUpload'>;
type CreateVideoDirectUploadResult = RealmServiceResult<'MediaService', 'createVideoDirectUpload'>;
type RequireSignedUrlsInput = {
  requireSignedUrls?: string | boolean;
};

export type PlatformAuthSessionStore = {
  getAccessToken?: () => string | Promise<string>;
  getRefreshToken?: () => string | Promise<string>;
  getSubjectUserId?: () => string | Promise<string>;
  getCurrentUser?: () => PlatformSessionUser | Promise<PlatformSessionUser>;
  setAuthSession?: (
    user: PlatformSessionUser,
    accessToken: string,
    refreshToken?: string,
  ) => void | Promise<void>;
  clearAuthSession?: () => void | Promise<void>;
};

export type PlatformClientInput = {
  appId?: string;
  realmBaseUrl?: string;
  accessToken?: string;
  accessTokenProvider?: () => string | Promise<string>;
  refreshTokenProvider?: () => string | Promise<string>;
  subjectUserIdProvider?: () => string | Promise<string>;
  sessionStore?: PlatformAuthSessionStore | null;
  runtimeTransport?: RuntimeTransportConfig | null;
  runtimeDefaults?: RuntimeClientDefaults;
  runtimeOptions?: Omit<RuntimeOptions, 'appId' | 'transport' | 'auth' | 'subjectContext' | 'defaults'>;
  realmFetchImpl?: RealmFetchImpl;
  allowAnonymousRealm?: boolean;
};

type PlatformDomains = {
  auth: {
    checkEmail: RealmServices['AuthService']['checkEmail'];
    passwordLogin: (input: AuthPasswordLoginInput) => Promise<AuthPasswordLoginResult>;
    oauthLogin: RealmServices['AuthService']['oauthLogin'];
    requestEmailOtp: RealmServices['AuthService']['requestEmailOtp'];
    verifyEmailOtp: RealmServices['AuthService']['verifyEmailOtp'];
    verifyTwoFactor: RealmServices['AuthService']['verifyTwoFactor'];
    walletChallenge: RealmServices['AuthService']['walletChallenge'];
    walletLogin: RealmServices['AuthService']['walletLogin'];
    updatePassword: RealmServices['AuthService']['updatePassword'];
    getCurrentUser: RealmServices['MeService']['getMe'];
  };
  social: {
    startChat: RealmServices['HumanChatsService']['startChat'];
    listMessages: RealmServices['HumanChatsService']['listMessages'];
    markChatRead: RealmServices['HumanChatsService']['markChatRead'];
    sendMessage: RealmServices['HumanChatsService']['sendMessage'];
    listFriends: (limit?: number, cursor?: string) => Promise<ListMyFriendsResult>;
  };
  world: {
    getWorldTruth: RealmServices['WorldsService']['worldControllerGetWorld'];
    getWorldviewTruth: RealmServices['WorldsService']['worldControllerGetWorldview'];
    getWorld: RealmServices['WorldsService']['worldControllerGetWorld'];
    getWorldview: RealmServices['WorldsService']['worldControllerGetWorldview'];
    getWorldDetailWithAgents: RealmServices['WorldsService']['worldControllerGetWorldDetailWithAgents'];
    getWorldState: RealmServices['WorldControlService']['worldControlControllerGetState'];
    commitWorldState: RealmServices['WorldControlService']['worldControlControllerCommitState'];
    listWorldHistory: RealmServices['WorldControlService']['worldControlControllerListWorldHistory'];
    appendWorldHistory: RealmServices['WorldControlService']['worldControlControllerAppendWorldHistory'];
    listMyWorlds: RealmServices['WorldControlService']['worldControlControllerListMyWorlds'];
    listWorldLorebooks: RealmServices['WorldsService']['worldControllerGetWorldLorebooks'];
    listWorldMediaBindings: RealmServices['WorldsService']['worldControllerGetWorldMediaBindings'];
    getWorldHistory: RealmServices['WorldsService']['worldControllerGetWorldHistory'];
    listWorldLevelAudits: RealmServices['WorldsService']['worldControllerGetWorldLevelAudits'];
  };
  creator: {
    listAgents: RealmServices['CreatorService']['creatorControllerListAgents'];
    getAgent: RealmServices['CreatorService']['creatorControllerGetAgent'];
    createAgent: RealmServices['CreatorService']['creatorControllerCreateAgent'];
    updateAgent: RealmServices['CreatorService']['creatorControllerUpdateAgent'];
    batchCreateAgents: RealmServices['CreatorService']['creatorControllerBatchCreateAgents'];
  };
  media: {
    createImageDirectUpload: (input?: RequireSignedUrlsInput) => Promise<CreateImageDirectUploadResult>;
    createVideoDirectUpload: (input?: RequireSignedUrlsInput) => Promise<CreateVideoDirectUploadResult>;
    createAudioDirectUpload: RealmServices['MediaService']['createAudioDirectUpload'];
    finalizeAsset: RealmServices['MediaService']['finalizeMediaAsset'];
    getAsset: RealmServices['MediaService']['getMediaAsset'];
    createPost: RealmServices['PostService']['createPost'];
  };
  runtimeAdmin: {
    listProviderCatalog: RuntimeConnectorModule['listProviderCatalog'];
    listConnectors: (
      input?: Partial<ListConnectorsInput>,
      options?: RuntimeCallOptions,
    ) => Promise<ListConnectorsResponse>;
    createConnector: RuntimeConnectorModule['createConnector'];
    updateConnector: RuntimeConnectorModule['updateConnector'];
    deleteConnector: RuntimeConnectorModule['deleteConnector'];
    testConnector: RuntimeConnectorModule['testConnector'];
    listConnectorModels: RuntimeConnectorModule['listConnectorModels'];
    listModelCatalogProviders: RuntimeConnectorModule['listModelCatalogProviders'];
    listCatalogProviderModels: RuntimeConnectorModule['listCatalogProviderModels'];
    getCatalogModelDetail: RuntimeConnectorModule['getCatalogModelDetail'];
    upsertModelCatalogProvider: RuntimeConnectorModule['upsertModelCatalogProvider'];
    deleteModelCatalogProvider: RuntimeConnectorModule['deleteModelCatalogProvider'];
    upsertCatalogModelOverlay: RuntimeConnectorModule['upsertCatalogModelOverlay'];
    deleteCatalogModelOverlay: RuntimeConnectorModule['deleteCatalogModelOverlay'];
    listAuditEvents: RuntimeAuditModule['listAuditEvents'];
    exportAuditEvents: RuntimeAuditModule['exportAuditEvents'];
    listUsageStats: RuntimeAuditModule['listUsageStats'];
    getRuntimeHealth: RuntimeAuditModule['getRuntimeHealth'];
    listAIProviderHealth: RuntimeAuditModule['listAIProviderHealth'];
    healthEvents: Runtime['healthEvents'];
    providerHealthEvents: Runtime['providerHealthEvents'];
  };
  publicContent: {
    getPublicPost: RealmServices['PostService']['getPublicPost'];
  };
};

export type PlatformClient = {
  runtime: Runtime;
  realm: Realm;
  domains: PlatformDomains;
};

let currentPlatformClient: PlatformClient | null = null;
const DEFAULT_PLATFORM_APP_ID = 'nimi.app';
const DEFAULT_REALM_BASE_URL = 'http://localhost:3002';

function detectTauriTransport(): RuntimeTransportConfig | null {
  const tauriRuntime = (
    (globalThis as { __TAURI__?: unknown }).__TAURI__
    || ((globalThis as { window?: { __TAURI__?: unknown } }).window?.__TAURI__)
  );
  if (!tauriRuntime) {
    return null;
  }
  return {
    type: 'tauri-ipc',
    commandNamespace: 'runtime_bridge',
    eventNamespace: 'runtime_bridge',
  };
}

function readProcessEnv(name: string): string {
  if (typeof process === 'undefined' || typeof process.env === 'undefined') {
    return '';
  }
  return normalizeText(process.env[name]);
}

function resolvePlatformRealmBaseUrl(explicitBaseUrl: string | undefined): string {
  const normalizedExplicitBaseUrl = normalizeText(explicitBaseUrl);
  if (normalizedExplicitBaseUrl) {
    return normalizedExplicitBaseUrl;
  }

  const envBaseUrl = readProcessEnv('VITE_NIMI_REALM_BASE_URL') || readProcessEnv('NIMI_REALM_URL');
  if (envBaseUrl) {
    return envBaseUrl;
  }

  const locationOrigin = normalizeText((globalThis as { location?: { origin?: string } }).location?.origin);
  if (locationOrigin && /^https?:\/\//.test(locationOrigin)) {
    return locationOrigin;
  }

  return DEFAULT_REALM_BASE_URL;
}

function decodeBase64UrlUtf8(input: string): string {
  const normalized = normalizeText(input).replace(/-/g, '+').replace(/_/g, '/');
  if (!normalized) {
    return '';
  }
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${'='.repeat(paddingLength)}`;

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64').toString('utf8');
  }
  if (typeof atob === 'function') {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(bytes);
    }
    return String.fromCharCode(...bytes);
  }
  return '';
}

async function resolveToken(
  explicit: string | undefined,
  provider: (() => string | Promise<string>) | undefined,
  storeProvider: (() => string | Promise<string>) | undefined,
): Promise<string> {
  if (storeProvider) {
    const value = normalizeText(await storeProvider());
    if (value) return value;
  }
  if (provider) {
    const value = normalizeText(await provider());
    if (value) return value;
  }
  return normalizeText(explicit);
}

function decodeJwtSubject(accessToken: string): string {
  const normalizedToken = normalizeText(accessToken);
  if (!normalizedToken) {
    return '';
  }
  const rawToken = normalizedToken.toLowerCase().startsWith('bearer ')
    ? normalizeText(normalizedToken.slice(7))
    : normalizedToken;
  const parts = rawToken.split('.');
  if (parts.length < 2) {
    return '';
  }
  try {
    const payloadText = decodeBase64UrlUtf8(parts[1] || '');
    if (!payloadText) {
      return '';
    }
    return normalizeText(asRecord(JSON.parse(payloadText)).sub);
  } catch {
    return '';
  }
}

function createDisabledRuntime(appId: string): Runtime {
  const target = { appId } as Runtime;
  return new Proxy(target, {
    get(currentTarget, prop, receiver) {
      if (prop === 'appId') {
        return Reflect.get(currentTarget, prop, receiver);
      }
      if (prop === 'toString') {
        return () => '[DisabledRuntime]';
      }
      throw createNimiError({
        message: `runtime is disabled for platform client ${appId}`,
        reasonCode: ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
        actionHint: 'configure_runtime_transport',
        source: 'sdk',
      });
    },
  });
}

function createDomains(runtime: Runtime, realm: Realm): PlatformDomains {
  const toListConnectorsInput = (input?: Partial<ListConnectorsInput>): ListConnectorsInput => ({
    pageSize: Number(input?.pageSize || 0),
    pageToken: String(input?.pageToken || ''),
    kindFilter: Number(input?.kindFilter || 0),
    statusFilter: Number(input?.statusFilter || 0),
    providerFilter: String(input?.providerFilter || ''),
  });

  return {
    auth: {
      checkEmail: (input) => realm.services.AuthService.checkEmail(input),
      passwordLogin: (input) => realm.services.AuthService.passwordLogin({
        identifier: normalizeText(input.identifier || input.email),
        password: input.password,
      }),
      oauthLogin: (input) => realm.services.AuthService.oauthLogin(input),
      requestEmailOtp: (input) => realm.services.AuthService.requestEmailOtp(input),
      verifyEmailOtp: (input) => realm.services.AuthService.verifyEmailOtp(input),
      verifyTwoFactor: (input) => realm.services.AuthService.verifyTwoFactor(input),
      walletChallenge: (input) => realm.services.AuthService.walletChallenge(input),
      walletLogin: (input) => realm.services.AuthService.walletLogin(input),
      updatePassword: (input) => realm.services.AuthService.updatePassword(input),
      getCurrentUser: () => realm.services.MeService.getMe(),
    },
    social: {
      startChat: (input) => realm.services.HumanChatsService.startChat(input),
      listMessages: (chatId, limit) => realm.services.HumanChatsService.listMessages(chatId, limit),
      markChatRead: (chatId) => realm.services.HumanChatsService.markChatRead(chatId),
      sendMessage: (chatId, input) => realm.services.HumanChatsService.sendMessage(chatId, input),
      listFriends: (limit, cursor) => realm.services.MeService.listMyFriendsWithDetails(cursor, limit),
    },
    world: {
      getWorldTruth: (worldId) => realm.services.WorldsService.worldControllerGetWorld(worldId),
      getWorldviewTruth: (worldId) => realm.services.WorldsService.worldControllerGetWorldview(worldId),
      getWorld: (worldId) => realm.services.WorldsService.worldControllerGetWorld(worldId),
      getWorldview: (worldId) => realm.services.WorldsService.worldControllerGetWorldview(worldId),
      getWorldDetailWithAgents: (worldId, take = 4) => realm.services.WorldsService.worldControllerGetWorldDetailWithAgents(worldId, take),
      getWorldState: (worldId) => realm.services.WorldControlService.worldControlControllerGetState(worldId),
      commitWorldState: (worldId, input) => realm.services.WorldControlService.worldControlControllerCommitState(worldId, input),
      listWorldHistory: (worldId) => realm.services.WorldControlService.worldControlControllerListWorldHistory(worldId),
      appendWorldHistory: (worldId, input) => realm.services.WorldControlService.worldControlControllerAppendWorldHistory(worldId, input),
      listMyWorlds: () => realm.services.WorldControlService.worldControlControllerListMyWorlds(),
      listWorldLorebooks: (worldId) => realm.services.WorldsService.worldControllerGetWorldLorebooks(worldId),
      listWorldMediaBindings: (worldId) => realm.services.WorldsService.worldControllerGetWorldMediaBindings(worldId),
      getWorldHistory: (worldId) => realm.services.WorldsService.worldControllerGetWorldHistory(worldId),
      listWorldLevelAudits: (worldId, take) => realm.services.WorldsService.worldControllerGetWorldLevelAudits(worldId, take),
    },
    creator: {
      listAgents: () => realm.services.CreatorService.creatorControllerListAgents(),
      getAgent: (agentId) => realm.services.CreatorService.creatorControllerGetAgent(agentId),
      createAgent: (input) => realm.services.CreatorService.creatorControllerCreateAgent(input),
      updateAgent: (agentId, input) => realm.services.CreatorService.creatorControllerUpdateAgent(agentId, input),
      batchCreateAgents: (input) => realm.services.CreatorService.creatorControllerBatchCreateAgents(input),
    },
    media: {
      createImageDirectUpload: (input) => realm.services.MediaService.createImageDirectUpload(
        String(input?.requireSignedUrls ?? ''),
      ),
      createVideoDirectUpload: (input) => realm.services.MediaService.createVideoDirectUpload(
        String(input?.requireSignedUrls ?? ''),
      ),
      createAudioDirectUpload: (input = {}) => realm.services.MediaService.createAudioDirectUpload(input),
      finalizeAsset: (assetId, input = {}) => realm.services.MediaService.finalizeMediaAsset(assetId, input),
      getAsset: (assetId) => realm.services.MediaService.getMediaAsset(assetId),
      createPost: (input) => realm.services.PostService.createPost(input),
    },
    runtimeAdmin: {
      listProviderCatalog: (input = {}, options) => runtime.connector.listProviderCatalog(input, options),
      listConnectors: (input, options) => runtime.connector.listConnectors(toListConnectorsInput(input), options),
      createConnector: (input, options) => runtime.connector.createConnector(input, options),
      updateConnector: (input, options) => runtime.connector.updateConnector(input, options),
      deleteConnector: (input, options) => runtime.connector.deleteConnector(input, options),
      testConnector: (input, options) => runtime.connector.testConnector(input, options),
      listConnectorModels: (input, options) => runtime.connector.listConnectorModels(input, options),
      listModelCatalogProviders: (input = {}, options) => runtime.connector.listModelCatalogProviders(input, options),
      listCatalogProviderModels: (input, options) => runtime.connector.listCatalogProviderModels(input, options),
      getCatalogModelDetail: (input, options) => runtime.connector.getCatalogModelDetail(input, options),
      upsertModelCatalogProvider: (input, options) => runtime.connector.upsertModelCatalogProvider(input, options),
      deleteModelCatalogProvider: (input, options) => runtime.connector.deleteModelCatalogProvider(input, options),
      upsertCatalogModelOverlay: (input, options) => runtime.connector.upsertCatalogModelOverlay(input, options),
      deleteCatalogModelOverlay: (input, options) => runtime.connector.deleteCatalogModelOverlay(input, options),
      listAuditEvents: (input, options) => runtime.audit.listAuditEvents(input, options),
      exportAuditEvents: (input, options) => runtime.audit.exportAuditEvents(input, options),
      listUsageStats: (input, options) => runtime.audit.listUsageStats(input, options),
      getRuntimeHealth: (input = {}, options) => runtime.audit.getRuntimeHealth(input, options),
      listAIProviderHealth: (input = {}, options) => runtime.audit.listAIProviderHealth(input, options),
      healthEvents: (input = {}, options) => runtime.healthEvents(input, options),
      providerHealthEvents: (input = {}, options) => runtime.providerHealthEvents(input, options),
    },
    publicContent: {
      getPublicPost: (postId) => realm.services.PostService.getPublicPost(postId),
    },
  };
}

export async function createPlatformClient(input: PlatformClientInput): Promise<PlatformClient> {
  const appId = normalizeText(input.appId) || DEFAULT_PLATFORM_APP_ID;
  const tokenValue = normalizeText(input.accessToken);
  const sessionStore = input.sessionStore ?? null;
  const realmBaseUrl = resolvePlatformRealmBaseUrl(input.realmBaseUrl);

  const runtimeAccessTokenProvider = async () => resolveToken(
    tokenValue,
    input.accessTokenProvider,
    sessionStore?.getAccessToken,
  );

  const runtimeSubjectUserIdProvider = async () => {
    if (sessionStore?.getSubjectUserId) {
      const subjectUserId = normalizeText(await sessionStore.getSubjectUserId());
      if (subjectUserId) {
        return subjectUserId;
      }
    }
    if (input.subjectUserIdProvider) {
      const subjectUserId = normalizeText(await input.subjectUserIdProvider());
      if (subjectUserId) {
        return subjectUserId;
      }
    }
    return decodeJwtSubject(await runtimeAccessTokenProvider());
  };

  const runtime = input.runtimeTransport === null
    ? createDisabledRuntime(appId)
    : new Runtime({
        ...input.runtimeOptions,
        appId,
        transport: input.runtimeTransport || detectTauriTransport() || undefined,
        defaults: input.runtimeDefaults,
        auth: {
          accessToken: runtimeAccessTokenProvider,
        },
        subjectContext: {
          getSubjectUserId: runtimeSubjectUserIdProvider,
        },
      });

  let realm!: Realm;
  realm = new Realm({
    baseUrl: realmBaseUrl,
    auth: input.allowAnonymousRealm && !tokenValue && !input.accessTokenProvider && !sessionStore?.getAccessToken
      ? null
      : {
          accessToken: async () => resolveToken(
            tokenValue,
            input.accessTokenProvider,
            sessionStore?.getAccessToken,
          ),
          refreshToken: async () => resolveToken(
            '',
            input.refreshTokenProvider,
            sessionStore?.getRefreshToken,
          ),
          onTokenRefreshed: async (result: RealmTokenRefreshResult) => {
            if (!sessionStore?.setAuthSession) {
              return;
            }
            const user = sessionStore.getCurrentUser
              ? await sessionStore.getCurrentUser()
              : null;
            await sessionStore.setAuthSession(user ?? null, result.accessToken, result.refreshToken);
          },
          onRefreshFailed: async () => {
            realm.clearAuth();
            await sessionStore?.clearAuthSession?.();
          },
        },
    fetchImpl: input.realmFetchImpl,
  });

  const client: PlatformClient = {
    runtime,
    realm,
    domains: createDomains(runtime, realm),
  };
  currentPlatformClient = client;
  return client;
}

export function getPlatformClient(): PlatformClient {
  if (!currentPlatformClient) {
    throw createNimiError({
      message: 'platform client is not ready; call createPlatformClient() first',
      reasonCode: ReasonCode.SDK_PLATFORM_CLIENT_NOT_READY,
      actionHint: 'call_create_platform_client_first',
      source: 'sdk',
    });
  }
  return currentPlatformClient;
}

export function clearPlatformClient(): void {
  currentPlatformClient = null;
}
