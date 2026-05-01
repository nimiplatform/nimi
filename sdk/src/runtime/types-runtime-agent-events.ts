import type {
  RuntimeAgentExecutionStateValue,
  RuntimeAgentHookAdmissionState,
  RuntimeAgentHookEffect,
  RuntimeAgentHookTriggerFamily,
  RuntimeAgentPostureProjection,
  RuntimeAgentPresentationEnvelope,
  RuntimeAgentPresentationTimelineEnvelope,
  RuntimeAgentScopedOriginEnvelope,
  RuntimeAgentTurnEnvelope,
} from './types-runtime-agent-core.js';

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

export type RuntimeAgentVoicePlaybackState =
  | 'requested'
  | 'started'
  | 'completed'
  | 'interrupted'
  | 'canceled'
  | 'failed';

export type RuntimeAgentPresentationVoicePlaybackRequestedEvent = RuntimeAgentPresentationTimelineEnvelope & {
  eventName: 'runtime.agent.presentation.voice_playback_requested';
  detail: {
    audioArtifactId: string;
    audioMimeType: string;
    playbackState: RuntimeAgentVoicePlaybackState;
    durationMs?: number;
    deadlineOffsetMs?: number;
    reason?: string;
  };
};

export type RuntimeAgentLipsyncFrame = {
  frameSequence: number;
  offsetMs: number;
  durationMs: number;
  mouthOpenY: number;
  audioLevel: number;
};

export type RuntimeAgentPresentationLipsyncFrameBatchEvent = RuntimeAgentPresentationTimelineEnvelope & {
  eventName: 'runtime.agent.presentation.lipsync_frame_batch';
  detail: {
    audioArtifactId: string;
    frames: RuntimeAgentLipsyncFrame[];
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
  | RuntimeAgentPresentationActivityRequestedEvent
  | RuntimeAgentPresentationMotionRequestedEvent
  | RuntimeAgentPresentationExpressionRequestedEvent
  | RuntimeAgentPresentationPoseRequestedEvent
  | RuntimeAgentPresentationPoseClearedEvent
  | RuntimeAgentPresentationLookAtRequestedEvent
  | RuntimeAgentPresentationVoicePlaybackRequestedEvent
  | RuntimeAgentPresentationLipsyncFrameBatchEvent
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

