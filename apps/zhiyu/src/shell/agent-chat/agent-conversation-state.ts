import type {
  NimiRuntimeAgentConsumeEvent,
  NimiRuntimeAgentSessionSnapshot,
  NimiRuntimeAgentSessionTranscriptMessage,
} from '@nimiplatform/sdk/runtime';
import type { ConversationCanonicalMessage } from '@nimiplatform/kit/features/chat';
import type {
  ZhiyuCompanionRuntimeProjectionEventEvidence,
  ZhiyuEvidence,
} from '../app/evidence';
import {
  initialZhiyuCompanionEmotionProjection,
  projectZhiyuCompanionEmotion,
  type ZhiyuCompanionEmotionProjection,
  type ZhiyuCompanionEmotionViolation,
} from '../agent/companion-emotion';

export type ZhiyuAgentChatStatus = ZhiyuEvidence['chat'];
export type ZhiyuCompanionStatus = ZhiyuEvidence['companion'];

export type ZhiyuAgentSessionHydrationInput = {
  readonly current: ZhiyuAgentChatStatus;
  readonly agentHandle: string;
  readonly conversationAnchorId: string;
  readonly snapshot: NimiRuntimeAgentSessionSnapshot;
};

export function hydrateZhiyuAgentChatFromRuntimeSessionSnapshot(
  input: ZhiyuAgentSessionHydrationInput,
): ZhiyuAgentChatStatus {
  const transcript = Array.isArray(input.snapshot.transcript) ? input.snapshot.transcript : [];
  if (!transcriptHasReplayEnvelope(transcript)) {
    return input.current;
  }
  const messages = transcript.flatMap((message) => {
    const projected = transcriptMessageToCanonicalMessage({
      message,
      sessionId: input.conversationAnchorId,
      targetId: input.agentHandle,
    });
    return projected ? [projected] : [];
  });
  if (messages.length === 0) {
    return input.current;
  }
  const latestAssistant = latestAssistantMessage(messages);
  const outputText = latestAssistant?.text || null;
  return {
    transport: 'electron-ipc',
    ready: true,
    state: 'completed',
    reasonCode: 'runtime-agent-session-snapshot-hydrated',
    actionHint: 'continue_runtime_agent_conversation',
    source: 'runtime',
    message: 'Runtime Agent session snapshot was hydrated through SDK transcript replay.',
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
    conversationAnchorId: input.conversationAnchorId,
    requestId: normalizeText(input.snapshot.requestId) || null,
    runtimeTurnId: runtimeTurnIdFromSnapshot(input.snapshot),
    runtimeStreamId: runtimeStreamIdFromSnapshot(input.snapshot),
    eventTypes: ['session-snapshot-hydrated'],
    messageCount: messages.length,
    messages,
    latestAssistantText: outputText,
    reasoningText: latestAssistant?.metadata?.reasoningText as string | undefined || null,
    outputText,
    diagnostics: {
      source: 'runtime.agent.session.snapshot',
      transcriptMessageCount: messages.length,
      sessionStatus: normalizeText(input.snapshot.sessionStatus) || 'unknown',
    },
  };
}

export function projectZhiyuCompanionFromRuntimeAgentEvent(input: {
  readonly current: ZhiyuCompanionStatus;
  readonly event: NimiRuntimeAgentConsumeEvent;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly observedAt: string;
}): ZhiyuCompanionStatus {
  const projection = projectRuntimeAgentCompanionEvent(input.event, input.current);
  if (!projection) {
    return input.current;
  }
  const observedAt = normalizeText(input.observedAt);
  if (!observedAt) {
    throw new Error('ZHIYU_COMPANION_OBSERVED_AT_REQUIRED');
  }
  const statusText = projection.statusText || input.current.statusText;
  const executionState = projection.executionState || input.current.executionState;
  const voiceOutputMode = projection.voiceOutputMode || input.current.voiceOutputMode;
  const voicePlaybackState = projection.voicePlaybackState || input.current.voicePlaybackState;
  const voiceAudioArtifactId = projection.voiceAudioArtifactId || input.current.voiceAudioArtifactId;
  const voiceAudioMimeType = projection.voiceAudioMimeType || input.current.voiceAudioMimeType;
  const voicePlaybackTarget = projection.voicePlaybackTarget || input.current.voicePlaybackTarget;
  const voiceStreamId = projection.voiceStreamId || input.current.voiceStreamId;
  const currentEmotion = projection.currentEmotion || input.current.currentEmotion;
  const currentEmotionId = projection.currentEmotionId;
  const currentEmotionCue = projection.currentEmotionCue;
  const currentEmotionIntensity = projection.currentEmotionIntensity;
  const emotionViolation = projection.emotionViolation;
  const activeWorldId = projection.activeWorldId || input.current.activeWorldId;
  const activeUserId = projection.activeUserId || input.current.activeUserId;
  const projectedFields = uniqueTexts([
    ...input.current.projectedFields,
    'runtimeAgentEventSubscription',
    ...projection.projectedFields,
    statusText ? 'statusText' : '',
    executionState ? 'executionState' : '',
    voiceOutputMode ? 'voiceOutputMode' : '',
    voicePlaybackState ? 'voicePlaybackState' : '',
    voiceAudioArtifactId ? 'voiceAudioArtifactId' : '',
    voiceAudioMimeType ? 'voiceAudioMimeType' : '',
    voicePlaybackTarget ? 'voicePlaybackTarget' : '',
    voiceStreamId ? 'voiceStreamId' : '',
    currentEmotion ? 'currentEmotion' : '',
    currentEmotionId ? 'currentEmotionId' : '',
    currentEmotionCue ? 'currentEmotionCue' : '',
    currentEmotionIntensity ? 'currentEmotionIntensity' : '',
    emotionViolation ? 'emotionViolation' : '',
    activeWorldId ? 'activeWorldId' : '',
    activeUserId ? 'activeUserId' : '',
  ]);
  const diagnostics = appendCompanionRuntimeProjectionEvent(input.current.diagnostics, input.event, {
    projectedExecutionState: executionState,
    projectedStatusText: statusText,
    projectedFields,
    projectionReasonCode: projection.reasonCode,
  });
  return {
    ...input.current,
    transport: 'electron-ipc',
    ready: true,
    state: 'projected',
    reasonCode: projection.reasonCode,
    actionHint: 'inspect_runtime_agent_state_event_subscription',
    source: 'runtime',
    message: projection.message,
    ownerUserId: input.ownerUserId,
    runtimeSourceRef: input.runtimeSourceRef,
    localAgentRef: input.event.localAgentRef || input.current.localAgentRef,
    observedAt,
    stateUpdatedAt: observedAt,
    executionState,
    statusText,
    voiceOutputMode,
    voicePlaybackState,
    voiceAudioArtifactId,
    voiceAudioMimeType,
    voicePlaybackTarget,
    voiceStreamId,
    activeWorldId,
    activeUserId,
    currentEmotion,
    currentEmotionId,
    currentEmotionCue,
    currentEmotionIntensity,
    emotionViolation,
    participationMode: activeWorldId ? 'world' : activeUserId ? 'dyadic' : 'idle',
    participationSource: activeWorldId || activeUserId || 'runtime-agent-event',
    projectedFields,
    diagnostics,
  };
}

export function projectZhiyuCompanionFromRuntimeProjectionEvents(input: {
  readonly current: ZhiyuCompanionStatus;
  readonly chat: ZhiyuAgentChatStatus;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly observedAt: string;
}): ZhiyuCompanionStatus {
  const events = runtimeProjectionEventsFromChat(input.chat);
  if (events.length === 0) {
    return input.current;
  }
  let companion = input.current;
  for (const event of events) {
    companion = projectZhiyuCompanionFromRuntimeAgentEvent({
      current: companion,
      event,
      ownerUserId: input.ownerUserId,
      runtimeSourceRef: input.runtimeSourceRef,
      observedAt: input.observedAt,
    });
  }
  return companion;
}

type CompanionEventProjection = {
  readonly reasonCode: string;
  readonly message: string;
  readonly executionState: string | null;
  readonly statusText: string | null;
  readonly voiceOutputMode?: string | null;
  readonly voicePlaybackState?: string | null;
  readonly voiceAudioArtifactId?: string | null;
  readonly voiceAudioMimeType?: string | null;
  readonly voicePlaybackTarget?: string | null;
  readonly voiceStreamId?: string | null;
  readonly activeWorldId: string | null;
  readonly activeUserId: string | null;
  readonly currentEmotion: ZhiyuCompanionEmotionProjection['currentEmotion'];
  readonly currentEmotionId: ZhiyuCompanionEmotionProjection['currentEmotionId'];
  readonly currentEmotionCue: ZhiyuCompanionEmotionProjection['currentEmotionCue'];
  readonly currentEmotionIntensity: ZhiyuCompanionEmotionProjection['currentEmotionIntensity'];
  readonly emotionViolation: ZhiyuCompanionEmotionViolation | null;
  readonly projectedFields: readonly string[];
};

function projectRuntimeAgentCompanionEvent(
  event: NimiRuntimeAgentConsumeEvent,
  current: ZhiyuCompanionStatus,
): CompanionEventProjection | null {
  const eventName = normalizeText(event.eventName);
  const detail = event.detail || {};
  if (eventName.startsWith('runtime.agent.state.')) {
    const emotion = detailText(detail, 'currentEmotion', 'current_emotion')
      ? projectZhiyuCompanionEmotion({
        current: companionEmotionProjectionFromStatus(current),
        emotion: detailText(detail, 'currentEmotion', 'current_emotion'),
      })
      : companionEmotionProjectionFromStatus(current);
    return {
      reasonCode: 'runtime-agent-state-event-projected',
      message: 'Runtime Agent state event was projected through SDK event subscription.',
      statusText: detailText(detail, 'currentStatusText', 'current_status_text') || current.statusText,
      executionState: detailText(detail, 'currentExecutionState', 'current_execution_state') || current.executionState,
      currentEmotion: emotion.currentEmotion,
      currentEmotionId: emotion.currentEmotionId,
      currentEmotionCue: emotion.currentEmotionCue,
      currentEmotionIntensity: emotion.currentEmotionIntensity,
      emotionViolation: emotion.emotionViolation,
      activeWorldId: detailText(detail, 'activeWorldId', 'active_world_id') || current.activeWorldId,
      activeUserId: detailText(detail, 'activeUserId', 'active_user_id') || current.activeUserId,
      projectedFields: [
        detailRecord(detail, 'currentPosture', 'current_posture') ? 'currentPosture' : '',
      ],
    };
  }
  if (eventName.startsWith('runtime.agent.turn.action_') || eventName === 'runtime.agent.turn.artifact_ready') {
    return projectRuntimeAgentTurnActionEvent(eventName, detail, current);
  }
  if (eventName === 'runtime.agent.presentation.activity_requested') {
    return projectRuntimeAgentActivityEvent(detail, current);
  }
  if (
    eventName === 'runtime.agent.presentation.voice_playback_requested'
    || eventName === 'runtime.agent.presentation.voice_stream_chunk_available'
    || eventName === 'runtime.agent.presentation.voice_playback_terminal'
  ) {
    return projectRuntimeAgentVoiceEvent(eventName, detail, current);
  }
  if (eventName === 'runtime.agent.presentation.lipsync_frame_batch') {
    return projectRuntimeAgentLipsyncEvent(detail, current);
  }
  if (eventName.startsWith('runtime.agent.presentation.')) {
    return projectRuntimeAgentGenericPresentationEvent(eventName, detail, current);
  }
  if (eventName.startsWith('runtime.agent.hook.')) {
    return projectRuntimeAgentHookEvent(eventName, detail, current);
  }
  return null;
}

function projectRuntimeAgentTurnActionEvent(
  eventName: string,
  detail: Record<string, unknown>,
  current: ZhiyuCompanionStatus,
): CompanionEventProjection {
  const modality = detailText(detail, 'modality') || mimeModality(detailText(detail, 'mimeType', 'mime_type')) || 'action';
  const phase = eventName.slice('runtime.agent.turn.'.length);
  return runtimeProjection({
    reasonCode: 'runtime-agent-turn-action-event-projected',
    message: 'Runtime Agent turn action event was projected through SDK event subscription.',
    executionState: `${modality}_${phase}`,
    statusText: firstText([
      detailText(detail, 'operation'),
      detailText(detail, 'mimeType', 'mime_type'),
      detailText(detail, 'reasonCode', 'reason_code'),
      detailText(detail, 'message'),
      detailText(detail, 'actionId', 'action_id'),
      current.statusText,
    ]),
    current,
    projectedFields: [
      'turnActionEvent',
      detailText(detail, 'actionId', 'action_id') ? 'actionId' : '',
      detailText(detail, 'modality') ? 'actionModality' : '',
      detailText(detail, 'operation') ? 'actionOperation' : '',
      detailText(detail, 'artifactId', 'artifact_id') ? 'artifactId' : '',
      detailText(detail, 'mimeType', 'mime_type') ? 'mimeType' : '',
      detailText(detail, 'jobId', 'job_id') ? 'jobId' : '',
      detailText(detail, 'reasonCode', 'reason_code') ? 'reasonCode' : '',
    ],
  });
}

function projectRuntimeAgentActivityEvent(
  detail: Record<string, unknown>,
  current: ZhiyuCompanionStatus,
): CompanionEventProjection {
  const activityName = detailText(detail, 'activityName', 'activity_name');
  const category = detailText(detail, 'category');
  const emotion = category === 'emotion' && activityName
    ? projectZhiyuCompanionEmotion({
      current: companionEmotionProjectionFromStatus(current),
      emotion: activityName,
      intensity: detailText(detail, 'intensity'),
    })
    : companionEmotionProjectionFromStatus(current);
  const statusText = category === 'emotion' && emotion.emotionViolation
    ? category || current.statusText
    : activityName || category || current.statusText;
  return runtimeProjection({
    reasonCode: 'runtime-agent-presentation-activity-event-projected',
    message: 'Runtime Agent presentation activity event was projected through SDK event subscription.',
    executionState: 'activity_requested',
    statusText,
    emotion,
    current,
    projectedFields: [
      'presentationActivity',
      activityName ? 'activityName' : '',
      category ? 'activityCategory' : '',
      detailText(detail, 'intensity') ? 'activityIntensity' : '',
      detailText(detail, 'source') ? 'activitySource' : '',
      emotion.emotionViolation ? 'emotionViolation' : '',
    ],
  });
}

function projectRuntimeAgentVoiceEvent(
  eventName: string,
  detail: Record<string, unknown>,
  current: ZhiyuCompanionStatus,
): CompanionEventProjection {
  const isTerminal = eventName.endsWith('voice_playback_terminal');
  const playbackState = detailText(detail, 'playbackState', 'playback_state')
    || detailText(detail, 'voicePlaybackState', 'voice_playback_state')
    || 'streaming';
  const isChunk = eventName.endsWith('voice_stream_chunk_available');
  const voiceOutputMode = detailText(detail, 'voiceOutputMode', 'voice_output_mode');
  const voicePlaybackState = detailText(detail, 'voicePlaybackState', 'voice_playback_state');
  const voiceAudioArtifactId = detailText(detail, 'audioArtifactId', 'audio_artifact_id', 'finalArtifactId', 'final_artifact_id');
  const voiceAudioMimeType = detailText(detail, 'audioMimeType', 'audio_mime_type');
  const voicePlaybackTarget = detailText(detail, 'playbackTarget', 'playback_target');
  const voiceStreamId = detailText(detail, 'voiceStreamId', 'voice_stream_id');
  return runtimeProjection({
    reasonCode: 'runtime-agent-presentation-voice-event-projected',
    message: 'Runtime Agent presentation voice event was projected through SDK event subscription.',
    executionState: isTerminal ? `voice_${playbackState}` : (isChunk ? 'voice_stream_chunk_available' : `voice_${playbackState}`),
    statusText: firstText([
      voicePlaybackTarget,
      voiceOutputMode,
      detailText(detail, 'defaultVoiceReference', 'default_voice_reference'),
      detailText(detail, 'reason'),
      voiceAudioMimeType,
      current.statusText,
    ]),
    current,
    projectedFields: [
      isChunk ? 'voiceStreamChunk' : 'voicePlayback',
      isTerminal ? 'voicePlaybackTerminal' : '',
      voiceStreamId ? 'voiceStreamId' : '',
      voiceAudioArtifactId ? 'audioArtifactId' : '',
      voiceAudioMimeType ? 'audioMimeType' : '',
      voicePlaybackTarget ? 'playbackTarget' : '',
      voiceOutputMode ? 'voiceOutputMode' : '',
      voicePlaybackState ? 'voicePlaybackState' : '',
      detailRecord(detail, 'voiceRouteBinding', 'voice_route_binding') ? 'voiceRouteBinding' : '',
    ],
    voiceOutputMode,
    voicePlaybackState,
    voiceAudioArtifactId,
    voiceAudioMimeType,
    voicePlaybackTarget,
    voiceStreamId,
  });
}

function projectRuntimeAgentLipsyncEvent(
  detail: Record<string, unknown>,
  current: ZhiyuCompanionStatus,
): CompanionEventProjection {
  const frames = Array.isArray(detail.frames) ? detail.frames : [];
  return runtimeProjection({
    reasonCode: 'runtime-agent-presentation-lipsync-event-projected',
    message: 'Runtime Agent presentation lipsync event was projected through SDK event subscription.',
    executionState: 'lipsync_frame_batch',
    statusText: frames.length > 0 ? `lipsync_frames:${frames.length}` : current.statusText,
    current,
    projectedFields: [
      'lipsyncFrameBatch',
      detailText(detail, 'audioArtifactId', 'audio_artifact_id') ? 'audioArtifactId' : '',
      frames.length > 0 ? 'lipsyncFrames' : '',
    ],
  });
}

function projectRuntimeAgentGenericPresentationEvent(
  eventName: string,
  detail: Record<string, unknown>,
  current: ZhiyuCompanionStatus,
): CompanionEventProjection {
  const phase = eventName.slice('runtime.agent.presentation.'.length);
  return runtimeProjection({
    reasonCode: 'runtime-agent-presentation-event-projected',
    message: 'Runtime Agent presentation event was projected through SDK event subscription.',
    executionState: phase,
    statusText: firstText([
      detailText(detail, 'activityName', 'activity_name'),
      detailText(detail, 'expressionName', 'expression_name'),
      detailText(detail, 'motionName', 'motion_name'),
      detailText(detail, 'poseName', 'pose_name'),
      current.statusText,
    ]),
    current,
    projectedFields: ['presentationEvent', phase],
  });
}

function projectRuntimeAgentHookEvent(
  eventName: string,
  detail: Record<string, unknown>,
  current: ZhiyuCompanionStatus,
): CompanionEventProjection {
  const phase = eventName.slice('runtime.agent.hook.'.length);
  return runtimeProjection({
    reasonCode: 'runtime-agent-hook-event-projected',
    message: 'Runtime Agent hook event was projected through SDK event subscription.',
    executionState: `hook_${phase}`,
    statusText: firstText([
      detailText(detail, 'effect'),
      detailText(detail, 'triggerFamily', 'trigger_family'),
      detailText(detail, 'reasonCode', 'reason_code'),
      detailText(detail, 'message'),
      detailText(detail, 'intentId', 'intent_id'),
      current.statusText,
    ]),
    current,
    projectedFields: [
      'hookIntent',
      detailText(detail, 'intentId', 'intent_id') ? 'intentId' : '',
      detailText(detail, 'triggerFamily', 'trigger_family') ? 'triggerFamily' : '',
      detailText(detail, 'effect') ? 'hookEffect' : '',
      detailText(detail, 'admissionState', 'admission_state') ? 'hookAdmissionState' : '',
      detailText(detail, 'reasonCode', 'reason_code') ? 'reasonCode' : '',
    ],
  });
}

function runtimeProjection(input: {
  readonly reasonCode: string;
  readonly message: string;
  readonly executionState: string | null;
  readonly statusText: string | null;
  readonly currentEmotion?: string | null;
  readonly emotion?: ZhiyuCompanionEmotionProjection;
  readonly voiceOutputMode?: string | null;
  readonly voicePlaybackState?: string | null;
  readonly voiceAudioArtifactId?: string | null;
  readonly voiceAudioMimeType?: string | null;
  readonly voicePlaybackTarget?: string | null;
  readonly voiceStreamId?: string | null;
  readonly current: ZhiyuCompanionStatus;
  readonly projectedFields: readonly string[];
}): CompanionEventProjection {
  const emotion = input.emotion ?? (
    input.currentEmotion === undefined
      ? companionEmotionProjectionFromStatus(input.current)
      : projectZhiyuCompanionEmotion({
        current: companionEmotionProjectionFromStatus(input.current),
        emotion: input.currentEmotion,
      })
  );
  return {
    reasonCode: input.reasonCode,
    message: input.message,
    executionState: input.executionState || input.current.executionState,
    statusText: input.statusText || input.current.statusText,
    activeWorldId: input.current.activeWorldId,
    activeUserId: input.current.activeUserId,
    currentEmotion: emotion.currentEmotion,
    currentEmotionId: emotion.currentEmotionId,
    currentEmotionCue: emotion.currentEmotionCue,
    currentEmotionIntensity: emotion.currentEmotionIntensity,
    emotionViolation: emotion.emotionViolation,
    voiceOutputMode: input.voiceOutputMode ?? input.current.voiceOutputMode,
    voicePlaybackState: input.voicePlaybackState ?? input.current.voicePlaybackState,
    voiceAudioArtifactId: input.voiceAudioArtifactId ?? input.current.voiceAudioArtifactId,
    voiceAudioMimeType: input.voiceAudioMimeType ?? input.current.voiceAudioMimeType,
    voicePlaybackTarget: input.voicePlaybackTarget ?? input.current.voicePlaybackTarget,
    voiceStreamId: input.voiceStreamId ?? input.current.voiceStreamId,
    projectedFields: input.projectedFields,
  };
}

function companionEmotionProjectionFromStatus(status: ZhiyuCompanionStatus): ZhiyuCompanionEmotionProjection {
  if (
    status.currentEmotion
    || status.currentEmotionId
    || status.currentEmotionCue
    || status.currentEmotionIntensity
    || status.emotionViolation
  ) {
    return {
      currentEmotion: status.currentEmotion,
      currentEmotionId: status.currentEmotionId,
      currentEmotionCue: status.currentEmotionCue,
      currentEmotionIntensity: status.currentEmotionIntensity,
      emotionViolation: status.emotionViolation,
    };
  }
  return initialZhiyuCompanionEmotionProjection();
}

function runtimeProjectionEventsFromChat(chat: ZhiyuAgentChatStatus): NimiRuntimeAgentConsumeEvent[] {
  const events: NimiRuntimeAgentConsumeEvent[] = [];
  const addEvents = (value: unknown) => {
    if (!Array.isArray(value)) {
      return;
    }
    for (const item of value) {
      const event = runtimeProjectionEventFromUnknown(item, chat);
      if (event) {
        events.push(event);
      }
    }
  };
  if (isRecord(chat.diagnostics)) {
    addEvents(chat.diagnostics.runtimeProjectionEvents);
  }
  for (const message of chat.messages) {
    if (isRecord(message.metadata)) {
      addEvents(message.metadata.runtimeProjectionEvents);
    }
  }
  return events;
}

function runtimeProjectionEventFromUnknown(
  value: unknown,
  chat: ZhiyuAgentChatStatus,
): NimiRuntimeAgentConsumeEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const eventName = normalizeText(value.eventName);
  const detail = isRecord(value.detail) ? value.detail : null;
  if (!eventName || !detail) {
    return null;
  }
  const localAgentRef = normalizeText(value.localAgentRef) || normalizeText(chat.localAgentRef);
  if (!localAgentRef) {
    return null;
  }
  return {
    eventName,
    localAgentRef,
    conversationAnchorId: normalizeText(value.conversationAnchorId) || normalizeText(chat.conversationAnchorId),
    turnId: normalizeText(value.runtimeTurnId) || normalizeText(value.turnId),
    streamId: normalizeText(value.runtimeStreamId) || normalizeText(value.streamId),
    detail,
  } as NimiRuntimeAgentConsumeEvent;
}

function appendCompanionRuntimeProjectionEvent(
  current: ZhiyuCompanionStatus['diagnostics'] | undefined,
  event: NimiRuntimeAgentConsumeEvent,
  projection: {
    readonly projectedExecutionState: string | null;
    readonly projectedStatusText: string | null;
    readonly projectedFields: readonly string[];
    readonly projectionReasonCode: string | null;
  },
): ZhiyuCompanionStatus['diagnostics'] {
  const events = Array.isArray(current?.runtimeProjectionEvents)
    ? current.runtimeProjectionEvents
    : [];
  return {
    runtimeProjectionEvents: [
      ...events,
      companionRuntimeProjectionEventEvidence(event, projection),
    ].slice(-80),
  };
}

function companionRuntimeProjectionEventEvidence(
  event: NimiRuntimeAgentConsumeEvent,
  projection: {
    readonly projectedExecutionState: string | null;
    readonly projectedStatusText: string | null;
    readonly projectedFields: readonly string[];
    readonly projectionReasonCode: string | null;
  },
): ZhiyuCompanionRuntimeProjectionEventEvidence {
  return {
    eventName: normalizeText(event.eventName),
    localAgentRef: normalizeText(event.localAgentRef) || null,
    conversationAnchorId: normalizeText(event.conversationAnchorId) || null,
    turnId: normalizeText(event.turnId) || null,
    streamId: normalizeText(event.streamId) || null,
    detail: isRecord(event.detail) ? { ...event.detail } : {},
    projectedExecutionState: normalizeText(projection.projectedExecutionState) || null,
    projectedStatusText: normalizeText(projection.projectedStatusText) || null,
    projectedFields: uniqueTexts(projection.projectedFields),
    projectionReasonCode: normalizeText(projection.projectionReasonCode) || null,
  };
}

function transcriptHasReplayEnvelope(
  transcript: readonly NimiRuntimeAgentSessionTranscriptMessage[],
): boolean {
  return transcript.length > 0 && transcript.every((message) => (
    normalizeText(message.id)
    && normalizeText(message.role)
    && (normalizeText(message.content) || isTranscriptImageMessage(message))
    && normalizeText(message.status)
    && normalizeText(message.kind)
    && normalizeText(message.createdAt)
    && normalizeText(message.updatedAt)
  ));
}

function isTranscriptImageMessage(message: NimiRuntimeAgentSessionTranscriptMessage): boolean {
  return normalizeText(message.kind) === 'image' && Boolean(normalizeText(message.artifactId));
}

function runtimeTurnIdFromSnapshot(snapshot: NimiRuntimeAgentSessionSnapshot): string | null {
  const turnId = normalizeText(snapshot.activeTurn?.turnId) || normalizeText(snapshot.lastTurn?.turnId);
  return /^agent_turn_/u.test(turnId) ? turnId : null;
}

function runtimeStreamIdFromSnapshot(snapshot: NimiRuntimeAgentSessionSnapshot): string | null {
  const streamId = normalizeText(snapshot.activeTurn?.streamId) || normalizeText(snapshot.lastTurn?.streamId);
  return /^agent_stream_/u.test(streamId) ? streamId : null;
}

function transcriptMessageToCanonicalMessage(input: {
  readonly message: NimiRuntimeAgentSessionTranscriptMessage;
  readonly sessionId: string;
  readonly targetId: string;
}): ConversationCanonicalMessage | null {
  const id = normalizeText(input.message.id);
  const content = normalizeText(input.message.content);
  if (!id || (!content && !isTranscriptImageMessage(input.message))) {
    return null;
  }
  const role = canonicalRole(input.message.role);
  const kind = canonicalKind(input.message.kind);
  const status = canonicalStatus(input.message.status);
  const createdAt = normalizeText(input.message.createdAt);
  const updatedAt = normalizeText(input.message.updatedAt) || createdAt;
  if (!role || !kind || !status || !createdAt) {
    return null;
  }
  return {
    id,
    sessionId: input.sessionId,
    targetId: input.targetId,
    source: 'agent',
    role,
    text: content,
    createdAt,
    updatedAt,
    status,
    kind,
    senderName: role === 'user' ? 'You' : role === 'agent' ? 'Zhiyu Agent' : null,
    senderKind: role === 'user' ? 'human' : role === 'agent' ? 'agent' : 'system',
    metadata: {
      ...(normalizeText(input.message.traceId) ? { traceId: normalizeText(input.message.traceId) } : {}),
      ...(normalizeText(input.message.reasoningText) ? { reasoningText: normalizeText(input.message.reasoningText) } : {}),
      ...(normalizeText(input.message.artifactId) ? { artifactId: normalizeText(input.message.artifactId) } : {}),
      ...(normalizeText(input.message.mediaUrl) ? { mediaUrl: normalizeText(input.message.mediaUrl) } : {}),
      ...(normalizeText(input.message.mediaMimeType) ? { mediaMimeType: normalizeText(input.message.mediaMimeType) } : {}),
      ...(input.message.metadata || {}),
    },
  };
}

function canonicalRole(role: unknown): ConversationCanonicalMessage['role'] | null {
  const normalized = normalizeText(role);
  if (normalized === 'assistant') {
    return 'agent';
  }
  if (normalized === 'user' || normalized === 'system' || normalized === 'tool') {
    return normalized;
  }
  return null;
}

function canonicalKind(kind: unknown): ConversationCanonicalMessage['kind'] | null {
  const normalized = normalizeText(kind);
  if (
    normalized === 'text'
    || normalized === 'image'
    || normalized === 'voice'
    || normalized === 'system'
  ) {
    return normalized;
  }
  if (normalized === 'tool') {
    return 'system';
  }
  return null;
}

function canonicalStatus(status: unknown): ConversationCanonicalMessage['status'] | null {
  const normalized = normalizeText(status);
  if (normalized === 'complete' || normalized === 'pending' || normalized === 'error') {
    return normalized;
  }
  if (normalized === 'committed') {
    return 'complete';
  }
  if (normalized === 'failed') {
    return 'error';
  }
  return null;
}

function latestAssistantMessage(messages: readonly ConversationCanonicalMessage[]): ConversationCanonicalMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'agent') {
      return message;
    }
  }
  return null;
}

function detailText(detail: Record<string, unknown>, ...keys: readonly string[]): string {
  for (const key of keys) {
    const value = normalizeText(detail[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

function detailRecord(detail: Record<string, unknown>, ...keys: readonly string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = detail[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return null;
}

function firstText(values: readonly (string | null | undefined)[]): string | null {
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function mimeModality(mimeType: string): string {
  const normalized = normalizeText(mimeType).toLowerCase();
  if (normalized.startsWith('image/')) {
    return 'image';
  }
  if (normalized.startsWith('audio/')) {
    return 'voice';
  }
  if (normalized.startsWith('video/')) {
    return 'video';
  }
  return '';
}

function uniqueTexts(values: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = normalizeText(value);
    if (normalized) {
      unique.add(normalized);
    }
  }
  return [...unique];
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
