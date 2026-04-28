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
  AccountSessionEvent,
  BeginLoginRequest,
  BeginLoginResponse,
  CompleteLoginRequest,
  CompleteLoginResponse,
  GetAccessTokenRequest,
  GetAccessTokenResponse,
  GetAccountSessionStatusRequest,
  GetAccountSessionStatusResponse,
  IssueScopedAppBindingRequest,
  IssueScopedAppBindingResponse,
  LogoutRequest,
  LogoutResponse,
  RefreshAccountSessionRequest,
  RefreshAccountSessionResponse,
  RevokeScopedAppBindingRequest,
  RevokeScopedAppBindingResponse,
  SubscribeAccountSessionEventsRequest,
  SwitchAccountRequest,
  SwitchAccountResponse,
} from './generated/runtime/v1/account';
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
  PeekSchedulingRequest,
  PeekSchedulingResponse,
} from './generated/runtime/v1/ai_scheduling';
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
  CancelLocalTransferRequest,
  CancelLocalTransferResponse,
  CheckLocalAssetHealthRequest,
  CheckLocalAssetHealthResponse,
  CheckLocalServiceHealthRequest,
  CheckLocalServiceHealthResponse,
  CollectDeviceProfileRequest,
  CollectDeviceProfileResponse,
  ImportLocalAssetRequest,
  ImportLocalAssetResponse,
  ImportLocalAssetFileRequest,
  ImportLocalAssetFileResponse,
  InstallLocalServiceRequest,
  InstallLocalServiceResponse,
  InstallVerifiedAssetRequest,
  InstallVerifiedAssetResponse,
  ListLocalAssetsRequest,
  ListLocalAssetsResponse,
  ListLocalAuditsRequest,
  ListLocalAuditsResponse,
  ListLocalServicesRequest,
  ListLocalServicesResponse,
  ListLocalTransfersRequest,
  ListLocalTransfersResponse,
  LocalTransferProgressEvent,
  ListNodeCatalogRequest,
  ListNodeCatalogResponse,
  PauseLocalTransferRequest,
  PauseLocalTransferResponse,
  ListVerifiedAssetsRequest,
  ListVerifiedAssetsResponse,
  RemoveLocalAssetRequest,
  RemoveLocalAssetResponse,
  RemoveLocalServiceRequest,
  RemoveLocalServiceResponse,
  ResumeLocalTransferRequest,
  ResumeLocalTransferResponse,
  ResolveProfileRequest,
  ResolveProfileResponse,
  ScanUnregisteredAssetsRequest,
  ScanUnregisteredAssetsResponse,
  ScaffoldOrphanAssetRequest,
  ScaffoldOrphanAssetResponse,
  ResolveModelInstallPlanRequest,
  ResolveModelInstallPlanResponse,
  SearchCatalogModelsRequest,
  SearchCatalogModelsResponse,
  StartLocalAssetRequest,
  StartLocalAssetResponse,
  StartLocalServiceRequest,
  StartLocalServiceResponse,
  StopLocalAssetRequest,
  StopLocalAssetResponse,
  StopLocalServiceRequest,
  StopLocalServiceResponse,
  WatchLocalTransfersRequest,
  WarmLocalAssetRequest,
  WarmLocalAssetResponse,
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
  CreateKnowledgeBankRequest,
  CreateKnowledgeBankResponse,
  DeleteKnowledgeBankRequest,
  DeleteKnowledgeBankResponse,
  AddLinkRequest,
  AddLinkResponse,
  DeletePageRequest,
  DeletePageResponse,
  GetIngestTaskRequest,
  GetIngestTaskResponse,
  GetKnowledgeBankRequest,
  GetKnowledgeBankResponse,
  GetPageRequest,
  GetPageResponse,
  IngestDocumentRequest,
  IngestDocumentResponse,
  ListBacklinksRequest,
  ListBacklinksResponse,
  ListKnowledgeBanksRequest,
  ListKnowledgeBanksResponse,
  ListLinksRequest,
  ListLinksResponse,
  ListPagesRequest,
  ListPagesResponse,
  PutPageRequest,
  PutPageResponse,
  RemoveLinkRequest,
  RemoveLinkResponse,
  SearchKeywordRequest,
  SearchKeywordResponse,
  SearchHybridRequest,
  SearchHybridResponse,
  TraverseGraphRequest,
  TraverseGraphResponse,
} from './generated/runtime/v1/knowledge';
import type {
  CreateBankRequest,
  CreateBankResponse,
  DeleteBankRequest,
  DeleteBankResponse,
  DeleteMemoryRequest,
  DeleteMemoryResponse,
  GetBankRequest,
  GetBankResponse,
  HistoryRequest,
  HistoryResponse,
  ListBanksRequest,
  ListBanksResponse,
  RecallRequest,
  RecallResponse,
  RetainRequest,
  RetainResponse,
  SubscribeMemoryEventsRequest,
  MemoryEvent,
} from './generated/runtime/v1/memory';
import type {
  CancelHookRequest,
  CancelHookResponse,
  DisableAutonomyRequest,
  DisableAutonomyResponse,
  GetConversationAnchorSnapshotRequest,
  GetConversationAnchorSnapshotResponse,
  EnableAutonomyRequest,
  EnableAutonomyResponse,
  GetAgentRequest,
  GetAgentResponse,
  GetAgentStateRequest,
  GetAgentStateResponse,
  InitializeAgentRequest,
  InitializeAgentResponse,
  ListAgentsRequest,
  ListAgentsResponse,
  ListPendingHooksRequest,
  ListPendingHooksResponse,
  OpenConversationAnchorRequest,
  OpenConversationAnchorResponse,
  QueryAgentMemoryRequest,
  QueryAgentMemoryResponse,
  SetAgentPresentationProfileRequest,
  SetAgentPresentationProfileResponse,
  SetAutonomyConfigRequest,
  SetAutonomyConfigResponse,
  SubscribeAgentEventsRequest,
  AgentEvent,
  TerminateAgentRequest,
  TerminateAgentResponse,
  UpdateAgentStateRequest,
  UpdateAgentStateResponse,
  WriteAgentMemoryRequest,
  WriteAgentMemoryResponse,
} from './generated/runtime/v1/agent_service';
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

export type RuntimeAccountClient = {
  getAccountSessionStatus(request: GetAccountSessionStatusRequest, options?: RuntimeCallOptions): Promise<GetAccountSessionStatusResponse>;
  subscribeAccountSessionEvents(request: SubscribeAccountSessionEventsRequest, options?: RuntimeStreamCallOptions): Promise<AsyncIterable<AccountSessionEvent>>;
  beginLogin(request: BeginLoginRequest, options?: RuntimeCallOptions): Promise<BeginLoginResponse>;
  completeLogin(request: CompleteLoginRequest, options?: RuntimeCallOptions): Promise<CompleteLoginResponse>;
  getAccessToken(request: GetAccessTokenRequest, options?: RuntimeCallOptions): Promise<GetAccessTokenResponse>;
  refreshAccountSession(request: RefreshAccountSessionRequest, options?: RuntimeCallOptions): Promise<RefreshAccountSessionResponse>;
  logout(request: LogoutRequest, options?: RuntimeCallOptions): Promise<LogoutResponse>;
  switchAccount(request: SwitchAccountRequest, options?: RuntimeCallOptions): Promise<SwitchAccountResponse>;
  issueScopedAppBinding(request: IssueScopedAppBindingRequest, options?: RuntimeCallOptions): Promise<IssueScopedAppBindingResponse>;
  revokeScopedAppBinding(request: RevokeScopedAppBindingRequest, options?: RuntimeCallOptions): Promise<RevokeScopedAppBindingResponse>;
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
  peekScheduling(request: PeekSchedulingRequest, options?: RuntimeCallOptions): Promise<PeekSchedulingResponse>;
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
  createKnowledgeBank(request: CreateKnowledgeBankRequest, options?: RuntimeCallOptions): Promise<CreateKnowledgeBankResponse>;
  getKnowledgeBank(request: GetKnowledgeBankRequest, options?: RuntimeCallOptions): Promise<GetKnowledgeBankResponse>;
  listKnowledgeBanks(request: ListKnowledgeBanksRequest, options?: RuntimeCallOptions): Promise<ListKnowledgeBanksResponse>;
  deleteKnowledgeBank(request: DeleteKnowledgeBankRequest, options?: RuntimeCallOptions): Promise<DeleteKnowledgeBankResponse>;
  putPage(request: PutPageRequest, options?: RuntimeCallOptions): Promise<PutPageResponse>;
  getPage(request: GetPageRequest, options?: RuntimeCallOptions): Promise<GetPageResponse>;
  listPages(request: ListPagesRequest, options?: RuntimeCallOptions): Promise<ListPagesResponse>;
  deletePage(request: DeletePageRequest, options?: RuntimeCallOptions): Promise<DeletePageResponse>;
  searchKeyword(request: SearchKeywordRequest, options?: RuntimeCallOptions): Promise<SearchKeywordResponse>;
  searchHybrid(request: SearchHybridRequest, options?: RuntimeCallOptions): Promise<SearchHybridResponse>;
  addLink(request: AddLinkRequest, options?: RuntimeCallOptions): Promise<AddLinkResponse>;
  removeLink(request: RemoveLinkRequest, options?: RuntimeCallOptions): Promise<RemoveLinkResponse>;
  listLinks(request: ListLinksRequest, options?: RuntimeCallOptions): Promise<ListLinksResponse>;
  listBacklinks(request: ListBacklinksRequest, options?: RuntimeCallOptions): Promise<ListBacklinksResponse>;
  traverseGraph(request: TraverseGraphRequest, options?: RuntimeCallOptions): Promise<TraverseGraphResponse>;
  ingestDocument(request: IngestDocumentRequest, options?: RuntimeCallOptions): Promise<IngestDocumentResponse>;
  getIngestTask(request: GetIngestTaskRequest, options?: RuntimeCallOptions): Promise<GetIngestTaskResponse>;
};

export type RuntimeMemoryClient = {
  createBank(request: CreateBankRequest, options?: RuntimeCallOptions): Promise<CreateBankResponse>;
  getBank(request: GetBankRequest, options?: RuntimeCallOptions): Promise<GetBankResponse>;
  listBanks(request: ListBanksRequest, options?: RuntimeCallOptions): Promise<ListBanksResponse>;
  deleteBank(request: DeleteBankRequest, options?: RuntimeCallOptions): Promise<DeleteBankResponse>;
  retain(request: RetainRequest, options?: RuntimeCallOptions): Promise<RetainResponse>;
  recall(request: RecallRequest, options?: RuntimeCallOptions): Promise<RecallResponse>;
  history(request: HistoryRequest, options?: RuntimeCallOptions): Promise<HistoryResponse>;
  deleteMemory(request: DeleteMemoryRequest, options?: RuntimeCallOptions): Promise<DeleteMemoryResponse>;
  subscribeEvents(
    request: SubscribeMemoryEventsRequest,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<MemoryEvent>>;
};

export type RuntimeAgentClient = {
  initializeAgent(request: InitializeAgentRequest, options?: RuntimeCallOptions): Promise<InitializeAgentResponse>;
  terminateAgent(request: TerminateAgentRequest, options?: RuntimeCallOptions): Promise<TerminateAgentResponse>;
  getAgent(request: GetAgentRequest, options?: RuntimeCallOptions): Promise<GetAgentResponse>;
  listAgents(request: ListAgentsRequest, options?: RuntimeCallOptions): Promise<ListAgentsResponse>;
  openConversationAnchor(
    request: OpenConversationAnchorRequest,
    options?: RuntimeCallOptions,
  ): Promise<OpenConversationAnchorResponse>;
  getConversationAnchorSnapshot(
    request: GetConversationAnchorSnapshotRequest,
    options?: RuntimeCallOptions,
  ): Promise<GetConversationAnchorSnapshotResponse>;
  getAgentState(request: GetAgentStateRequest, options?: RuntimeCallOptions): Promise<GetAgentStateResponse>;
  updateAgentState(request: UpdateAgentStateRequest, options?: RuntimeCallOptions): Promise<UpdateAgentStateResponse>;
  setPresentationProfile(
    request: SetAgentPresentationProfileRequest,
    options?: RuntimeCallOptions,
  ): Promise<SetAgentPresentationProfileResponse>;
  enableAutonomy(request: EnableAutonomyRequest, options?: RuntimeCallOptions): Promise<EnableAutonomyResponse>;
  disableAutonomy(request: DisableAutonomyRequest, options?: RuntimeCallOptions): Promise<DisableAutonomyResponse>;
  setAutonomyConfig(request: SetAutonomyConfigRequest, options?: RuntimeCallOptions): Promise<SetAutonomyConfigResponse>;
  listPendingHooks(request: ListPendingHooksRequest, options?: RuntimeCallOptions): Promise<ListPendingHooksResponse>;
  cancelHook(request: CancelHookRequest, options?: RuntimeCallOptions): Promise<CancelHookResponse>;
  queryMemory(request: QueryAgentMemoryRequest, options?: RuntimeCallOptions): Promise<QueryAgentMemoryResponse>;
  writeMemory(request: WriteAgentMemoryRequest, options?: RuntimeCallOptions): Promise<WriteAgentMemoryResponse>;
  subscribeEvents(
    request: SubscribeAgentEventsRequest,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<AgentEvent>>;
};

export type RuntimeLocalServiceClient = {
  listLocalAssets(request: ListLocalAssetsRequest, options?: RuntimeCallOptions): Promise<ListLocalAssetsResponse>;
  listVerifiedAssets(request: ListVerifiedAssetsRequest, options?: RuntimeCallOptions): Promise<ListVerifiedAssetsResponse>;
  searchCatalogModels(request: SearchCatalogModelsRequest, options?: RuntimeCallOptions): Promise<SearchCatalogModelsResponse>;
  resolveModelInstallPlan(request: ResolveModelInstallPlanRequest, options?: RuntimeCallOptions): Promise<ResolveModelInstallPlanResponse>;
  installVerifiedAsset(request: InstallVerifiedAssetRequest, options?: RuntimeCallOptions): Promise<InstallVerifiedAssetResponse>;
  importLocalAsset(request: ImportLocalAssetRequest, options?: RuntimeCallOptions): Promise<ImportLocalAssetResponse>;
  importLocalAssetFile(request: ImportLocalAssetFileRequest, options?: RuntimeCallOptions): Promise<ImportLocalAssetFileResponse>;
  scanUnregisteredAssets(request: ScanUnregisteredAssetsRequest, options?: RuntimeCallOptions): Promise<ScanUnregisteredAssetsResponse>;
  scaffoldOrphanAsset(request: ScaffoldOrphanAssetRequest, options?: RuntimeCallOptions): Promise<ScaffoldOrphanAssetResponse>;
  removeLocalAsset(request: RemoveLocalAssetRequest, options?: RuntimeCallOptions): Promise<RemoveLocalAssetResponse>;
  startLocalAsset(request: StartLocalAssetRequest, options?: RuntimeCallOptions): Promise<StartLocalAssetResponse>;
  stopLocalAsset(request: StopLocalAssetRequest, options?: RuntimeCallOptions): Promise<StopLocalAssetResponse>;
  checkLocalAssetHealth(request: CheckLocalAssetHealthRequest, options?: RuntimeCallOptions): Promise<CheckLocalAssetHealthResponse>;
  warmLocalAsset(request: WarmLocalAssetRequest, options?: RuntimeCallOptions): Promise<WarmLocalAssetResponse>;
  listLocalTransfers(request: ListLocalTransfersRequest, options?: RuntimeCallOptions): Promise<ListLocalTransfersResponse>;
  pauseLocalTransfer(request: PauseLocalTransferRequest, options?: RuntimeCallOptions): Promise<PauseLocalTransferResponse>;
  resumeLocalTransfer(request: ResumeLocalTransferRequest, options?: RuntimeCallOptions): Promise<ResumeLocalTransferResponse>;
  cancelLocalTransfer(request: CancelLocalTransferRequest, options?: RuntimeCallOptions): Promise<CancelLocalTransferResponse>;
  watchLocalTransfers(request: WatchLocalTransfersRequest, options?: RuntimeStreamCallOptions): Promise<AsyncIterable<LocalTransferProgressEvent>>;
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
  account: RuntimeAccountClient;
  ai: RuntimeAiClient;
  workflow: RuntimeWorkflowClient;
  model: RuntimeModelClient;
  memory: RuntimeMemoryClient;
  agent: RuntimeAgentClient;
  local: RuntimeLocalServiceClient;
  connector: RuntimeConnectorClient;
  knowledge: RuntimeKnowledgeClient;
  app: RuntimeAppClient;
  audit: RuntimeAuditClient;
  closeStream(streamId: string): Promise<void>;
  close(): Promise<void>;
};
