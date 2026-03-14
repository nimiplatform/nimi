import { RuntimeMethodIds } from '../method-ids';

import {
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
} from '../generated/runtime/v1/auth';
import {
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
  IssueDelegatedAccessTokenRequest,
  IssueDelegatedAccessTokenResponse,
  ListTokenChainRequest,
  ListTokenChainResponse,
  RevokeAppAccessTokenRequest,
  ValidateAppAccessTokenRequest,
  ValidateAppAccessTokenResponse,
} from '../generated/runtime/v1/grant';
import {
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
} from '../generated/runtime/v1/ai';
import {
  DeleteVoiceAssetRequest,
  DeleteVoiceAssetResponse,
  GetVoiceAssetRequest,
  GetVoiceAssetResponse,
  ListPresetVoicesRequest,
  ListPresetVoicesResponse,
  ListVoiceAssetsRequest,
  ListVoiceAssetsResponse,
} from '../generated/runtime/v1/voice';
import {
  CancelWorkflowRequest,
  GetWorkflowRequest,
  GetWorkflowResponse,
  SubmitWorkflowRequest,
  SubmitWorkflowResponse,
  SubscribeWorkflowEventsRequest,
  WorkflowEvent,
} from '../generated/runtime/v1/workflow';
import {
  CheckModelHealthRequest,
  CheckModelHealthResponse,
  ListModelsRequest,
  ListModelsResponse,
  PullModelRequest,
  PullModelResponse,
  RemoveModelRequest,
} from '../generated/runtime/v1/model';
import {
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
} from '../generated/runtime/v1/local_runtime';
import {
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
} from '../generated/runtime/v1/local_runtime_engine';
import {
  BuildIndexRequest,
  BuildIndexResponse,
  DeleteIndexRequest,
  SearchIndexRequest,
  SearchIndexResponse,
} from '../generated/runtime/v1/knowledge';
import {
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
  ListModelCatalogProvidersRequest,
  ListModelCatalogProvidersResponse,
  UpsertModelCatalogProviderRequest,
  UpsertModelCatalogProviderResponse,
  DeleteModelCatalogProviderRequest,
  DeleteModelCatalogProviderResponse,
} from '../generated/runtime/v1/connector';
import {
  AppMessageEvent,
  SendAppMessageRequest,
  SendAppMessageResponse,
  SubscribeAppMessagesRequest,
} from '../generated/runtime/v1/app';
import {
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
} from '../generated/runtime/v1/audit';
import { Ack } from '../generated/runtime/v1/common';

type BinaryMessageType<T> = {
  create(value?: Partial<T>): T;
};

export type RuntimeUnaryMethodCodec<Request, Response> = {
  requestType: BinaryMessageType<Request>;
  responseType: BinaryMessageType<Response>;
};

export type RuntimeStreamMethodCodec<Request, Event> = {
  requestType: BinaryMessageType<Request>;
  eventType: BinaryMessageType<Event>;
};

export const RuntimeUnaryMethodCodecs: Record<string, RuntimeUnaryMethodCodec<unknown, unknown>> = {
  [RuntimeMethodIds.auth.registerApp]: {
    requestType: RegisterAppRequest,
    responseType: RegisterAppResponse,
  },
  [RuntimeMethodIds.auth.openSession]: {
    requestType: OpenSessionRequest,
    responseType: OpenSessionResponse,
  },
  [RuntimeMethodIds.auth.refreshSession]: {
    requestType: RefreshSessionRequest,
    responseType: RefreshSessionResponse,
  },
  [RuntimeMethodIds.auth.revokeSession]: {
    requestType: RevokeSessionRequest,
    responseType: Ack,
  },
  [RuntimeMethodIds.auth.registerExternalPrincipal]: {
    requestType: RegisterExternalPrincipalRequest,
    responseType: RegisterExternalPrincipalResponse,
  },
  [RuntimeMethodIds.auth.openExternalPrincipalSession]: {
    requestType: OpenExternalPrincipalSessionRequest,
    responseType: OpenExternalPrincipalSessionResponse,
  },
  [RuntimeMethodIds.auth.revokeExternalPrincipalSession]: {
    requestType: RevokeExternalPrincipalSessionRequest,
    responseType: Ack,
  },
  [RuntimeMethodIds.appAuth.authorizeExternalPrincipal]: {
    requestType: AuthorizeExternalPrincipalRequest,
    responseType: AuthorizeExternalPrincipalResponse,
  },
  [RuntimeMethodIds.appAuth.validateToken]: {
    requestType: ValidateAppAccessTokenRequest,
    responseType: ValidateAppAccessTokenResponse,
  },
  [RuntimeMethodIds.appAuth.revokeToken]: {
    requestType: RevokeAppAccessTokenRequest,
    responseType: Ack,
  },
  [RuntimeMethodIds.appAuth.issueDelegatedToken]: {
    requestType: IssueDelegatedAccessTokenRequest,
    responseType: IssueDelegatedAccessTokenResponse,
  },
  [RuntimeMethodIds.appAuth.listTokenChain]: {
    requestType: ListTokenChainRequest,
    responseType: ListTokenChainResponse,
  },
  [RuntimeMethodIds.ai.executeScenario]: {
    requestType: ExecuteScenarioRequest,
    responseType: ExecuteScenarioResponse,
  },
  [RuntimeMethodIds.ai.submitScenarioJob]: {
    requestType: SubmitScenarioJobRequest,
    responseType: SubmitScenarioJobResponse,
  },
  [RuntimeMethodIds.ai.getScenarioJob]: {
    requestType: GetScenarioJobRequest,
    responseType: GetScenarioJobResponse,
  },
  [RuntimeMethodIds.ai.cancelScenarioJob]: {
    requestType: CancelScenarioJobRequest,
    responseType: CancelScenarioJobResponse,
  },
  [RuntimeMethodIds.ai.getScenarioArtifacts]: {
    requestType: GetScenarioArtifactsRequest,
    responseType: GetScenarioArtifactsResponse,
  },
  [RuntimeMethodIds.ai.listScenarioProfiles]: {
    requestType: ListScenarioProfilesRequest,
    responseType: ListScenarioProfilesResponse,
  },
  [RuntimeMethodIds.ai.getVoiceAsset]: {
    requestType: GetVoiceAssetRequest,
    responseType: GetVoiceAssetResponse,
  },
  [RuntimeMethodIds.ai.listVoiceAssets]: {
    requestType: ListVoiceAssetsRequest,
    responseType: ListVoiceAssetsResponse,
  },
  [RuntimeMethodIds.ai.deleteVoiceAsset]: {
    requestType: DeleteVoiceAssetRequest,
    responseType: DeleteVoiceAssetResponse,
  },
  [RuntimeMethodIds.ai.listPresetVoices]: {
    requestType: ListPresetVoicesRequest,
    responseType: ListPresetVoicesResponse,
  },
  [RuntimeMethodIds.aiRealtime.openRealtimeSession]: {
    requestType: OpenRealtimeSessionRequest,
    responseType: OpenRealtimeSessionResponse,
  },
  [RuntimeMethodIds.aiRealtime.appendRealtimeInput]: {
    requestType: AppendRealtimeInputRequest,
    responseType: AppendRealtimeInputResponse,
  },
  [RuntimeMethodIds.aiRealtime.closeRealtimeSession]: {
    requestType: CloseRealtimeSessionRequest,
    responseType: CloseRealtimeSessionResponse,
  },
  [RuntimeMethodIds.workflow.submit]: {
    requestType: SubmitWorkflowRequest,
    responseType: SubmitWorkflowResponse,
  },
  [RuntimeMethodIds.workflow.get]: {
    requestType: GetWorkflowRequest,
    responseType: GetWorkflowResponse,
  },
  [RuntimeMethodIds.workflow.cancel]: {
    requestType: CancelWorkflowRequest,
    responseType: Ack,
  },
  [RuntimeMethodIds.model.list]: {
    requestType: ListModelsRequest,
    responseType: ListModelsResponse,
  },
  [RuntimeMethodIds.model.pull]: {
    requestType: PullModelRequest,
    responseType: PullModelResponse,
  },
  [RuntimeMethodIds.model.remove]: {
    requestType: RemoveModelRequest,
    responseType: Ack,
  },
  [RuntimeMethodIds.model.checkHealth]: {
    requestType: CheckModelHealthRequest,
    responseType: CheckModelHealthResponse,
  },
  [RuntimeMethodIds.local.listLocalModels]: {
    requestType: ListLocalModelsRequest,
    responseType: ListLocalModelsResponse,
  },
  [RuntimeMethodIds.local.listLocalArtifacts]: {
    requestType: ListLocalArtifactsRequest,
    responseType: ListLocalArtifactsResponse,
  },
  [RuntimeMethodIds.local.listVerifiedModels]: {
    requestType: ListVerifiedModelsRequest,
    responseType: ListVerifiedModelsResponse,
  },
  [RuntimeMethodIds.local.listVerifiedArtifacts]: {
    requestType: ListVerifiedArtifactsRequest,
    responseType: ListVerifiedArtifactsResponse,
  },
  [RuntimeMethodIds.local.searchCatalogModels]: {
    requestType: SearchCatalogModelsRequest,
    responseType: SearchCatalogModelsResponse,
  },
  [RuntimeMethodIds.local.resolveModelInstallPlan]: {
    requestType: ResolveModelInstallPlanRequest,
    responseType: ResolveModelInstallPlanResponse,
  },
  [RuntimeMethodIds.local.installLocalModel]: {
    requestType: InstallLocalModelRequest,
    responseType: InstallLocalModelResponse,
  },
  [RuntimeMethodIds.local.installVerifiedModel]: {
    requestType: InstallVerifiedModelRequest,
    responseType: InstallVerifiedModelResponse,
  },
  [RuntimeMethodIds.local.installVerifiedArtifact]: {
    requestType: InstallVerifiedArtifactRequest,
    responseType: InstallVerifiedArtifactResponse,
  },
  [RuntimeMethodIds.local.importLocalModel]: {
    requestType: ImportLocalModelRequest,
    responseType: ImportLocalModelResponse,
  },
  [RuntimeMethodIds.local.importLocalArtifact]: {
    requestType: ImportLocalArtifactRequest,
    responseType: ImportLocalArtifactResponse,
  },
  [RuntimeMethodIds.local.removeLocalModel]: {
    requestType: RemoveLocalModelRequest,
    responseType: RemoveLocalModelResponse,
  },
  [RuntimeMethodIds.local.removeLocalArtifact]: {
    requestType: RemoveLocalArtifactRequest,
    responseType: RemoveLocalArtifactResponse,
  },
  [RuntimeMethodIds.local.startLocalModel]: {
    requestType: StartLocalModelRequest,
    responseType: StartLocalModelResponse,
  },
  [RuntimeMethodIds.local.stopLocalModel]: {
    requestType: StopLocalModelRequest,
    responseType: StopLocalModelResponse,
  },
  [RuntimeMethodIds.local.checkLocalModelHealth]: {
    requestType: CheckLocalModelHealthRequest,
    responseType: CheckLocalModelHealthResponse,
  },
  [RuntimeMethodIds.local.warmLocalModel]: {
    requestType: WarmLocalModelRequest,
    responseType: WarmLocalModelResponse,
  },
  [RuntimeMethodIds.local.collectDeviceProfile]: {
    requestType: CollectDeviceProfileRequest,
    responseType: CollectDeviceProfileResponse,
  },
  [RuntimeMethodIds.local.resolveProfile]: {
    requestType: ResolveProfileRequest,
    responseType: ResolveProfileResponse,
  },
  [RuntimeMethodIds.local.applyProfile]: {
    requestType: ApplyProfileRequest,
    responseType: ApplyProfileResponse,
  },
  [RuntimeMethodIds.local.listLocalServices]: {
    requestType: ListLocalServicesRequest,
    responseType: ListLocalServicesResponse,
  },
  [RuntimeMethodIds.local.installLocalService]: {
    requestType: InstallLocalServiceRequest,
    responseType: InstallLocalServiceResponse,
  },
  [RuntimeMethodIds.local.startLocalService]: {
    requestType: StartLocalServiceRequest,
    responseType: StartLocalServiceResponse,
  },
  [RuntimeMethodIds.local.stopLocalService]: {
    requestType: StopLocalServiceRequest,
    responseType: StopLocalServiceResponse,
  },
  [RuntimeMethodIds.local.checkLocalServiceHealth]: {
    requestType: CheckLocalServiceHealthRequest,
    responseType: CheckLocalServiceHealthResponse,
  },
  [RuntimeMethodIds.local.removeLocalService]: {
    requestType: RemoveLocalServiceRequest,
    responseType: RemoveLocalServiceResponse,
  },
  [RuntimeMethodIds.local.listNodeCatalog]: {
    requestType: ListNodeCatalogRequest,
    responseType: ListNodeCatalogResponse,
  },
  [RuntimeMethodIds.local.listLocalAudits]: {
    requestType: ListLocalAuditsRequest,
    responseType: ListLocalAuditsResponse,
  },
  [RuntimeMethodIds.local.appendInferenceAudit]: {
    requestType: AppendInferenceAuditRequest,
    responseType: Ack,
  },
  [RuntimeMethodIds.local.appendRuntimeAudit]: {
    requestType: AppendRuntimeAuditRequest,
    responseType: Ack,
  },
  [RuntimeMethodIds.local.listEngines]: {
    requestType: ListEnginesRequest,
    responseType: ListEnginesResponse,
  },
  [RuntimeMethodIds.local.ensureEngine]: {
    requestType: EnsureEngineRequest,
    responseType: EnsureEngineResponse,
  },
  [RuntimeMethodIds.local.startEngine]: {
    requestType: StartEngineRequest,
    responseType: StartEngineResponse,
  },
  [RuntimeMethodIds.local.stopEngine]: {
    requestType: StopEngineRequest,
    responseType: StopEngineResponse,
  },
  [RuntimeMethodIds.local.getEngineStatus]: {
    requestType: GetEngineStatusRequest,
    responseType: GetEngineStatusResponse,
  },
  [RuntimeMethodIds.connector.createConnector]: {
    requestType: CreateConnectorRequest,
    responseType: CreateConnectorResponse,
  },
  [RuntimeMethodIds.connector.getConnector]: {
    requestType: GetConnectorRequest,
    responseType: GetConnectorResponse,
  },
  [RuntimeMethodIds.connector.listConnectors]: {
    requestType: ListConnectorsRequest,
    responseType: ListConnectorsResponse,
  },
  [RuntimeMethodIds.connector.updateConnector]: {
    requestType: UpdateConnectorRequest,
    responseType: UpdateConnectorResponse,
  },
  [RuntimeMethodIds.connector.deleteConnector]: {
    requestType: DeleteConnectorRequest,
    responseType: DeleteConnectorResponse,
  },
  [RuntimeMethodIds.connector.testConnector]: {
    requestType: TestConnectorRequest,
    responseType: TestConnectorResponse,
  },
  [RuntimeMethodIds.connector.listConnectorModels]: {
    requestType: ListConnectorModelsRequest,
    responseType: ListConnectorModelsResponse,
  },
  [RuntimeMethodIds.connector.listProviderCatalog]: {
    requestType: ListProviderCatalogRequest,
    responseType: ListProviderCatalogResponse,
  },
  [RuntimeMethodIds.connector.listModelCatalogProviders]: {
    requestType: ListModelCatalogProvidersRequest,
    responseType: ListModelCatalogProvidersResponse,
  },
  [RuntimeMethodIds.connector.upsertModelCatalogProvider]: {
    requestType: UpsertModelCatalogProviderRequest,
    responseType: UpsertModelCatalogProviderResponse,
  },
  [RuntimeMethodIds.connector.deleteModelCatalogProvider]: {
    requestType: DeleteModelCatalogProviderRequest,
    responseType: DeleteModelCatalogProviderResponse,
  },
  [RuntimeMethodIds.knowledge.buildIndex]: {
    requestType: BuildIndexRequest,
    responseType: BuildIndexResponse,
  },
  [RuntimeMethodIds.knowledge.searchIndex]: {
    requestType: SearchIndexRequest,
    responseType: SearchIndexResponse,
  },
  [RuntimeMethodIds.knowledge.deleteIndex]: {
    requestType: DeleteIndexRequest,
    responseType: Ack,
  },
  [RuntimeMethodIds.app.sendAppMessage]: {
    requestType: SendAppMessageRequest,
    responseType: SendAppMessageResponse,
  },
  [RuntimeMethodIds.audit.listAuditEvents]: {
    requestType: ListAuditEventsRequest,
    responseType: ListAuditEventsResponse,
  },
  [RuntimeMethodIds.audit.listUsageStats]: {
    requestType: ListUsageStatsRequest,
    responseType: ListUsageStatsResponse,
  },
  [RuntimeMethodIds.audit.getRuntimeHealth]: {
    requestType: GetRuntimeHealthRequest,
    responseType: GetRuntimeHealthResponse,
  },
  [RuntimeMethodIds.audit.listAIProviderHealth]: {
    requestType: ListAIProviderHealthRequest,
    responseType: ListAIProviderHealthResponse,
  },
};

export const RuntimeStreamMethodCodecs: Record<string, RuntimeStreamMethodCodec<unknown, unknown>> = {
  [RuntimeMethodIds.ai.streamScenario]: {
    requestType: StreamScenarioRequest,
    eventType: StreamScenarioEvent,
  },
  [RuntimeMethodIds.ai.subscribeScenarioJobEvents]: {
    requestType: SubscribeScenarioJobEventsRequest,
    eventType: ScenarioJobEvent,
  },
  [RuntimeMethodIds.aiRealtime.readRealtimeEvents]: {
    requestType: ReadRealtimeEventsRequest,
    eventType: RealtimeEvent,
  },
  [RuntimeMethodIds.workflow.subscribeEvents]: {
    requestType: SubscribeWorkflowEventsRequest,
    eventType: WorkflowEvent,
  },
  [RuntimeMethodIds.app.subscribeAppMessages]: {
    requestType: SubscribeAppMessagesRequest,
    eventType: AppMessageEvent,
  },
  [RuntimeMethodIds.audit.exportAuditEvents]: {
    requestType: ExportAuditEventsRequest,
    eventType: AuditExportChunk,
  },
  [RuntimeMethodIds.audit.subscribeAIProviderHealthEvents]: {
    requestType: SubscribeAIProviderHealthEventsRequest,
    eventType: AIProviderHealthEvent,
  },
  [RuntimeMethodIds.audit.subscribeRuntimeHealthEvents]: {
    requestType: SubscribeRuntimeHealthEventsRequest,
    eventType: RuntimeHealthEvent,
  },
};
