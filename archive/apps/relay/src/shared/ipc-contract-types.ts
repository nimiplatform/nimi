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

export type HealthResponse = RuntimeMethodOutput<Runtime['health']>;
export type AiGenerateResponse = RuntimeMethodOutput<Runtime['ai']['text']['generate']>;
export type AiStreamOpenResponse = { streamId: string };
export type AiStreamEvent = AsyncIterableItem<Awaited<ReturnType<Runtime['ai']['text']['stream']>>['stream']>;

export type TtsSynthesizeInput = RuntimeMethodInput<Runtime['media']['tts']['synthesize']>;
export type TtsSynthesizeResponse = RuntimeMethodOutput<Runtime['media']['tts']['synthesize']>;
export type TtsListVoicesInput = RuntimeMethodInput<Runtime['media']['tts']['listVoices']>;
export type TtsListVoicesResponse = RuntimeMethodOutput<Runtime['media']['tts']['listVoices']>;
export type SttTranscribeInput = RuntimeMethodInput<Runtime['media']['stt']['transcribe']>;
export type SttTranscribeResponse = RuntimeMethodOutput<Runtime['media']['stt']['transcribe']>;
export type ImageGenerateInput = RuntimeMethodInput<Runtime['media']['image']['generate']>;
export type ImageGenerateResponse = RuntimeMethodOutput<Runtime['media']['image']['generate']>;
export type VideoGenerateInput = RuntimeMethodInput<Runtime['media']['video']['generate']>;
export type VideoGenerateResponse = RuntimeMethodOutput<Runtime['media']['video']['generate']>;
export type VideoJobGetResponse = RuntimeMethodOutput<Runtime['media']['jobs']['get']>;
export type VideoJobArtifactsResponse = RuntimeMethodOutput<Runtime['media']['jobs']['getArtifacts']>;
export type VideoJobEvent = AsyncIterableItem<RuntimeMethodOutput<Runtime['media']['jobs']['subscribe']>>;

export type ModelListInput = RuntimeMethodInput<Runtime['model']['list']>;
export type ModelListResponse = RuntimeMethodOutput<Runtime['model']['list']>;
export type ModelPullInput = RuntimeMethodInput<Runtime['model']['pull']>;
export type ModelPullResponse = RuntimeMethodOutput<Runtime['model']['pull']>;
export type ModelRemoveInput = RuntimeMethodInput<Runtime['model']['remove']>;
export type ModelRemoveResponse = RuntimeMethodOutput<Runtime['model']['remove']>;
export type ModelHealthInput = RuntimeMethodInput<Runtime['model']['checkHealth']>;
export type ModelHealthResponse = RuntimeMethodOutput<Runtime['model']['checkHealth']>;

export type LocalListAssetsInput = RuntimeMethodInput<Runtime['local']['listLocalAssets']>;
export type LocalListAssetsResponse = RuntimeMethodOutput<Runtime['local']['listLocalAssets']>;
export type LocalListVerifiedAssetsInput = RuntimeMethodInput<Runtime['local']['listVerifiedAssets']>;
export type LocalListVerifiedAssetsResponse = RuntimeMethodOutput<Runtime['local']['listVerifiedAssets']>;
export type LocalSearchCatalogInput = RuntimeMethodInput<Runtime['local']['searchCatalogModels']>;
export type LocalSearchCatalogResponse = RuntimeMethodOutput<Runtime['local']['searchCatalogModels']>;
export type LocalResolveInstallPlanInput = RuntimeMethodInput<Runtime['local']['resolveModelInstallPlan']>;
export type LocalResolveInstallPlanResponse = RuntimeMethodOutput<Runtime['local']['resolveModelInstallPlan']>;
export type LocalInstallVerifiedAssetInput = RuntimeMethodInput<Runtime['local']['installVerifiedAsset']>;
export type LocalInstallVerifiedAssetResponse = RuntimeMethodOutput<Runtime['local']['installVerifiedAsset']>;
export type LocalImportAssetInput = RuntimeMethodInput<Runtime['local']['importLocalAsset']>;
export type LocalImportAssetResponse = RuntimeMethodOutput<Runtime['local']['importLocalAsset']>;
export type LocalRemoveAssetInput = RuntimeMethodInput<Runtime['local']['removeLocalAsset']>;
export type LocalRemoveAssetResponse = RuntimeMethodOutput<Runtime['local']['removeLocalAsset']>;
export type LocalStartAssetInput = RuntimeMethodInput<Runtime['local']['startLocalAsset']>;
export type LocalStartAssetResponse = RuntimeMethodOutput<Runtime['local']['startLocalAsset']>;
export type LocalStopAssetInput = RuntimeMethodInput<Runtime['local']['stopLocalAsset']>;
export type LocalStopAssetResponse = RuntimeMethodOutput<Runtime['local']['stopLocalAsset']>;
export type LocalCheckHealthInput = RuntimeMethodInput<Runtime['local']['checkLocalAssetHealth']>;
export type LocalCheckHealthResponse = RuntimeMethodOutput<Runtime['local']['checkLocalAssetHealth']>;
export type LocalWarmAssetInput = RuntimeMethodInput<Runtime['local']['warmLocalAsset']>;
export type LocalWarmAssetResponse = RuntimeMethodOutput<Runtime['local']['warmLocalAsset']>;
export type LocalCollectDeviceProfileInput = RuntimeMethodInput<Runtime['local']['collectDeviceProfile']>;
export type LocalCollectDeviceProfileResponse = RuntimeMethodOutput<Runtime['local']['collectDeviceProfile']>;
export type LocalResolveProfileInput = RuntimeMethodInput<Runtime['local']['resolveProfile']>;
export type LocalResolveProfileResponse = RuntimeMethodOutput<Runtime['local']['resolveProfile']>;
export type LocalListNodeCatalogInput = RuntimeMethodInput<Runtime['local']['listNodeCatalog']>;
export type LocalListNodeCatalogResponse = RuntimeMethodOutput<Runtime['local']['listNodeCatalog']>;

export type ConnectorCreateInput = RuntimeMethodInput<Runtime['connector']['createConnector']>;
export type ConnectorCreateResponse = RuntimeMethodOutput<Runtime['connector']['createConnector']>;
export type ConnectorGetInput = RuntimeMethodInput<Runtime['connector']['getConnector']>;
export type ConnectorGetResponse = RuntimeMethodOutput<Runtime['connector']['getConnector']>;
export type ConnectorListInput = RuntimeMethodInput<Runtime['connector']['listConnectors']>;
export type ConnectorListResponse = RuntimeMethodOutput<Runtime['connector']['listConnectors']>;
export type ConnectorUpdateInput = RuntimeMethodInput<Runtime['connector']['updateConnector']>;
export type ConnectorUpdateResponse = RuntimeMethodOutput<Runtime['connector']['updateConnector']>;
export type ConnectorDeleteInput = RuntimeMethodInput<Runtime['connector']['deleteConnector']>;
export type ConnectorDeleteResponse = RuntimeMethodOutput<Runtime['connector']['deleteConnector']>;
export type ConnectorTestInput = RuntimeMethodInput<Runtime['connector']['testConnector']>;
export type ConnectorTestResponse = RuntimeMethodOutput<Runtime['connector']['testConnector']>;
export type ConnectorListModelsInput = RuntimeMethodInput<Runtime['connector']['listConnectorModels']>;
export type ConnectorListModelsResponse = RuntimeMethodOutput<Runtime['connector']['listConnectorModels']>;
export type ConnectorProviderCatalogInput = RuntimeMethodInput<Runtime['connector']['listProviderCatalog']>;
export type ConnectorProviderCatalogResponse = RuntimeMethodOutput<Runtime['connector']['listProviderCatalog']>;
export type ConnectorCatalogProvidersInput = RuntimeMethodInput<Runtime['connector']['listModelCatalogProviders']>;
export type ConnectorCatalogProvidersResponse = RuntimeMethodOutput<Runtime['connector']['listModelCatalogProviders']>;
export type ConnectorCatalogProviderModelsInput = RuntimeMethodInput<Runtime['connector']['listCatalogProviderModels']>;
export type ConnectorCatalogProviderModelsResponse = RuntimeMethodOutput<Runtime['connector']['listCatalogProviderModels']>;
export type ConnectorCatalogModelDetailInput = RuntimeMethodInput<Runtime['connector']['getCatalogModelDetail']>;
export type ConnectorCatalogModelDetailResponse = RuntimeMethodOutput<Runtime['connector']['getCatalogModelDetail']>;
export type ConnectorUpsertCatalogProviderInput = RuntimeMethodInput<Runtime['connector']['upsertModelCatalogProvider']>;
export type ConnectorUpsertCatalogProviderResponse = RuntimeMethodOutput<Runtime['connector']['upsertModelCatalogProvider']>;
export type ConnectorDeleteCatalogProviderInput = RuntimeMethodInput<Runtime['connector']['deleteModelCatalogProvider']>;
export type ConnectorDeleteCatalogProviderResponse = RuntimeMethodOutput<Runtime['connector']['deleteModelCatalogProvider']>;
export type ConnectorUpsertCatalogOverlayInput = RuntimeMethodInput<Runtime['connector']['upsertCatalogModelOverlay']>;
export type ConnectorUpsertCatalogOverlayResponse = RuntimeMethodOutput<Runtime['connector']['upsertCatalogModelOverlay']>;
export type ConnectorDeleteCatalogOverlayInput = RuntimeMethodInput<Runtime['connector']['deleteCatalogModelOverlay']>;
export type ConnectorDeleteCatalogOverlayResponse = RuntimeMethodOutput<Runtime['connector']['deleteCatalogModelOverlay']>;

export type AuthCheckEmailInput = RealmServiceArgs<'AuthService', 'checkEmail'>[0];
export type AuthCheckEmailResponse = RealmServiceResult<'AuthService', 'checkEmail'>;
export type AuthPasswordLoginInput = RealmServiceArgs<'AuthService', 'passwordLogin'>[0];
export type AuthPasswordLoginResponse = RealmServiceResult<'AuthService', 'passwordLogin'>;
export type AuthOauthLoginResponse = RealmServiceResult<'AuthService', 'oauthLogin'>;
export type AuthRequestEmailOtpInput = RealmServiceArgs<'AuthService', 'requestEmailOtp'>[0];
export type AuthRequestEmailOtpResponse = RealmServiceResult<'AuthService', 'requestEmailOtp'>;
export type AuthVerifyEmailOtpInput = RealmServiceArgs<'AuthService', 'verifyEmailOtp'>[0];
export type AuthVerifyEmailOtpResponse = RealmServiceResult<'AuthService', 'verifyEmailOtp'>;
export type AuthVerifyTwoFactorInput = RealmServiceArgs<'AuthService', 'verifyTwoFactor'>[0];
export type AuthVerifyTwoFactorResponse = RealmServiceResult<'AuthService', 'verifyTwoFactor'>;
export type AuthWalletChallengeInput = RealmServiceArgs<'AuthService', 'walletChallenge'>[0];
export type AuthWalletChallengeResponse = RealmServiceResult<'AuthService', 'walletChallenge'>;
export type AuthWalletLoginInput = RealmServiceArgs<'AuthService', 'walletLogin'>[0];
export type AuthWalletLoginResponse = RealmServiceResult<'AuthService', 'walletLogin'>;
export type AuthUpdatePasswordInput = {
  newPassword: RealmServiceArgs<'AuthService', 'updatePassword'>[0]['newPassword'];
  accessToken?: string;
};
export type AuthCurrentUserInput = { accessToken?: string };
export type AuthCurrentUserResponse = RealmServiceResult<'MeService', 'getMe'>;
export type AgentGetResponse = Awaited<ReturnType<Realm['services']['AgentsService']['getAgent']>>;
export type RelayAuthOauthLoginInput = {
  provider: string;
  accessToken: string;
};
export type RelayTtsSynthesizeRequest = {
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
export type RelayTtsSynthesizeResponse = Pick<TtsSynthesizeResponse, 'job' | 'trace'> & {
  artifact?: TtsSynthesizeResponse['artifacts'][number];
  audio?: string;
};
export type RelaySttTranscribeRequest = {
  model?: string;
  audio: string;
  format: string;
  mimeType?: string;
};
export type RelayVideoGenerateRequest = {
  agentId: string;
  prompt: string;
  model?: string;
};

export type RelayAuthStatus = {
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
  IpcAiGenerateInput,
  IpcAiStreamInput,
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
  local: RelayRouteOptions['local'];
  connectors: RelayRouteOptions['connectors'];
  loadStatus: RelayRouteOptions['loadStatus'];
  issues: RelayRouteOptions['issues'];
};

export type RelayOauthTokenExchangeRequest = Parameters<typeof performOauthTokenExchange>[0];
export type RelayOauthTokenExchangeResponse = Awaited<ReturnType<typeof performOauthTokenExchange>>;
