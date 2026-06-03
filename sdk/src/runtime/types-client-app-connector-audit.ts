import type {
  ReadArtifactBytesRequest,
  ReadArtifactBytesResponse,
} from './generated/runtime/v1/artifact_service';
import type {
  AppInstallJobEvent,
  AppMessageEvent,
  GetAccountAppLibraryRequest,
  GetAccountAppLibraryResponse,
  GetAppInstallJobRequest,
  GetAppInstallJobResponse,
  GetAppPackageReadinessRequest,
  GetAppPackageReadinessResponse,
  GetAppStorageRequest,
  GetAppStorageResponse,
  HealthRepairAppRequest,
  HealthRepairAppResponse,
  InstallAppRequest,
  InstallAppResponse,
  ListAppInstallJobsRequest,
  ListAppInstallJobsResponse,
  OpenAppRequest,
  OpenAppResponse,
  SendAppMessageRequest,
  SendAppMessageResponse,
  SubscribeAppMessagesRequest,
  UninstallAppRequest,
  UninstallAppResponse,
  UpdateAppRequest,
  UpdateAppResponse,
  WatchAppInstallJobEventsRequest,
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
import type {
  RuntimeCallOptions,
  RuntimeStreamCallOptions,
} from './types.js';

export type RuntimeAppClient = {
  sendAppMessage(request: SendAppMessageRequest, options?: RuntimeCallOptions): Promise<SendAppMessageResponse>;
  subscribeAppMessages(request: SubscribeAppMessagesRequest, options?: RuntimeStreamCallOptions): Promise<AsyncIterable<AppMessageEvent>>;
  installApp(request: InstallAppRequest, options?: RuntimeCallOptions): Promise<InstallAppResponse>;
  uninstallApp(request: UninstallAppRequest, options?: RuntimeCallOptions): Promise<UninstallAppResponse>;
  getAppStorage(request: GetAppStorageRequest, options?: RuntimeCallOptions): Promise<GetAppStorageResponse>;
  getAccountAppLibrary(request: GetAccountAppLibraryRequest, options?: RuntimeCallOptions): Promise<GetAccountAppLibraryResponse>;
  getAppPackageReadiness(request: GetAppPackageReadinessRequest, options?: RuntimeCallOptions): Promise<GetAppPackageReadinessResponse>;
  getAppInstallJob(request: GetAppInstallJobRequest, options?: RuntimeCallOptions): Promise<GetAppInstallJobResponse>;
  listAppInstallJobs(request: ListAppInstallJobsRequest, options?: RuntimeCallOptions): Promise<ListAppInstallJobsResponse>;
  watchAppInstallJobEvents(request: WatchAppInstallJobEventsRequest, options?: RuntimeStreamCallOptions): Promise<AsyncIterable<AppInstallJobEvent>>;
  updateApp(request: UpdateAppRequest, options?: RuntimeCallOptions): Promise<UpdateAppResponse>;
  healthRepairApp(request: HealthRepairAppRequest, options?: RuntimeCallOptions): Promise<HealthRepairAppResponse>;
  openApp(request: OpenAppRequest, options?: RuntimeCallOptions): Promise<OpenAppResponse>;
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

export type RuntimeArtifactClient = {
  readArtifactBytes(request: ReadArtifactBytesRequest, options?: RuntimeCallOptions): Promise<ReadArtifactBytesResponse>;
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
