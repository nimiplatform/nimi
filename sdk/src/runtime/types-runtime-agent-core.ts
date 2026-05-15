import type { NimiReasoningConfig, NimiRoutePolicy, NimiTraceInfo } from './types-media.js';

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

export type RuntimeAgentLocalIdentity = {
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
};

export type RuntimeScopedBindingAttachment = {
  bindingId: string;
  bindingHandle?: string;
  runtimeAppId?: string;
  appInstanceId?: string;
  windowId?: string;
  avatarInstanceId?: string;
  localAgentRef?: string;
  conversationAnchorId?: string;
  worldId?: string;
};

export type RuntimeAgentTurnRequest = RuntimeAgentLocalIdentity & {
  conversationAnchorId: string;
  requestId?: string;
  threadId?: string;
  systemPrompt?: string;
  worldId?: string;
  maxOutputTokens?: number;
  messages: RuntimeAgentMessage[];
  executionBinding: RuntimeAgentExecutionBinding;
  reasoning?: RuntimeAgentReasoningConfig;
  scopedBinding?: RuntimeScopedBindingAttachment;
};

export type RuntimeAgentTurnInterruptRequest = RuntimeAgentLocalIdentity & {
  conversationAnchorId: string;
  worldId?: string;
  turnId?: string;
  reason?: string;
  scopedBinding?: RuntimeScopedBindingAttachment;
};

export type RuntimeAgentSessionSnapshotRequest = RuntimeAgentLocalIdentity & {
  conversationAnchorId: string;
  worldId?: string;
  requestId?: string;
  scopedBinding?: RuntimeScopedBindingAttachment;
};

export type RuntimeAgentConsumeRequest = RuntimeAgentLocalIdentity & {
  conversationAnchorId?: string;
  cursor?: string;
  subjectUserId?: string;
  includeAgentEvents?: boolean;
  scopedBinding?: RuntimeScopedBindingAttachment;
};

export type RuntimeAgentTimelineChannel =
  | 'text'
  | 'voice'
  | 'avatar'
  | 'state'
  | 'lipsync';

export type RuntimeAgentTimelineEnvelope = {
  turnId: string;
  streamId: string;
  channel: RuntimeAgentTimelineChannel;
  offsetMs: number;
  sequence: number;
  startedAtWall: string;
  observedAtWall: string;
  timebaseOwner: 'runtime';
  projectionRuleId: 'K-AGCORE-051';
  clockBasis: 'monotonic_with_wall_anchor';
  providerNeutral: true;
  appLocalAuthority: false;
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
  localAgentRef: string;
  conversationAnchorId: string;
  turnId: string;
  streamId: string;
  timeline?: RuntimeAgentTimelineEnvelope;
};

export type RuntimeAgentPresentationEnvelope = {
  eventName:
    | 'runtime.agent.presentation.activity_requested'
    | 'runtime.agent.presentation.motion_requested'
    | 'runtime.agent.presentation.expression_requested'
    | 'runtime.agent.presentation.pose_requested'
    | 'runtime.agent.presentation.pose_cleared'
    | 'runtime.agent.presentation.lookat_requested';
  localAgentRef: string;
  conversationAnchorId: string;
  turnId: string;
  streamId: string;
};

export type RuntimeAgentPresentationTimelineEnvelope = {
  eventName:
    | 'runtime.agent.presentation.voice_playback_requested'
    | 'runtime.agent.presentation.lipsync_frame_batch';
  localAgentRef: string;
  conversationAnchorId: string;
  turnId: string;
  streamId: string;
  timeline: RuntimeAgentTimelineEnvelope;
};

export type RuntimeAgentScopedOriginEnvelope = RuntimeAgentLocalIdentity & {
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
