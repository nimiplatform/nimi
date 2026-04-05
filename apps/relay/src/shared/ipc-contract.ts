import type {
  AgentGetResponse,
  AiGenerateResponse,
  AiStreamEvent,
  AiStreamOpenResponse,
  AuthCheckEmailInput,
  AuthCheckEmailResponse,
  AuthCurrentUserInput,
  AuthCurrentUserResponse,
  AuthOauthLoginResponse,
  AuthPasswordLoginInput,
  AuthPasswordLoginResponse,
  AuthRequestEmailOtpInput,
  AuthRequestEmailOtpResponse,
  AuthUpdatePasswordInput,
  AuthVerifyEmailOtpInput,
  AuthVerifyEmailOtpResponse,
  AuthVerifyTwoFactorInput,
  AuthVerifyTwoFactorResponse,
  AuthWalletChallengeInput,
  AuthWalletChallengeResponse,
  AuthWalletLoginInput,
  AuthWalletLoginResponse,
  ConnectorCatalogModelDetailInput,
  ConnectorCatalogModelDetailResponse,
  ConnectorCatalogProviderModelsInput,
  ConnectorCatalogProviderModelsResponse,
  ConnectorCatalogProvidersInput,
  ConnectorCatalogProvidersResponse,
  ConnectorCreateInput,
  ConnectorCreateResponse,
  ConnectorDeleteCatalogOverlayInput,
  ConnectorDeleteCatalogOverlayResponse,
  ConnectorDeleteCatalogProviderInput,
  ConnectorDeleteCatalogProviderResponse,
  ConnectorDeleteInput,
  ConnectorDeleteResponse,
  ConnectorGetInput,
  ConnectorGetResponse,
  ConnectorListInput,
  ConnectorListModelsInput,
  ConnectorListModelsResponse,
  ConnectorListResponse,
  ConnectorProviderCatalogInput,
  ConnectorProviderCatalogResponse,
  ConnectorTestInput,
  ConnectorTestResponse,
  ConnectorUpdateInput,
  ConnectorUpdateResponse,
  ConnectorUpsertCatalogOverlayInput,
  ConnectorUpsertCatalogOverlayResponse,
  ConnectorUpsertCatalogProviderInput,
  ConnectorUpsertCatalogProviderResponse,
  HealthResponse,
  IpcAiGenerateInput,
  IpcAiStreamInput,
  LocalChatPromptTrace,
  LocalChatSession,
  LocalChatSettings,
  LocalChatTurnAudit,
  LocalChatTurnSendPhase,
  LocalCheckHealthInput,
  LocalCheckHealthResponse,
  LocalCollectDeviceProfileInput,
  LocalCollectDeviceProfileResponse,
  LocalImportAssetInput,
  LocalImportAssetResponse,
  LocalInstallVerifiedAssetInput,
  LocalInstallVerifiedAssetResponse,
  LocalListAssetsInput,
  LocalListAssetsResponse,
  LocalListNodeCatalogInput,
  LocalListNodeCatalogResponse,
  LocalListVerifiedAssetsInput,
  LocalListVerifiedAssetsResponse,
  LocalRemoveAssetInput,
  LocalRemoveAssetResponse,
  LocalResolveInstallPlanInput,
  LocalResolveInstallPlanResponse,
  LocalResolveProfileInput,
  LocalResolveProfileResponse,
  LocalSearchCatalogInput,
  LocalSearchCatalogResponse,
  LocalStartAssetInput,
  LocalStartAssetResponse,
  LocalStopAssetInput,
  LocalStopAssetResponse,
  LocalWarmAssetInput,
  LocalWarmAssetResponse,
  ModelHealthInput,
  ModelHealthResponse,
  ModelListInput,
  ModelListResponse,
  ModelPullInput,
  ModelPullResponse,
  ModelRemoveInput,
  ModelRemoveResponse,
  RelayAgentListResponse,
  RelayAgentListItem,
  RelayAuthOauthLoginInput,
  RelayAuthStatus,
  RelayChatMessage,
  RelayChatSettingsPatch,
  RelayDesktopOpenConfigResponse,
  RelayMediaRouteOptionsRequest,
  RelayMediaRouteOptionsResponse,
  RelayOAuthListenForCodeResponse,
  RelayOauthTokenExchangeRequest,
  RelayOauthTokenExchangeResponse,
  RelayRealtimeMessage,
  RelayRealtimePresence,
  RelayRouteBinding,
  RelayRouteOptions,
  RelaySttTranscribeRequest,
  RelayStatusBanner,
  RelayStreamChunk,
  RelayStreamEnd,
  RelayStreamError,
  RelayTtsSynthesizeRequest,
  RelayTtsSynthesizeResponse,
  RelayVideoGenerateRequest,
  ResolvedRelayRoute,
  SttTranscribeResponse,
  TtsListVoicesInput,
  TtsListVoicesResponse,
  ImageGenerateInput,
  ImageGenerateResponse,
  VideoGenerateResponse,
  VideoJobArtifactsResponse,
  VideoJobEvent,
  VideoJobGetResponse,
} from './ipc-contract-types.js';

export type RelayInvokeMap = {
  'relay:config': {
    request: undefined;
    response: { agentId: string | null; worldId: string | null };
  };
  'relay:health': {
    request: undefined;
    response: HealthResponse;
  };
  'relay:ai:generate': {
    request: IpcAiGenerateInput;
    response: AiGenerateResponse;
  };
  'relay:ai:stream:open': {
    request: IpcAiStreamInput;
    response: AiStreamOpenResponse;
  };
  'relay:ai:stream:cancel': {
    request: { streamId: string };
    response: void;
  };
  'relay:media:tts:synthesize': {
    request: RelayTtsSynthesizeRequest;
    response: RelayTtsSynthesizeResponse;
  };
  'relay:media:tts:voices': {
    request: TtsListVoicesInput;
    response: TtsListVoicesResponse;
  };
  'relay:media:stt:transcribe': {
    request: RelaySttTranscribeRequest;
    response: SttTranscribeResponse;
  };
  'relay:media:image:generate': {
    request: ImageGenerateInput;
    response: ImageGenerateResponse;
  };
  'relay:media:video:generate': {
    request: RelayVideoGenerateRequest;
    response: VideoGenerateResponse;
  };
  'relay:media:video:job:subscribe': {
    request: { jobId: string };
    response: { streamId: string };
  };
  'relay:media:video:job:get': {
    request: { jobId: string };
    response: VideoJobGetResponse;
  };
  'relay:media:video:job:artifacts': {
    request: { jobId: string };
    response: VideoJobArtifactsResponse;
  };
  'relay:media:video:job:cancel': {
    request: { streamId: string };
    response: void;
  };
  'relay:agent:list': {
    request: undefined;
    response: RelayAgentListResponse;
  };
  'relay:agent:get': {
    request: { agentId: string };
    response: AgentGetResponse;
  };
  'relay:realtime:subscribe': {
    request: string;
    response: void;
  };
  'relay:realtime:unsubscribe': {
    request: string;
    response: void;
  };
  'relay:auth:status': {
    request: undefined;
    response: RelayAuthStatus;
  };
  'relay:auth:apply-token': {
    request: { accessToken: string };
    response: { success: boolean; error?: string };
  };
  'relay:auth:check-email': {
    request: AuthCheckEmailInput;
    response: AuthCheckEmailResponse;
  };
  'relay:auth:password-login': {
    request: AuthPasswordLoginInput;
    response: AuthPasswordLoginResponse;
  };
  'relay:auth:oauth-login': {
    request: RelayAuthOauthLoginInput;
    response: AuthOauthLoginResponse;
  };
  'relay:auth:email-otp-request': {
    request: AuthRequestEmailOtpInput;
    response: AuthRequestEmailOtpResponse;
  };
  'relay:auth:email-otp-verify': {
    request: AuthVerifyEmailOtpInput;
    response: AuthVerifyEmailOtpResponse;
  };
  'relay:auth:2fa-verify': {
    request: AuthVerifyTwoFactorInput;
    response: AuthVerifyTwoFactorResponse;
  };
  'relay:auth:wallet-challenge': {
    request: AuthWalletChallengeInput;
    response: AuthWalletChallengeResponse;
  };
  'relay:auth:wallet-login': {
    request: AuthWalletLoginInput;
    response: AuthWalletLoginResponse;
  };
  'relay:auth:update-password': {
    request: AuthUpdatePasswordInput;
    response: { success: boolean };
  };
  'relay:auth:current-user': {
    request: AuthCurrentUserInput | undefined;
    response: AuthCurrentUserResponse;
  };
  'relay:auth:logout': {
    request: undefined;
    response: void;
  };
  'relay:oauth:listen-for-code': {
    request: { redirectUri: string; timeoutMs?: number };
    response: RelayOAuthListenForCodeResponse;
  };
  'relay:oauth:open-external-url': {
    request: { url: string };
    response: { opened: boolean };
  };
  'relay:oauth:focus-main-window': {
    request: undefined;
    response: void;
  };
  'relay:oauth:token-exchange': {
    request: RelayOauthTokenExchangeRequest;
    response: RelayOauthTokenExchangeResponse;
  };
  'relay:model:list': {
    request: ModelListInput | undefined;
    response: ModelListResponse;
  };
  'relay:model:pull': {
    request: ModelPullInput;
    response: ModelPullResponse;
  };
  'relay:model:remove': {
    request: ModelRemoveInput;
    response: ModelRemoveResponse;
  };
  'relay:model:health': {
    request: ModelHealthInput;
    response: ModelHealthResponse;
  };
  'relay:local:assets:list': {
    request: LocalListAssetsInput | undefined;
    response: LocalListAssetsResponse;
  };
  'relay:local:assets:verified': {
    request: LocalListVerifiedAssetsInput | undefined;
    response: LocalListVerifiedAssetsResponse;
  };
  'relay:local:assets:catalog-search': {
    request: LocalSearchCatalogInput;
    response: LocalSearchCatalogResponse;
  };
  'relay:local:assets:install-plan': {
    request: LocalResolveInstallPlanInput;
    response: LocalResolveInstallPlanResponse;
  };
  'relay:local:assets:install': {
    request: LocalInstallVerifiedAssetInput;
    response: LocalInstallVerifiedAssetResponse;
  };
  'relay:local:assets:install-verified': {
    request: LocalInstallVerifiedAssetInput;
    response: LocalInstallVerifiedAssetResponse;
  };
  'relay:local:assets:import': {
    request: LocalImportAssetInput;
    response: LocalImportAssetResponse;
  };
  'relay:local:assets:remove': {
    request: LocalRemoveAssetInput;
    response: LocalRemoveAssetResponse;
  };
  'relay:local:assets:start': {
    request: LocalStartAssetInput;
    response: LocalStartAssetResponse;
  };
  'relay:local:assets:stop': {
    request: LocalStopAssetInput;
    response: LocalStopAssetResponse;
  };
  'relay:local:assets:health': {
    request: LocalCheckHealthInput;
    response: LocalCheckHealthResponse;
  };
  'relay:local:assets:warm': {
    request: LocalWarmAssetInput;
    response: LocalWarmAssetResponse;
  };
  'relay:local:device-profile': {
    request: LocalCollectDeviceProfileInput | undefined;
    response: LocalCollectDeviceProfileResponse;
  };
  'relay:local:profile:resolve': {
    request: LocalResolveProfileInput;
    response: LocalResolveProfileResponse;
  };
  'relay:local:catalog:nodes': {
    request: LocalListNodeCatalogInput | undefined;
    response: LocalListNodeCatalogResponse;
  };
  'relay:connector:create': {
    request: ConnectorCreateInput;
    response: ConnectorCreateResponse;
  };
  'relay:connector:get': {
    request: ConnectorGetInput;
    response: ConnectorGetResponse;
  };
  'relay:connector:list': {
    request: ConnectorListInput | undefined;
    response: ConnectorListResponse;
  };
  'relay:connector:update': {
    request: ConnectorUpdateInput;
    response: ConnectorUpdateResponse;
  };
  'relay:connector:delete': {
    request: ConnectorDeleteInput;
    response: ConnectorDeleteResponse;
  };
  'relay:connector:test': {
    request: ConnectorTestInput;
    response: ConnectorTestResponse;
  };
  'relay:connector:models': {
    request: ConnectorListModelsInput;
    response: ConnectorListModelsResponse;
  };
  'relay:connector:provider-catalog': {
    request: ConnectorProviderCatalogInput | undefined;
    response: ConnectorProviderCatalogResponse;
  };
  'relay:connector:catalog-providers': {
    request: ConnectorCatalogProvidersInput | undefined;
    response: ConnectorCatalogProvidersResponse;
  };
  'relay:connector:catalog-provider-models': {
    request: ConnectorCatalogProviderModelsInput;
    response: ConnectorCatalogProviderModelsResponse;
  };
  'relay:connector:catalog-model-detail': {
    request: ConnectorCatalogModelDetailInput;
    response: ConnectorCatalogModelDetailResponse;
  };
  'relay:connector:catalog-provider:upsert': {
    request: ConnectorUpsertCatalogProviderInput;
    response: ConnectorUpsertCatalogProviderResponse;
  };
  'relay:connector:catalog-provider:delete': {
    request: ConnectorDeleteCatalogProviderInput;
    response: ConnectorDeleteCatalogProviderResponse;
  };
  'relay:connector:catalog-overlay:upsert': {
    request: ConnectorUpsertCatalogOverlayInput;
    response: ConnectorUpsertCatalogOverlayResponse;
  };
  'relay:connector:catalog-overlay:delete': {
    request: ConnectorDeleteCatalogOverlayInput;
    response: ConnectorDeleteCatalogOverlayResponse;
  };
  'relay:route:options': {
    request: undefined;
    response: RelayRouteOptions;
  };
  'relay:route:binding:get': {
    request: undefined;
    response: RelayRouteBinding | null;
  };
  'relay:route:binding:set': {
    request: RelayRouteBinding;
    response: ResolvedRelayRoute | null;
  };
  'relay:route:snapshot': {
    request: undefined;
    response: ResolvedRelayRoute | null;
  };
  'relay:route:refresh': {
    request: undefined;
    response: RelayRouteOptions;
  };
  'relay:media-route:options': {
    request: RelayMediaRouteOptionsRequest;
    response: RelayMediaRouteOptionsResponse;
  };
  'relay:desktop:open-config': {
    request: { pageId?: string } | undefined;
    response: RelayDesktopOpenConfigResponse;
  };
  'relay:chat:send': {
    request: { agentId: string; text: string; sessionId?: string };
    response: void;
  };
  'relay:chat:cancel': {
    request: { turnTxnId: string };
    response: void;
  };
  'relay:chat:history': {
    request: { agentId: string };
    response: RelayChatMessage[];
  };
  'relay:chat:clear': {
    request: { agentId: string; sessionId: string };
    response: void;
  };
  'relay:chat:settings:get': {
    request: undefined;
    response: LocalChatSettings | null;
  };
  'relay:chat:settings:set': {
    request: RelayChatSettingsPatch;
    response: void;
  };
  'relay:chat:proactive:toggle': {
    request: { enabled: boolean };
    response: void;
  };

  // ── Direct Chat (agent-less LLM chat) ────────────────────────────
  'relay:direct-chat:send': {
    request: { text: string; sessionId?: string };
    response: void;
  };
  'relay:direct-chat:cancel': {
    request: { turnTxnId: string };
    response: void;
  };
  'relay:direct-chat:history': {
    request: undefined;
    response: RelayChatMessage[];
  };
  'relay:direct-chat:clear': {
    request: { sessionId?: string } | undefined;
    response: void;
  };
};

export type RelayEventMap = {
  'relay:realtime:message': RelayRealtimeMessage;
  'relay:realtime:presence': RelayRealtimePresence;
  'relay:realtime:status': { connected: boolean };
  'relay:stream:chunk': RelayStreamChunk;
  'relay:stream:end': RelayStreamEnd;
  'relay:stream:error': RelayStreamError;
  'relay:auth:status': RelayAuthStatus;
  'relay:chat:turn:phase': { turnId?: string; turnTxnId?: string; phase: LocalChatTurnSendPhase };
  'relay:chat:beat': { turnId: string; beat: VideoJobEvent | AiStreamEvent };
  'relay:chat:turn:done': { turnId: string; diagnostics?: LocalChatTurnAudit | null };
  'relay:chat:turn:error': { turnId: string; error: RelayStreamError['error'] };
  'relay:chat:messages': RelayChatMessage[];
  'relay:chat:sessions': LocalChatSession[];
  'relay:chat:input-text': string;
  'relay:chat:selected-session': string;
  'relay:chat:status-banner': RelayStatusBanner;
  'relay:chat:prompt-trace': LocalChatPromptTrace | null;
  'relay:chat:turn-audit': LocalChatTurnAudit | null;
};

export type RelayInvokeChannel = keyof RelayInvokeMap;
export type RelayEventChannel = keyof RelayEventMap;

type MaybeOptionalArg<T> = [T] extends [undefined]
  ? []
  : undefined extends T
    ? [input?: T]
    : [input: T];

export type RelayInvokeArgs<K extends RelayInvokeChannel> = MaybeOptionalArg<RelayInvokeMap[K]['request']>;
export type RelayInvokeResponse<K extends RelayInvokeChannel> = RelayInvokeMap[K]['response'];
export type RelayEventPayload<K extends RelayEventChannel> = RelayEventMap[K];
export type { RelayAgentListItem };

export interface NimiRelayBridge {
  config: (...args: RelayInvokeArgs<'relay:config'>) => Promise<RelayInvokeResponse<'relay:config'>>;
  health: (...args: RelayInvokeArgs<'relay:health'>) => Promise<RelayInvokeResponse<'relay:health'>>;
  ai: {
    generate: (...args: RelayInvokeArgs<'relay:ai:generate'>) => Promise<RelayInvokeResponse<'relay:ai:generate'>>;
    streamOpen: (...args: RelayInvokeArgs<'relay:ai:stream:open'>) => Promise<RelayInvokeResponse<'relay:ai:stream:open'>>;
    streamCancel: (streamId: string) => Promise<RelayInvokeResponse<'relay:ai:stream:cancel'>>;
  };
  media: {
    tts: {
      synthesize: (...args: RelayInvokeArgs<'relay:media:tts:synthesize'>) => Promise<RelayInvokeResponse<'relay:media:tts:synthesize'>>;
      listVoices: (...args: RelayInvokeArgs<'relay:media:tts:voices'>) => Promise<RelayInvokeResponse<'relay:media:tts:voices'>>;
    };
    stt: {
      transcribe: (...args: RelayInvokeArgs<'relay:media:stt:transcribe'>) => Promise<RelayInvokeResponse<'relay:media:stt:transcribe'>>;
    };
    image: {
      generate: (...args: RelayInvokeArgs<'relay:media:image:generate'>) => Promise<RelayInvokeResponse<'relay:media:image:generate'>>;
    };
    video: {
      generate: (...args: RelayInvokeArgs<'relay:media:video:generate'>) => Promise<RelayInvokeResponse<'relay:media:video:generate'>>;
      job: {
        subscribe: (jobId: string) => Promise<RelayInvokeResponse<'relay:media:video:job:subscribe'>>;
        get: (jobId: string) => Promise<RelayInvokeResponse<'relay:media:video:job:get'>>;
        artifacts: (jobId: string) => Promise<RelayInvokeResponse<'relay:media:video:job:artifacts'>>;
        cancel: (streamId: string) => Promise<RelayInvokeResponse<'relay:media:video:job:cancel'>>;
      };
    };
  };
  agent: {
    list: (...args: RelayInvokeArgs<'relay:agent:list'>) => Promise<RelayInvokeResponse<'relay:agent:list'>>;
    get: (agentId: string) => Promise<RelayInvokeResponse<'relay:agent:get'>>;
  };
  realtime: {
    subscribe: (...args: RelayInvokeArgs<'relay:realtime:subscribe'>) => Promise<RelayInvokeResponse<'relay:realtime:subscribe'>>;
    unsubscribe: (...args: RelayInvokeArgs<'relay:realtime:unsubscribe'>) => Promise<RelayInvokeResponse<'relay:realtime:unsubscribe'>>;
    onMessage: (callback: (data: RelayEventPayload<'relay:realtime:message'>) => void) => string;
    onPresence: (callback: (data: RelayEventPayload<'relay:realtime:presence'>) => void) => string;
    onStatus: (callback: (data: RelayEventPayload<'relay:realtime:status'>) => void) => string;
    removeListener: (id: string) => void;
  };
  stream: {
    onChunk: (callback: (payload: RelayEventPayload<'relay:stream:chunk'>) => void) => string;
    onEnd: (callback: (payload: RelayEventPayload<'relay:stream:end'>) => void) => string;
    onError: (callback: (payload: RelayEventPayload<'relay:stream:error'>) => void) => string;
    removeListener: (id: string) => void;
  };
  auth: {
    getStatus: (...args: RelayInvokeArgs<'relay:auth:status'>) => Promise<RelayInvokeResponse<'relay:auth:status'>>;
    applyToken: (...args: RelayInvokeArgs<'relay:auth:apply-token'>) => Promise<RelayInvokeResponse<'relay:auth:apply-token'>>;
    checkEmail: (...args: RelayInvokeArgs<'relay:auth:check-email'>) => Promise<RelayInvokeResponse<'relay:auth:check-email'>>;
    passwordLogin: (...args: RelayInvokeArgs<'relay:auth:password-login'>) => Promise<RelayInvokeResponse<'relay:auth:password-login'>>;
    oauthLogin: (...args: RelayInvokeArgs<'relay:auth:oauth-login'>) => Promise<RelayInvokeResponse<'relay:auth:oauth-login'>>;
    requestEmailOtp: (...args: RelayInvokeArgs<'relay:auth:email-otp-request'>) => Promise<RelayInvokeResponse<'relay:auth:email-otp-request'>>;
    verifyEmailOtp: (...args: RelayInvokeArgs<'relay:auth:email-otp-verify'>) => Promise<RelayInvokeResponse<'relay:auth:email-otp-verify'>>;
    verifyTwoFactor: (...args: RelayInvokeArgs<'relay:auth:2fa-verify'>) => Promise<RelayInvokeResponse<'relay:auth:2fa-verify'>>;
    walletChallenge: (...args: RelayInvokeArgs<'relay:auth:wallet-challenge'>) => Promise<RelayInvokeResponse<'relay:auth:wallet-challenge'>>;
    walletLogin: (...args: RelayInvokeArgs<'relay:auth:wallet-login'>) => Promise<RelayInvokeResponse<'relay:auth:wallet-login'>>;
    updatePassword: (...args: RelayInvokeArgs<'relay:auth:update-password'>) => Promise<RelayInvokeResponse<'relay:auth:update-password'>>;
    currentUser: (...args: RelayInvokeArgs<'relay:auth:current-user'>) => Promise<RelayInvokeResponse<'relay:auth:current-user'>>;
    logout: (...args: RelayInvokeArgs<'relay:auth:logout'>) => Promise<RelayInvokeResponse<'relay:auth:logout'>>;
    onStatus: (callback: (payload: RelayEventPayload<'relay:auth:status'>) => void) => string;
    removeListener: (id: string) => void;
  };
  oauth: {
    listenForCode: (...args: RelayInvokeArgs<'relay:oauth:listen-for-code'>) => Promise<RelayInvokeResponse<'relay:oauth:listen-for-code'>>;
    openExternalUrl: (url: string) => Promise<RelayInvokeResponse<'relay:oauth:open-external-url'>>;
    focusMainWindow: (...args: RelayInvokeArgs<'relay:oauth:focus-main-window'>) => Promise<RelayInvokeResponse<'relay:oauth:focus-main-window'>>;
    tokenExchange: (...args: RelayInvokeArgs<'relay:oauth:token-exchange'>) => Promise<RelayInvokeResponse<'relay:oauth:token-exchange'>>;
  };
  model: {
    list: (...args: RelayInvokeArgs<'relay:model:list'>) => Promise<RelayInvokeResponse<'relay:model:list'>>;
    pull: (...args: RelayInvokeArgs<'relay:model:pull'>) => Promise<RelayInvokeResponse<'relay:model:pull'>>;
    remove: (...args: RelayInvokeArgs<'relay:model:remove'>) => Promise<RelayInvokeResponse<'relay:model:remove'>>;
    checkHealth: (...args: RelayInvokeArgs<'relay:model:health'>) => Promise<RelayInvokeResponse<'relay:model:health'>>;
  };
  local: {
    listAssets: (...args: RelayInvokeArgs<'relay:local:assets:list'>) => Promise<RelayInvokeResponse<'relay:local:assets:list'>>;
    listVerifiedAssets: (...args: RelayInvokeArgs<'relay:local:assets:verified'>) => Promise<RelayInvokeResponse<'relay:local:assets:verified'>>;
    searchAssetCatalog: (...args: RelayInvokeArgs<'relay:local:assets:catalog-search'>) => Promise<RelayInvokeResponse<'relay:local:assets:catalog-search'>>;
    resolveAssetInstallPlan: (...args: RelayInvokeArgs<'relay:local:assets:install-plan'>) => Promise<RelayInvokeResponse<'relay:local:assets:install-plan'>>;
    installAsset: (...args: RelayInvokeArgs<'relay:local:assets:install'>) => Promise<RelayInvokeResponse<'relay:local:assets:install'>>;
    installVerifiedAsset: (...args: RelayInvokeArgs<'relay:local:assets:install-verified'>) => Promise<RelayInvokeResponse<'relay:local:assets:install-verified'>>;
    importAsset: (...args: RelayInvokeArgs<'relay:local:assets:import'>) => Promise<RelayInvokeResponse<'relay:local:assets:import'>>;
    removeAsset: (...args: RelayInvokeArgs<'relay:local:assets:remove'>) => Promise<RelayInvokeResponse<'relay:local:assets:remove'>>;
    startAsset: (...args: RelayInvokeArgs<'relay:local:assets:start'>) => Promise<RelayInvokeResponse<'relay:local:assets:start'>>;
    stopAsset: (...args: RelayInvokeArgs<'relay:local:assets:stop'>) => Promise<RelayInvokeResponse<'relay:local:assets:stop'>>;
    checkAssetHealth: (...args: RelayInvokeArgs<'relay:local:assets:health'>) => Promise<RelayInvokeResponse<'relay:local:assets:health'>>;
    warmAsset: (...args: RelayInvokeArgs<'relay:local:assets:warm'>) => Promise<RelayInvokeResponse<'relay:local:assets:warm'>>;
    collectDeviceProfile: (...args: RelayInvokeArgs<'relay:local:device-profile'>) => Promise<RelayInvokeResponse<'relay:local:device-profile'>>;
    resolveProfile: (...args: RelayInvokeArgs<'relay:local:profile:resolve'>) => Promise<RelayInvokeResponse<'relay:local:profile:resolve'>>;
    listNodeCatalog: (...args: RelayInvokeArgs<'relay:local:catalog:nodes'>) => Promise<RelayInvokeResponse<'relay:local:catalog:nodes'>>;
  };
  connector: {
    create: (...args: RelayInvokeArgs<'relay:connector:create'>) => Promise<RelayInvokeResponse<'relay:connector:create'>>;
    get: (...args: RelayInvokeArgs<'relay:connector:get'>) => Promise<RelayInvokeResponse<'relay:connector:get'>>;
    list: (...args: RelayInvokeArgs<'relay:connector:list'>) => Promise<RelayInvokeResponse<'relay:connector:list'>>;
    update: (...args: RelayInvokeArgs<'relay:connector:update'>) => Promise<RelayInvokeResponse<'relay:connector:update'>>;
    delete: (...args: RelayInvokeArgs<'relay:connector:delete'>) => Promise<RelayInvokeResponse<'relay:connector:delete'>>;
    test: (...args: RelayInvokeArgs<'relay:connector:test'>) => Promise<RelayInvokeResponse<'relay:connector:test'>>;
    listModels: (...args: RelayInvokeArgs<'relay:connector:models'>) => Promise<RelayInvokeResponse<'relay:connector:models'>>;
    listProviderCatalog: (...args: RelayInvokeArgs<'relay:connector:provider-catalog'>) => Promise<RelayInvokeResponse<'relay:connector:provider-catalog'>>;
    listCatalogProviders: (...args: RelayInvokeArgs<'relay:connector:catalog-providers'>) => Promise<RelayInvokeResponse<'relay:connector:catalog-providers'>>;
    listCatalogProviderModels: (...args: RelayInvokeArgs<'relay:connector:catalog-provider-models'>) => Promise<RelayInvokeResponse<'relay:connector:catalog-provider-models'>>;
    getCatalogModelDetail: (...args: RelayInvokeArgs<'relay:connector:catalog-model-detail'>) => Promise<RelayInvokeResponse<'relay:connector:catalog-model-detail'>>;
    upsertCatalogProvider: (...args: RelayInvokeArgs<'relay:connector:catalog-provider:upsert'>) => Promise<RelayInvokeResponse<'relay:connector:catalog-provider:upsert'>>;
    deleteCatalogProvider: (...args: RelayInvokeArgs<'relay:connector:catalog-provider:delete'>) => Promise<RelayInvokeResponse<'relay:connector:catalog-provider:delete'>>;
    upsertCatalogOverlay: (...args: RelayInvokeArgs<'relay:connector:catalog-overlay:upsert'>) => Promise<RelayInvokeResponse<'relay:connector:catalog-overlay:upsert'>>;
    deleteCatalogOverlay: (...args: RelayInvokeArgs<'relay:connector:catalog-overlay:delete'>) => Promise<RelayInvokeResponse<'relay:connector:catalog-overlay:delete'>>;
  };
  route: {
    getOptions: (...args: RelayInvokeArgs<'relay:route:options'>) => Promise<RelayInvokeResponse<'relay:route:options'>>;
    getBinding: (...args: RelayInvokeArgs<'relay:route:binding:get'>) => Promise<RelayInvokeResponse<'relay:route:binding:get'>>;
    setBinding: (...args: RelayInvokeArgs<'relay:route:binding:set'>) => Promise<RelayInvokeResponse<'relay:route:binding:set'>>;
    getSnapshot: (...args: RelayInvokeArgs<'relay:route:snapshot'>) => Promise<RelayInvokeResponse<'relay:route:snapshot'>>;
    refresh: (...args: RelayInvokeArgs<'relay:route:refresh'>) => Promise<RelayInvokeResponse<'relay:route:refresh'>>;
  };
  mediaRoute: {
    getOptions: (...args: RelayInvokeArgs<'relay:media-route:options'>) => Promise<RelayInvokeResponse<'relay:media-route:options'>>;
  };
  desktop: {
    openConfig: (pageId?: string) => Promise<RelayInvokeResponse<'relay:desktop:open-config'>>;
  };
  directChat: {
    send: (...args: RelayInvokeArgs<'relay:direct-chat:send'>) => Promise<RelayInvokeResponse<'relay:direct-chat:send'>>;
    cancel: (...args: RelayInvokeArgs<'relay:direct-chat:cancel'>) => Promise<RelayInvokeResponse<'relay:direct-chat:cancel'>>;
    history: (...args: RelayInvokeArgs<'relay:direct-chat:history'>) => Promise<RelayInvokeResponse<'relay:direct-chat:history'>>;
    clear: (...args: RelayInvokeArgs<'relay:direct-chat:clear'>) => Promise<RelayInvokeResponse<'relay:direct-chat:clear'>>;
  };
  chat: {
    send: (...args: RelayInvokeArgs<'relay:chat:send'>) => Promise<RelayInvokeResponse<'relay:chat:send'>>;
    cancel: (...args: RelayInvokeArgs<'relay:chat:cancel'>) => Promise<RelayInvokeResponse<'relay:chat:cancel'>>;
    history: (...args: RelayInvokeArgs<'relay:chat:history'>) => Promise<RelayInvokeResponse<'relay:chat:history'>>;
    clear: (...args: RelayInvokeArgs<'relay:chat:clear'>) => Promise<RelayInvokeResponse<'relay:chat:clear'>>;
    settings: {
      get: (...args: RelayInvokeArgs<'relay:chat:settings:get'>) => Promise<RelayInvokeResponse<'relay:chat:settings:get'>>;
      set: (...args: RelayInvokeArgs<'relay:chat:settings:set'>) => Promise<RelayInvokeResponse<'relay:chat:settings:set'>>;
    };
    proactive: {
      toggle: (enabled: boolean) => Promise<RelayInvokeResponse<'relay:chat:proactive:toggle'>>;
    };
    onTurnPhase: (callback: (payload: RelayEventPayload<'relay:chat:turn:phase'>) => void) => string;
    onBeat: (callback: (payload: RelayEventPayload<'relay:chat:beat'>) => void) => string;
    onTurnDone: (callback: (payload: RelayEventPayload<'relay:chat:turn:done'>) => void) => string;
    onTurnError: (callback: (payload: RelayEventPayload<'relay:chat:turn:error'>) => void) => string;
    onMessages: (callback: (messages: RelayEventPayload<'relay:chat:messages'>) => void) => string;
    onSessions: (callback: (sessions: RelayEventPayload<'relay:chat:sessions'>) => void) => string;
    onStatusBanner: (callback: (banner: RelayEventPayload<'relay:chat:status-banner'>) => void) => string;
    onPromptTrace: (callback: (trace: RelayEventPayload<'relay:chat:prompt-trace'>) => void) => string;
    onTurnAudit: (callback: (audit: RelayEventPayload<'relay:chat:turn-audit'>) => void) => string;
    removeListener: (id: string) => void;
  };
}
