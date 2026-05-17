import type {
  AgentEvent,
  CancelCompanionParticipationRequest,
  CancelCompanionParticipationResponse,
  GetConversationAnchorSnapshotRequest,
  GetConversationAnchorSnapshotResponse,
  GetCompanionParticipationProjectionRequest,
  GetCompanionParticipationProjectionResponse,
  GetPublicChatSessionSnapshotRequest,
  GetPublicChatSessionSnapshotResponse,
  OpenCompanionParticipationReplayRequest,
  OpenCompanionParticipationReplayResponse,
  OpenConversationAnchorRequest,
  OpenConversationAnchorResponse,
  RegisterAvatarLiveInstanceBindingRequest,
  RegisterAvatarLiveInstanceBindingResponse,
  ResolveAvatarLiveInstanceBindingRequest,
  ResolveAvatarLiveInstanceBindingResponse,
  RequestCompanionParticipationRequest,
  RequestCompanionParticipationResponse,
  QueryAgentMemoryRequest,
  QueryAgentMemoryResponse,
  SetAgentPresentationProfileRequest,
  SetAgentPresentationProfileResponse,
  SubscribeAgentEventsRequest,
  WriteAgentMemoryRequest,
  WriteAgentMemoryResponse,
} from './generated/runtime/v1/agent_service.js';
import type {
  GetDelegatedControlSurfaceSnapshotRequest,
  GetDelegatedControlSurfaceSnapshotResponse,
  GetDelegatedReplayTraceRequest,
  GetDelegatedReplayTraceResponse,
  SubmitDelegatedApprovalDecisionRequest,
  SubmitDelegatedApprovalDecisionResponse,
} from './generated/runtime/v1/delegated_control.js';
import type {
  CreateRealmGroupMessageCandidateRequest,
  CreateRealmGroupMessageCandidateResponse,
  GetRealmGroupMessageCandidateEvidenceRequest,
  GetRealmGroupMessageCandidateEvidenceResponse,
} from './generated/runtime/v1/agent_group_message_candidate.js';
import type {
  ExecuteScenarioRequest,
  ExecuteScenarioResponse,
  StreamScenarioEvent,
  StreamScenarioRequest,
} from './generated/runtime/v1/ai.js';
import type {
  CreateBankRequest,
  CreateBankResponse,
  MemoryEvent,
  SubscribeMemoryEventsRequest,
} from './generated/runtime/v1/memory.js';
import { RuntimeMethodIds } from './method-ids.js';
import { Runtime } from './runtime.js';
import type { RuntimeUnsafeRawModule } from './types.js';

type Assert<T extends true> = T;
type IsEqual<A, B> = (
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
);

declare const raw: RuntimeUnsafeRawModule;
declare const runtime: Runtime;

const rawUnaryResult = raw.call(RuntimeMethodIds.ai.executeScenario, {} as ExecuteScenarioRequest);
const rawStreamResult = raw.call(RuntimeMethodIds.ai.streamScenario, {} as StreamScenarioRequest);
const runtimeUnaryResult = runtime.call(RuntimeMethodIds.ai.executeScenario, {} as ExecuteScenarioRequest);
const rawMemoryUnaryResult = raw.call(RuntimeMethodIds.memory.createBank, {} as CreateBankRequest);
const rawMemoryStreamResult = raw.call(RuntimeMethodIds.memory.subscribeEvents, {} as SubscribeMemoryEventsRequest);
const runtimeMemoryUnaryResult = runtime.call(RuntimeMethodIds.memory.createBank, {} as CreateBankRequest);
const rawAgentUnaryResult = raw.call(RuntimeMethodIds.agent.queryMemory, {} as QueryAgentMemoryRequest);
const rawAgentStreamResult = raw.call(RuntimeMethodIds.agent.subscribeEvents, {} as SubscribeAgentEventsRequest);
const runtimeAgentUnaryResult = runtime.call(RuntimeMethodIds.agent.writeMemory, {} as WriteAgentMemoryRequest);
const runtimeAgentPresentationResult = runtime.call(
  RuntimeMethodIds.agent.setPresentationProfile,
  {} as SetAgentPresentationProfileRequest,
);
const runtimeAgentOpenAnchorResult = runtime.agent.openConversationAnchor({} as OpenConversationAnchorRequest);
const runtimeAgentGetAnchorSnapshotResult = runtime.agent.getConversationAnchorSnapshot({} as GetConversationAnchorSnapshotRequest);
const runtimeAgentRegisterAvatarLiveInstanceBindingResult = runtime.agent.registerAvatarLiveInstanceBinding(
  {} as RegisterAvatarLiveInstanceBindingRequest,
);
const runtimeAgentResolveAvatarLiveInstanceBindingResult = runtime.agent.resolveAvatarLiveInstanceBinding(
  {} as ResolveAvatarLiveInstanceBindingRequest,
);
const runtimeAgentGetPublicChatSessionSnapshotResult = runtime.agent.getPublicChatSessionSnapshot({} as GetPublicChatSessionSnapshotRequest);
const runtimeAgentGetCompanionParticipationProjectionResult = runtime.agent.getCompanionParticipationProjection(
  {} as GetCompanionParticipationProjectionRequest,
);
const runtimeAgentRequestCompanionParticipationResult = runtime.agent.requestCompanionParticipation(
  {} as RequestCompanionParticipationRequest,
);
const runtimeAgentCancelCompanionParticipationResult = runtime.agent.cancelCompanionParticipation(
  {} as CancelCompanionParticipationRequest,
);
const runtimeAgentOpenCompanionParticipationReplayResult = runtime.agent.openCompanionParticipationReplay(
  {} as OpenCompanionParticipationReplayRequest,
);
const runtimeAgentCreateRealmGroupMessageCandidateResult = runtime.agent.createRealmGroupMessageCandidate(
  {} as CreateRealmGroupMessageCandidateRequest,
);
const runtimeAgentGetRealmGroupMessageCandidateEvidenceResult = runtime.agent.getRealmGroupMessageCandidateEvidence(
  {} as GetRealmGroupMessageCandidateEvidenceRequest,
);
const runtimeAgentDelegatedSnapshotResult = runtime.agent.getDelegatedControlSurfaceSnapshot(
  {} as GetDelegatedControlSurfaceSnapshotRequest,
);
const runtimeAgentDelegatedApprovalResult = runtime.agent.submitDelegatedApprovalDecision(
  {} as SubmitDelegatedApprovalDecisionRequest,
);
const runtimeAgentDelegatedReplayResult = runtime.agent.getDelegatedReplayTrace(
  {} as GetDelegatedReplayTraceRequest,
);
const fallbackRawResult = raw.call('/nimi.runtime.v1.Custom/Unknown', {});

type _GuardRawUnaryResult = Assert<IsEqual<
  Awaited<typeof rawUnaryResult>,
  ExecuteScenarioResponse
>>;
type _GuardRawStreamResult = Assert<IsEqual<
  Awaited<typeof rawStreamResult>,
  AsyncIterable<StreamScenarioEvent>
>>;
type _GuardRuntimeUnaryResult = Assert<IsEqual<
  Awaited<typeof runtimeUnaryResult>,
  ExecuteScenarioResponse
>>;
type _GuardRawMemoryUnaryResult = Assert<IsEqual<
  Awaited<typeof rawMemoryUnaryResult>,
  CreateBankResponse
>>;
type _GuardRawMemoryStreamResult = Assert<IsEqual<
  Awaited<typeof rawMemoryStreamResult>,
  AsyncIterable<MemoryEvent>
>>;
type _GuardRuntimeMemoryUnaryResult = Assert<IsEqual<
  Awaited<typeof runtimeMemoryUnaryResult>,
  CreateBankResponse
>>;
type _GuardRawAgentUnaryResult = Assert<IsEqual<
  Awaited<typeof rawAgentUnaryResult>,
  QueryAgentMemoryResponse
>>;
type _GuardRawAgentStreamResult = Assert<IsEqual<
  Awaited<typeof rawAgentStreamResult>,
  AsyncIterable<AgentEvent>
>>;
type _GuardRuntimeAgentUnaryResult = Assert<IsEqual<
  Awaited<typeof runtimeAgentUnaryResult>,
  WriteAgentMemoryResponse
>>;
type _GuardRuntimeAgentPresentationResult = Assert<IsEqual<
  Awaited<typeof runtimeAgentPresentationResult>,
  SetAgentPresentationProfileResponse
>>;
type _GuardRuntimeAgentOpenAnchorResult = Assert<IsEqual<
  Awaited<typeof runtimeAgentOpenAnchorResult>,
  OpenConversationAnchorResponse
>>;
type _GuardRuntimeAgentGetAnchorSnapshotResult = Assert<IsEqual<
  Awaited<typeof runtimeAgentGetAnchorSnapshotResult>,
  GetConversationAnchorSnapshotResponse
>>;
type _GuardRuntimeAgentRegisterAvatarLiveInstanceBindingResult = Assert<IsEqual<
  Awaited<typeof runtimeAgentRegisterAvatarLiveInstanceBindingResult>,
  RegisterAvatarLiveInstanceBindingResponse
>>;
type _GuardRuntimeAgentResolveAvatarLiveInstanceBindingResult = Assert<IsEqual<
  Awaited<typeof runtimeAgentResolveAvatarLiveInstanceBindingResult>,
  ResolveAvatarLiveInstanceBindingResponse
>>;
type _GuardRuntimeAgentGetPublicChatSessionSnapshotResult = Assert<IsEqual<
  Awaited<typeof runtimeAgentGetPublicChatSessionSnapshotResult>,
  GetPublicChatSessionSnapshotResponse
>>;
type _GuardRuntimeAgentGetCompanionParticipationProjectionResult = Assert<IsEqual<
  Awaited<typeof runtimeAgentGetCompanionParticipationProjectionResult>,
  GetCompanionParticipationProjectionResponse
>>;
type _GuardRuntimeAgentRequestCompanionParticipationResult = Assert<IsEqual<
  Awaited<typeof runtimeAgentRequestCompanionParticipationResult>,
  RequestCompanionParticipationResponse
>>;
type _GuardRuntimeAgentCancelCompanionParticipationResult = Assert<IsEqual<
  Awaited<typeof runtimeAgentCancelCompanionParticipationResult>,
  CancelCompanionParticipationResponse
>>;
type _GuardRuntimeAgentOpenCompanionParticipationReplayResult = Assert<IsEqual<
  Awaited<typeof runtimeAgentOpenCompanionParticipationReplayResult>,
  OpenCompanionParticipationReplayResponse
>>;
type _GuardRuntimeAgentCreateRealmGroupMessageCandidateResult = Assert<IsEqual<
  Awaited<typeof runtimeAgentCreateRealmGroupMessageCandidateResult>,
  CreateRealmGroupMessageCandidateResponse
>>;
type _GuardRuntimeAgentGetRealmGroupMessageCandidateEvidenceResult = Assert<IsEqual<
  Awaited<typeof runtimeAgentGetRealmGroupMessageCandidateEvidenceResult>,
  GetRealmGroupMessageCandidateEvidenceResponse
>>;
type _GuardRuntimeAgentDelegatedSnapshotResult = Assert<IsEqual<
  Awaited<typeof runtimeAgentDelegatedSnapshotResult>,
  GetDelegatedControlSurfaceSnapshotResponse
>>;
type _GuardRuntimeAgentDelegatedApprovalResult = Assert<IsEqual<
  Awaited<typeof runtimeAgentDelegatedApprovalResult>,
  SubmitDelegatedApprovalDecisionResponse
>>;
type _GuardRuntimeAgentDelegatedReplayResult = Assert<IsEqual<
  Awaited<typeof runtimeAgentDelegatedReplayResult>,
  GetDelegatedReplayTraceResponse
>>;
type _GuardFallbackRawResult = Assert<IsEqual<
  Awaited<typeof fallbackRawResult>,
  unknown
>>;

// @ts-expect-error known method ids must reject incompatible request payloads
raw.call(RuntimeMethodIds.ai.executeScenario, { invalid: true });

// @ts-expect-error known stream method ids must reject incompatible request payloads
raw.call(RuntimeMethodIds.ai.streamScenario, { invalid: true });

// @ts-expect-error known memory method ids must reject incompatible request payloads
raw.call(RuntimeMethodIds.memory.createBank, { invalid: true });

// @ts-expect-error known agent method ids must reject incompatible request payloads
raw.call(RuntimeMethodIds.agent.queryMemory, { invalid: true });
