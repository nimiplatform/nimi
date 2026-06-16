import {
  AvatarDebugEventFamily,
  AgentPresentationEventFamily,
  AgentStateEventFamily,
  HookAdmissionState,
  type AgentEvent,
  type AppMessageEvent,
} from '../core-generated/runtime-typed-client';
import type { Struct } from '../core-generated/runtime-protobuf/google/protobuf/struct';
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
  NimiRuntimeAgentAvatarDebugConsumeEvent,
  NimiRuntimeAgentExecutionStateValue,
  NimiRuntimeAgentHookConsumeEvent,
  NimiRuntimeAgentPresentationConsumeEvent,
  NimiRuntimeAgentSessionSnapshot,
  NimiRuntimeAgentSessionTranscriptMessage,
  NimiRuntimeAgentSessionTurnSnapshot,
  NimiRuntimeAgentStateConsumeEvent,
  NimiRuntimeAgentTimelineChannel,
  NimiRuntimeAgentTimelineEnvelope,
  NimiRuntimeAgentTurnConsumeEvent,
} from './runtime-agent-consume-types';

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
  'runtime.agent.presentation.voice_playback_requested',
  'runtime.agent.presentation.lipsync_frame_batch',
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

function parseNimiRuntimeAgentSessionSnapshot(value?: Struct): NimiRuntimeAgentSessionSnapshot {
  const payload = value ? fromNimiRuntimeProtoStruct(value) : {};
  const transcript = parseTranscript(payload.transcript);
  return {
    ...(optionalString(payload.request_id, payload.requestId) ? { requestId: optionalString(payload.request_id, payload.requestId) } : {}),
    ...(optionalString(payload.thread_id, payload.threadId) ? { threadId: optionalString(payload.thread_id, payload.threadId) } : {}),
    ...(optionalString(payload.subject_user_id, payload.subjectUserId) ? { subjectUserId: optionalString(payload.subject_user_id, payload.subjectUserId) } : {}),
    ...(optionalString(payload.session_status, payload.sessionStatus) ? { sessionStatus: optionalString(payload.session_status, payload.sessionStatus) } : {}),
    ...(optionalNumber(payload.transcript_message_count ?? payload.transcriptMessageCount) !== undefined
      ? { transcriptMessageCount: optionalNumber(payload.transcript_message_count ?? payload.transcriptMessageCount) }
      : {}),
    ...(transcript ? { transcript } : {}),
    ...(asRecord(payload.execution_bindings ?? payload.executionBindings) ? { executionBindings: asRecord(payload.execution_bindings ?? payload.executionBindings) } : {}),
    ...(parseTurnSnapshot(payload.active_turn ?? payload.activeTurn) ? { activeTurn: parseTurnSnapshot(payload.active_turn ?? payload.activeTurn) } : {}),
    ...(parseTurnSnapshot(payload.last_turn ?? payload.lastTurn) ? { lastTurn: parseTurnSnapshot(payload.last_turn ?? payload.lastTurn) } : {}),
    ...(asRecord(payload.pending_follow_up ?? payload.pendingFollowUp) ? { pendingFollowUp: asRecord(payload.pending_follow_up ?? payload.pendingFollowUp) } : {}),
  };
}

export { parseNimiRuntimeAgentSessionSnapshot };

function parseTranscript(value: unknown): NimiRuntimeAgentSessionTranscriptMessage[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const transcript: NimiRuntimeAgentSessionTranscriptMessage[] = [];
  for (const item of value) {
    const payload = asRecord(item);
    if (!payload) return undefined;
    const id = optionalString(payload.id);
    const role = optionalString(payload.role);
    const content = optionalContentString(payload.content);
    const name = optionalString(payload.name);
    const status = optionalString(payload.status);
    const kind = optionalString(payload.kind);
    const createdAt = optionalString(payload.created_at, payload.createdAt);
    const updatedAt = optionalString(payload.updated_at, payload.updatedAt);
    const parentMessageId = optionalString(payload.parent_message_id, payload.parentMessageId);
    const traceId = optionalString(payload.trace_id, payload.traceId);
    const reasoningText = optionalContentString(payload.reasoning_text ?? payload.reasoningText);
    const mediaUrl = optionalString(payload.media_url, payload.mediaUrl);
    const mediaMimeType = optionalString(payload.media_mime_type, payload.mediaMimeType);
    const artifactId = optionalString(payload.artifact_id, payload.artifactId);
    const metadata = asRecord(payload.metadata);
    if (
      !id
      || !isRuntimeAgentTranscriptRole(role)
      || content === undefined
      || !isRuntimeAgentTranscriptStatus(status)
      || !isRuntimeAgentTranscriptKind(kind)
      || !isValidIsoTimestamp(createdAt)
      || !isValidIsoTimestamp(updatedAt)
    ) {
      return undefined;
    }
    transcript.push({
      id,
      role,
      content,
      ...(name ? { name } : {}),
      status,
      kind,
      createdAt,
      updatedAt,
      ...(parentMessageId ? { parentMessageId } : {}),
      ...(traceId ? { traceId } : {}),
      ...(reasoningText !== undefined ? { reasoningText } : {}),
      ...(mediaUrl ? { mediaUrl } : {}),
      ...(mediaMimeType ? { mediaMimeType } : {}),
      ...(artifactId ? { artifactId } : {}),
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    });
  }
  return transcript.length > 0 ? transcript : undefined;
}

function parseTurnSnapshot(value: unknown): NimiRuntimeAgentSessionTurnSnapshot | undefined {
  const payload = asRecord(value);
  if (!payload) return undefined;
  const turnId = optionalString(payload.turn_id, payload.turnId);
  if (!turnId) return undefined;
  return {
    turnId,
    ...(optionalString(payload.stream_id, payload.streamId) ? { streamId: optionalString(payload.stream_id, payload.streamId) } : {}),
    ...(optionalString(payload.status) ? { status: optionalString(payload.status) } : {}),
    ...(optionalNumber(payload.stream_sequence ?? payload.streamSequence) !== undefined ? { streamSequence: optionalNumber(payload.stream_sequence ?? payload.streamSequence) } : {}),
    ...(optionalString(payload.turn_origin, payload.turnOrigin) ? { turnOrigin: optionalString(payload.turn_origin, payload.turnOrigin) } : {}),
    ...(optionalNumber(payload.follow_up_depth ?? payload.followUpDepth) !== undefined ? { followUpDepth: optionalNumber(payload.follow_up_depth ?? payload.followUpDepth) } : {}),
    ...(optionalNumber(payload.max_follow_up_turns ?? payload.maxFollowUpTurns) !== undefined ? { maxFollowUpTurns: optionalNumber(payload.max_follow_up_turns ?? payload.maxFollowUpTurns) } : {}),
    ...(typeof payload.output_observed === 'boolean' ? { outputObserved: payload.output_observed } : {}),
    ...(typeof payload.outputObserved === 'boolean' ? { outputObserved: payload.outputObserved } : {}),
    ...(typeof payload.reasoning_observed === 'boolean' ? { reasoningObserved: payload.reasoning_observed } : {}),
    ...(typeof payload.reasoningObserved === 'boolean' ? { reasoningObserved: payload.reasoningObserved } : {}),
    ...(optionalString(payload.updated_at, payload.updatedAt) ? { updatedAt: optionalString(payload.updated_at, payload.updatedAt) } : {}),
    ...(optionalString(payload.message_id, payload.messageId) ? { messageId: optionalString(payload.message_id, payload.messageId) } : {}),
    ...(typeof payload.text === 'string' ? { text: payload.text } : {}),
    ...(asRecord(payload.structured) ? { structured: asRecord(payload.structured) } : {}),
    ...(optionalString(payload.finish_reason, payload.finishReason) ? { finishReason: optionalString(payload.finish_reason, payload.finishReason) } : {}),
    ...(optionalString(payload.reason_code, payload.reasonCode) ? { reasonCode: optionalString(payload.reason_code, payload.reasonCode) } : {}),
    ...(optionalString(payload.action_hint, payload.actionHint) ? { actionHint: optionalString(payload.action_hint, payload.actionHint) } : {}),
    ...(optionalString(payload.message) ? { message: optionalString(payload.message) } : {}),
  };
}

function optionalContentString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRuntimeAgentTranscriptRole(
  value: string | undefined,
): value is NimiRuntimeAgentSessionTranscriptMessage['role'] {
  return value === 'system' || value === 'user' || value === 'assistant' || value === 'tool';
}

function isRuntimeAgentTranscriptStatus(
  value: string | undefined,
): value is NimiRuntimeAgentSessionTranscriptMessage['status'] {
  return value === 'pending'
    || value === 'complete'
    || value === 'error'
    || value === 'committed'
    || value === 'failed';
}

function isRuntimeAgentTranscriptKind(
  value: string | undefined,
): value is NimiRuntimeAgentSessionTranscriptMessage['kind'] {
  return value === 'text'
    || value === 'image'
    || value === 'voice'
    || value === 'tool'
    || value === 'system';
}

function isValidIsoTimestamp(value: string | undefined): value is string {
  return Boolean(value && Number.isFinite(Date.parse(value)));
}


function projectAppMessageStream(
  stream: AsyncIterable<AppMessageEvent>,
  request: { readonly conversationAnchorId?: unknown },
): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const event of stream) {
        const projected = projectNimiRuntimeAgentAppMessageEvent(event);
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

export function projectNimiRuntimeAgentAppMessageEvent(event: AppMessageEvent): NimiRuntimeAgentConsumeEvent | null {
  const messageType = normalizeText(event.messageType);
  if (!TURN_EVENT_TYPES.has(messageType)) {
    return null;
  }
  const payload = event.payload ? fromNimiRuntimeProtoStruct(event.payload) : {};
  const localAgentRef = requireText(
    payload.local_agent_ref ?? payload.localAgentRef ?? payload.agent_id ?? payload.agentId,
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
  return {
    eventName: messageType as NimiRuntimeAgentTurnConsumeEvent['eventName'],
    localAgentRef,
    conversationAnchorId,
    turnId,
    streamId,
    ...(parseOptionalNimiRuntimeAgentTimeline(payload.runtime_timeline ?? payload.runtimeTimeline, messageType, turnId, streamId)
      ? { timeline: parseOptionalNimiRuntimeAgentTimeline(payload.runtime_timeline ?? payload.runtimeTimeline, messageType, turnId, streamId) }
      : {}),
    detail: projectAppMessageDetail(messageType, payload),
  };
}

function projectAppMessageDetail(messageType: string, payload: JsonObject): JsonObject {
  switch (messageType) {
    case 'runtime.agent.state.status_text_changed':
      return {
        currentStatusText: optionalString(payload.current_status_text, payload.currentStatusText),
        previousStatusText: optionalString(payload.previous_status_text, payload.previousStatusText),
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
        intentId: optionalString(payload.intent_id, payload.intentId),
        triggerFamily: optionalString(payload.trigger_family, payload.triggerFamily),
        triggerDetail: asRecord(payload.trigger_detail ?? payload.triggerDetail),
        effect: optionalString(payload.effect),
        admissionState: optionalString(payload.admission_state, payload.admissionState),
        reasonCode: optionalString(payload.reason_code, payload.reasonCode),
        message: optionalString(payload.message),
        reason: optionalString(payload.reason),
      };
    case 'runtime.agent.presentation.activity_requested':
      return {
        activityName: optionalString(payload.activity_name, payload.activityName),
        category: optionalString(payload.category),
        intensity: optionalString(payload.intensity),
        source: optionalString(payload.source),
      };
    case 'runtime.agent.turn.accepted':
      return { requestId: optionalString(payload.request_id, payload.requestId) };
    case 'runtime.agent.turn.text_delta':
    case 'runtime.agent.turn.message_committed':
      return {
        text: optionalString(payload.text) || '',
        messageId: optionalString(payload.message_id, payload.messageId),
      };
    case 'runtime.agent.turn.completed':
      return { terminalReason: optionalString(payload.terminal_reason, payload.terminalReason, payload.finish_reason, payload.finishReason) };
    case 'runtime.agent.turn.action_planned':
    case 'runtime.agent.turn.action_started':
    case 'runtime.agent.turn.action_completed':
      return {
        actionId: optionalString(payload.action_id, payload.actionId) || '',
        modality: optionalString(payload.modality) || '',
        operation: optionalString(payload.operation) || '',
        projectionMessageId: optionalString(payload.projection_message_id, payload.projectionMessageId),
        artifactId: optionalString(payload.artifact_id, payload.artifactId),
        mimeType: optionalString(payload.mime_type, payload.mimeType),
        jobId: optionalString(payload.job_id, payload.jobId),
      };
    case 'runtime.agent.turn.artifact_ready':
      return {
        actionId: optionalString(payload.action_id, payload.actionId) || '',
        projectionMessageId: optionalString(payload.projection_message_id, payload.projectionMessageId) || '',
        artifactId: optionalString(payload.artifact_id, payload.artifactId) || '',
        mimeType: optionalString(payload.mime_type, payload.mimeType) || '',
      };
    case 'runtime.agent.turn.action_failed':
      return {
        actionId: optionalString(payload.action_id, payload.actionId) || '',
        modality: optionalString(payload.modality) || '',
        operation: optionalString(payload.operation) || '',
        projectionMessageId: optionalString(payload.projection_message_id, payload.projectionMessageId),
        reasonCode: optionalString(payload.reason_code, payload.reasonCode),
        message: optionalString(payload.message),
      };
    case 'runtime.agent.turn.failed':
      return {
        reasonCode: optionalString(payload.reason_code, payload.reasonCode),
        message: optionalString(payload.message),
      };
    case 'runtime.agent.turn.interrupted':
      return { reason: optionalString(payload.reason) };
    case 'runtime.agent.turn.interrupt_ack':
      return { interruptedTurnId: optionalString(payload.interrupted_turn_id, payload.interruptedTurnId) };
    case 'runtime.agent.turn.structured':
      return {
        payload: asRecord(payload.structured) || {},
        structured: asRecord(payload.structured) || {},
      };
    case 'runtime.agent.presentation.voice_playback_requested':
      return {
        audioArtifactId: optionalString(payload.audio_artifact_id, payload.audioArtifactId) || '',
        audioMimeType: optionalString(payload.audio_mime_type, payload.audioMimeType) || '',
        playbackState: optionalString(payload.playback_state, payload.playbackState) || '',
        durationMs: optionalNumber(payload.duration_ms ?? payload.durationMs),
        deadlineOffsetMs: optionalNumber(payload.deadline_offset_ms ?? payload.deadlineOffsetMs),
        reason: optionalString(payload.reason),
        defaultVoiceReference: optionalString(payload.default_voice_reference, payload.defaultVoiceReference),
        ...(parseVoiceRouteBinding(payload.voice_route_binding ?? payload.voiceRouteBinding)
          ? { voiceRouteBinding: parseVoiceRouteBinding(payload.voice_route_binding ?? payload.voiceRouteBinding) }
          : {}),
      };
    default:
      return {};
  }
}

function parseVoiceRouteBinding(value: unknown): JsonObject | null {
  const payload = asRecord(value);
  if (!payload) {
    return null;
  }
  const result: JsonObject = {};
  const fields: Array<[string, unknown]> = [
    ['capability', payload.capability],
    ['defaultVoiceReference', payload.default_voice_reference ?? payload.defaultVoiceReference],
    ['voiceReferenceKind', payload.voice_reference_kind ?? payload.voiceReferenceKind],
    ['voiceReferenceValue', payload.voice_reference_value ?? payload.voiceReferenceValue],
    ['modelId', payload.model_id ?? payload.modelId],
    ['modelResolved', payload.model_resolved ?? payload.modelResolved],
    ['scenarioJobId', payload.scenario_job_id ?? payload.scenarioJobId],
    ['boundAudioArtifactId', payload.bound_audio_artifact_id ?? payload.boundAudioArtifactId],
    ['boundAudioMimeType', payload.bound_audio_mime_type ?? payload.boundAudioMimeType],
    ['synthesisMode', payload.synthesis_mode ?? payload.synthesisMode],
    ['status', payload.status],
    ['reason', payload.reason],
  ];
  for (const [key, raw] of fields) {
    const normalized = optionalString(raw);
    if (normalized) {
      result[key] = normalized;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
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
    case 'avatarDebug':
      return projectAvatarDebugEvent(localAgentRef, event.detail.avatarDebug);
    default:
      runtimeAgentError(
        'Runtime Agent service event family is not a consume projection event',
        'SDK_RUNTIME_AGENT_EVENT_UNSUPPORTED',
        'subscribe_supported_runtime_agent_event_families',
      );
  }
}

function projectAvatarDebugEvent(
  localAgentRef: string,
  avatarDebug: Extract<AgentEvent['detail'], { oneofKind: 'avatarDebug' }>['avatarDebug'],
): NimiRuntimeAgentAvatarDebugConsumeEvent {
  const request = avatarDebug.request;
  const result = avatarDebug.result;
  const replay = avatarDebug.replay;
  const conversationAnchorId = optionalString(request?.conversationAnchorId || result?.conversationAnchorId);
  return {
    eventName: avatarDebugEventName(avatarDebug.family),
    localAgentRef,
    ...(conversationAnchorId ? { conversationAnchorId } : {}),
    ...(optionalString(request?.turnId) ? { turnId: optionalString(request?.turnId) } : {}),
    ...(optionalString(request?.streamId) ? { streamId: optionalString(request?.streamId) } : {}),
    detail: {
      ...(request ? {
        probeId: request.probeId,
        agentId: request.agentId,
        conversationAnchorId: request.conversationAnchorId,
        probeKind: request.probeKind,
        requestedBy: request.requestedBy,
        turnId: request.turnId,
        streamId: request.streamId,
        avatarInstanceId: request.avatarInstanceId,
        runtimeReplayRef: request.runtimeReplayRef,
        replayRequested: request.replayRequested,
        scopedBinding: request.scopedBinding as unknown as JsonObject | undefined,
      } : {}),
      ...(result ? {
        probeId: result.probeId,
        agentId: result.agentId,
        conversationAnchorId: result.conversationAnchorId,
        probeKind: result.probeKind,
        status: result.status,
        evidenceRefs: result.evidenceRefs,
        reasonCode: result.reasonCode,
        resultId: result.resultId,
      } : {}),
      ...(replay ? {
        replayProbeId: replay.probeId,
        replayRef: replay.replayRef,
        redactionState: replay.redactionState,
        visibility: replay.visibility,
      } : {}),
    },
  };
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

function avatarDebugEventName(family: AvatarDebugEventFamily): NimiRuntimeAgentAvatarDebugConsumeEvent['eventName'] {
  switch (family) {
    case AvatarDebugEventFamily.PROBE_REQUESTED:
      return 'runtime.agent.avatar_debug.probe_requested';
    case AvatarDebugEventFamily.PROBE_RESULT:
      return 'runtime.agent.avatar_debug.probe_result';
    case AvatarDebugEventFamily.REPLAY_LINKED:
      return 'runtime.agent.avatar_debug.replay_linked';
    default:
      runtimeAgentError('Runtime Agent avatar debug event family is unsupported', 'SDK_RUNTIME_AGENT_EVENT_UNSUPPORTED', 'check_runtime_agent_event_family');
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
  if (
    (payload.projection_rule_id ?? payload.projectionRuleId) !== 'K-AGCORE-051'
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
    projectionRuleId: 'K-AGCORE-051',
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
  if (messageType === 'runtime.agent.presentation.voice_playback_requested') {
    return 'voice';
  }
  if (messageType === 'runtime.agent.presentation.lipsync_frame_batch') {
    return 'lipsync';
  }
  return 'state';
}
