import type { NimiError } from '../types/index.js';

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
  ArtifactChunk,
  EmbedRequest,
  EmbedResponse,
  GenerateImageRequest,
  GenerateRequest,
  GenerateResponse,
  GenerateVideoRequest,
  StreamGenerateEvent,
  StreamGenerateRequest,
  SynthesizeSpeechRequest,
  TranscribeAudioRequest,
  TranscribeAudioResponse,
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

export type RuntimeNodeGrpcTransportConfig = {
  type: 'node-grpc';
  endpoint: string;
  tls?: {
    enabled: boolean;
    serverName?: string;
    rootCertPem?: string;
  };
};

export type RuntimeTauriIpcTransportConfig = {
  type: 'tauri-ipc';
  commandNamespace?: string;
  eventNamespace?: string;
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
};

export type RuntimeWireMessage = Uint8Array;

export type RuntimeUnaryCall<Request = RuntimeWireMessage> = {
  methodId: string;
  request: Request;
  metadata: RuntimeMetadata;
  timeoutMs?: number;
};

export type RuntimeOpenStreamCall<Request = RuntimeWireMessage> = {
  methodId: string;
  request: Request;
  metadata: RuntimeMetadata;
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
  generateImage(request: GenerateImageRequest, options?: RuntimeStreamCallOptions): Promise<AsyncIterable<ArtifactChunk>>;
  generateVideo(request: GenerateVideoRequest, options?: RuntimeStreamCallOptions): Promise<AsyncIterable<ArtifactChunk>>;
  synthesizeSpeech(request: SynthesizeSpeechRequest, options?: RuntimeStreamCallOptions): Promise<AsyncIterable<ArtifactChunk>>;
  transcribeAudio(request: TranscribeAudioRequest, options?: RuntimeCallOptions): Promise<TranscribeAudioResponse>;
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
  knowledge: RuntimeKnowledgeClient;
  app: RuntimeAppClient;
  audit: RuntimeAuditClient;
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
