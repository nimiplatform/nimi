import type { Runtime } from '@nimiplatform/sdk/runtime';
import type {
  Realm,
  RealmServiceArgs,
  RealmServiceResult,
} from '@nimiplatform/sdk/realm';
import type { IpcAiGenerateInput, IpcAiStreamInput } from '../main/input-transform.js';
import type {
  ChatMessage as MainChatMessage,
  LocalChatPromptTrace,
  LocalChatSession,
  LocalChatTurnAudit,
  LocalChatTurnSendPhase,
} from '../main/chat-pipeline/types.js';
import type {
  RelayRouteBinding,
  RelayRouteOptions,
  ResolvedRelayRoute,
} from '../main/route/types.js';
import type { LocalChatSettings } from '../main/settings/types.js';
import type { AuthState } from '../renderer/app-shell/providers/app-store.js';
import type { performOauthTokenExchange } from '../main/auth/index.js';

type RuntimeMethodInput<T extends (...args: any[]) => any> =
  Parameters<T> extends [] ? undefined : Parameters<T>[0];
type RuntimeMethodOutput<T extends (...args: any[]) => any> = Awaited<ReturnType<T>>;
type AsyncIterableItem<T> = T extends AsyncIterable<infer Item> ? Item : never;

type HealthResponse = RuntimeMethodOutput<Runtime['health']>;
type AiGenerateResponse = RuntimeMethodOutput<Runtime['ai']['text']['generate']>;
type AiStreamOpenResponse = { streamId: string };
type AiStreamEvent = AsyncIterableItem<Awaited<ReturnType<Runtime['ai']['text']['stream']>>['stream']>;

type TtsSynthesizeInput = RuntimeMethodInput<Runtime['media']['tts']['synthesize']>;
type TtsSynthesizeResponse = RuntimeMethodOutput<Runtime['media']['tts']['synthesize']>;
type TtsListVoicesInput = RuntimeMethodInput<Runtime['media']['tts']['listVoices']>;
type TtsListVoicesResponse = RuntimeMethodOutput<Runtime['media']['tts']['listVoices']>;
type SttTranscribeInput = RuntimeMethodInput<Runtime['media']['stt']['transcribe']>;
type SttTranscribeResponse = RuntimeMethodOutput<Runtime['media']['stt']['transcribe']>;
type ImageGenerateInput = RuntimeMethodInput<Runtime['media']['image']['generate']>;
type ImageGenerateResponse = RuntimeMethodOutput<Runtime['media']['image']['generate']>;
type VideoGenerateInput = RuntimeMethodInput<Runtime['media']['video']['generate']>;
type VideoGenerateResponse = RuntimeMethodOutput<Runtime['media']['video']['generate']>;
type VideoJobGetResponse = RuntimeMethodOutput<Runtime['media']['jobs']['get']>;
type VideoJobArtifactsResponse = RuntimeMethodOutput<Runtime['media']['jobs']['getArtifacts']>;
type VideoJobEvent = AsyncIterableItem<RuntimeMethodOutput<Runtime['media']['jobs']['subscribe']>>;

type ModelListInput = RuntimeMethodInput<Runtime['model']['list']>;
type ModelListResponse = RuntimeMethodOutput<Runtime['model']['list']>;
type ModelPullInput = RuntimeMethodInput<Runtime['model']['pull']>;
type ModelPullResponse = RuntimeMethodOutput<Runtime['model']['pull']>;
type ModelRemoveInput = RuntimeMethodInput<Runtime['model']['remove']>;
type ModelRemoveResponse = RuntimeMethodOutput<Runtime['model']['remove']>;
type ModelHealthInput = RuntimeMethodInput<Runtime['model']['checkHealth']>;
type ModelHealthResponse = RuntimeMethodOutput<Runtime['model']['checkHealth']>;

type LocalListModelsInput = RuntimeMethodInput<Runtime['local']['listLocalModels']>;
type LocalListModelsResponse = RuntimeMethodOutput<Runtime['local']['listLocalModels']>;
type LocalListVerifiedModelsInput = RuntimeMethodInput<Runtime['local']['listVerifiedModels']>;
type LocalListVerifiedModelsResponse = RuntimeMethodOutput<Runtime['local']['listVerifiedModels']>;
type LocalSearchCatalogInput = RuntimeMethodInput<Runtime['local']['searchCatalogModels']>;
type LocalSearchCatalogResponse = RuntimeMethodOutput<Runtime['local']['searchCatalogModels']>;
type LocalResolveInstallPlanInput = RuntimeMethodInput<Runtime['local']['resolveModelInstallPlan']>;
type LocalResolveInstallPlanResponse = RuntimeMethodOutput<Runtime['local']['resolveModelInstallPlan']>;
type LocalInstallModelInput = RuntimeMethodInput<Runtime['local']['installLocalModel']>;
type LocalInstallModelResponse = RuntimeMethodOutput<Runtime['local']['installLocalModel']>;
type LocalInstallVerifiedModelInput = RuntimeMethodInput<Runtime['local']['installVerifiedModel']>;
type LocalInstallVerifiedModelResponse = RuntimeMethodOutput<Runtime['local']['installVerifiedModel']>;
type LocalImportModelInput = RuntimeMethodInput<Runtime['local']['importLocalModel']>;
type LocalImportModelResponse = RuntimeMethodOutput<Runtime['local']['importLocalModel']>;
type LocalRemoveModelInput = RuntimeMethodInput<Runtime['local']['removeLocalModel']>;
type LocalRemoveModelResponse = RuntimeMethodOutput<Runtime['local']['removeLocalModel']>;
type LocalStartModelInput = RuntimeMethodInput<Runtime['local']['startLocalModel']>;
type LocalStartModelResponse = RuntimeMethodOutput<Runtime['local']['startLocalModel']>;
type LocalStopModelInput = RuntimeMethodInput<Runtime['local']['stopLocalModel']>;
type LocalStopModelResponse = RuntimeMethodOutput<Runtime['local']['stopLocalModel']>;
type LocalCheckHealthInput = RuntimeMethodInput<Runtime['local']['checkLocalModelHealth']>;
type LocalCheckHealthResponse = RuntimeMethodOutput<Runtime['local']['checkLocalModelHealth']>;
type LocalWarmModelInput = RuntimeMethodInput<Runtime['local']['warmLocalModel']>;
type LocalWarmModelResponse = RuntimeMethodOutput<Runtime['local']['warmLocalModel']>;
type LocalCollectDeviceProfileInput = RuntimeMethodInput<Runtime['local']['collectDeviceProfile']>;
type LocalCollectDeviceProfileResponse = RuntimeMethodOutput<Runtime['local']['collectDeviceProfile']>;
type LocalResolveProfileInput = RuntimeMethodInput<Runtime['local']['resolveProfile']>;
type LocalResolveProfileResponse = RuntimeMethodOutput<Runtime['local']['resolveProfile']>;
type LocalListNodeCatalogInput = RuntimeMethodInput<Runtime['local']['listNodeCatalog']>;
type LocalListNodeCatalogResponse = RuntimeMethodOutput<Runtime['local']['listNodeCatalog']>;

type ConnectorCreateInput = RuntimeMethodInput<Runtime['connector']['createConnector']>;
type ConnectorCreateResponse = RuntimeMethodOutput<Runtime['connector']['createConnector']>;
type ConnectorGetInput = RuntimeMethodInput<Runtime['connector']['getConnector']>;
type ConnectorGetResponse = RuntimeMethodOutput<Runtime['connector']['getConnector']>;
type ConnectorListInput = RuntimeMethodInput<Runtime['connector']['listConnectors']>;
type ConnectorListResponse = RuntimeMethodOutput<Runtime['connector']['listConnectors']>;
type ConnectorUpdateInput = RuntimeMethodInput<Runtime['connector']['updateConnector']>;
type ConnectorUpdateResponse = RuntimeMethodOutput<Runtime['connector']['updateConnector']>;
type ConnectorDeleteInput = RuntimeMethodInput<Runtime['connector']['deleteConnector']>;
type ConnectorDeleteResponse = RuntimeMethodOutput<Runtime['connector']['deleteConnector']>;
type ConnectorTestInput = RuntimeMethodInput<Runtime['connector']['testConnector']>;
type ConnectorTestResponse = RuntimeMethodOutput<Runtime['connector']['testConnector']>;
type ConnectorListModelsInput = RuntimeMethodInput<Runtime['connector']['listConnectorModels']>;
type ConnectorListModelsResponse = RuntimeMethodOutput<Runtime['connector']['listConnectorModels']>;
type ConnectorProviderCatalogInput = RuntimeMethodInput<Runtime['connector']['listProviderCatalog']>;
type ConnectorProviderCatalogResponse = RuntimeMethodOutput<Runtime['connector']['listProviderCatalog']>;
type ConnectorCatalogProvidersInput = RuntimeMethodInput<Runtime['connector']['listModelCatalogProviders']>;
type ConnectorCatalogProvidersResponse = RuntimeMethodOutput<Runtime['connector']['listModelCatalogProviders']>;
type ConnectorCatalogProviderModelsInput = RuntimeMethodInput<Runtime['connector']['listCatalogProviderModels']>;
type ConnectorCatalogProviderModelsResponse = RuntimeMethodOutput<Runtime['connector']['listCatalogProviderModels']>;
type ConnectorCatalogModelDetailInput = RuntimeMethodInput<Runtime['connector']['getCatalogModelDetail']>;
type ConnectorCatalogModelDetailResponse = RuntimeMethodOutput<Runtime['connector']['getCatalogModelDetail']>;
type ConnectorUpsertCatalogProviderInput = RuntimeMethodInput<Runtime['connector']['upsertModelCatalogProvider']>;
type ConnectorUpsertCatalogProviderResponse = RuntimeMethodOutput<Runtime['connector']['upsertModelCatalogProvider']>;
type ConnectorDeleteCatalogProviderInput = RuntimeMethodInput<Runtime['connector']['deleteModelCatalogProvider']>;
type ConnectorDeleteCatalogProviderResponse = RuntimeMethodOutput<Runtime['connector']['deleteModelCatalogProvider']>;
type ConnectorUpsertCatalogOverlayInput = RuntimeMethodInput<Runtime['connector']['upsertCatalogModelOverlay']>;
type ConnectorUpsertCatalogOverlayResponse = RuntimeMethodOutput<Runtime['connector']['upsertCatalogModelOverlay']>;
type ConnectorDeleteCatalogOverlayInput = RuntimeMethodInput<Runtime['connector']['deleteCatalogModelOverlay']>;
type ConnectorDeleteCatalogOverlayResponse = RuntimeMethodOutput<Runtime['connector']['deleteCatalogModelOverlay']>;

type AuthCheckEmailInput = RealmServiceArgs<'AuthService', 'checkEmail'>[0];
type AuthCheckEmailResponse = RealmServiceResult<'AuthService', 'checkEmail'>;
type AuthPasswordLoginInput = RealmServiceArgs<'AuthService', 'passwordLogin'>[0];
type AuthPasswordLoginResponse = RealmServiceResult<'AuthService', 'passwordLogin'>;
type AuthOauthLoginResponse = RealmServiceResult<'AuthService', 'oauthLogin'>;
type AuthRequestEmailOtpInput = RealmServiceArgs<'AuthService', 'requestEmailOtp'>[0];
type AuthRequestEmailOtpResponse = RealmServiceResult<'AuthService', 'requestEmailOtp'>;
type AuthVerifyEmailOtpInput = RealmServiceArgs<'AuthService', 'verifyEmailOtp'>[0];
type AuthVerifyEmailOtpResponse = RealmServiceResult<'AuthService', 'verifyEmailOtp'>;
type AuthVerifyTwoFactorInput = RealmServiceArgs<'AuthService', 'verifyTwoFactor'>[0];
type AuthVerifyTwoFactorResponse = RealmServiceResult<'AuthService', 'verifyTwoFactor'>;
type AuthWalletChallengeInput = RealmServiceArgs<'AuthService', 'walletChallenge'>[0];
type AuthWalletChallengeResponse = RealmServiceResult<'AuthService', 'walletChallenge'>;
type AuthWalletLoginInput = RealmServiceArgs<'AuthService', 'walletLogin'>[0];
type AuthWalletLoginResponse = RealmServiceResult<'AuthService', 'walletLogin'>;
type AuthUpdatePasswordInput = {
  newPassword: RealmServiceArgs<'AuthService', 'updatePassword'>[0]['newPassword'];
  accessToken?: string;
};
type AuthCurrentUserInput = { accessToken?: string };
type AuthCurrentUserResponse = RealmServiceResult<'MeService', 'getMe'>;
type AgentGetResponse = Awaited<ReturnType<Realm['services']['AgentsService']['getAgent']>>;
type HumanChatSendResponse = RealmServiceResult<'HumanChatService', 'sendMessage'>;
type RelayAuthOauthLoginInput = {
  provider: string;
  accessToken: string;
};
type RelayTtsSynthesizeRequest = {
  agentId: string;
  model: string;
  text: string;
  voiceId?: string;
  language?: string;
  audioFormat?: string;
  sampleRateHz?: number;
  speed?: number;
  pitch?: number;
  volume?: number;
  emotion?: string;
};
type RelayTtsSynthesizeResponse = Pick<TtsSynthesizeResponse, 'job' | 'trace'> & {
  artifact?: TtsSynthesizeResponse['artifacts'][number];
  audio?: string;
};
type RelaySttTranscribeRequest = {
  model?: string;
  audio: string;
  format: string;
  mimeType?: string;
};
type RelayVideoGenerateRequest = {
  agentId: string;
  prompt: string;
  model?: string;
};

type RelayAuthStatus = {
  state: AuthState;
  error: string | null;
};

export type RelayStatusBanner = {
  kind: 'warning' | 'error' | 'success' | 'info';
  message: string;
};

export type RelayAgentListItem = {
  agentId: string;
  displayName: string;
  handle: string;
  state: string;
  avatarUrl: string | null;
};

export type RelayAgentListResponse = {
  items: RelayAgentListItem[];
};

export type RelayOAuthListenForCodeResponse = {
  callbackUrl: string;
  code?: string;
  state?: string;
  error?: string;
};

export type RelayDesktopOpenConfigResponse = {
  success: boolean;
};

export type RelayChatMessage = Omit<MainChatMessage, 'timestamp'> & {
  timestamp: MainChatMessage['timestamp'] | string;
};

export type RelayChatSettingsPatch = {
  product?: Partial<LocalChatSettings['product']>;
  inspect?: Partial<LocalChatSettings['inspect']>;
};

export type RelayRealtimeMessage = {
  id: string;
  senderId: string;
  senderName?: string;
  text: string;
  timestamp: string;
};

export type RelayRealtimePresence = {
  channel?: string;
  userId?: string;
  status?: string;
  online?: boolean;
};

export type RelayStreamChunk = {
  streamId: string;
  data: AiStreamEvent | VideoJobEvent;
};

export type RelayStreamEnd = {
  streamId: string;
};

export type RelayStreamError = {
  streamId: string;
  error: {
    message?: string;
    reasonCode?: string;
    actionHint?: string;
  };
};

export type {
  AuthState,
  LocalChatPromptTrace,
  LocalChatSession,
  LocalChatSettings,
  LocalChatTurnAudit,
  LocalChatTurnSendPhase,
  RelayRouteBinding,
  RelayRouteOptions,
  ResolvedRelayRoute,
};

export type RelayMediaRouteOptionsRequest = {
  capability: string;
};

export type RelayMediaRouteOptionsResponse = {
  connectors: RelayRouteOptions['connectors'];
  loadStatus: RelayRouteOptions['loadStatus'];
  issues: RelayRouteOptions['issues'];
};

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
  'relay:human-chat:send': {
    request: { agentId: string; text: string };
    response: HumanChatSendResponse;
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
    request: Parameters<typeof performOauthTokenExchange>[0];
    response: Awaited<ReturnType<typeof performOauthTokenExchange>>;
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
  'relay:local:models:list': {
    request: LocalListModelsInput | undefined;
    response: LocalListModelsResponse;
  };
  'relay:local:models:verified': {
    request: LocalListVerifiedModelsInput | undefined;
    response: LocalListVerifiedModelsResponse;
  };
  'relay:local:models:catalog-search': {
    request: LocalSearchCatalogInput;
    response: LocalSearchCatalogResponse;
  };
  'relay:local:models:install-plan': {
    request: LocalResolveInstallPlanInput;
    response: LocalResolveInstallPlanResponse;
  };
  'relay:local:models:install': {
    request: LocalInstallModelInput;
    response: LocalInstallModelResponse;
  };
  'relay:local:models:install-verified': {
    request: LocalInstallVerifiedModelInput;
    response: LocalInstallVerifiedModelResponse;
  };
  'relay:local:models:import': {
    request: LocalImportModelInput;
    response: LocalImportModelResponse;
  };
  'relay:local:models:remove': {
    request: LocalRemoveModelInput;
    response: LocalRemoveModelResponse;
  };
  'relay:local:models:start': {
    request: LocalStartModelInput;
    response: LocalStartModelResponse;
  };
  'relay:local:models:stop': {
    request: LocalStopModelInput;
    response: LocalStopModelResponse;
  };
  'relay:local:models:health': {
    request: LocalCheckHealthInput;
    response: LocalCheckHealthResponse;
  };
  'relay:local:models:warm': {
    request: LocalWarmModelInput;
    response: LocalWarmModelResponse;
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
};

export type RelayEventMap = {
  'relay:realtime:message': RelayRealtimeMessage;
  'relay:realtime:presence': RelayRealtimePresence;
  'relay:realtime:status': { connected: boolean };
  'relay:stream:chunk': RelayStreamChunk;
  'relay:stream:end': RelayStreamEnd;
  'relay:stream:error': RelayStreamError;
  'relay:auth:status': RelayAuthStatus;
  'relay:chat:turn:phase': { turnId?: string; phase: LocalChatTurnSendPhase };
  'relay:chat:beat': { turnId: string; beat: VideoJobEvent | AiStreamEvent };
  'relay:chat:turn:done': { turnId: string; diagnostics?: LocalChatTurnAudit | null };
  'relay:chat:turn:error': { turnId: string; error: RelayStreamError['error'] };
  'relay:chat:messages': RelayChatMessage[];
  'relay:chat:sessions': LocalChatSession[];
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
  humanChat: {
    sendMessage: (...args: RelayInvokeArgs<'relay:human-chat:send'>) => Promise<RelayInvokeResponse<'relay:human-chat:send'>>;
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
    listModels: (...args: RelayInvokeArgs<'relay:local:models:list'>) => Promise<RelayInvokeResponse<'relay:local:models:list'>>;
    listVerifiedModels: (...args: RelayInvokeArgs<'relay:local:models:verified'>) => Promise<RelayInvokeResponse<'relay:local:models:verified'>>;
    searchCatalog: (...args: RelayInvokeArgs<'relay:local:models:catalog-search'>) => Promise<RelayInvokeResponse<'relay:local:models:catalog-search'>>;
    resolveInstallPlan: (...args: RelayInvokeArgs<'relay:local:models:install-plan'>) => Promise<RelayInvokeResponse<'relay:local:models:install-plan'>>;
    installModel: (...args: RelayInvokeArgs<'relay:local:models:install'>) => Promise<RelayInvokeResponse<'relay:local:models:install'>>;
    installVerifiedModel: (...args: RelayInvokeArgs<'relay:local:models:install-verified'>) => Promise<RelayInvokeResponse<'relay:local:models:install-verified'>>;
    importModel: (...args: RelayInvokeArgs<'relay:local:models:import'>) => Promise<RelayInvokeResponse<'relay:local:models:import'>>;
    removeModel: (...args: RelayInvokeArgs<'relay:local:models:remove'>) => Promise<RelayInvokeResponse<'relay:local:models:remove'>>;
    startModel: (...args: RelayInvokeArgs<'relay:local:models:start'>) => Promise<RelayInvokeResponse<'relay:local:models:start'>>;
    stopModel: (...args: RelayInvokeArgs<'relay:local:models:stop'>) => Promise<RelayInvokeResponse<'relay:local:models:stop'>>;
    checkModelHealth: (...args: RelayInvokeArgs<'relay:local:models:health'>) => Promise<RelayInvokeResponse<'relay:local:models:health'>>;
    warmModel: (...args: RelayInvokeArgs<'relay:local:models:warm'>) => Promise<RelayInvokeResponse<'relay:local:models:warm'>>;
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
