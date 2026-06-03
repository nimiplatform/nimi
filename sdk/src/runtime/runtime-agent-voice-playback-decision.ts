import type {
  RuntimeAgentPresentationLipsyncFrameBatchEvent,
  RuntimeAgentPresentationVoicePlaybackRequestedEvent,
  RuntimeAgentTimelineEnvelope,
} from './types-runtime-agent.js';

export type RuntimeAgentVoicePlaybackCuePoint = {
  offsetMs: number;
  durationMs: number;
  amplitude: number;
  visemeId: null;
};

export type RuntimeAgentVoicePlaybackCueEnvelope = {
  version: 'v1';
  source: 'runtime';
  cues: RuntimeAgentVoicePlaybackCuePoint[];
};

export type RuntimeAgentVoicePlaybackSchedule = {
  turnId: string;
  streamId: string;
  audioArtifactId: string;
  audioMimeType: string;
  playbackState: 'requested' | 'started';
  timeline: RuntimeAgentTimelineEnvelope;
  cueEnvelope: RuntimeAgentVoicePlaybackCueEnvelope;
  driftMs: number;
};

export type RuntimeAgentVoicePlaybackDecision =
  | {
    kind: 'schedule';
    schedule: RuntimeAgentVoicePlaybackSchedule;
  }
  | {
    kind: 'cancel';
    turnId: string;
    streamId: string;
    audioArtifactId: string;
    reason: string;
    timeline: RuntimeAgentTimelineEnvelope;
  }
  | {
    kind: 'reject';
    reason: string;
  };

function isRuntimeTimelineForChannel(
  timeline: RuntimeAgentTimelineEnvelope | undefined,
  channel: 'voice' | 'lipsync',
): boolean {
  return Boolean(
    timeline
    && timeline.channel === channel
    && timeline.timebaseOwner === 'runtime'
    && timeline.projectionRuleId === 'K-AGCORE-051'
    && timeline.clockBasis === 'monotonic_with_wall_anchor'
    && timeline.providerNeutral === true
    && timeline.appLocalAuthority === false,
  );
}

function matchesTimelineIdentity(
  event: RuntimeAgentPresentationVoicePlaybackRequestedEvent | RuntimeAgentPresentationLipsyncFrameBatchEvent,
): boolean {
  return event.timeline.turnId === event.turnId && event.timeline.streamId === event.streamId;
}

function rejectRuntimeVoicePlayback(reason: string): RuntimeAgentVoicePlaybackDecision {
  return {
    kind: 'reject',
    reason,
  };
}

export function resolveRuntimeAgentVoicePlaybackDecision(input: {
  voiceEvent: RuntimeAgentPresentationVoicePlaybackRequestedEvent;
  lipsyncEvent?: RuntimeAgentPresentationLipsyncFrameBatchEvent | null;
  activeTurnId?: string | null;
  activeStreamId?: string | null;
  playbackClockOffsetMs?: number;
  driftToleranceMs?: number;
}): RuntimeAgentVoicePlaybackDecision {
  const { voiceEvent } = input;
  if (voiceEvent.eventName !== 'runtime.agent.presentation.voice_playback_requested') {
    return rejectRuntimeVoicePlayback('unsupported_voice_event');
  }
  if (!isRuntimeTimelineForChannel(voiceEvent.timeline, 'voice') || !matchesTimelineIdentity(voiceEvent)) {
    return rejectRuntimeVoicePlayback('non_runtime_voice_timeline');
  }
  if (
    (input.activeTurnId && input.activeTurnId !== voiceEvent.turnId)
    || (input.activeStreamId && input.activeStreamId !== voiceEvent.streamId)
  ) {
    return rejectRuntimeVoicePlayback('stale_stream');
  }
  const terminalState = voiceEvent.detail.playbackState;
  if (terminalState === 'interrupted' || terminalState === 'canceled' || terminalState === 'failed') {
    return {
      kind: 'cancel',
      turnId: voiceEvent.turnId,
      streamId: voiceEvent.streamId,
      audioArtifactId: voiceEvent.detail.audioArtifactId,
      reason: voiceEvent.detail.reason || terminalState,
      timeline: voiceEvent.timeline,
    };
  }
  if (terminalState !== 'requested' && terminalState !== 'started') {
    return rejectRuntimeVoicePlayback('terminal_playback_state');
  }
  const lipsyncEvent = input.lipsyncEvent;
  if (!lipsyncEvent || lipsyncEvent.eventName !== 'runtime.agent.presentation.lipsync_frame_batch') {
    return rejectRuntimeVoicePlayback('missing_lipsync_event');
  }
  if (!isRuntimeTimelineForChannel(lipsyncEvent.timeline, 'lipsync') || !matchesTimelineIdentity(lipsyncEvent)) {
    return rejectRuntimeVoicePlayback('non_runtime_lipsync_timeline');
  }
  if (lipsyncEvent.turnId !== voiceEvent.turnId || lipsyncEvent.streamId !== voiceEvent.streamId) {
    return rejectRuntimeVoicePlayback('timeline_identity_mismatch');
  }
  if (lipsyncEvent.detail.audioArtifactId !== voiceEvent.detail.audioArtifactId) {
    return rejectRuntimeVoicePlayback('audio_artifact_mismatch');
  }
  const driftMs = lipsyncEvent.timeline.offsetMs
    - voiceEvent.timeline.offsetMs
    - (Number.isFinite(input.playbackClockOffsetMs) ? input.playbackClockOffsetMs! : 0);
  const driftToleranceMs = Number.isFinite(input.driftToleranceMs) ? input.driftToleranceMs! : 120;
  if (Math.abs(driftMs) > driftToleranceMs) {
    return rejectRuntimeVoicePlayback('timeline_drift_exceeded');
  }
  const cues = lipsyncEvent.detail.frames
    .map((frame) => ({
      offsetMs: frame.offsetMs,
      durationMs: frame.durationMs,
      amplitude: Math.max(0, Math.min(frame.audioLevel || frame.mouthOpenY, 1)),
      visemeId: null,
    }))
    .filter((cue) => cue.durationMs > 0)
    .sort((left, right) => left.offsetMs - right.offsetMs);
  if (cues.length === 0) {
    return rejectRuntimeVoicePlayback('empty_lipsync_frames');
  }
  return {
    kind: 'schedule',
    schedule: {
      turnId: voiceEvent.turnId,
      streamId: voiceEvent.streamId,
      audioArtifactId: voiceEvent.detail.audioArtifactId,
      audioMimeType: voiceEvent.detail.audioMimeType,
      playbackState: terminalState,
      timeline: voiceEvent.timeline,
      cueEnvelope: {
        version: 'v1',
        source: 'runtime',
        cues,
      },
      driftMs,
    },
  };
}
