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
  AppendRealtimeInputRequest,
  AppendRealtimeInputResponse,
  CancelScenarioJobRequest,
  CancelScenarioJobResponse,
  CloseRealtimeSessionRequest,
  CloseRealtimeSessionResponse,
  ExecuteScenarioRequest,
  ExecuteScenarioResponse,
  GetScenarioArtifactsRequest,
  GetScenarioArtifactsResponse,
  GetScenarioJobRequest,
  GetScenarioJobResponse,
  ListScenarioProfilesRequest,
  ListScenarioProfilesResponse,
  OpenRealtimeSessionRequest,
  OpenRealtimeSessionResponse,
  ReadRealtimeEventsRequest,
  RealtimeEvent,
  ScenarioJobEvent,
  StreamScenarioEvent,
  StreamScenarioRequest,
  SubmitScenarioJobRequest,
  SubmitScenarioJobResponse,
  SubscribeScenarioJobEventsRequest,
} from './generated/runtime/v1/ai';
import type {
  DeleteVoiceAssetRequest,
  DeleteVoiceAssetResponse,
  GetVoiceAssetRequest,
  GetVoiceAssetResponse,
  ListPresetVoicesRequest,
  ListPresetVoicesResponse,
  ListVoiceAssetsRequest,
  ListVoiceAssetsResponse,
} from './generated/runtime/v1/voice';
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
  ApplyProfileRequest,
  ApplyProfileResponse,
  AppendInferenceAuditRequest,
  AppendRuntimeAuditRequest,
  CheckLocalModelHealthRequest,
  CheckLocalModelHealthResponse,
  CheckLocalServiceHealthRequest,
  CheckLocalServiceHealthResponse,
  CollectDeviceProfileRequest,
  CollectDeviceProfileResponse,
  ImportLocalArtifactRequest,
  ImportLocalArtifactResponse,
  ImportLocalModelRequest,
  ImportLocalModelResponse,
  InstallLocalModelRequest,
  InstallLocalModelResponse,
  InstallLocalServiceRequest,
  InstallLocalServiceResponse,
  InstallVerifiedArtifactRequest,
  InstallVerifiedArtifactResponse,
  InstallVerifiedModelRequest,
  InstallVerifiedModelResponse,
  ListLocalArtifactsRequest,
  ListLocalArtifactsResponse,
  ListLocalAuditsRequest,
  ListLocalAuditsResponse,
  ListLocalModelsRequest,
  ListLocalModelsResponse,
  ListLocalServicesRequest,
  ListLocalServicesResponse,
  ListNodeCatalogRequest,
  ListNodeCatalogResponse,
  ListVerifiedArtifactsRequest,
  ListVerifiedArtifactsResponse,
  ListVerifiedModelsRequest,
  ListVerifiedModelsResponse,
  RemoveLocalArtifactRequest,
  RemoveLocalArtifactResponse,
  RemoveLocalModelRequest,
  RemoveLocalModelResponse,
  RemoveLocalServiceRequest,
  RemoveLocalServiceResponse,
  ResolveProfileRequest,
  ResolveProfileResponse,
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
  WarmLocalModelRequest,
  WarmLocalModelResponse,
} from './generated/runtime/v1/local_runtime';
import type {
  EnsureEngineRequest,
  EnsureEngineResponse,
  GetEngineStatusRequest,
  GetEngineStatusResponse,
  ListEnginesRequest,
  ListEnginesResponse,
  StartEngineRequest,
  StartEngineResponse,
  StopEngineRequest,
  StopEngineResponse,
} from './generated/runtime/v1/local_runtime_engine';
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
  DeleteCatalogModelOverlayRequest,
  DeleteCatalogModelOverlayResponse,
  DeleteConnectorRequest,
  DeleteConnectorResponse,
  DeleteModelCatalogProviderRequest,
  DeleteModelCatalogProviderResponse,
  GetCatalogModelDetailRequest,
  GetCatalogModelDetailResponse,
  GetConnectorRequest,
  GetConnectorResponse,
  ListCatalogProviderModelsRequest,
  ListCatalogProviderModelsResponse,
  ListConnectorModelsRequest,
  ListConnectorModelsResponse,
  ListConnectorsRequest,
  ListConnectorsResponse,
  ListModelCatalogProvidersRequest,
  ListModelCatalogProvidersResponse,
  ListProviderCatalogRequest,
  ListProviderCatalogResponse,
  TestConnectorRequest,
  TestConnectorResponse,
  UpdateConnectorRequest,
  UpdateConnectorResponse,
  UpsertCatalogModelOverlayRequest,
  UpsertCatalogModelOverlayResponse,
  UpsertModelCatalogProviderRequest,
  UpsertModelCatalogProviderResponse,
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
import type { Ack } from './generated/runtime/v1/common';
import type {
  RuntimeCallOptions,
  RuntimeStreamCallOptions,
  RuntimeTransportConfig,
} from './types.js';

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
  executeScenario(request: ExecuteScenarioRequest, options?: RuntimeCallOptions): Promise<ExecuteScenarioResponse>;
  streamScenario(request: StreamScenarioRequest, options?: RuntimeStreamCallOptions): Promise<AsyncIterable<StreamScenarioEvent>>;
  submitScenarioJob(request: SubmitScenarioJobRequest, options?: RuntimeCallOptions): Promise<SubmitScenarioJobResponse>;
  getScenarioJob(request: GetScenarioJobRequest, options?: RuntimeCallOptions): Promise<GetScenarioJobResponse>;
  cancelScenarioJob(request: CancelScenarioJobRequest, options?: RuntimeCallOptions): Promise<CancelScenarioJobResponse>;
  subscribeScenarioJobEvents(
    request: SubscribeScenarioJobEventsRequest,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<ScenarioJobEvent>>;
  getScenarioArtifacts(request: GetScenarioArtifactsRequest, options?: RuntimeCallOptions): Promise<GetScenarioArtifactsResponse>;
  listScenarioProfiles(request: ListScenarioProfilesRequest, options?: RuntimeCallOptions): Promise<ListScenarioProfilesResponse>;
  getVoiceAsset(request: GetVoiceAssetRequest, options?: RuntimeCallOptions): Promise<GetVoiceAssetResponse>;
  listVoiceAssets(request: ListVoiceAssetsRequest, options?: RuntimeCallOptions): Promise<ListVoiceAssetsResponse>;
  deleteVoiceAsset(request: DeleteVoiceAssetRequest, options?: RuntimeCallOptions): Promise<DeleteVoiceAssetResponse>;
  listPresetVoices(request: ListPresetVoicesRequest, options?: RuntimeCallOptions): Promise<ListPresetVoicesResponse>;
  openRealtimeSession(request: OpenRealtimeSessionRequest, options?: RuntimeCallOptions): Promise<OpenRealtimeSessionResponse>;
  appendRealtimeInput(request: AppendRealtimeInputRequest, options?: RuntimeCallOptions): Promise<AppendRealtimeInputResponse>;
  readRealtimeEvents(
    request: ReadRealtimeEventsRequest,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<RealtimeEvent>>;
  closeRealtimeSession(
    request: CloseRealtimeSessionRequest,
    options?: RuntimeCallOptions,
  ): Promise<CloseRealtimeSessionResponse>;
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

export type RuntimeLocalServiceClient = {
  listLocalModels(request: ListLocalModelsRequest, options?: RuntimeCallOptions): Promise<ListLocalModelsResponse>;
  listLocalArtifacts(request: ListLocalArtifactsRequest, options?: RuntimeCallOptions): Promise<ListLocalArtifactsResponse>;
  listVerifiedModels(request: ListVerifiedModelsRequest, options?: RuntimeCallOptions): Promise<ListVerifiedModelsResponse>;
  listVerifiedArtifacts(request: ListVerifiedArtifactsRequest, options?: RuntimeCallOptions): Promise<ListVerifiedArtifactsResponse>;
  searchCatalogModels(request: SearchCatalogModelsRequest, options?: RuntimeCallOptions): Promise<SearchCatalogModelsResponse>;
  resolveModelInstallPlan(request: ResolveModelInstallPlanRequest, options?: RuntimeCallOptions): Promise<ResolveModelInstallPlanResponse>;
  installLocalModel(request: InstallLocalModelRequest, options?: RuntimeCallOptions): Promise<InstallLocalModelResponse>;
  installVerifiedModel(request: InstallVerifiedModelRequest, options?: RuntimeCallOptions): Promise<InstallVerifiedModelResponse>;
  installVerifiedArtifact(request: InstallVerifiedArtifactRequest, options?: RuntimeCallOptions): Promise<InstallVerifiedArtifactResponse>;
  importLocalModel(request: ImportLocalModelRequest, options?: RuntimeCallOptions): Promise<ImportLocalModelResponse>;
  importLocalArtifact(request: ImportLocalArtifactRequest, options?: RuntimeCallOptions): Promise<ImportLocalArtifactResponse>;
  removeLocalModel(request: RemoveLocalModelRequest, options?: RuntimeCallOptions): Promise<RemoveLocalModelResponse>;
  removeLocalArtifact(request: RemoveLocalArtifactRequest, options?: RuntimeCallOptions): Promise<RemoveLocalArtifactResponse>;
  startLocalModel(request: StartLocalModelRequest, options?: RuntimeCallOptions): Promise<StartLocalModelResponse>;
  stopLocalModel(request: StopLocalModelRequest, options?: RuntimeCallOptions): Promise<StopLocalModelResponse>;
  checkLocalModelHealth(request: CheckLocalModelHealthRequest, options?: RuntimeCallOptions): Promise<CheckLocalModelHealthResponse>;
  warmLocalModel(request: WarmLocalModelRequest, options?: RuntimeCallOptions): Promise<WarmLocalModelResponse>;
  collectDeviceProfile(request: CollectDeviceProfileRequest, options?: RuntimeCallOptions): Promise<CollectDeviceProfileResponse>;
  resolveProfile(request: ResolveProfileRequest, options?: RuntimeCallOptions): Promise<ResolveProfileResponse>;
  applyProfile(request: ApplyProfileRequest, options?: RuntimeCallOptions): Promise<ApplyProfileResponse>;
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
  listEngines(request: ListEnginesRequest, options?: RuntimeCallOptions): Promise<ListEnginesResponse>;
  ensureEngine(request: EnsureEngineRequest, options?: RuntimeCallOptions): Promise<EnsureEngineResponse>;
  startEngine(request: StartEngineRequest, options?: RuntimeCallOptions): Promise<StartEngineResponse>;
  stopEngine(request: StopEngineRequest, options?: RuntimeCallOptions): Promise<StopEngineResponse>;
  getEngineStatus(request: GetEngineStatusRequest, options?: RuntimeCallOptions): Promise<GetEngineStatusResponse>;
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
  listModelCatalogProviders(
    request: ListModelCatalogProvidersRequest,
    options?: RuntimeCallOptions,
  ): Promise<ListModelCatalogProvidersResponse>;
  listCatalogProviderModels(
    request: ListCatalogProviderModelsRequest,
    options?: RuntimeCallOptions,
  ): Promise<ListCatalogProviderModelsResponse>;
  getCatalogModelDetail(
    request: GetCatalogModelDetailRequest,
    options?: RuntimeCallOptions,
  ): Promise<GetCatalogModelDetailResponse>;
  upsertModelCatalogProvider(
    request: UpsertModelCatalogProviderRequest,
    options?: RuntimeCallOptions,
  ): Promise<UpsertModelCatalogProviderResponse>;
  deleteModelCatalogProvider(
    request: DeleteModelCatalogProviderRequest,
    options?: RuntimeCallOptions,
  ): Promise<DeleteModelCatalogProviderResponse>;
  upsertCatalogModelOverlay(
    request: UpsertCatalogModelOverlayRequest,
    options?: RuntimeCallOptions,
  ): Promise<UpsertCatalogModelOverlayResponse>;
  deleteCatalogModelOverlay(
    request: DeleteCatalogModelOverlayRequest,
    options?: RuntimeCallOptions,
  ): Promise<DeleteCatalogModelOverlayResponse>;
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
  local: RuntimeLocalServiceClient;
  connector: RuntimeConnectorClient;
  knowledge: RuntimeKnowledgeClient;
  app: RuntimeAppClient;
  audit: RuntimeAuditClient;
  closeStream(streamId: string): Promise<void>;
  close(): Promise<void>;
};
