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
} from '../generated/runtime/v1/ai';
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
} from '../generated/runtime/v1/local_runtime';
import {
  BuildIndexRequest,
  BuildIndexResponse,
  DeleteIndexRequest,
  SearchIndexRequest,
  SearchIndexResponse,
} from '../generated/runtime/v1/knowledge';
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
  [RuntimeMethodIds.ai.generate]: {
    requestType: GenerateRequest,
    responseType: GenerateResponse,
  },
  [RuntimeMethodIds.ai.embed]: {
    requestType: EmbedRequest,
    responseType: EmbedResponse,
  },
  [RuntimeMethodIds.ai.transcribeAudio]: {
    requestType: TranscribeAudioRequest,
    responseType: TranscribeAudioResponse,
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
  [RuntimeMethodIds.localRuntime.listLocalModels]: {
    requestType: ListLocalModelsRequest,
    responseType: ListLocalModelsResponse,
  },
  [RuntimeMethodIds.localRuntime.listVerifiedModels]: {
    requestType: ListVerifiedModelsRequest,
    responseType: ListVerifiedModelsResponse,
  },
  [RuntimeMethodIds.localRuntime.searchCatalogModels]: {
    requestType: SearchCatalogModelsRequest,
    responseType: SearchCatalogModelsResponse,
  },
  [RuntimeMethodIds.localRuntime.resolveModelInstallPlan]: {
    requestType: ResolveModelInstallPlanRequest,
    responseType: ResolveModelInstallPlanResponse,
  },
  [RuntimeMethodIds.localRuntime.installLocalModel]: {
    requestType: InstallLocalModelRequest,
    responseType: InstallLocalModelResponse,
  },
  [RuntimeMethodIds.localRuntime.installVerifiedModel]: {
    requestType: InstallVerifiedModelRequest,
    responseType: InstallVerifiedModelResponse,
  },
  [RuntimeMethodIds.localRuntime.importLocalModel]: {
    requestType: ImportLocalModelRequest,
    responseType: ImportLocalModelResponse,
  },
  [RuntimeMethodIds.localRuntime.removeLocalModel]: {
    requestType: RemoveLocalModelRequest,
    responseType: RemoveLocalModelResponse,
  },
  [RuntimeMethodIds.localRuntime.startLocalModel]: {
    requestType: StartLocalModelRequest,
    responseType: StartLocalModelResponse,
  },
  [RuntimeMethodIds.localRuntime.stopLocalModel]: {
    requestType: StopLocalModelRequest,
    responseType: StopLocalModelResponse,
  },
  [RuntimeMethodIds.localRuntime.checkLocalModelHealth]: {
    requestType: CheckLocalModelHealthRequest,
    responseType: CheckLocalModelHealthResponse,
  },
  [RuntimeMethodIds.localRuntime.collectDeviceProfile]: {
    requestType: CollectDeviceProfileRequest,
    responseType: CollectDeviceProfileResponse,
  },
  [RuntimeMethodIds.localRuntime.resolveDependencies]: {
    requestType: ResolveDependenciesRequest,
    responseType: ResolveDependenciesResponse,
  },
  [RuntimeMethodIds.localRuntime.applyDependencies]: {
    requestType: ApplyDependenciesRequest,
    responseType: ApplyDependenciesResponse,
  },
  [RuntimeMethodIds.localRuntime.listLocalServices]: {
    requestType: ListLocalServicesRequest,
    responseType: ListLocalServicesResponse,
  },
  [RuntimeMethodIds.localRuntime.installLocalService]: {
    requestType: InstallLocalServiceRequest,
    responseType: InstallLocalServiceResponse,
  },
  [RuntimeMethodIds.localRuntime.startLocalService]: {
    requestType: StartLocalServiceRequest,
    responseType: StartLocalServiceResponse,
  },
  [RuntimeMethodIds.localRuntime.stopLocalService]: {
    requestType: StopLocalServiceRequest,
    responseType: StopLocalServiceResponse,
  },
  [RuntimeMethodIds.localRuntime.checkLocalServiceHealth]: {
    requestType: CheckLocalServiceHealthRequest,
    responseType: CheckLocalServiceHealthResponse,
  },
  [RuntimeMethodIds.localRuntime.removeLocalService]: {
    requestType: RemoveLocalServiceRequest,
    responseType: RemoveLocalServiceResponse,
  },
  [RuntimeMethodIds.localRuntime.listNodeCatalog]: {
    requestType: ListNodeCatalogRequest,
    responseType: ListNodeCatalogResponse,
  },
  [RuntimeMethodIds.localRuntime.listLocalAudits]: {
    requestType: ListLocalAuditsRequest,
    responseType: ListLocalAuditsResponse,
  },
  [RuntimeMethodIds.localRuntime.appendInferenceAudit]: {
    requestType: AppendInferenceAuditRequest,
    responseType: Ack,
  },
  [RuntimeMethodIds.localRuntime.appendRuntimeAudit]: {
    requestType: AppendRuntimeAuditRequest,
    responseType: Ack,
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
  [RuntimeMethodIds.ai.streamGenerate]: {
    requestType: StreamGenerateRequest,
    eventType: StreamGenerateEvent,
  },
  [RuntimeMethodIds.ai.generateImage]: {
    requestType: GenerateImageRequest,
    eventType: ArtifactChunk,
  },
  [RuntimeMethodIds.ai.generateVideo]: {
    requestType: GenerateVideoRequest,
    eventType: ArtifactChunk,
  },
  [RuntimeMethodIds.ai.synthesizeSpeech]: {
    requestType: SynthesizeSpeechRequest,
    eventType: ArtifactChunk,
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
