import type {
  AgentEvent,
  CancelCompanionParticipationRequest,
  CancelCompanionParticipationResponse,
  CancelHookRequest,
  CancelHookResponse,
  DisableAutonomyRequest,
  DisableAutonomyResponse,
  EnableAutonomyRequest,
  EnableAutonomyResponse,
  GetAgentCanonicalMemoryBankStatusRequest,
  GetAgentCanonicalMemoryBankStatusResponse,
  GetAgentRequest,
  GetAgentResponse,
  GetAgentStateRequest,
  GetAgentStateResponse,
  GetAvatarDebugReplayRequest,
  GetAvatarDebugReplayResponse,
  GetAvatarDebugSnapshotRequest,
  GetAvatarDebugSnapshotResponse,
  GetCompanionParticipationProjectionRequest,
  GetCompanionParticipationProjectionResponse,
  GetConversationAnchorSnapshotRequest,
  GetConversationAnchorSnapshotResponse,
  GetPublicChatSessionSnapshotRequest,
  GetPublicChatSessionSnapshotResponse,
  InitializeAgentRequest,
  InitializeAgentResponse,
  ListAgentConversationSummariesRequest,
  ListAgentConversationSummariesResponse,
  ListAgentsRequest,
  ListAgentsResponse,
  ListAvatarDebugProbeResultsRequest,
  ListAvatarDebugProbeResultsResponse,
  ListPendingHooksRequest,
  ListPendingHooksResponse,
  OpenCompanionParticipationReplayRequest,
  OpenCompanionParticipationReplayResponse,
  OpenConversationAnchorRequest,
  OpenConversationAnchorResponse,
  QueryAgentMemoryRequest,
  QueryAgentMemoryResponse,
  RegisterAvatarLiveInstanceBindingRequest,
  RegisterAvatarLiveInstanceBindingResponse,
  RequestAgentCanonicalMemoryBankBindRequest,
  RequestAgentCanonicalMemoryBankBindResponse,
  RequestAvatarDebugProbeRequest,
  RequestAvatarDebugProbeResponse,
  RequestCompanionParticipationRequest,
  RequestCompanionParticipationResponse,
  ResolveAvatarLiveInstanceBindingRequest,
  ResolveAvatarLiveInstanceBindingResponse,
  SetAgentPresentationProfileRequest,
  SetAgentPresentationProfileResponse,
  SetAutonomyConfigRequest,
  SetAutonomyConfigResponse,
  SubscribeAgentEventsRequest,
  TerminateAgentRequest,
  TerminateAgentResponse,
  UpdateAgentStateRequest,
  UpdateAgentStateResponse,
  WriteAgentMemoryRequest,
  WriteAgentMemoryResponse,
} from './generated/runtime/v1/agent_service';
import type {
  ExecuteDelegatedCapabilityRequest,
  ExecuteDelegatedCapabilityResponse,
  GetDelegatedControlSurfaceSnapshotRequest,
  GetDelegatedControlSurfaceSnapshotResponse,
  GetDelegatedReplayTraceRequest,
  GetDelegatedReplayTraceResponse,
  ListDelegatedApprovalRequestsRequest,
  ListDelegatedApprovalRequestsResponse,
  ListDelegatedDiagnosticsRequest,
  ListDelegatedDiagnosticsResponse,
  ListDelegatedProviderProfilesRequest,
  ListDelegatedProviderProfilesResponse,
  SetDelegatedProviderStateRequest,
  SetDelegatedProviderStateResponse,
  SubmitDelegatedApprovalDecisionRequest,
  SubmitDelegatedApprovalDecisionResponse,
  UpsertDelegatedProviderProfileRequest,
  UpsertDelegatedProviderProfileResponse,
} from './generated/runtime/v1/delegated_control';
import type {
  CreateRealmGroupMessageCandidateRequest,
  CreateRealmGroupMessageCandidateResponse,
  GetRealmGroupMessageCandidateEvidenceRequest,
  GetRealmGroupMessageCandidateEvidenceResponse,
} from './generated/runtime/v1/agent_group_message_candidate';
import type {
  RuntimeCallOptions,
  RuntimeStreamCallOptions,
} from './types.js';

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
  listAgentConversationSummaries(
    request: ListAgentConversationSummariesRequest,
    options?: RuntimeCallOptions,
  ): Promise<ListAgentConversationSummariesResponse>;
  registerAvatarLiveInstanceBinding(
    request: RegisterAvatarLiveInstanceBindingRequest,
    options?: RuntimeCallOptions,
  ): Promise<RegisterAvatarLiveInstanceBindingResponse>;
  resolveAvatarLiveInstanceBinding(
    request: ResolveAvatarLiveInstanceBindingRequest,
    options?: RuntimeCallOptions,
  ): Promise<ResolveAvatarLiveInstanceBindingResponse>;
  getPublicChatSessionSnapshot(
    request: GetPublicChatSessionSnapshotRequest,
    options?: RuntimeCallOptions,
  ): Promise<GetPublicChatSessionSnapshotResponse>;
  getCompanionParticipationProjection(
    request: GetCompanionParticipationProjectionRequest,
    options?: RuntimeCallOptions,
  ): Promise<GetCompanionParticipationProjectionResponse>;
  requestCompanionParticipation(
    request: RequestCompanionParticipationRequest,
    options?: RuntimeCallOptions,
  ): Promise<RequestCompanionParticipationResponse>;
  cancelCompanionParticipation(
    request: CancelCompanionParticipationRequest,
    options?: RuntimeCallOptions,
  ): Promise<CancelCompanionParticipationResponse>;
  openCompanionParticipationReplay(
    request: OpenCompanionParticipationReplayRequest,
    options?: RuntimeCallOptions,
  ): Promise<OpenCompanionParticipationReplayResponse>;
  createRealmGroupMessageCandidate(
    request: CreateRealmGroupMessageCandidateRequest,
    options?: RuntimeCallOptions,
  ): Promise<CreateRealmGroupMessageCandidateResponse>;
  getRealmGroupMessageCandidateEvidence(
    request: GetRealmGroupMessageCandidateEvidenceRequest,
    options?: RuntimeCallOptions,
  ): Promise<GetRealmGroupMessageCandidateEvidenceResponse>;
  getAvatarDebugSnapshot(
    request: GetAvatarDebugSnapshotRequest,
    options?: RuntimeCallOptions,
  ): Promise<GetAvatarDebugSnapshotResponse>;
  requestAvatarDebugProbe(
    request: RequestAvatarDebugProbeRequest,
    options?: RuntimeCallOptions,
  ): Promise<RequestAvatarDebugProbeResponse>;
  listAvatarDebugProbeResults(
    request: ListAvatarDebugProbeResultsRequest,
    options?: RuntimeCallOptions,
  ): Promise<ListAvatarDebugProbeResultsResponse>;
  getAvatarDebugReplay(
    request: GetAvatarDebugReplayRequest,
    options?: RuntimeCallOptions,
  ): Promise<GetAvatarDebugReplayResponse>;
  listDelegatedProviderProfiles(
    request: ListDelegatedProviderProfilesRequest,
    options?: RuntimeCallOptions,
  ): Promise<ListDelegatedProviderProfilesResponse>;
  upsertDelegatedProviderProfile(
    request: UpsertDelegatedProviderProfileRequest,
    options?: RuntimeCallOptions,
  ): Promise<UpsertDelegatedProviderProfileResponse>;
  setDelegatedProviderState(
    request: SetDelegatedProviderStateRequest,
    options?: RuntimeCallOptions,
  ): Promise<SetDelegatedProviderStateResponse>;
  listDelegatedApprovalRequests(
    request: ListDelegatedApprovalRequestsRequest,
    options?: RuntimeCallOptions,
  ): Promise<ListDelegatedApprovalRequestsResponse>;
  submitDelegatedApprovalDecision(
    request: SubmitDelegatedApprovalDecisionRequest,
    options?: RuntimeCallOptions,
  ): Promise<SubmitDelegatedApprovalDecisionResponse>;
  listDelegatedDiagnostics(
    request: ListDelegatedDiagnosticsRequest,
    options?: RuntimeCallOptions,
  ): Promise<ListDelegatedDiagnosticsResponse>;
  getDelegatedReplayTrace(
    request: GetDelegatedReplayTraceRequest,
    options?: RuntimeCallOptions,
  ): Promise<GetDelegatedReplayTraceResponse>;
  getDelegatedControlSurfaceSnapshot(
    request: GetDelegatedControlSurfaceSnapshotRequest,
    options?: RuntimeCallOptions,
  ): Promise<GetDelegatedControlSurfaceSnapshotResponse>;
  executeDelegatedCapability(
    request: ExecuteDelegatedCapabilityRequest,
    options?: RuntimeCallOptions,
  ): Promise<ExecuteDelegatedCapabilityResponse>;
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
  getAgentCanonicalMemoryBankStatus(
    request: GetAgentCanonicalMemoryBankStatusRequest,
    options?: RuntimeCallOptions,
  ): Promise<GetAgentCanonicalMemoryBankStatusResponse>;
  requestAgentCanonicalMemoryBankBind(
    request: RequestAgentCanonicalMemoryBankBindRequest,
    options?: RuntimeCallOptions,
  ): Promise<RequestAgentCanonicalMemoryBankBindResponse>;
  subscribeEvents(
    request: SubscribeAgentEventsRequest,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<AgentEvent>>;
};
