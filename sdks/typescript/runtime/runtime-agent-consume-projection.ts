import {
  AgentPresentationEventFamily,
  AgentVoiceTimingPhase,
  AgentStateEventFamily,
  HookAdmissionState,
  type AgentEvent,
  type AppMessageEvent,
} from '../core-generated/runtime-typed-client';
import type { JsonObject } from '../types';
import { fromNimiRuntimeProtoStruct } from './runtime-agent-values';
import {
  asRecord,
  normalizeText,
  optionalNumber,
  optionalString,
  requireText,
  runtimeAgentError,
} from './runtime-agent-consume-internal';
import type {
  NimiRuntimeAgentConsumeEvent,
  NimiRuntimeAgentExecutionStateValue,
  NimiRuntimeAgentHookConsumeEvent,
  NimiRuntimeAgentPresentationConsumeEvent,
  NimiRuntimeAgentStateConsumeEvent,
  NimiRuntimeAgentTimelineChannel,
  NimiRuntimeAgentTimelineEnvelope,
  NimiRuntimeAgentTurnConsumeEvent,
} from './runtime-agent-consume-types';
export { parseNimiRuntimeAgentSessionSnapshot } from './runtime-agent-consume-snapshot';

const TURN_EVENT_TYPES = new Set([
  'runtime.agent.turn.accepted',
  'runtime.agent.turn.started',
  'runtime.agent.turn.reasoning_delta',
  'runtime.agent.turn.text_delta',
  'runtime.agent.turn.structured',
  'runtime.agent.turn.message_committed',
  'runtime.agent.turn.action_planned',
  'runtime.agent.turn.action_started',
  'runtime.agent.turn.artifact_ready',
  'runtime.agent.turn.action_completed',
  'runtime.agent.turn.action_failed',
  'runtime.agent.turn.post_turn',
  'runtime.agent.turn.completed',
  'runtime.agent.turn.failed',
  'runtime.agent.turn.interrupted',
  'runtime.agent.turn.interrupt_ack',
  'runtime.agent.conversation.voice_timing_ready',
  'runtime.agent.conversation.voice_artifact_available',
  'runtime.agent.conversation.voice_timing_terminal',
  'runtime.agent.state.status_text_changed',
  'runtime.agent.state.execution_state_changed',
  'runtime.agent.state.emotion_changed',
  'runtime.agent.state.posture_changed',
  'runtime.agent.hook.intent_proposed',
  'runtime.agent.hook.pending',
  'runtime.agent.hook.rejected',
  'runtime.agent.hook.running',
  'runtime.agent.hook.completed',
  'runtime.agent.hook.failed',
  'runtime.agent.hook.canceled',
  'runtime.agent.hook.rescheduled',
  'runtime.agent.presentation.activity_requested',
  'runtime.agent.presentation.motion_requested',
  'runtime.agent.presentation.expression_requested',
  'runtime.agent.presentation.pose_requested',
  'runtime.agent.presentation.pose_cleared',
  'runtime.agent.presentation.lookat_requested',
]);

function projectAppMessageStream(
  stream: AsyncIterable<AppMessageEvent>,
  request: { readonly conversationAnchorId?: unknown; readonly localAgentRef?: unknown },
): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const event of stream) {
        const projected = projectNimiRuntimeAgentAppMessageEvent(event, request.localAgentRef);
        if (!projected) continue;
        const expectedAnchorId = normalizeText(request.conversationAnchorId);
        if (expectedAnchorId && projected.conversationAnchorId !== expectedAnchorId) {
          continue;
        }
        yield projected;
      }
    },
  };
}

function projectAgentEventStream(
  stream: AsyncIterable<AgentEvent>,
  conversationAnchorId: string,
): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const event of stream) {
        const projected = projectNimiRuntimeAgentServiceEvent(event);
        if (conversationAnchorId && projected.conversationAnchorId && projected.conversationAnchorId !== conversationAnchorId) {
          continue;
        }
        yield projected;
      }
    },
  };
}

export function projectNimiRuntimeAgentAppMessageEvent(
  event: AppMessageEvent,
  callerScopedAgentRef?: unknown,
): NimiRuntimeAgentConsumeEvent | null {
  const messageType = normalizeText(event.messageType);
  if (!TURN_EVENT_TYPES.has(messageType)) {
    return null;
  }
  const payload = event.payload ? fromNimiRuntimeProtoStruct(event.payload) : {};
  const localAgentRef = requireText(
    messageType.startsWith('runtime.agent.turn.')
      ? callerScopedAgentRef
      : payload.local_agent_ref ?? payload.localAgentRef ?? payload.agent_id ?? payload.agentId,
    'localAgentRef',
  );
  if (messageType.startsWith('runtime.agent.state.')) {
    return {
      eventName: messageType as NimiRuntimeAgentStateConsumeEvent['eventName'],
      localAgentRef,
      ...(optionalString(payload.conversation_anchor_id, payload.conversationAnchorId) ? { conversationAnchorId: optionalString(payload.conversation_anchor_id, payload.conversationAnchorId) } : {}),
      ...(optionalString(payload.originating_turn_id, payload.originatingTurnId) ? { originatingTurnId: optionalString(payload.originating_turn_id, payload.originatingTurnId) } : {}),
      ...(optionalString(payload.originating_stream_id, payload.originatingStreamId) ? { originatingStreamId: optionalString(payload.originating_stream_id, payload.originatingStreamId) } : {}),
      detail: projectAppMessageDetail(messageType, payload),
    };
  }
  if (messageType.startsWith('runtime.agent.hook.')) {
    return {
      eventName: messageType as NimiRuntimeAgentHookConsumeEvent['eventName'],
      localAgentRef,
      ...(optionalString(payload.conversation_anchor_id, payload.conversationAnchorId) ? { conversationAnchorId: optionalString(payload.conversation_anchor_id, payload.conversationAnchorId) } : {}),
      ...(optionalString(payload.originating_turn_id, payload.originatingTurnId) ? { originatingTurnId: optionalString(payload.originating_turn_id, payload.originatingTurnId) } : {}),
      ...(optionalString(payload.originating_stream_id, payload.originatingStreamId) ? { originatingStreamId: optionalString(payload.originating_stream_id, payload.originatingStreamId) } : {}),
      detail: projectAppMessageDetail(messageType, payload),
    };
  }
  const conversationAnchorId = requireText(
    payload.conversation_anchor_id ?? payload.conversationAnchorId,
    'conversationAnchorId',
  );
  const turnId = requireText(payload.turn_id ?? payload.turnId, 'turnId');
  const streamId = requireText(payload.stream_id ?? payload.streamId, 'streamId');
  const timelinePayload = payload.timeline ?? payload.runtime_timeline ?? payload.runtimeTimeline;
  const timeline = parseOptionalNimiRuntimeAgentTimeline(timelinePayload, messageType, turnId, streamId);
  const projectedDetail = projectAppMessageDetail(messageType, payload);
  if (!admitCommonVoiceDetail(messageType, projectedDetail)) return null;
  return {
    eventName: messageType as NimiRuntimeAgentTurnConsumeEvent['eventName'],
    localAgentRef,
    conversationAnchorId,
    turnId,
    streamId,
    ...(timeline ? { timeline } : {}),
    detail: projectedDetail,
  };
}

function admitCommonVoiceDetail(messageType: string, detail: JsonObject): boolean {
  if (messageType !== 'runtime.agent.conversation.voice_timing_ready'
    && messageType !== 'runtime.agent.conversation.voice_artifact_available') return true;
  const artifactId = optionalString(detail.audioArtifactId);
  const mimeType = optionalString(detail.audioMimeType)?.toLowerCase();
  if (!artifactId || !mimeType?.startsWith('audio/')) return false;
  return messageType !== 'runtime.agent.conversation.voice_artifact_available'
    || detail.artifactComplete === true;
}

function projectAppMessageDetail(messageType: string, payload: JsonObject): JsonObject {
  const detail = asRecord(payload.detail) || {};
  switch (messageType) {
    case 'runtime.agent.state.status_text_changed':
      return {
        currentStatusText: optionalString(detail.current_status_text, detail.currentStatusText, payload.current_status_text, payload.currentStatusText),
        previousStatusText: optionalString(detail.previous_status_text, detail.previousStatusText, payload.previous_status_text, payload.previousStatusText),
      };
    case 'runtime.agent.hook.intent_proposed':
    case 'runtime.agent.hook.pending':
    case 'runtime.agent.hook.rejected':
    case 'runtime.agent.hook.running':
    case 'runtime.agent.hook.completed':
    case 'runtime.agent.hook.failed':
    case 'runtime.agent.hook.canceled':
    case 'runtime.agent.hook.rescheduled':
      return {
        intentId: optionalString(detail.intent_id, detail.intentId, payload.intent_id, payload.intentId),
        triggerFamily: optionalString(detail.trigger_family, detail.triggerFamily, payload.trigger_family, payload.triggerFamily),
        triggerDetail: asRecord(detail.trigger_detail ?? detail.triggerDetail ?? payload.trigger_detail ?? payload.triggerDetail),
        effect: optionalString(detail.effect, payload.effect),
        admissionState: optionalString(detail.admission_state, detail.admissionState, payload.admission_state, payload.admissionState),
        reasonCode: optionalString(detail.reason_code, detail.reasonCode, payload.reason_code, payload.reasonCode),
        message: optionalString(detail.message, payload.message),
        reason: optionalString(detail.reason, payload.reason),
      };
    case 'runtime.agent.presentation.activity_requested':
      return {
        activityName: optionalString(detail.activity_name, detail.activityName, payload.activity_name, payload.activityName),
        category: optionalString(detail.category, payload.category),
        intensity: optionalString(detail.intensity, payload.intensity),
        source: optionalString(detail.source, payload.source),
      };
    case 'runtime.agent.turn.accepted':
      return { requestId: optionalString(detail.request_id, detail.requestId, payload.request_id, payload.requestId) };
    case 'runtime.agent.turn.text_delta':
    case 'runtime.agent.turn.reasoning_delta':
    case 'runtime.agent.turn.message_committed':
      return {
        text: optionalString(detail.text, payload.text) || '',
        messageId: optionalString(detail.message_id, detail.messageId, payload.message_id, payload.messageId),
      };
    case 'runtime.agent.turn.completed':
      return { terminalReason: optionalString(detail.terminal_reason, detail.terminalReason, detail.finish_reason, detail.finishReason, payload.terminal_reason, payload.terminalReason, payload.finish_reason, payload.finishReason) };
    case 'runtime.agent.turn.action_planned':
    case 'runtime.agent.turn.action_started':
    case 'runtime.agent.turn.action_completed':
      return {
        actionId: optionalString(detail.action_id, detail.actionId, payload.action_id, payload.actionId) || '',
        modality: optionalString(detail.modality, payload.modality) || '',
        operation: optionalString(detail.operation, payload.operation) || '',
        projectionMessageId: optionalString(detail.projection_message_id, detail.projectionMessageId, payload.projection_message_id, payload.projectionMessageId),
        artifactId: optionalString(detail.artifact_id, detail.artifactId, payload.artifact_id, payload.artifactId),
        mimeType: optionalString(detail.mime_type, detail.mimeType, payload.mime_type, payload.mimeType),
        jobId: optionalString(detail.job_id, detail.jobId, payload.job_id, payload.jobId),
      };
    case 'runtime.agent.turn.artifact_ready':
      return {
        actionId: optionalString(detail.action_id, detail.actionId, payload.action_id, payload.actionId) || '',
        projectionMessageId: optionalString(detail.projection_message_id, detail.projectionMessageId, payload.projection_message_id, payload.projectionMessageId) || '',
        artifactId: optionalString(detail.artifact_id, detail.artifactId, payload.artifact_id, payload.artifactId) || '',
        mimeType: optionalString(detail.mime_type, detail.mimeType, payload.mime_type, payload.mimeType) || '',
      };
    case 'runtime.agent.turn.action_failed':
      return {
        actionId: optionalString(detail.action_id, detail.actionId, payload.action_id, payload.actionId) || '',
        modality: optionalString(detail.modality, payload.modality) || '',
        operation: optionalString(detail.operation, payload.operation) || '',
        projectionMessageId: optionalString(detail.projection_message_id, detail.projectionMessageId, payload.projection_message_id, payload.projectionMessageId),
        reasonCode: optionalString(detail.reason_code, detail.reasonCode, payload.reason_code, payload.reasonCode),
        // K-AGCORE-147 admission-resolution failure class:
        // image_binding_missing | image_route_unhealthy | image_execution_failed.
        reason: optionalString(detail.reason, payload.reason),
        message: optionalString(detail.message, payload.message),
      };
    case 'runtime.agent.turn.failed':
      return {
        reasonCode: optionalString(detail.reason_code, detail.reasonCode, payload.reason_code, payload.reasonCode),
        message: optionalString(detail.message, payload.message),
      };
    case 'runtime.agent.turn.interrupted':
      return { reason: optionalString(detail.reason, payload.reason) };
    case 'runtime.agent.turn.interrupt_ack':
      return { interruptedTurnId: optionalString(detail.interrupted_turn_id, detail.interruptedTurnId, payload.interrupted_turn_id, payload.interruptedTurnId) };
    case 'runtime.agent.turn.structured':
      {
        const structuredPayload = asRecord(detail.payload) || asRecord(payload.structured) || {};
        return {
          payload: structuredPayload,
          structured: structuredPayload,
        };
      }
    case 'runtime.agent.conversation.voice_timing_ready':
      return {
        audioArtifactId: optionalString(detail.audio_artifact_id, detail.audioArtifactId, payload.audio_artifact_id, payload.audioArtifactId) || '',
        audioMimeType: optionalString(detail.audio_mime_type, detail.audioMimeType, payload.audio_mime_type, payload.audioMimeType) || '',
        messageId: optionalString(detail.message_id, detail.messageId, payload.message_id, payload.messageId),
        voiceTimingPhase: optionalString(detail.voice_timing_phase, detail.voiceTimingPhase, payload.voice_timing_phase, payload.voiceTimingPhase),
        durationMs: optionalNumber(detail.duration_ms ?? detail.durationMs ?? payload.duration_ms ?? payload.durationMs),
        deadlineOffsetMs: optionalNumber(detail.deadline_offset_ms ?? detail.deadlineOffsetMs ?? payload.deadline_offset_ms ?? payload.deadlineOffsetMs),
        reason: optionalString(detail.reason, payload.reason),
      };
    case 'runtime.agent.conversation.voice_artifact_available':
      return {
        audioArtifactId: optionalString(detail.audio_artifact_id, detail.audioArtifactId, payload.audio_artifact_id, payload.audioArtifactId),
        audioMimeType: optionalString(detail.audio_mime_type, detail.audioMimeType, payload.audio_mime_type, payload.audioMimeType) || '',
        messageId: optionalString(detail.message_id, detail.messageId, payload.message_id, payload.messageId),
        artifactSequence: optionalNumber(detail.artifact_sequence ?? detail.artifactSequence ?? payload.artifact_sequence ?? payload.artifactSequence),
        artifactComplete: optionalBoolean(detail.artifact_complete ?? detail.artifactComplete ?? payload.artifact_complete ?? payload.artifactComplete),
        voiceTimingPhase: optionalString(detail.voice_timing_phase, detail.voiceTimingPhase, payload.voice_timing_phase, payload.voiceTimingPhase),
        durationMs: optionalNumber(detail.duration_ms ?? detail.durationMs ?? payload.duration_ms ?? payload.durationMs),
        reason: optionalString(detail.reason, payload.reason),
      };
    case 'runtime.agent.conversation.voice_timing_terminal':
      return {
        audioArtifactId: optionalString(detail.audio_artifact_id, detail.audioArtifactId, payload.audio_artifact_id, payload.audioArtifactId),
        audioMimeType: optionalString(detail.audio_mime_type, detail.audioMimeType, payload.audio_mime_type, payload.audioMimeType),
        messageId: optionalString(detail.message_id, detail.messageId, payload.message_id, payload.messageId),
        voiceTimingPhase: optionalString(detail.voice_timing_phase, detail.voiceTimingPhase, payload.voice_timing_phase, payload.voiceTimingPhase),
        terminalReason: optionalString(detail.terminal_reason, detail.terminalReason, payload.terminal_reason, payload.terminalReason),
      };
    default:
      return {};
  }
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function projectNimiRuntimeAgentServiceEvent(event: AgentEvent): NimiRuntimeAgentConsumeEvent {
  const localAgentRef = requireText(event.localAgentRef || event.agentId, 'localAgentRef');
  switch (event.detail.oneofKind) {
    case 'state':
      return projectStateEvent(localAgentRef, event.detail.state);
    case 'presentation':
      return projectPresentationEvent(localAgentRef, event.detail.presentation);
    case 'hook':
      return projectHookEvent(localAgentRef, event.detail.hook);
    default:
      runtimeAgentError(
        'Runtime Agent service event family is not a consume projection event',
        'SDK_RUNTIME_AGENT_EVENT_UNSUPPORTED',
        'subscribe_supported_runtime_agent_event_families',
      );
  }
}

function projectStateEvent(localAgentRef: string, state: AgentEvent['detail'] & { oneofKind: 'state' } extends never ? never : Extract<AgentEvent['detail'], { oneofKind: 'state' }>['state']): NimiRuntimeAgentStateConsumeEvent {
  const eventName = stateEventName(state.family);
  return {
    eventName,
    localAgentRef,
    ...(optionalString(state.conversationAnchorId) ? { conversationAnchorId: optionalString(state.conversationAnchorId) } : {}),
    ...(optionalString(state.originatingTurnId) ? { originatingTurnId: optionalString(state.originatingTurnId) } : {}),
    ...(optionalString(state.originatingStreamId) ? { originatingStreamId: optionalString(state.originatingStreamId) } : {}),
    detail: {
      currentStatusText: state.currentStatusText,
      previousStatusText: state.hasPreviousStatusText ? state.previousStatusText : undefined,
      currentExecutionState: formatGeneratedAgentExecutionState(state.currentExecutionState),
      previousExecutionState: formatGeneratedAgentExecutionState(state.previousExecutionState),
      currentEmotion: state.currentEmotion,
      previousEmotion: state.previousEmotion || undefined,
      source: state.emotionSource,
      currentPosture: state.currentPosture ? {
        actionFamily: state.currentPosture.actionFamily,
        interruptMode: state.currentPosture.interruptMode,
      } : undefined,
      previousPosture: state.previousPosture ? {
        actionFamily: state.previousPosture.actionFamily,
        interruptMode: state.previousPosture.interruptMode,
      } : undefined,
    },
  };
}

function projectPresentationEvent(
  localAgentRef: string,
  presentation: Extract<AgentEvent['detail'], { oneofKind: 'presentation' }>['presentation'],
): NimiRuntimeAgentPresentationConsumeEvent {
  const conversationAnchorId = requireText(presentation.conversationAnchorId, 'conversationAnchorId');
  const turnId = requireText(presentation.turnId, 'turnId');
  const streamId = requireText(presentation.streamId, 'streamId');
  return {
    eventName: presentationEventName(presentation.family),
    localAgentRef,
    conversationAnchorId,
    turnId,
    streamId,
    detail: {
      activityName: presentation.activityName,
      category: presentation.activityCategory,
      intensity: presentation.activityIntensity || undefined,
      source: presentation.activitySource,
      motionId: presentation.motionId,
      motionPriority: presentation.motionPriority,
      motionExpectedDurationMs: optionalNumber(presentation.motionExpectedDurationMs),
      expressionId: presentation.expressionId,
      expectedDurationMs: optionalNumber(presentation.expressionExpectedDurationMs || presentation.poseExpectedDurationMs),
      poseId: presentation.poseId,
      previousPoseId: presentation.previousPoseId,
      lookatTargetKind: presentation.lookatTargetKind,
      ...(presentation.lookatHasX ? { x: presentation.lookatX } : {}),
      ...(presentation.lookatHasY ? { y: presentation.lookatY } : {}),
      ...(presentation.lookatHasZ ? { z: presentation.lookatZ } : {}),
      audioArtifactId: presentation.audioArtifactId || undefined,
      audioMimeType: presentation.audioMimeType || undefined,
      messageId: presentation.messageId || undefined,
      artifactSequence: optionalNumber(presentation.artifactSequence),
      artifactComplete: presentation.artifactComplete,
      voiceTimingPhase: formatGeneratedVoiceTimingPhase(presentation.voiceTimingPhase),
      terminalReason: presentation.terminalReason || undefined,
      reason: presentation.reason || undefined,
      durationMs: optionalNumber(presentation.durationMs),
      deadlineOffsetMs: optionalNumber(presentation.deadlineOffsetMs),
    },
  };
}

function projectHookEvent(
  localAgentRef: string,
  hook: Extract<AgentEvent['detail'], { oneofKind: 'hook' }>['hook'],
): NimiRuntimeAgentHookConsumeEvent {
  return {
    eventName: hookEventName(hook.family),
    localAgentRef,
    detail: {
      intent: hook.intent as unknown as JsonObject,
      reasonCode: hook.reasonCode,
      message: hook.message,
      reason: hook.reason,
    },
  };
}

function stateEventName(family: AgentStateEventFamily): NimiRuntimeAgentStateConsumeEvent['eventName'] {
  switch (family) {
    case AgentStateEventFamily.STATUS_TEXT_CHANGED:
      return 'runtime.agent.state.status_text_changed';
    case AgentStateEventFamily.EXECUTION_STATE_CHANGED:
      return 'runtime.agent.state.execution_state_changed';
    case AgentStateEventFamily.EMOTION_CHANGED:
      return 'runtime.agent.state.emotion_changed';
    case AgentStateEventFamily.POSTURE_CHANGED:
      return 'runtime.agent.state.posture_changed';
    default:
      runtimeAgentError('Runtime Agent state event family is unsupported', 'SDK_RUNTIME_AGENT_EVENT_UNSUPPORTED', 'check_runtime_agent_event_family');
  }
}

function presentationEventName(family: AgentPresentationEventFamily): NimiRuntimeAgentPresentationConsumeEvent['eventName'] {
  switch (family) {
    case AgentPresentationEventFamily.ACTIVITY_REQUESTED:
      return 'runtime.agent.presentation.activity_requested';
    case AgentPresentationEventFamily.MOTION_REQUESTED:
      return 'runtime.agent.presentation.motion_requested';
    case AgentPresentationEventFamily.EXPRESSION_REQUESTED:
      return 'runtime.agent.presentation.expression_requested';
    case AgentPresentationEventFamily.POSE_REQUESTED:
      return 'runtime.agent.presentation.pose_requested';
    case AgentPresentationEventFamily.POSE_CLEARED:
      return 'runtime.agent.presentation.pose_cleared';
    case AgentPresentationEventFamily.LOOKAT_REQUESTED:
      return 'runtime.agent.presentation.lookat_requested';
    case AgentPresentationEventFamily.VOICE_TIMING_READY:
      return 'runtime.agent.conversation.voice_timing_ready';
    case AgentPresentationEventFamily.VOICE_ARTIFACT_AVAILABLE:
      return 'runtime.agent.conversation.voice_artifact_available';
    case AgentPresentationEventFamily.VOICE_TIMING_TERMINAL:
      return 'runtime.agent.conversation.voice_timing_terminal';
    default:
      runtimeAgentError('Runtime Agent presentation event family is unsupported', 'SDK_RUNTIME_AGENT_EVENT_UNSUPPORTED', 'check_runtime_agent_event_family');
  }
}

function hookEventName(family: HookAdmissionState): NimiRuntimeAgentHookConsumeEvent['eventName'] {
  switch (family) {
    case HookAdmissionState.PROPOSED:
      return 'runtime.agent.hook.intent_proposed';
    case HookAdmissionState.PENDING:
      return 'runtime.agent.hook.pending';
    case HookAdmissionState.REJECTED:
      return 'runtime.agent.hook.rejected';
    case HookAdmissionState.RUNNING:
      return 'runtime.agent.hook.running';
    case HookAdmissionState.COMPLETED:
      return 'runtime.agent.hook.completed';
    case HookAdmissionState.FAILED:
      return 'runtime.agent.hook.failed';
    case HookAdmissionState.CANCELED:
      return 'runtime.agent.hook.canceled';
    case HookAdmissionState.RESCHEDULED:
      return 'runtime.agent.hook.rescheduled';
    default:
      runtimeAgentError('Runtime Agent hook event family is unsupported', 'SDK_RUNTIME_AGENT_EVENT_UNSUPPORTED', 'check_runtime_agent_event_family');
  }
}

function formatGeneratedAgentExecutionState(value: unknown): NimiRuntimeAgentExecutionStateValue | undefined {
  if (value === 1) return 'idle';
  if (value === 2) return 'chat_active';
  if (value === 3) return 'life_pending';
  if (value === 4) return 'life_running';
  if (value === 5) return 'suspended';
  return undefined;
}

function formatGeneratedVoiceTimingPhase(value: unknown): string | undefined {
  if (value === AgentVoiceTimingPhase.ACTIVE) return 'active';
  if (value === AgentVoiceTimingPhase.COMPLETED) return 'completed';
  if (value === AgentVoiceTimingPhase.FAILED) return 'failed';
  if (value === AgentVoiceTimingPhase.INTERRUPTED) return 'interrupted';
  if (value === AgentVoiceTimingPhase.CANCELED) return 'canceled';
  return undefined;
}

export function parseNimiRuntimeAgentTimeline(
  value: unknown,
  messageType: string,
  expectedTurnId: string,
  expectedStreamId: string,
): NimiRuntimeAgentTimelineEnvelope {
  const payload = asRecord(value);
  if (!payload) {
    runtimeAgentError('Runtime Agent timeline must be an object', 'SDK_RUNTIME_AGENT_TIMELINE_INVALID', 'check_runtime_agent_timeline_projection_shape');
  }
  const turnId = requireText(payload.turn_id ?? payload.turnId, 'timeline.turnId');
  const streamId = requireText(payload.stream_id ?? payload.streamId, 'timeline.streamId');
  if (turnId !== expectedTurnId || streamId !== expectedStreamId) {
    runtimeAgentError('Runtime Agent timeline ids must match event envelope', 'SDK_RUNTIME_AGENT_TIMELINE_INVALID', 'check_runtime_agent_timeline_projection_shape');
  }
  const channel = requireText(payload.channel, 'timeline.channel') as NimiRuntimeAgentTimelineChannel;
  const expectedChannel = timelineChannelForEvent(messageType);
  if (channel !== expectedChannel) {
    runtimeAgentError(`Runtime Agent timeline channel must be ${expectedChannel}`, 'SDK_RUNTIME_AGENT_TIMELINE_INVALID', 'check_runtime_agent_timeline_projection_shape');
  }
  const offsetMs = optionalNumber(payload.offset_ms ?? payload.offsetMs);
  const sequence = optionalNumber(payload.sequence);
  if (offsetMs === undefined || offsetMs < 0 || sequence === undefined || sequence <= 0 || !Number.isInteger(sequence)) {
    runtimeAgentError('Runtime Agent timeline numeric fields are invalid', 'SDK_RUNTIME_AGENT_TIMELINE_INVALID', 'check_runtime_agent_timeline_projection_shape');
  }
  if (
    payload.timebase_owner !== 'runtime'
    && payload.timebaseOwner !== 'runtime'
  ) {
    runtimeAgentError('Runtime Agent timeline timebase owner must be runtime', 'SDK_RUNTIME_AGENT_TIMELINE_INVALID', 'check_runtime_agent_timeline_projection_shape');
  }
  const expectedProjectionRuleId = projectionRuleIdForEvent(messageType);
  if (
    (payload.projection_rule_id ?? payload.projectionRuleId) !== expectedProjectionRuleId
    || (payload.clock_basis ?? payload.clockBasis) !== 'monotonic_with_wall_anchor'
    || (payload.provider_neutral ?? payload.providerNeutral) !== true
    || (payload.app_local_authority ?? payload.appLocalAuthority) !== false
  ) {
    runtimeAgentError('Runtime Agent timeline authority fields are invalid', 'SDK_RUNTIME_AGENT_TIMELINE_INVALID', 'check_runtime_agent_timeline_projection_shape');
  }
  return {
    turnId,
    streamId,
    channel,
    offsetMs,
    sequence,
    startedAtWall: requireText(payload.started_at_wall ?? payload.startedAtWall, 'timeline.startedAtWall'),
    observedAtWall: requireText(payload.observed_at_wall ?? payload.observedAtWall, 'timeline.observedAtWall'),
    timebaseOwner: 'runtime',
    projectionRuleId: expectedProjectionRuleId,
    clockBasis: 'monotonic_with_wall_anchor',
    providerNeutral: true,
    appLocalAuthority: false,
  };
}

function parseOptionalNimiRuntimeAgentTimeline(
  value: unknown,
  messageType: string,
  expectedTurnId: string,
  expectedStreamId: string,
): NimiRuntimeAgentTimelineEnvelope | undefined {
  return asRecord(value)
    ? parseNimiRuntimeAgentTimeline(value, messageType, expectedTurnId, expectedStreamId)
    : undefined;
}

function timelineChannelForEvent(messageType: string): NimiRuntimeAgentTimelineChannel {
  if (
    messageType === 'runtime.agent.turn.text_delta'
    || messageType === 'runtime.agent.turn.reasoning_delta'
    || messageType === 'runtime.agent.turn.structured'
    || messageType === 'runtime.agent.turn.message_committed'
  ) {
    return 'text';
  }
  if (messageType === 'runtime.agent.conversation.voice_timing_ready') {
    return 'voice';
  }
  if (messageType === 'runtime.agent.conversation.voice_artifact_available') {
    return 'voice';
  }
  if (messageType === 'runtime.agent.conversation.voice_timing_terminal') {
    return 'voice';
  }
  return 'state';
}

function projectionRuleIdForEvent(messageType: string): NimiRuntimeAgentTimelineEnvelope['projectionRuleId'] {
  if (
    messageType === 'runtime.agent.conversation.voice_artifact_available'
    || messageType === 'runtime.agent.conversation.voice_timing_terminal'
  ) {
    return 'K-AGCORE-133';
  }
  return 'K-AGCORE-051';
}
