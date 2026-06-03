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
  Ack,
} from './generated/runtime/v1/common';
import type {
  RuntimeCallOptions,
  RuntimeStreamCallOptions,
} from './types.js';

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
