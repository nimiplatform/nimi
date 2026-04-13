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
  PeekSchedulingRequest,
  PeekSchedulingResponse,
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
  MemoryEvent,
  RecallRequest,
  RecallResponse,
  ReflectRequest,
  ReflectResponse,
  RetainRequest,
  RetainResponse,
  SubscribeMemoryEventsRequest,
} from '../generated/runtime/v1/memory';
import {
  AgentEvent,
  CancelHookRequest,
  CancelHookResponse,
  DisableAutonomyRequest,
  DisableAutonomyResponse,
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
  QueryAgentMemoryRequest,
  QueryAgentMemoryResponse,
  SetAutonomyConfigRequest,
  SetAutonomyConfigResponse,
  SubscribeAgentEventsRequest,
  TerminateAgentRequest,
  TerminateAgentResponse,
  UpdateAgentStateRequest,
  UpdateAgentStateResponse,
  WriteAgentMemoryRequest,
  WriteAgentMemoryResponse,
} from '../generated/runtime/v1/agent_core';
import {
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
  DeleteCatalogModelOverlayRequest,
  DeleteCatalogModelOverlayResponse,
  DeleteConnectorRequest,
  DeleteConnectorResponse,
  GetConnectorRequest,
  GetConnectorResponse,
  GetCatalogModelDetailRequest,
  GetCatalogModelDetailResponse,
  ListCatalogProviderModelsRequest,
  ListCatalogProviderModelsResponse,
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
  UpsertCatalogModelOverlayRequest,
  UpsertCatalogModelOverlayResponse,
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
import type {
  RuntimeStreamMethodContractMap,
  RuntimeStreamMethodId,
  RuntimeUnaryMethodContractMap,
  RuntimeUnaryMethodId,
} from '../runtime-method-contracts.js';

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

type RuntimeUnaryMethodCodecMap = {
  [MethodId in RuntimeUnaryMethodId]: RuntimeUnaryMethodCodec<
    RuntimeUnaryMethodContractMap[MethodId]['request'],
    RuntimeUnaryMethodContractMap[MethodId]['response']
  >;
};

type RuntimeStreamMethodCodecMap = {
  [MethodId in RuntimeStreamMethodId]: RuntimeStreamMethodCodec<
    RuntimeStreamMethodContractMap[MethodId]['request'],
    RuntimeStreamMethodContractMap[MethodId]['response'] extends AsyncIterable<infer Event> ? Event : never
  >;
};

export const RuntimeUnaryMethodCodecs: RuntimeUnaryMethodCodecMap = {
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
  [RuntimeMethodIds.ai.peekScheduling]: {
    requestType: PeekSchedulingRequest,
    responseType: PeekSchedulingResponse,
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
  [RuntimeMethodIds.local.listLocalAssets]: {
    requestType: ListLocalAssetsRequest,
    responseType: ListLocalAssetsResponse,
  },
  [RuntimeMethodIds.local.listVerifiedAssets]: {
    requestType: ListVerifiedAssetsRequest,
    responseType: ListVerifiedAssetsResponse,
  },
  [RuntimeMethodIds.local.searchCatalogModels]: {
    requestType: SearchCatalogModelsRequest,
    responseType: SearchCatalogModelsResponse,
  },
  [RuntimeMethodIds.local.resolveModelInstallPlan]: {
    requestType: ResolveModelInstallPlanRequest,
    responseType: ResolveModelInstallPlanResponse,
  },
  [RuntimeMethodIds.local.installVerifiedAsset]: {
    requestType: InstallVerifiedAssetRequest,
    responseType: InstallVerifiedAssetResponse,
  },
  [RuntimeMethodIds.local.importLocalAsset]: {
    requestType: ImportLocalAssetRequest,
    responseType: ImportLocalAssetResponse,
  },
  [RuntimeMethodIds.local.importLocalAssetFile]: {
    requestType: ImportLocalAssetFileRequest,
    responseType: ImportLocalAssetFileResponse,
  },
  [RuntimeMethodIds.local.scanUnregisteredAssets]: {
    requestType: ScanUnregisteredAssetsRequest,
    responseType: ScanUnregisteredAssetsResponse,
  },
  [RuntimeMethodIds.local.scaffoldOrphanAsset]: {
    requestType: ScaffoldOrphanAssetRequest,
    responseType: ScaffoldOrphanAssetResponse,
  },
  [RuntimeMethodIds.local.removeLocalAsset]: {
    requestType: RemoveLocalAssetRequest,
    responseType: RemoveLocalAssetResponse,
  },
  [RuntimeMethodIds.local.startLocalAsset]: {
    requestType: StartLocalAssetRequest,
    responseType: StartLocalAssetResponse,
  },
  [RuntimeMethodIds.local.stopLocalAsset]: {
    requestType: StopLocalAssetRequest,
    responseType: StopLocalAssetResponse,
  },
  [RuntimeMethodIds.local.checkLocalAssetHealth]: {
    requestType: CheckLocalAssetHealthRequest,
    responseType: CheckLocalAssetHealthResponse,
  },
  [RuntimeMethodIds.local.warmLocalAsset]: {
    requestType: WarmLocalAssetRequest,
    responseType: WarmLocalAssetResponse,
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
  [RuntimeMethodIds.connector.listCatalogProviderModels]: {
    requestType: ListCatalogProviderModelsRequest,
    responseType: ListCatalogProviderModelsResponse,
  },
  [RuntimeMethodIds.connector.getCatalogModelDetail]: {
    requestType: GetCatalogModelDetailRequest,
    responseType: GetCatalogModelDetailResponse,
  },
  [RuntimeMethodIds.connector.upsertModelCatalogProvider]: {
    requestType: UpsertModelCatalogProviderRequest,
    responseType: UpsertModelCatalogProviderResponse,
  },
  [RuntimeMethodIds.connector.deleteModelCatalogProvider]: {
    requestType: DeleteModelCatalogProviderRequest,
    responseType: DeleteModelCatalogProviderResponse,
  },
  [RuntimeMethodIds.connector.upsertCatalogModelOverlay]: {
    requestType: UpsertCatalogModelOverlayRequest,
    responseType: UpsertCatalogModelOverlayResponse,
  },
  [RuntimeMethodIds.connector.deleteCatalogModelOverlay]: {
    requestType: DeleteCatalogModelOverlayRequest,
    responseType: DeleteCatalogModelOverlayResponse,
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
  [RuntimeMethodIds.memory.createBank]: {
    requestType: CreateBankRequest,
    responseType: CreateBankResponse,
  },
  [RuntimeMethodIds.memory.getBank]: {
    requestType: GetBankRequest,
    responseType: GetBankResponse,
  },
  [RuntimeMethodIds.memory.listBanks]: {
    requestType: ListBanksRequest,
    responseType: ListBanksResponse,
  },
  [RuntimeMethodIds.memory.deleteBank]: {
    requestType: DeleteBankRequest,
    responseType: DeleteBankResponse,
  },
  [RuntimeMethodIds.memory.retain]: {
    requestType: RetainRequest,
    responseType: RetainResponse,
  },
  [RuntimeMethodIds.memory.recall]: {
    requestType: RecallRequest,
    responseType: RecallResponse,
  },
  [RuntimeMethodIds.memory.history]: {
    requestType: HistoryRequest,
    responseType: HistoryResponse,
  },
  [RuntimeMethodIds.memory.reflect]: {
    requestType: ReflectRequest,
    responseType: ReflectResponse,
  },
  [RuntimeMethodIds.memory.deleteMemory]: {
    requestType: DeleteMemoryRequest,
    responseType: DeleteMemoryResponse,
  },
  [RuntimeMethodIds.agentCore.initializeAgent]: {
    requestType: InitializeAgentRequest,
    responseType: InitializeAgentResponse,
  },
  [RuntimeMethodIds.agentCore.terminateAgent]: {
    requestType: TerminateAgentRequest,
    responseType: TerminateAgentResponse,
  },
  [RuntimeMethodIds.agentCore.getAgent]: {
    requestType: GetAgentRequest,
    responseType: GetAgentResponse,
  },
  [RuntimeMethodIds.agentCore.listAgents]: {
    requestType: ListAgentsRequest,
    responseType: ListAgentsResponse,
  },
  [RuntimeMethodIds.agentCore.getAgentState]: {
    requestType: GetAgentStateRequest,
    responseType: GetAgentStateResponse,
  },
  [RuntimeMethodIds.agentCore.updateAgentState]: {
    requestType: UpdateAgentStateRequest,
    responseType: UpdateAgentStateResponse,
  },
  [RuntimeMethodIds.agentCore.enableAutonomy]: {
    requestType: EnableAutonomyRequest,
    responseType: EnableAutonomyResponse,
  },
  [RuntimeMethodIds.agentCore.disableAutonomy]: {
    requestType: DisableAutonomyRequest,
    responseType: DisableAutonomyResponse,
  },
  [RuntimeMethodIds.agentCore.setAutonomyConfig]: {
    requestType: SetAutonomyConfigRequest,
    responseType: SetAutonomyConfigResponse,
  },
  [RuntimeMethodIds.agentCore.listPendingHooks]: {
    requestType: ListPendingHooksRequest,
    responseType: ListPendingHooksResponse,
  },
  [RuntimeMethodIds.agentCore.cancelHook]: {
    requestType: CancelHookRequest,
    responseType: CancelHookResponse,
  },
  [RuntimeMethodIds.agentCore.queryMemory]: {
    requestType: QueryAgentMemoryRequest,
    responseType: QueryAgentMemoryResponse,
  },
  [RuntimeMethodIds.agentCore.writeMemory]: {
    requestType: WriteAgentMemoryRequest,
    responseType: WriteAgentMemoryResponse,
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
  [RuntimeMethodIds.local.listLocalTransfers]: {
    requestType: ListLocalTransfersRequest,
    responseType: ListLocalTransfersResponse,
  },
  [RuntimeMethodIds.local.pauseLocalTransfer]: {
    requestType: PauseLocalTransferRequest,
    responseType: PauseLocalTransferResponse,
  },
  [RuntimeMethodIds.local.resumeLocalTransfer]: {
    requestType: ResumeLocalTransferRequest,
    responseType: ResumeLocalTransferResponse,
  },
  [RuntimeMethodIds.local.cancelLocalTransfer]: {
    requestType: CancelLocalTransferRequest,
    responseType: CancelLocalTransferResponse,
  },
};

export const RuntimeStreamMethodCodecs: RuntimeStreamMethodCodecMap = {
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
  [RuntimeMethodIds.local.watchLocalTransfers]: {
    requestType: WatchLocalTransfersRequest,
    eventType: LocalTransferProgressEvent,
  },
  [RuntimeMethodIds.memory.subscribeEvents]: {
    requestType: SubscribeMemoryEventsRequest,
    eventType: MemoryEvent,
  },
  [RuntimeMethodIds.agentCore.subscribeEvents]: {
    requestType: SubscribeAgentEventsRequest,
    eventType: AgentEvent,
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
