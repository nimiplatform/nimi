import type {
  NimiError,
  ScopeCatalogDescriptor,
  ScopeCatalogEntry,
  ScopeCatalogPublishResult,
  ScopeCatalogRevokeResult,
  ScopeManifest,
} from '../types/index.js';
import type { Realm } from '../realm/client.js';
import type { Runtime } from './runtime.js';

import type {
  OpenExternalPrincipalSessionRequest,
  OpenExternalPrincipalSessionResponse,
  OpenSessionRequest,
  OpenSessionResponse,
  RefreshSessionRequest,
  RefreshSessionResponse,
  RegisterAppRequest,
  RegisterAppResponse,
  RegisterExternalPrincipalRequest,
  RegisterExternalPrincipalResponse,
  RevokeExternalPrincipalSessionRequest,
  RevokeSessionRequest,
} from './generated/runtime/v1/auth';
import type {
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
  IssueDelegatedAccessTokenRequest,
  IssueDelegatedAccessTokenResponse,
  ListTokenChainRequest,
  ListTokenChainResponse,
  RevokeAppAccessTokenRequest,
  ValidateAppAccessTokenRequest,
  ValidateAppAccessTokenResponse,
} from './generated/runtime/v1/grant';
import type {
  CancelMediaJobRequest,
  CancelMediaJobResponse,
  EmbedRequest,
  EmbedResponse,
  GetMediaArtifactsRequest,
  GetMediaArtifactsResponse,
  GetMediaJobRequest,
  GetMediaJobResponse,
  ArtifactChunk,
  GenerateRequest,
  GenerateResponse,
  MediaArtifact,
  MediaJob,
  GetSpeechVoicesRequest,
  GetSpeechVoicesResponse,
  MediaJobEvent,
  StreamSpeechSynthesisRequest,
  SubmitMediaJobRequest,
  SubmitMediaJobResponse,
  StreamGenerateEvent,
  StreamGenerateRequest,
  SubscribeMediaJobEventsRequest,
} from './generated/runtime/v1/ai';
import type {
  CancelWorkflowRequest,
  GetWorkflowRequest,
  GetWorkflowResponse,
  SubmitWorkflowRequest,
  SubmitWorkflowResponse,
  SubscribeWorkflowEventsRequest,
  WorkflowEvent,
} from './generated/runtime/v1/workflow';
import type {
  CheckModelHealthRequest,
  CheckModelHealthResponse,
  ListModelsRequest,
  ListModelsResponse,
  PullModelRequest,
  PullModelResponse,
  RemoveModelRequest,
} from './generated/runtime/v1/model';
import type {
  ApplyDependenciesRequest,
  ApplyDependenciesResponse,
  AppendInferenceAuditRequest,
  AppendRuntimeAuditRequest,
  CheckLocalModelHealthRequest,
  CheckLocalModelHealthResponse,
  CheckLocalServiceHealthRequest,
  CheckLocalServiceHealthResponse,
  CollectDeviceProfileRequest,
  CollectDeviceProfileResponse,
  ImportLocalModelRequest,
  ImportLocalModelResponse,
  InstallLocalModelRequest,
  InstallLocalModelResponse,
  InstallLocalServiceRequest,
  InstallLocalServiceResponse,
  InstallVerifiedModelRequest,
  InstallVerifiedModelResponse,
  ListLocalAuditsRequest,
  ListLocalAuditsResponse,
  ListLocalModelsRequest,
  ListLocalModelsResponse,
  ListLocalServicesRequest,
  ListLocalServicesResponse,
  ListNodeCatalogRequest,
  ListNodeCatalogResponse,
  ListVerifiedModelsRequest,
  ListVerifiedModelsResponse,
  RemoveLocalModelRequest,
  RemoveLocalModelResponse,
  RemoveLocalServiceRequest,
  RemoveLocalServiceResponse,
  ResolveDependenciesRequest,
  ResolveDependenciesResponse,
  ResolveModelInstallPlanRequest,
  ResolveModelInstallPlanResponse,
  SearchCatalogModelsRequest,
  SearchCatalogModelsResponse,
  StartLocalModelRequest,
  StartLocalModelResponse,
  StartLocalServiceRequest,
  StartLocalServiceResponse,
  StopLocalModelRequest,
  StopLocalModelResponse,
  StopLocalServiceRequest,
  StopLocalServiceResponse,
} from './generated/runtime/v1/local_runtime';
import type {
  BuildIndexRequest,
  BuildIndexResponse,
  DeleteIndexRequest,
  SearchIndexRequest,
  SearchIndexResponse,
} from './generated/runtime/v1/knowledge';
import type {
  AppMessageEvent,
  SendAppMessageRequest,
  SendAppMessageResponse,
  SubscribeAppMessagesRequest,
} from './generated/runtime/v1/app';
import type {
  CreateConnectorRequest,
  CreateConnectorResponse,
  DeleteConnectorRequest,
  DeleteConnectorResponse,
  GetConnectorRequest,
  GetConnectorResponse,
  ListConnectorModelsRequest,
  ListConnectorModelsResponse,
  ListConnectorsRequest,
  ListConnectorsResponse,
  TestConnectorRequest,
  TestConnectorResponse,
  UpdateConnectorRequest,
  UpdateConnectorResponse,
  ListProviderCatalogRequest,
  ListProviderCatalogResponse,
} from './generated/runtime/v1/connector';
import type {
  AIProviderHealthEvent,
  AuditExportChunk,
  ExportAuditEventsRequest,
  GetRuntimeHealthRequest,
  GetRuntimeHealthResponse,
  ListAIProviderHealthRequest,
  ListAIProviderHealthResponse,
  ListAuditEventsRequest,
  ListAuditEventsResponse,
  ListUsageStatsRequest,
  ListUsageStatsResponse,
  RuntimeHealthEvent,
  SubscribeAIProviderHealthEventsRequest,
  SubscribeRuntimeHealthEventsRequest,
} from './generated/runtime/v1/audit';
import type {
  ExecuteRequest,
  ExecuteResponse,
} from './generated/runtime/v1/script_worker';
import type { Ack } from './generated/runtime/v1/common';

export type RuntimeCallerKind =
  | 'desktop-core'
  | 'desktop-mod'
  | 'third-party-app'
  | 'third-party-service';

export type RuntimeMetadata = {
  protocolVersion?: string;
  participantProtocolVersion?: string;
  participantId?: string;
  domain?: string;
  appId?: string;
  traceId?: string;
  idempotencyKey?: string;
  callerKind?: RuntimeCallerKind;
  callerId?: string;
  surfaceId?: string;
  keySource?: 'inline' | 'managed';
  providerType?: string;
  clientId?: string;
  providerEndpoint?: string;
  providerApiKey?: string;
  extra?: Record<string, string>;
};

export type RuntimeCallOptions = {
  metadata?: RuntimeMetadata;
  timeoutMs?: number;
  idempotencyKey?: string;
};

export type RuntimeStreamCallOptions = RuntimeCallOptions & {
  signal?: AbortSignal;
};

export type RuntimeResponseMetadataObserver = (metadata: Record<string, string>) => void;

export type RuntimeNodeGrpcTransportConfig = {
  type: 'node-grpc';
  endpoint: string;
  tls?: {
    enabled: boolean;
    serverName?: string;
    rootCertPem?: string;
  };
  /** @internal Side-channel for response metadata extraction (e.g. x-nimi-runtime-version). */
  _responseMetadataObserver?: RuntimeResponseMetadataObserver;
};

export type RuntimeTauriIpcTransportConfig = {
  type: 'tauri-ipc';
  commandNamespace?: string;
  eventNamespace?: string;
  /** @internal Side-channel for response metadata extraction (e.g. x-nimi-runtime-version). */
  _responseMetadataObserver?: RuntimeResponseMetadataObserver;
};

export type RuntimeTransportConfig = RuntimeNodeGrpcTransportConfig | RuntimeTauriIpcTransportConfig;

export type RuntimeClientDefaults = {
  protocolVersion?: string;
  participantProtocolVersion?: string;
  participantId?: string;
  callerKind?: RuntimeCallerKind;
  callerId?: string;
  surfaceId?: string;
};

export type RuntimeClientConfig = {
  appId: string;
  transport: RuntimeTransportConfig;
  defaults?: RuntimeClientDefaults;
  auth?: RuntimeAuthProvider;
};

export type RuntimeWireMessage = Uint8Array;

export type RuntimeUnaryCall<Request = RuntimeWireMessage> = {
  methodId: string;
  request: Request;
  metadata: RuntimeMetadata;
  authorization?: string;
  timeoutMs?: number;
};

export type RuntimeOpenStreamCall<Request = RuntimeWireMessage> = {
  methodId: string;
  request: Request;
  metadata: RuntimeMetadata;
  authorization?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type RuntimeStreamCloseCall = {
  streamId: string;
};

export type RuntimeTransport = {
  invokeUnary(input: RuntimeUnaryCall<RuntimeWireMessage>): Promise<RuntimeWireMessage>;
  openStream(input: RuntimeOpenStreamCall<RuntimeWireMessage>): Promise<AsyncIterable<RuntimeWireMessage>>;
  closeStream(input: RuntimeStreamCloseCall): Promise<void>;
};

export type RuntimeAuthClient = {
  registerApp(request: RegisterAppRequest, options?: RuntimeCallOptions): Promise<RegisterAppResponse>;
  openSession(request: OpenSessionRequest, options?: RuntimeCallOptions): Promise<OpenSessionResponse>;
  refreshSession(request: RefreshSessionRequest, options?: RuntimeCallOptions): Promise<RefreshSessionResponse>;
  revokeSession(request: RevokeSessionRequest, options?: RuntimeCallOptions): Promise<Ack>;
  registerExternalPrincipal(request: RegisterExternalPrincipalRequest, options?: RuntimeCallOptions): Promise<RegisterExternalPrincipalResponse>;
  openExternalPrincipalSession(request: OpenExternalPrincipalSessionRequest, options?: RuntimeCallOptions): Promise<OpenExternalPrincipalSessionResponse>;
  revokeExternalPrincipalSession(request: RevokeExternalPrincipalSessionRequest, options?: RuntimeCallOptions): Promise<Ack>;
};

export type RuntimeAppAuthClient = {
  authorizeExternalPrincipal(request: AuthorizeExternalPrincipalRequest, options?: RuntimeCallOptions): Promise<AuthorizeExternalPrincipalResponse>;
  validateToken(request: ValidateAppAccessTokenRequest, options?: RuntimeCallOptions): Promise<ValidateAppAccessTokenResponse>;
  revokeToken(request: RevokeAppAccessTokenRequest, options?: RuntimeCallOptions): Promise<Ack>;
  issueDelegatedToken(request: IssueDelegatedAccessTokenRequest, options?: RuntimeCallOptions): Promise<IssueDelegatedAccessTokenResponse>;
  listTokenChain(request: ListTokenChainRequest, options?: RuntimeCallOptions): Promise<ListTokenChainResponse>;
};

export type RuntimeAiClient = {
  generate(request: GenerateRequest, options?: RuntimeCallOptions): Promise<GenerateResponse>;
  streamGenerate(request: StreamGenerateRequest, options?: RuntimeStreamCallOptions): Promise<AsyncIterable<StreamGenerateEvent>>;
  embed(request: EmbedRequest, options?: RuntimeCallOptions): Promise<EmbedResponse>;
  submitMediaJob(request: SubmitMediaJobRequest, options?: RuntimeCallOptions): Promise<SubmitMediaJobResponse>;
  getMediaJob(request: GetMediaJobRequest, options?: RuntimeCallOptions): Promise<GetMediaJobResponse>;
  cancelMediaJob(request: CancelMediaJobRequest, options?: RuntimeCallOptions): Promise<CancelMediaJobResponse>;
  subscribeMediaJobEvents(request: SubscribeMediaJobEventsRequest, options?: RuntimeStreamCallOptions): Promise<AsyncIterable<MediaJobEvent>>;
  getMediaResult(request: GetMediaArtifactsRequest, options?: RuntimeCallOptions): Promise<GetMediaArtifactsResponse>;
  getSpeechVoices(request: GetSpeechVoicesRequest, options?: RuntimeCallOptions): Promise<GetSpeechVoicesResponse>;
  synthesizeSpeechStream(request: StreamSpeechSynthesisRequest, options?: RuntimeStreamCallOptions): Promise<AsyncIterable<ArtifactChunk>>;
};

export type RuntimeWorkflowClient = {
  submit(request: SubmitWorkflowRequest, options?: RuntimeCallOptions): Promise<SubmitWorkflowResponse>;
  get(request: GetWorkflowRequest, options?: RuntimeCallOptions): Promise<GetWorkflowResponse>;
  cancel(request: CancelWorkflowRequest, options?: RuntimeCallOptions): Promise<Ack>;
  subscribeEvents(request: SubscribeWorkflowEventsRequest, options?: RuntimeStreamCallOptions): Promise<AsyncIterable<WorkflowEvent>>;
};

export type RuntimeModelClient = {
  list(request: ListModelsRequest, options?: RuntimeCallOptions): Promise<ListModelsResponse>;
  pull(request: PullModelRequest, options?: RuntimeCallOptions): Promise<PullModelResponse>;
  remove(request: RemoveModelRequest, options?: RuntimeCallOptions): Promise<Ack>;
  checkHealth(request: CheckModelHealthRequest, options?: RuntimeCallOptions): Promise<CheckModelHealthResponse>;
};

export type RuntimeKnowledgeClient = {
  buildIndex(request: BuildIndexRequest, options?: RuntimeCallOptions): Promise<BuildIndexResponse>;
  searchIndex(request: SearchIndexRequest, options?: RuntimeCallOptions): Promise<SearchIndexResponse>;
  deleteIndex(request: DeleteIndexRequest, options?: RuntimeCallOptions): Promise<Ack>;
};

export type RuntimeLocalRuntimeClient = {
  listLocalModels(request: ListLocalModelsRequest, options?: RuntimeCallOptions): Promise<ListLocalModelsResponse>;
  listVerifiedModels(request: ListVerifiedModelsRequest, options?: RuntimeCallOptions): Promise<ListVerifiedModelsResponse>;
  searchCatalogModels(request: SearchCatalogModelsRequest, options?: RuntimeCallOptions): Promise<SearchCatalogModelsResponse>;
  resolveModelInstallPlan(request: ResolveModelInstallPlanRequest, options?: RuntimeCallOptions): Promise<ResolveModelInstallPlanResponse>;
  installLocalModel(request: InstallLocalModelRequest, options?: RuntimeCallOptions): Promise<InstallLocalModelResponse>;
  installVerifiedModel(request: InstallVerifiedModelRequest, options?: RuntimeCallOptions): Promise<InstallVerifiedModelResponse>;
  importLocalModel(request: ImportLocalModelRequest, options?: RuntimeCallOptions): Promise<ImportLocalModelResponse>;
  removeLocalModel(request: RemoveLocalModelRequest, options?: RuntimeCallOptions): Promise<RemoveLocalModelResponse>;
  startLocalModel(request: StartLocalModelRequest, options?: RuntimeCallOptions): Promise<StartLocalModelResponse>;
  stopLocalModel(request: StopLocalModelRequest, options?: RuntimeCallOptions): Promise<StopLocalModelResponse>;
  checkLocalModelHealth(request: CheckLocalModelHealthRequest, options?: RuntimeCallOptions): Promise<CheckLocalModelHealthResponse>;
  collectDeviceProfile(request: CollectDeviceProfileRequest, options?: RuntimeCallOptions): Promise<CollectDeviceProfileResponse>;
  resolveDependencies(request: ResolveDependenciesRequest, options?: RuntimeCallOptions): Promise<ResolveDependenciesResponse>;
  applyDependencies(request: ApplyDependenciesRequest, options?: RuntimeCallOptions): Promise<ApplyDependenciesResponse>;
  listLocalServices(request: ListLocalServicesRequest, options?: RuntimeCallOptions): Promise<ListLocalServicesResponse>;
  installLocalService(request: InstallLocalServiceRequest, options?: RuntimeCallOptions): Promise<InstallLocalServiceResponse>;
  startLocalService(request: StartLocalServiceRequest, options?: RuntimeCallOptions): Promise<StartLocalServiceResponse>;
  stopLocalService(request: StopLocalServiceRequest, options?: RuntimeCallOptions): Promise<StopLocalServiceResponse>;
  checkLocalServiceHealth(request: CheckLocalServiceHealthRequest, options?: RuntimeCallOptions): Promise<CheckLocalServiceHealthResponse>;
  removeLocalService(request: RemoveLocalServiceRequest, options?: RuntimeCallOptions): Promise<RemoveLocalServiceResponse>;
  listNodeCatalog(request: ListNodeCatalogRequest, options?: RuntimeCallOptions): Promise<ListNodeCatalogResponse>;
  listLocalAudits(request: ListLocalAuditsRequest, options?: RuntimeCallOptions): Promise<ListLocalAuditsResponse>;
  appendInferenceAudit(request: AppendInferenceAuditRequest, options?: RuntimeCallOptions): Promise<Ack>;
  appendRuntimeAudit(request: AppendRuntimeAuditRequest, options?: RuntimeCallOptions): Promise<Ack>;
};

export type RuntimeAppClient = {
  sendAppMessage(request: SendAppMessageRequest, options?: RuntimeCallOptions): Promise<SendAppMessageResponse>;
  subscribeAppMessages(request: SubscribeAppMessagesRequest, options?: RuntimeStreamCallOptions): Promise<AsyncIterable<AppMessageEvent>>;
};

export type RuntimeConnectorClient = {
  createConnector(request: CreateConnectorRequest, options?: RuntimeCallOptions): Promise<CreateConnectorResponse>;
  getConnector(request: GetConnectorRequest, options?: RuntimeCallOptions): Promise<GetConnectorResponse>;
  listConnectors(request: ListConnectorsRequest, options?: RuntimeCallOptions): Promise<ListConnectorsResponse>;
  updateConnector(request: UpdateConnectorRequest, options?: RuntimeCallOptions): Promise<UpdateConnectorResponse>;
  deleteConnector(request: DeleteConnectorRequest, options?: RuntimeCallOptions): Promise<DeleteConnectorResponse>;
  testConnector(request: TestConnectorRequest, options?: RuntimeCallOptions): Promise<TestConnectorResponse>;
  listConnectorModels(request: ListConnectorModelsRequest, options?: RuntimeCallOptions): Promise<ListConnectorModelsResponse>;
  listProviderCatalog(request: ListProviderCatalogRequest, options?: RuntimeCallOptions): Promise<ListProviderCatalogResponse>;
};

export type RuntimeScriptWorkerClient = {
  execute(request: ExecuteRequest, options?: RuntimeCallOptions): Promise<ExecuteResponse>;
};

export type RuntimeAuditClient = {
  listAuditEvents(request: ListAuditEventsRequest, options?: RuntimeCallOptions): Promise<ListAuditEventsResponse>;
  exportAuditEvents(request: ExportAuditEventsRequest, options?: RuntimeStreamCallOptions): Promise<AsyncIterable<AuditExportChunk>>;
  listUsageStats(request: ListUsageStatsRequest, options?: RuntimeCallOptions): Promise<ListUsageStatsResponse>;
  getRuntimeHealth(request: GetRuntimeHealthRequest, options?: RuntimeCallOptions): Promise<GetRuntimeHealthResponse>;
  listAIProviderHealth(request: ListAIProviderHealthRequest, options?: RuntimeCallOptions): Promise<ListAIProviderHealthResponse>;
  subscribeAIProviderHealthEvents(request: SubscribeAIProviderHealthEventsRequest, options?: RuntimeStreamCallOptions): Promise<AsyncIterable<AIProviderHealthEvent>>;
  subscribeRuntimeHealthEvents(request: SubscribeRuntimeHealthEventsRequest, options?: RuntimeStreamCallOptions): Promise<AsyncIterable<RuntimeHealthEvent>>;
};

export type RuntimeClient = {
  appId: string;
  transport: RuntimeTransportConfig;
  auth: RuntimeAuthClient;
  appAuth: RuntimeAppAuthClient;
  ai: RuntimeAiClient;
  workflow: RuntimeWorkflowClient;
  model: RuntimeModelClient;
  localRuntime: RuntimeLocalRuntimeClient;
  connector: RuntimeConnectorClient;
  knowledge: RuntimeKnowledgeClient;
  app: RuntimeAppClient;
  audit: RuntimeAuditClient;
  scriptWorker: RuntimeScriptWorkerClient;
  closeStream(streamId: string): Promise<void>;
};

export type RuntimeClientFactory = {
  create(config: RuntimeClientConfig): RuntimeClient;
};

export type RuntimeCallResult<T> = {
  ok: true;
  value: T;
} | {
  ok: false;
  error: NimiError;
};

export type RuntimeConnectionMode = 'auto' | 'manual';

export type RuntimeConnectionState = {
  status: 'idle' | 'connecting' | 'ready' | 'closing' | 'closed';
  connectedAt?: string;
  lastReadyAt?: string;
};

export type RuntimeHealth = {
  status: 'healthy' | 'degraded' | 'unavailable';
  reason?: string;
  queueDepth?: number;
  activeWorkflows?: number;
  activeInferenceJobs?: number;
  cpuMilli?: string;
  memoryBytes?: string;
  vramBytes?: string;
  sampledAt?: string;
};

export type RuntimeTelemetryEvent = {
  name: string;
  at: string;
  data?: Record<string, unknown>;
};

export type RuntimeAuthProvider = {
  accessToken?: string | (() => string | Promise<string>);
};

export type RuntimeSubjectContextProvider = {
  subjectUserId?: string;
  getSubjectUserId?: () => string | Promise<string>;
};

export type RuntimeOptions = {
  appId: string;
  connection?: {
    mode?: RuntimeConnectionMode;
    waitForReadyTimeoutMs?: number;
  };
  transport: RuntimeTransportConfig;
  defaults?: RuntimeClientDefaults;
  auth?: RuntimeAuthProvider;
  timeoutMs?: number;
  retry?: {
    maxAttempts?: number;
    backoffMs?: number;
  };
  subjectContext?: RuntimeSubjectContextProvider;
  telemetry?: {
    enabled?: boolean;
    onEvent?: (event: RuntimeTelemetryEvent) => void;
  };
};

export type RuntimeAuthMaterial = {
  grantToken: string;
  grantVersion: string;
};

export type RuntimeRealmBridgeContext = {
  appId: string;
  runtime: Runtime;
  realm: Realm;
};

export type RuntimeRealmBridgeHelpers = {
  fetchRealmGrant(input: {
    appId?: string;
    subjectUserId: string;
    scopes: string[];
    path?: string;
  }): Promise<{
    token: string;
    version: string;
    expiresAt?: string;
  }>;
  buildRuntimeAuthMetadata(input: RuntimeAuthMaterial): Record<string, string>;
  linkRuntimeTraceToRealmWrite(input: {
    runtimeTraceId?: string;
    realmPayload: Record<string, unknown>;
  }): Record<string, unknown>;
};

export type NimiRoutePolicy = 'local-runtime' | 'token-api';

export type NimiFallbackPolicy = 'deny' | 'allow';

export type NimiFinishReason =
  | 'stop'
  | 'length'
  | 'content-filter'
  | 'tool-calls'
  | 'error';

export type NimiTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type NimiTraceInfo = {
  traceId?: string;
  modelResolved?: string;
  routeDecision?: NimiRoutePolicy;
};

export type TextMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
};

export type TextGenerateInput = {
  model: string;
  input: string | TextMessage[];
  subjectUserId?: string;
  system?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  route?: NimiRoutePolicy;
  fallback?: NimiFallbackPolicy;
  timeoutMs?: number;
  metadata?: Record<string, string>;
};

export type TextStreamInput = TextGenerateInput & {
  signal?: AbortSignal;
};

export type TextGenerateOutput = {
  text: string;
  finishReason: NimiFinishReason;
  usage: NimiTokenUsage;
  trace: NimiTraceInfo;
};

export type TextStreamPart =
  | { type: 'start' }
  | { type: 'delta'; text: string }
  | { type: 'finish'; finishReason: NimiFinishReason; usage: NimiTokenUsage; trace: NimiTraceInfo }
  | { type: 'error'; error: NimiError };

export type TextStreamOutput = {
  stream: AsyncIterable<TextStreamPart>;
};

export type EmbeddingGenerateInput = {
  model: string;
  input: string | string[];
  subjectUserId?: string;
  route?: NimiRoutePolicy;
  fallback?: NimiFallbackPolicy;
  timeoutMs?: number;
  metadata?: Record<string, string>;
};

export type EmbeddingGenerateOutput = {
  vectors: number[][];
  usage: NimiTokenUsage;
  trace: NimiTraceInfo;
};

export type ImageGenerateInput = {
  model: string;
  prompt: string;
  subjectUserId?: string;
  negativePrompt?: string;
  n?: number;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  style?: string;
  seed?: number;
  referenceImages?: string[];
  mask?: string;
  responseFormat?: 'url' | 'base64';
  route?: NimiRoutePolicy;
  fallback?: NimiFallbackPolicy;
  timeoutMs?: number;
  connectorId?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type VideoGenerateInput = {
  model: string;
  prompt: string;
  subjectUserId?: string;
  negativePrompt?: string;
  durationSec?: number;
  fps?: number;
  resolution?: string;
  aspectRatio?: string;
  seed?: number;
  firstFrameUri?: string;
  lastFrameUri?: string;
  cameraMotion?: string;
  route?: NimiRoutePolicy;
  fallback?: NimiFallbackPolicy;
  timeoutMs?: number;
  connectorId?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type SpeechSynthesizeInput = {
  model: string;
  text: string;
  subjectUserId?: string;
  voice?: string;
  language?: string;
  audioFormat?: string;
  sampleRateHz?: number;
  speed?: number;
  pitch?: number;
  volume?: number;
  emotion?: string;
  route?: NimiRoutePolicy;
  fallback?: NimiFallbackPolicy;
  timeoutMs?: number;
  connectorId?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type SpeechTranscribeInput = {
  model: string;
  subjectUserId?: string;
  audio:
    | { kind: 'bytes'; bytes: Uint8Array }
    | { kind: 'url'; url: string }
    | { kind: 'chunks'; chunks: Uint8Array[] };
  mimeType?: string;
  language?: string;
  timestamps?: boolean;
  diarization?: boolean;
  speakerCount?: number;
  prompt?: string;
  responseFormat?: string;
  route?: NimiRoutePolicy;
  fallback?: NimiFallbackPolicy;
  timeoutMs?: number;
  connectorId?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type ImageGenerateOutput = {
  job: MediaJob;
  artifacts: MediaArtifact[];
  trace: NimiTraceInfo;
};

export type VideoGenerateOutput = {
  job: MediaJob;
  artifacts: MediaArtifact[];
  trace: NimiTraceInfo;
};

export type SpeechSynthesizeOutput = {
  job: MediaJob;
  artifacts: MediaArtifact[];
  trace: NimiTraceInfo;
};

export type SpeechTranscribeOutput = {
  job: MediaJob;
  text: string;
  trace: NimiTraceInfo;
};

export type SpeechListVoicesInput = {
  model: string;
  subjectUserId?: string;
  route?: NimiRoutePolicy;
  fallback?: NimiFallbackPolicy;
  connectorId?: string;
  metadata?: Record<string, string>;
};

export type SpeechListVoicesOutput = {
  voices: Array<{
    voiceId: string;
    name: string;
    lang: string;
    supportedLangs: string[];
  }>;
  modelResolved: string;
  traceId: string;
};

export type SpeechStreamSynthesisInput = {
  model: string;
  text: string;
  subjectUserId?: string;
  voice?: string;
  language?: string;
  audioFormat?: string;
  sampleRateHz?: number;
  speed?: number;
  pitch?: number;
  volume?: number;
  emotion?: string;
  route?: NimiRoutePolicy;
  fallback?: NimiFallbackPolicy;
  timeoutMs?: number;
  connectorId?: string;
  metadata?: Record<string, string>;
  providerOptions?: Record<string, unknown>;
};

export type MediaJobSubmitInput =
  | { modal: 'image'; input: ImageGenerateInput }
  | { modal: 'video'; input: VideoGenerateInput }
  | { modal: 'tts'; input: SpeechSynthesizeInput }
  | { modal: 'stt'; input: SpeechTranscribeInput };

export type RuntimeScopeModule = {
  register(input: ScopeManifest): Promise<ScopeCatalogEntry>;
  publish(): Promise<ScopeCatalogPublishResult>;
  revoke(input: { scopes: string[] }): Promise<ScopeCatalogRevokeResult>;
  list(input?: { include?: Array<'realm' | 'runtime' | 'app'> }): Promise<ScopeCatalogDescriptor>;
};

export type RuntimeAiGenerateRequestInput =
  Omit<GenerateRequest, 'subjectUserId'>
  & { subjectUserId?: string };

export type RuntimeAiStreamGenerateRequestInput =
  Omit<StreamGenerateRequest, 'subjectUserId'>
  & { subjectUserId?: string };

export type RuntimeAiEmbedRequestInput =
  Omit<EmbedRequest, 'subjectUserId'>
  & { subjectUserId?: string };

export type RuntimeAiSubmitMediaJobRequestInput =
  Omit<SubmitMediaJobRequest, 'subjectUserId'>
  & { subjectUserId?: string };

export type RuntimeAiModule = {
  generate(
    request: RuntimeAiGenerateRequestInput,
    options?: RuntimeCallOptions,
  ): Promise<GenerateResponse>;
  streamGenerate(
    request: RuntimeAiStreamGenerateRequestInput,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<StreamGenerateEvent>>;
  embed(
    request: RuntimeAiEmbedRequestInput,
    options?: RuntimeCallOptions,
  ): Promise<EmbedResponse>;
  submitMediaJob(
    request: RuntimeAiSubmitMediaJobRequestInput,
    options?: RuntimeCallOptions,
  ): Promise<SubmitMediaJobResponse>;
  getMediaJob(request: GetMediaJobRequest, options?: RuntimeCallOptions): Promise<GetMediaJobResponse>;
  cancelMediaJob(
    request: CancelMediaJobRequest,
    options?: RuntimeCallOptions,
  ): Promise<CancelMediaJobResponse>;
  subscribeMediaJobEvents(
    request: SubscribeMediaJobEventsRequest,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<MediaJobEvent>>;
  getMediaResult(
    request: GetMediaArtifactsRequest,
    options?: RuntimeCallOptions,
  ): Promise<GetMediaArtifactsResponse>;
  text: {
    generate(input: TextGenerateInput): Promise<TextGenerateOutput>;
    stream(input: TextStreamInput): Promise<TextStreamOutput>;
  };
  embedding: {
    generate(input: EmbeddingGenerateInput): Promise<EmbeddingGenerateOutput>;
  };
};

export type RuntimeMediaModule = {
  image: {
    generate(input: ImageGenerateInput): Promise<ImageGenerateOutput>;
    stream(input: ImageGenerateInput): Promise<AsyncIterable<ArtifactChunk>>;
  };
  video: {
    generate(input: VideoGenerateInput): Promise<VideoGenerateOutput>;
    stream(input: VideoGenerateInput): Promise<AsyncIterable<ArtifactChunk>>;
  };
  tts: {
    synthesize(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeOutput>;
    stream(input: SpeechSynthesizeInput): Promise<AsyncIterable<ArtifactChunk>>;
    listVoices(input: SpeechListVoicesInput): Promise<SpeechListVoicesOutput>;
    streamSynthesis(input: SpeechStreamSynthesisInput): Promise<AsyncIterable<ArtifactChunk>>;
  };
  stt: {
    transcribe(input: SpeechTranscribeInput): Promise<SpeechTranscribeOutput>;
  };
  jobs: {
    submit(input: MediaJobSubmitInput): Promise<MediaJob>;
    get(jobId: string): Promise<MediaJob>;
    cancel(input: { jobId: string; reason?: string }): Promise<MediaJob>;
    subscribe(jobId: string): Promise<AsyncIterable<MediaJobEvent>>;
    getArtifacts(jobId: string): Promise<{ artifacts: MediaArtifact[]; traceId?: string }>;
  };
};

export type RuntimeEventName =
  | 'runtime.connected'
  | 'runtime.disconnected'
  | 'auth.token.issued'
  | 'auth.token.revoked'
  | 'error';

export type RuntimeEventPayloadMap = {
  'runtime.connected': { at: string };
  'runtime.disconnected': { at: string; reasonCode?: string };
  'auth.token.issued': { tokenId: string; at: string };
  'auth.token.revoked': { tokenId: string; at: string };
  error: { error: NimiError; at: string };
};

export type RuntimeEventsModule = {
  on<Name extends RuntimeEventName>(
    name: Name,
    handler: (event: RuntimeEventPayloadMap[Name]) => void,
  ): () => void;
  once<Name extends RuntimeEventName>(
    name: Name,
    handler: (event: RuntimeEventPayloadMap[Name]) => void,
  ): () => void;
};

export type RuntimeRawModule = {
  call<TReq, TRes>(
    methodId: string,
    input: TReq,
    options?: RuntimeCallOptions | RuntimeStreamCallOptions,
  ): Promise<TRes>;
  closeStream(streamId: string): Promise<void>;
};

export type RuntimeMethod<TReq, TRes> = {
  methodId: string;
  kind?: 'unary' | 'stream';
};
