import type {
  AdmitProductControlReadyForUseRequest,
  AppendInferenceAuditRequest,
  AppendRuntimeAuditRequest,
  ApplyProfileRequest,
  ApplyProfileResponse,
  CancelLocalEnvironmentDependencyJobRequest,
  CancelLocalEnvironmentDependencyJobResponse,
  CancelLocalTransferRequest,
  CancelLocalTransferResponse,
  CheckLocalAssetHealthRequest,
  CheckLocalAssetHealthResponse,
  CheckLocalServiceHealthRequest,
  CheckLocalServiceHealthResponse,
  CollectDeviceProfileRequest,
  CollectDeviceProfileResponse,
  CompleteProductControlFirstRunDeviceEnvironmentScanRequest,
  EnsureProductControlRecordCreatedRequest,
  ExecuteLocalStateCutoverRequest,
  ExecuteLocalStateCutoverResponse,
  GetProductControlRecordRequest,
  GetProductControlSelectedDataRootRequest,
  GetRecommendationFeedRequest,
  GetRecommendationFeedResponse,
  ImportLocalAssetBundleRequest,
  ImportLocalAssetBundleResponse,
  ImportLocalAssetFileRequest,
  ImportLocalAssetFileResponse,
  ImportLocalAssetRequest,
  ImportLocalAssetResponse,
  InstallLocalServiceRequest,
  InstallLocalServiceResponse,
  InstallModelFromPlanRequest,
  InstallModelFromPlanResponse,
  InstallVerifiedAssetRequest,
  InstallVerifiedAssetResponse,
  ListCatalogVariantsRequest,
  ListCatalogVariantsResponse,
  ListLocalAssetsRequest,
  ListLocalAssetsResponse,
  ListLocalAuditsRequest,
  ListLocalAuditsResponse,
  ListLocalEnvironmentDependencyJobsRequest,
  ListLocalEnvironmentDependencyJobsResponse,
  ListLocalEnvironmentSelectedSourcesRequest,
  ListLocalEnvironmentSelectedSourcesResponse,
  ListLocalServicesRequest,
  ListLocalServicesResponse,
  ListLocalTransfersRequest,
  ListLocalTransfersResponse,
  ListNodeCatalogRequest,
  ListNodeCatalogResponse,
  ListVerifiedAssetsRequest,
  ListVerifiedAssetsResponse,
  LocalTransferProgressEvent,
  MintFirstRunExecutionEvidenceRequest,
  MintFirstRunExecutionEvidenceResponse,
  MintRuntimeBaselineReadinessRequest,
  MintRuntimeBaselineReadinessResponse,
  PauseLocalTransferRequest,
  PauseLocalTransferResponse,
  ProductControlProjectionJson,
  ReconcileProductControlFirstRunSetupStateRequest,
  RecordProductControlAccountDefaultProfileEvidenceRequest,
  RecordProductControlFirstRunLocalAiReadyEvidenceRequest,
  RemoveLocalAssetRequest,
  RemoveLocalAssetResponse,
  RemoveLocalServiceRequest,
  RemoveLocalServiceResponse,
  RepairLocalEnvironmentDependencyRequest,
  RepairLocalEnvironmentDependencyResponse,
  RescanLocalAssetBundleRequest,
  RescanLocalAssetBundleResponse,
  ResolveFirstRunExecutionEvidenceRequest,
  ResolveFirstRunExecutionEvidenceResponse,
  ResolveLocalEnvironmentActivationGateRequest,
  ResolveLocalEnvironmentActivationGateResponse,
  ResolveLocalEnvironmentPlanRequest,
  ResolveLocalEnvironmentPlanResponse,
  ResolveLocalStateReconciliationRequest,
  ResolveLocalStateReconciliationResponse,
  ResolveModelInstallPlanRequest,
  ResolveModelInstallPlanResponse,
  ResolveProfileRequest,
  ResolveProfileResponse,
  ResolveRuntimeBaselineReadinessRequest,
  ResolveRuntimeBaselineReadinessResponse,
  ResumeLocalTransferRequest,
  ResumeLocalTransferResponse,
  RetryLocalEnvironmentDependencyJobRequest,
  RetryLocalEnvironmentDependencyJobResponse,
  ScaffoldOrphanAssetRequest,
  ScaffoldOrphanAssetResponse,
  ScanUnregisteredAssetsRequest,
  ScanUnregisteredAssetsResponse,
  SearchCatalogModelsRequest,
  SearchCatalogModelsResponse,
  SelectProductControlDataRootRequest,
  SetProductControlFirstRunInstallLevelRequest,
  StartLocalAssetRequest,
  StartLocalAssetResponse,
  StartLocalEnvironmentDependencyJobRequest,
  StartLocalEnvironmentDependencyJobResponse,
  StartLocalServiceRequest,
  StartLocalServiceResponse,
  StopLocalAssetRequest,
  StopLocalAssetResponse,
  StopLocalServiceRequest,
  StopLocalServiceResponse,
  WarmLocalAssetRequest,
  WarmLocalAssetResponse,
  WatchLocalTransfersRequest,
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
  Ack,
} from './generated/runtime/v1/common';
import type {
  RuntimeCallOptions,
  RuntimeStreamCallOptions,
} from './types.js';

export type RuntimeLocalServiceClient = {
  listLocalAssets(request: ListLocalAssetsRequest, options?: RuntimeCallOptions): Promise<ListLocalAssetsResponse>;
  listVerifiedAssets(request: ListVerifiedAssetsRequest, options?: RuntimeCallOptions): Promise<ListVerifiedAssetsResponse>;
  searchCatalogModels(request: SearchCatalogModelsRequest, options?: RuntimeCallOptions): Promise<SearchCatalogModelsResponse>;
  listCatalogVariants(request: ListCatalogVariantsRequest, options?: RuntimeCallOptions): Promise<ListCatalogVariantsResponse>;
  getRecommendationFeed(request: GetRecommendationFeedRequest, options?: RuntimeCallOptions): Promise<GetRecommendationFeedResponse>;
  resolveModelInstallPlan(request: ResolveModelInstallPlanRequest, options?: RuntimeCallOptions): Promise<ResolveModelInstallPlanResponse>;
  installModelFromPlan(request: InstallModelFromPlanRequest, options?: RuntimeCallOptions): Promise<InstallModelFromPlanResponse>;
  installVerifiedAsset(request: InstallVerifiedAssetRequest, options?: RuntimeCallOptions): Promise<InstallVerifiedAssetResponse>;
  importLocalAsset(request: ImportLocalAssetRequest, options?: RuntimeCallOptions): Promise<ImportLocalAssetResponse>;
  importLocalAssetFile(request: ImportLocalAssetFileRequest, options?: RuntimeCallOptions): Promise<ImportLocalAssetFileResponse>;
  scanUnregisteredAssets(request: ScanUnregisteredAssetsRequest, options?: RuntimeCallOptions): Promise<ScanUnregisteredAssetsResponse>;
  scaffoldOrphanAsset(request: ScaffoldOrphanAssetRequest, options?: RuntimeCallOptions): Promise<ScaffoldOrphanAssetResponse>;
  importLocalAssetBundle(request: ImportLocalAssetBundleRequest, options?: RuntimeCallOptions): Promise<ImportLocalAssetBundleResponse>;
  rescanLocalAssetBundle(request: RescanLocalAssetBundleRequest, options?: RuntimeCallOptions): Promise<RescanLocalAssetBundleResponse>;
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
  resolveLocalEnvironmentPlan(request: ResolveLocalEnvironmentPlanRequest, options?: RuntimeCallOptions): Promise<ResolveLocalEnvironmentPlanResponse>;
  listLocalEnvironmentSelectedSources(request: ListLocalEnvironmentSelectedSourcesRequest, options?: RuntimeCallOptions): Promise<ListLocalEnvironmentSelectedSourcesResponse>;
  listLocalEnvironmentDependencyJobs(request: ListLocalEnvironmentDependencyJobsRequest, options?: RuntimeCallOptions): Promise<ListLocalEnvironmentDependencyJobsResponse>;
  resolveLocalEnvironmentActivationGate(request: ResolveLocalEnvironmentActivationGateRequest, options?: RuntimeCallOptions): Promise<ResolveLocalEnvironmentActivationGateResponse>;
  mintRuntimeBaselineReadiness(request: MintRuntimeBaselineReadinessRequest, options?: RuntimeCallOptions): Promise<MintRuntimeBaselineReadinessResponse>;
  resolveRuntimeBaselineReadiness(request: ResolveRuntimeBaselineReadinessRequest, options?: RuntimeCallOptions): Promise<ResolveRuntimeBaselineReadinessResponse>;
  mintFirstRunExecutionEvidence(request: MintFirstRunExecutionEvidenceRequest, options?: RuntimeCallOptions): Promise<MintFirstRunExecutionEvidenceResponse>;
  resolveFirstRunExecutionEvidence(request: ResolveFirstRunExecutionEvidenceRequest, options?: RuntimeCallOptions): Promise<ResolveFirstRunExecutionEvidenceResponse>;
  startLocalEnvironmentDependencyJob(request: StartLocalEnvironmentDependencyJobRequest, options?: RuntimeCallOptions): Promise<StartLocalEnvironmentDependencyJobResponse>;
  cancelLocalEnvironmentDependencyJob(request: CancelLocalEnvironmentDependencyJobRequest, options?: RuntimeCallOptions): Promise<CancelLocalEnvironmentDependencyJobResponse>;
  retryLocalEnvironmentDependencyJob(request: RetryLocalEnvironmentDependencyJobRequest, options?: RuntimeCallOptions): Promise<RetryLocalEnvironmentDependencyJobResponse>;
  repairLocalEnvironmentDependency(request: RepairLocalEnvironmentDependencyRequest, options?: RuntimeCallOptions): Promise<RepairLocalEnvironmentDependencyResponse>;
  resolveLocalStateReconciliation(request: ResolveLocalStateReconciliationRequest, options?: RuntimeCallOptions): Promise<ResolveLocalStateReconciliationResponse>;
  executeLocalStateCutover(request: ExecuteLocalStateCutoverRequest, options?: RuntimeCallOptions): Promise<ExecuteLocalStateCutoverResponse>;
  getProductControlRecord(request: GetProductControlRecordRequest, options?: RuntimeCallOptions): Promise<ProductControlProjectionJson>;
  getProductControlSelectedDataRoot(request: GetProductControlSelectedDataRootRequest, options?: RuntimeCallOptions): Promise<ProductControlProjectionJson>;
  ensureProductControlRecordCreated(request: EnsureProductControlRecordCreatedRequest, options?: RuntimeCallOptions): Promise<ProductControlProjectionJson>;
  selectProductControlDataRoot(request: SelectProductControlDataRootRequest, options?: RuntimeCallOptions): Promise<ProductControlProjectionJson>;
  setProductControlFirstRunInstallLevel(request: SetProductControlFirstRunInstallLevelRequest, options?: RuntimeCallOptions): Promise<ProductControlProjectionJson>;
  completeProductControlFirstRunDeviceEnvironmentScan(request: CompleteProductControlFirstRunDeviceEnvironmentScanRequest, options?: RuntimeCallOptions): Promise<ProductControlProjectionJson>;
  admitProductControlReadyForUse(request: AdmitProductControlReadyForUseRequest, options?: RuntimeCallOptions): Promise<ProductControlProjectionJson>;
  recordProductControlAccountDefaultProfileEvidence(request: RecordProductControlAccountDefaultProfileEvidenceRequest, options?: RuntimeCallOptions): Promise<ProductControlProjectionJson>;
  recordProductControlFirstRunLocalAiReadyEvidence(request: RecordProductControlFirstRunLocalAiReadyEvidenceRequest, options?: RuntimeCallOptions): Promise<ProductControlProjectionJson>;
  reconcileProductControlFirstRunSetupState(request: ReconcileProductControlFirstRunSetupStateRequest, options?: RuntimeCallOptions): Promise<ProductControlProjectionJson>;
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
