import {
  parseOptionalJsonObject,
  parseOptionalNumber,
  parseOptionalString,
} from '@renderer/bridge/runtime-bridge/shared';
import type { JsonObject } from '@renderer/bridge/runtime-bridge/shared';
import type {
  AgentVoicePlaybackCue,
  AgentVoicePlaybackVisemeId,
} from './chat-agent-voice-playback-state';
import type {
  RuntimeAgentPresentationLipsyncFrameBatchEvent,
  RuntimeAgentPresentationVoicePlaybackRequestedEvent,
  RuntimeAgentTimelineEnvelope,
} from '@nimiplatform/sdk/runtime';

export type AgentVoicePlaybackCuePoint = {
  offsetMs: number;
  durationMs: number;
  amplitude: number;
  visemeId: AgentVoicePlaybackVisemeId | null;
};

export type AgentVoicePlaybackCueEnvelope = {
  version: 'v1';
  source: 'runtime' | 'provider' | 'desktop-local';
  cues: AgentVoicePlaybackCuePoint[];
};

export type RuntimeAgentVoicePlaybackSchedule = {
  turnId: string;
  streamId: string;
  audioArtifactId: string;
  audioMimeType: string;
  playbackState: 'requested' | 'started';
  timeline: RuntimeAgentTimelineEnvelope;
  cueEnvelope: AgentVoicePlaybackCueEnvelope;
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

function parseVisemeId(value: unknown): AgentVoicePlaybackVisemeId | null {
  const normalized = parseOptionalString(value);
  if (
    normalized === 'aa'
    || normalized === 'ee'
    || normalized === 'ih'
    || normalized === 'oh'
    || normalized === 'ou'
  ) {
    return normalized;
  }
  return null;
}

function parseCuePoint(value: unknown): AgentVoicePlaybackCuePoint | null {
  const record = parseOptionalJsonObject(value);
  if (!record) {
    return null;
  }
  const offsetMs = parseOptionalNumber(record?.offsetMs);
  const durationMs = parseOptionalNumber(record?.durationMs);
  const amplitude = parseOptionalNumber(record?.amplitude);
  if (offsetMs == null || durationMs == null || durationMs <= 0 || amplitude == null) {
    return null;
  }
  return {
    offsetMs: Math.max(0, offsetMs),
    durationMs,
    amplitude: Math.max(0, Math.min(amplitude, 1)),
    visemeId: parseVisemeId(record?.visemeId),
  };
}

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

export function parseAgentVoicePlaybackCueEnvelope(value: unknown): AgentVoicePlaybackCueEnvelope | null {
  const record = parseOptionalJsonObject(value);
  if (!record) {
    return null;
  }
  const version = parseOptionalString(record?.version);
  const source = parseOptionalString(record?.source);
  if (
    version !== 'v1'
    || (source !== 'runtime' && source !== 'provider' && source !== 'desktop-local')
  ) {
    return null;
  }
  const cues = Array.isArray(record.cues)
    ? record.cues
      .map((cue) => parseCuePoint(cue))
      .filter((cue): cue is AgentVoicePlaybackCuePoint => Boolean(cue))
      .sort((left, right) => left.offsetMs - right.offsetMs)
    : [];
  if (cues.length === 0) {
    return null;
  }
  return {
    version,
    source,
    cues,
  };
}

export function toAgentVoicePlaybackCueEnvelopeJson(
  envelope: AgentVoicePlaybackCueEnvelope,
): JsonObject {
  return {
    version: envelope.version,
    source: envelope.source,
    cues: envelope.cues.map((cue) => ({
      offsetMs: cue.offsetMs,
      durationMs: cue.durationMs,
      amplitude: cue.amplitude,
      visemeId: cue.visemeId,
    })),
  };
}

export function resolveAgentVoicePlaybackCueFromEnvelope(
  envelope: AgentVoicePlaybackCueEnvelope | null | undefined,
  currentTimeSeconds: number,
): AgentVoicePlaybackCue {
  if (!envelope || envelope.cues.length === 0) {
    return {
      amplitude: 0,
      visemeId: null,
    };
  }
  const currentTimeMs = Math.max(
    0,
    Math.round((Number.isFinite(currentTimeSeconds) ? currentTimeSeconds : 0) * 1000),
  );
  for (const cue of envelope.cues) {
    if (currentTimeMs < cue.offsetMs) {
      break;
    }
    if (currentTimeMs < cue.offsetMs + cue.durationMs) {
      return {
        amplitude: cue.amplitude,
        visemeId: cue.visemeId,
      };
    }
  }
  return {
    amplitude: 0,
    visemeId: null,
  };
}
