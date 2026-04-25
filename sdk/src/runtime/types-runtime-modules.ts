import type {
  ScopeCatalogDescriptor,
  ScopeCatalogEntry,
  ScopeCatalogPublishResult,
  ScopeCatalogRevokeResult,
  ScopeManifest,
} from '../types/index.js';
import type { Realm } from '../realm/client.js';
import type { Runtime } from './runtime.js';
import type {
  EmbeddingGenerateInput,
  EmbeddingGenerateOutput,
  TextGenerateInput,
  TextGenerateOutput,
  TextStreamInput,
  TextStreamOutput,
} from './types-media.js';
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
  UploadArtifactResponse,
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
  ConversationAnchorSnapshot,
} from './generated/runtime/v1/agent_service';
import type {
  RuntimeCallOptions,
  RuntimeStreamCallOptions,
} from './types.js';
import type {
  NimiReasoningConfig,
  NimiRoutePolicy,
  NimiTraceInfo,
} from './types-media.js';
import type {
  RuntimeAgentClient,
} from './types-client-interfaces.js';
import type { SendAppMessageResponse } from './generated/runtime/v1/app';

export type RuntimeRealmBridgeContext = {
  appId: string;
  runtime: Runtime;
  realm: Realm;
};

export type RuntimeRealmBridgeHelpers = {
  /**
   * Fetches realm-issued runtime auth material through the standard generated Realm service.
   * The request contract is `{ appId, subjectUserId, scopes }`; `appId` is always sourced from
   * the bound Runtime/Realm bridge context.
   */
  fetchRealmGrant(input: {
    subjectUserId: string;
    scopes: string[];
  }): Promise<{
    token: string;
    version: string;
    expiresAt: string;
  }>;
  buildRuntimeAuthMetadata(input: {
    grantToken: string;
    grantVersion: string;
  }): Record<string, string>;
};

export type RuntimeScopeModule = {
  register(input: ScopeManifest): Promise<ScopeCatalogEntry>;
  publish(): Promise<ScopeCatalogPublishResult>;
  revoke(input: { scopes: string[] }): Promise<ScopeCatalogRevokeResult>;
  list(input?: { include?: Array<'realm' | 'runtime' | 'app'> }): Promise<ScopeCatalogDescriptor>;
};

export type RuntimeAiExecuteScenarioRequestInput =
  Omit<ExecuteScenarioRequest, 'head'>
  & {
    head: Omit<NonNullable<ExecuteScenarioRequest['head']>, 'subjectUserId' | 'fallback'>
      & { subjectUserId?: string };
  };

export type RuntimeAiStreamScenarioRequestInput =
  Omit<StreamScenarioRequest, 'head'>
  & {
    head: Omit<NonNullable<StreamScenarioRequest['head']>, 'subjectUserId' | 'fallback'>
      & { subjectUserId?: string };
  };

export type RuntimeAiSubmitScenarioJobRequestInput =
  Omit<SubmitScenarioJobRequest, 'head'>
  & {
    head: Omit<NonNullable<SubmitScenarioJobRequest['head']>, 'subjectUserId' | 'fallback'>
      & { subjectUserId?: string };
  };

export type RuntimeAiOpenRealtimeSessionRequestInput =
  Omit<OpenRealtimeSessionRequest, 'head'>
  & {
    head: Omit<NonNullable<OpenRealtimeSessionRequest['head']>, 'subjectUserId'> & { subjectUserId?: string };
  };

export type RuntimeAiUploadArtifactInput = {
  subjectUserId?: string;
  mimeType: string;
  bytes: Uint8Array;
  displayName?: string;
  chunkSize?: number;
};

export type RuntimeAiModule = {
  executeScenario(
    request: RuntimeAiExecuteScenarioRequestInput,
    options?: RuntimeCallOptions,
  ): Promise<ExecuteScenarioResponse>;
  streamScenario(
    request: RuntimeAiStreamScenarioRequestInput,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<StreamScenarioEvent>>;
  submitScenarioJob(
    request: RuntimeAiSubmitScenarioJobRequestInput,
    options?: RuntimeCallOptions,
  ): Promise<SubmitScenarioJobResponse>;
  getScenarioJob(
    request: GetScenarioJobRequest,
    options?: RuntimeCallOptions,
  ): Promise<GetScenarioJobResponse>;
  cancelScenarioJob(
    request: CancelScenarioJobRequest,
    options?: RuntimeCallOptions,
  ): Promise<CancelScenarioJobResponse>;
  subscribeScenarioJobEvents(
    request: SubscribeScenarioJobEventsRequest,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<ScenarioJobEvent>>;
  getScenarioArtifacts(
    request: GetScenarioArtifactsRequest,
    options?: RuntimeCallOptions,
  ): Promise<GetScenarioArtifactsResponse>;
  listScenarioProfiles(
    request: ListScenarioProfilesRequest,
    options?: RuntimeCallOptions,
  ): Promise<ListScenarioProfilesResponse>;
  getVoiceAsset(request: GetVoiceAssetRequest, options?: RuntimeCallOptions): Promise<GetVoiceAssetResponse>;
  listVoiceAssets(request: ListVoiceAssetsRequest, options?: RuntimeCallOptions): Promise<ListVoiceAssetsResponse>;
  deleteVoiceAsset(request: DeleteVoiceAssetRequest, options?: RuntimeCallOptions): Promise<DeleteVoiceAssetResponse>;
  listPresetVoices(request: ListPresetVoicesRequest, options?: RuntimeCallOptions): Promise<ListPresetVoicesResponse>;
  uploadArtifact(input: RuntimeAiUploadArtifactInput, options?: RuntimeCallOptions): Promise<UploadArtifactResponse>;
  openRealtimeSession(
    request: RuntimeAiOpenRealtimeSessionRequestInput,
    options?: RuntimeCallOptions,
  ): Promise<OpenRealtimeSessionResponse>;
  appendRealtimeInput(
    request: AppendRealtimeInputRequest,
    options?: RuntimeCallOptions,
  ): Promise<AppendRealtimeInputResponse>;
  readRealtimeEvents(
    request: ReadRealtimeEventsRequest,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<RealtimeEvent>>;
  closeRealtimeSession(
    request: CloseRealtimeSessionRequest,
    options?: RuntimeCallOptions,
  ): Promise<CloseRealtimeSessionResponse>;
  peekScheduling(
    request: PeekSchedulingRequest,
    options?: RuntimeCallOptions,
  ): Promise<PeekSchedulingResponse>;
  text: {
    generate(input: TextGenerateInput): Promise<TextGenerateOutput>;
    stream(input: TextStreamInput): Promise<TextStreamOutput>;
  };
  embedding: {
    generate(input: EmbeddingGenerateInput): Promise<EmbeddingGenerateOutput>;
  };
};

export type RuntimeAgentMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
};

export type RuntimeAgentExecutionBinding = {
  route: NimiRoutePolicy;
  modelId: string;
  connectorId?: string;
};

export type RuntimeAgentReasoningConfig = NimiReasoningConfig;

export type RuntimeAgentTurnRequest = {
  agentId: string;
  conversationAnchorId: string;
  requestId?: string;
  threadId?: string;
  systemPrompt?: string;
  worldId?: string;
  maxOutputTokens?: number;
  messages: RuntimeAgentMessage[];
  executionBinding: RuntimeAgentExecutionBinding;
  reasoning?: RuntimeAgentReasoningConfig;
};

export type RuntimeAgentTurnInterruptRequest = {
  agentId: string;
  conversationAnchorId: string;
  turnId?: string;
  reason?: string;
};

export type RuntimeAgentSessionSnapshotRequest = {
  agentId: string;
  conversationAnchorId: string;
  requestId?: string;
};

export type RuntimeAgentConsumeRequest = {
  agentId: string;
  conversationAnchorId?: string;
  cursor?: string;
  subjectUserId?: string;
  includeAgentEvents?: boolean;
};

export type RuntimeAgentSessionTurnSnapshot = {
  turnId: string;
  status?: string;
  streamSequence?: number;
  turnOrigin?: string;
  followUpDepth?: number;
  maxFollowUpTurns?: number;
  outputObserved?: boolean;
  reasoningObserved?: boolean;
  updatedAt?: string;
  trace?: NimiTraceInfo;
  chainId?: string;
  sourceTurnId?: string;
  sourceActionId?: string;
  messageId?: string;
  text?: string;
  structured?: Record<string, unknown>;
  assistantMemory?: Record<string, unknown>;
  chatSidecar?: Record<string, unknown>;
  followUp?: Record<string, unknown>;
  finishReason?: string;
  streamSimulated?: boolean;
  reasonCode?: string;
  actionHint?: string;
  message?: string;
};

export type RuntimeAgentPendingFollowUpSnapshot = {
  status?: string;
  followUpId?: string;
  scheduledFor?: string;
  chainId?: string;
  followUpDepth?: number;
  maxFollowUpTurns?: number;
  sourceTurnId?: string;
  sourceActionId?: string;
};

export type RuntimeAgentSessionSnapshot = {
  requestId?: string;
  threadId?: string;
  subjectUserId?: string;
  sessionStatus?: string;
  transcriptMessageCount?: number;
  transcript?: RuntimeAgentMessage[];
  executionBinding?: RuntimeAgentExecutionBinding;
  systemPrompt?: string;
  maxOutputTokens?: number;
  reasoning?: RuntimeAgentReasoningConfig;
  activeTurn?: RuntimeAgentSessionTurnSnapshot;
  lastTurn?: RuntimeAgentSessionTurnSnapshot;
  pendingFollowUp?: RuntimeAgentPendingFollowUpSnapshot;
};

export type RuntimeAgentTurnEnvelope = {
  eventName:
    | 'runtime.agent.turn.accepted'
    | 'runtime.agent.turn.started'
    | 'runtime.agent.turn.reasoning_delta'
    | 'runtime.agent.turn.text_delta'
    | 'runtime.agent.turn.structured'
    | 'runtime.agent.turn.message_committed'
    | 'runtime.agent.turn.post_turn'
    | 'runtime.agent.turn.completed'
    | 'runtime.agent.turn.failed'
    | 'runtime.agent.turn.interrupted'
    | 'runtime.agent.turn.interrupt_ack';
  agentId: string;
  conversationAnchorId: string;
  turnId: string;
  streamId: string;
};

export type RuntimeAgentPresentationEnvelope = {
  eventName:
    | 'runtime.agent.presentation.activity_requested'
    | 'runtime.agent.presentation.motion_requested'
    | 'runtime.agent.presentation.expression_requested'
    | 'runtime.agent.presentation.pose_requested'
    | 'runtime.agent.presentation.pose_cleared'
    | 'runtime.agent.presentation.lookat_requested';
  agentId: string;
  conversationAnchorId: string;
  turnId: string;
  streamId: string;
};

export type RuntimeAgentScopedOriginEnvelope = {
  agentId: string;
  conversationAnchorId?: string;
  originatingTurnId?: string;
  originatingStreamId?: string;
};

export type RuntimeAgentExecutionStateValue =
  | 'idle'
  | 'chat_active'
  | 'life_pending'
  | 'life_running'
  | 'suspended';

export type RuntimeAgentPostureProjection = {
  actionFamily: string;
  interruptMode: string;
};

export type RuntimeAgentHookTriggerFamily = 'time' | 'event';

export type RuntimeAgentHookEffect = 'follow-up-turn';

export type RuntimeAgentHookAdmissionState =
  | 'proposed'
  | 'pending'
  | 'rejected'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rescheduled';

export type RuntimeAgentTurnAcceptedEvent = RuntimeAgentTurnEnvelope & {
  eventName: 'runtime.agent.turn.accepted';
  detail: {
    requestId: string;
  };
};

export type RuntimeAgentTurnStartedEvent = RuntimeAgentTurnEnvelope & {
  eventName: 'runtime.agent.turn.started';
  detail: {
    track: 'chat' | 'life';
  };
};

export type RuntimeAgentTurnReasoningDeltaEvent = RuntimeAgentTurnEnvelope & {
  eventName: 'runtime.agent.turn.reasoning_delta';
  detail: {
    text: string;
  };
};

export type RuntimeAgentTurnTextDeltaEvent = RuntimeAgentTurnEnvelope & {
  eventName: 'runtime.agent.turn.text_delta';
  detail: {
    text: string;
  };
};

export type RuntimeAgentTurnStructuredEvent = RuntimeAgentTurnEnvelope & {
  eventName: 'runtime.agent.turn.structured';
  detail: {
    kind: string;
    payload: Record<string, unknown>;
  };
};

export type RuntimeAgentTurnMessageCommittedEvent = RuntimeAgentTurnEnvelope & {
  eventName: 'runtime.agent.turn.message_committed';
  messageId: string;
  detail: {
    messageId: string;
    text: string;
  };
};

export type RuntimeAgentTurnPostTurnEvent = RuntimeAgentTurnEnvelope & {
  eventName: 'runtime.agent.turn.post_turn';
  detail: {
    action?: Record<string, unknown>;
    hookIntent?: Record<string, unknown>;
  };
};

export type RuntimeAgentTurnCompletedEvent = RuntimeAgentTurnEnvelope & {
  eventName: 'runtime.agent.turn.completed';
  detail: {
    terminalReason?: string;
  };
};

export type RuntimeAgentTurnFailedEvent = RuntimeAgentTurnEnvelope & {
  eventName: 'runtime.agent.turn.failed';
  detail: {
    reasonCode: string;
    message?: string;
  };
};

export type RuntimeAgentTurnInterruptedEvent = RuntimeAgentTurnEnvelope & {
  eventName: 'runtime.agent.turn.interrupted';
  detail: {
    reason: string;
  };
};

export type RuntimeAgentTurnInterruptAckEvent = RuntimeAgentTurnEnvelope & {
  eventName: 'runtime.agent.turn.interrupt_ack';
  detail: {
    interruptedTurnId: string;
  };
};

export type RuntimeAgentSessionSnapshotEvent = {
  eventName: 'runtime.agent.session.snapshot';
  agentId: string;
  conversationAnchorId: string;
  detail: {
    snapshot: RuntimeAgentSessionSnapshot;
  };
};

export type RuntimeAgentPresentationActivityRequestedEvent = RuntimeAgentPresentationEnvelope & {
  eventName: 'runtime.agent.presentation.activity_requested';
  detail: {
    activityName: string;
    category: 'emotion' | 'interaction' | 'state';
    intensity?: 'weak' | 'moderate' | 'strong';
    source: string;
  };
};

export type RuntimeAgentPresentationMotionRequestedEvent = RuntimeAgentPresentationEnvelope & {
  eventName: 'runtime.agent.presentation.motion_requested';
  detail: {
    motionId: string;
    priority?: string;
    expectedDurationMs?: number;
  };
};

export type RuntimeAgentPresentationExpressionRequestedEvent = RuntimeAgentPresentationEnvelope & {
  eventName: 'runtime.agent.presentation.expression_requested';
  detail: {
    expressionId: string;
    expectedDurationMs?: number;
  };
};

export type RuntimeAgentPresentationPoseRequestedEvent = RuntimeAgentPresentationEnvelope & {
  eventName: 'runtime.agent.presentation.pose_requested';
  detail: {
    poseId: string;
    expectedDurationMs?: number;
  };
};

export type RuntimeAgentPresentationPoseClearedEvent = RuntimeAgentPresentationEnvelope & {
  eventName: 'runtime.agent.presentation.pose_cleared';
  detail: {
    previousPoseId?: string;
  };
};

export type RuntimeAgentPresentationLookAtRequestedEvent = RuntimeAgentPresentationEnvelope & {
  eventName: 'runtime.agent.presentation.lookat_requested';
  detail: {
    targetKind: string;
    x?: number;
    y?: number;
    z?: number;
  };
};

export type RuntimeAgentStateStatusTextChangedEvent = RuntimeAgentScopedOriginEnvelope & {
  eventName: 'runtime.agent.state.status_text_changed';
  detail: {
    currentStatusText: string;
    previousStatusText?: string;
  };
};

export type RuntimeAgentStateExecutionStateChangedEvent = RuntimeAgentScopedOriginEnvelope & {
  eventName: 'runtime.agent.state.execution_state_changed';
  detail: {
    currentExecutionState: RuntimeAgentExecutionStateValue;
    previousExecutionState?: RuntimeAgentExecutionStateValue;
  };
};

export type RuntimeAgentStateEmotionChangedEvent = RuntimeAgentScopedOriginEnvelope & {
  eventName: 'runtime.agent.state.emotion_changed';
  detail: {
    currentEmotion: string;
    previousEmotion?: string;
    source: string;
  };
};

export type RuntimeAgentStatePostureChangedEvent = RuntimeAgentScopedOriginEnvelope & {
  eventName: 'runtime.agent.state.posture_changed';
  detail: {
    currentPosture: RuntimeAgentPostureProjection;
    previousPosture?: RuntimeAgentPostureProjection;
  };
};

export type RuntimeAgentHookDetail = {
  intentId: string;
  triggerFamily: RuntimeAgentHookTriggerFamily;
  triggerDetail: Record<string, unknown>;
  effect: RuntimeAgentHookEffect;
  admissionState: RuntimeAgentHookAdmissionState;
  reasonCode?: string;
  message?: string;
  reason?: string;
  observedAt?: string;
};

export type RuntimeAgentHookIntentProposedEvent = RuntimeAgentScopedOriginEnvelope & {
  eventName: 'runtime.agent.hook.intent_proposed';
  detail: RuntimeAgentHookDetail;
};

export type RuntimeAgentHookPendingEvent = RuntimeAgentScopedOriginEnvelope & {
  eventName: 'runtime.agent.hook.pending';
  detail: RuntimeAgentHookDetail;
};

export type RuntimeAgentHookRejectedEvent = RuntimeAgentScopedOriginEnvelope & {
  eventName: 'runtime.agent.hook.rejected';
  detail: RuntimeAgentHookDetail;
};

export type RuntimeAgentHookRunningEvent = RuntimeAgentScopedOriginEnvelope & {
  eventName: 'runtime.agent.hook.running';
  detail: RuntimeAgentHookDetail;
};

export type RuntimeAgentHookCompletedEvent = RuntimeAgentScopedOriginEnvelope & {
  eventName: 'runtime.agent.hook.completed';
  detail: RuntimeAgentHookDetail;
};

export type RuntimeAgentHookFailedEvent = RuntimeAgentScopedOriginEnvelope & {
  eventName: 'runtime.agent.hook.failed';
  detail: RuntimeAgentHookDetail;
};

export type RuntimeAgentHookCanceledEvent = RuntimeAgentScopedOriginEnvelope & {
  eventName: 'runtime.agent.hook.canceled';
  detail: RuntimeAgentHookDetail;
};

export type RuntimeAgentHookRescheduledEvent = RuntimeAgentScopedOriginEnvelope & {
  eventName: 'runtime.agent.hook.rescheduled';
  detail: RuntimeAgentHookDetail;
};

export type RuntimeAgentConsumeEvent =
  | RuntimeAgentTurnAcceptedEvent
  | RuntimeAgentTurnStartedEvent
  | RuntimeAgentTurnReasoningDeltaEvent
  | RuntimeAgentTurnTextDeltaEvent
  | RuntimeAgentTurnStructuredEvent
  | RuntimeAgentTurnMessageCommittedEvent
  | RuntimeAgentTurnPostTurnEvent
  | RuntimeAgentTurnCompletedEvent
  | RuntimeAgentTurnFailedEvent
  | RuntimeAgentTurnInterruptedEvent
  | RuntimeAgentTurnInterruptAckEvent
  | RuntimeAgentSessionSnapshotEvent
  | RuntimeAgentPresentationActivityRequestedEvent
  | RuntimeAgentPresentationMotionRequestedEvent
  | RuntimeAgentPresentationExpressionRequestedEvent
  | RuntimeAgentPresentationPoseRequestedEvent
  | RuntimeAgentPresentationPoseClearedEvent
  | RuntimeAgentPresentationLookAtRequestedEvent
  | RuntimeAgentStateStatusTextChangedEvent
  | RuntimeAgentStateExecutionStateChangedEvent
  | RuntimeAgentStateEmotionChangedEvent
  | RuntimeAgentStatePostureChangedEvent
  | RuntimeAgentHookIntentProposedEvent
  | RuntimeAgentHookPendingEvent
  | RuntimeAgentHookRejectedEvent
  | RuntimeAgentHookRunningEvent
  | RuntimeAgentHookCompletedEvent
  | RuntimeAgentHookFailedEvent
  | RuntimeAgentHookCanceledEvent
  | RuntimeAgentHookRescheduledEvent;

export type RuntimeAgentAnchorsOpenRequest = {
  agentId: string;
  subjectUserId?: string;
  metadata?: Record<string, unknown>;
};

export type RuntimeAgentAnchorsSnapshotRequest = {
  agentId: string;
  conversationAnchorId: string;
  subjectUserId?: string;
};

export type RuntimeAgentAnchorsModule = {
  open(
    request: RuntimeAgentAnchorsOpenRequest,
    options?: RuntimeCallOptions,
  ): Promise<ConversationAnchorSnapshot>;
  getSnapshot(
    request: RuntimeAgentAnchorsSnapshotRequest,
    options?: RuntimeCallOptions,
  ): Promise<ConversationAnchorSnapshot>;
};

export type RuntimeAgentTurnsModule = {
  subscribe(
    request: RuntimeAgentConsumeRequest,
    options?: RuntimeStreamCallOptions,
  ): Promise<AsyncIterable<RuntimeAgentConsumeEvent>>;
  request(
    request: RuntimeAgentTurnRequest,
    options?: RuntimeCallOptions,
  ): Promise<SendAppMessageResponse>;
  interrupt(
    request: RuntimeAgentTurnInterruptRequest,
    options?: RuntimeCallOptions,
  ): Promise<SendAppMessageResponse>;
  getSessionSnapshot(
    request: RuntimeAgentSessionSnapshotRequest,
    options?: RuntimeStreamCallOptions,
  ): Promise<RuntimeAgentSessionSnapshot>;
};

export type RuntimeAgentModule = RuntimeAgentClient & {
  anchors: RuntimeAgentAnchorsModule;
  turns: RuntimeAgentTurnsModule;
};
