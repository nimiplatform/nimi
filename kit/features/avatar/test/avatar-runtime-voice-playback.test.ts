import { describe, expect, it } from 'vitest';

import {
  parseAgentVoicePlaybackCueEnvelope,
  resolveAgentVoicePlaybackCueFromEnvelope,
  resolveRuntimeAgentVoicePlaybackDecision,
  resolveRuntimeVoicePlaybackFrameCue,
  toAgentVoicePlaybackCueEnvelopeJson,
  type RuntimeAgentPresentationLipsyncFrameBatchEvent,
  type RuntimeAgentPresentationVoicePlaybackRequestedEvent,
  type RuntimeAgentTimelineEnvelope,
} from '../src/runtime.js';

function runtimeTimeline(
  channel: RuntimeAgentTimelineEnvelope['channel'],
  overrides: Partial<RuntimeAgentTimelineEnvelope> = {},
): RuntimeAgentTimelineEnvelope {
  return {
    turnId: 'turn-1',
    streamId: 'stream-1',
    channel,
    offsetMs: 0,
    sequence: channel === 'voice' ? 1 : 2,
    startedAtWall: '2026-04-26T00:00:00.000Z',
    observedAtWall: '2026-04-26T00:00:00.020Z',
    timebaseOwner: 'runtime',
    projectionRuleId: 'K-AGCORE-051',
    clockBasis: 'monotonic_with_wall_anchor',
    providerNeutral: true,
    appLocalAuthority: false,
    ...overrides,
  };
}

function voiceEvent(
  overrides: Partial<RuntimeAgentPresentationVoicePlaybackRequestedEvent> = {},
): RuntimeAgentPresentationVoicePlaybackRequestedEvent {
  return {
    eventName: 'runtime.agent.presentation.voice_playback_requested',
    localAgentRef: 'local-agent:user-1:agent-1',
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    streamId: 'stream-1',
    timeline: runtimeTimeline('voice'),
    detail: {
      audioArtifactId: 'artifact-1',
      audioMimeType: 'audio/wav',
      playbackState: 'requested',
    },
    ...overrides,
  };
}

function lipsyncEvent(
  overrides: Partial<RuntimeAgentPresentationLipsyncFrameBatchEvent> = {},
): RuntimeAgentPresentationLipsyncFrameBatchEvent {
  return {
    eventName: 'runtime.agent.presentation.lipsync_frame_batch',
    localAgentRef: 'local-agent:user-1:agent-1',
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    streamId: 'stream-1',
    timeline: runtimeTimeline('lipsync'),
    detail: {
      audioArtifactId: 'artifact-1',
      frames: [
        { frameSequence: 1, offsetMs: 0, durationMs: 80, mouthOpenY: 0.2, audioLevel: 0.18 },
        { frameSequence: 2, offsetMs: 80, durationMs: 90, mouthOpenY: 0.7, audioLevel: 0.64 },
      ],
    },
    ...overrides,
  };
}

describe('avatar runtime voice playback projection', () => {
  it('parses and sorts playback cue envelopes', () => {
    expect(parseAgentVoicePlaybackCueEnvelope({
      version: 'v1',
      source: 'runtime',
      cues: [
        { offsetMs: 180, durationMs: 120, amplitude: 0.72, visemeId: 'oh' },
        { offsetMs: 0, durationMs: 160, amplitude: 0.28, visemeId: 'aa' },
      ],
    })).toEqual({
      version: 'v1',
      source: 'runtime',
      cues: [
        { offsetMs: 0, durationMs: 160, amplitude: 0.28, visemeId: 'aa' },
        { offsetMs: 180, durationMs: 120, amplitude: 0.72, visemeId: 'oh' },
      ],
    });
  });

  it('resolves active cues from envelope time', () => {
    const envelope = parseAgentVoicePlaybackCueEnvelope({
      version: 'v1',
      source: 'provider',
      cues: [
        { offsetMs: 0, durationMs: 150, amplitude: 0.22, visemeId: 'ee' },
        { offsetMs: 150, durationMs: 180, amplitude: 0.61, visemeId: 'ou' },
      ],
    });

    expect(resolveAgentVoicePlaybackCueFromEnvelope(envelope, 0.08)).toEqual({
      amplitude: 0.22,
      visemeId: 'ee',
    });
    expect(resolveAgentVoicePlaybackCueFromEnvelope(envelope, 0.23)).toEqual({
      amplitude: 0.61,
      visemeId: 'ou',
    });
    expect(resolveAgentVoicePlaybackCueFromEnvelope(envelope, 0.4)).toEqual({
      amplitude: 0,
      visemeId: null,
    });
  });

  it('serializes admitted cue envelopes', () => {
    expect(toAgentVoicePlaybackCueEnvelopeJson({
      version: 'v1',
      source: 'desktop-local',
      cues: [{ offsetMs: 40, durationMs: 80, amplitude: 0.35, visemeId: null }],
    })).toEqual({
      version: 'v1',
      source: 'desktop-local',
      cues: [{ offsetMs: 40, durationMs: 80, amplitude: 0.35, visemeId: null }],
    });
  });

  it('schedules from runtime-owned lipsync frames', () => {
    const decision = resolveRuntimeAgentVoicePlaybackDecision({
      voiceEvent: voiceEvent(),
      lipsyncEvent: lipsyncEvent(),
      activeTurnId: 'turn-1',
      activeStreamId: 'stream-1',
    });

    expect(decision.kind).toBe('schedule');
    if (decision.kind !== 'schedule') {
      throw new Error('expected schedule');
    }
    expect(decision.schedule.audioArtifactId).toBe('artifact-1');
    expect(decision.schedule.cueEnvelope).toEqual({
      version: 'v1',
      source: 'runtime',
      cues: [
        { offsetMs: 0, durationMs: 80, amplitude: 0.18, visemeId: null },
        { offsetMs: 80, durationMs: 90, amplitude: 0.64, visemeId: null },
      ],
    });
  });

  it('rejects stale streams and timeline drift', () => {
    expect(resolveRuntimeAgentVoicePlaybackDecision({
      voiceEvent: voiceEvent(),
      lipsyncEvent: lipsyncEvent(),
      activeStreamId: 'other-stream',
    })).toEqual({
      kind: 'reject',
      reason: 'stale_stream',
    });

    expect(resolveRuntimeAgentVoicePlaybackDecision({
      voiceEvent: voiceEvent(),
      lipsyncEvent: lipsyncEvent({
        timeline: runtimeTimeline('lipsync', { offsetMs: 500 }),
      }),
      driftToleranceMs: 50,
    })).toEqual({
      kind: 'reject',
      reason: 'timeline_drift_exceeded',
    });
  });

  it('returns cancel for terminal interruption', () => {
    const decision = resolveRuntimeAgentVoicePlaybackDecision({
      voiceEvent: voiceEvent({
        detail: {
          audioArtifactId: 'artifact-1',
          audioMimeType: 'audio/wav',
          playbackState: 'interrupted',
          reason: 'user_interrupt',
        },
      }),
    });

    expect(decision.kind).toBe('cancel');
    if (decision.kind !== 'cancel') {
      throw new Error('expected cancel');
    }
    expect(decision.reason).toBe('user_interrupt');
    expect(decision.audioArtifactId).toBe('artifact-1');
  });

  it('uses envelope cues before audio estimator output', () => {
    const envelope = parseAgentVoicePlaybackCueEnvelope({
      version: 'v1',
      source: 'runtime',
      cues: [{ offsetMs: 20, durationMs: 100, amplitude: 0.5, visemeId: 'aa' }],
    });

    expect(resolveRuntimeVoicePlaybackFrameCue({
      playbackCueEnvelope: envelope,
      currentTimeSeconds: 0.04,
      timeDomainSamples: new Uint8Array(0),
      previousEstimatorFrame: null,
    })).toEqual({
      source: 'envelope',
      cue: { amplitude: 0.5, visemeId: 'aa' },
      estimatorFrame: null,
    });
  });
});
