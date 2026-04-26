import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAgentVoicePlaybackCueEnvelope,
  resolveRuntimeAgentVoicePlaybackDecision,
  resolveAgentVoicePlaybackCueFromEnvelope,
  toAgentVoicePlaybackCueEnvelopeJson,
} from '../src/shell/renderer/features/chat/chat-agent-voice-playback-envelope.js';
import type {
  RuntimeAgentPresentationLipsyncFrameBatchEvent,
  RuntimeAgentPresentationVoicePlaybackRequestedEvent,
  RuntimeAgentTimelineEnvelope,
} from '@nimiplatform/sdk/runtime';

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
    agentId: 'agent-1',
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
    agentId: 'agent-1',
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

test('agent voice playback envelope parser admits normalized cue envelopes', () => {
  const envelope = parseAgentVoicePlaybackCueEnvelope({
    version: 'v1',
    source: 'runtime',
    cues: [
      {
        offsetMs: 180,
        durationMs: 120,
        amplitude: 0.72,
        visemeId: 'oh',
      },
      {
        offsetMs: 0,
        durationMs: 160,
        amplitude: 0.28,
        visemeId: 'aa',
      },
    ],
  });

  assert.deepEqual(envelope, {
    version: 'v1',
    source: 'runtime',
    cues: [
      {
        offsetMs: 0,
        durationMs: 160,
        amplitude: 0.28,
        visemeId: 'aa',
      },
      {
        offsetMs: 180,
        durationMs: 120,
        amplitude: 0.72,
        visemeId: 'oh',
      },
    ],
  });
});

test('agent voice playback envelope resolver returns active cue for current time', () => {
  const envelope = parseAgentVoicePlaybackCueEnvelope({
    version: 'v1',
    source: 'provider',
    cues: [
      {
        offsetMs: 0,
        durationMs: 150,
        amplitude: 0.22,
        visemeId: 'ee',
      },
      {
        offsetMs: 150,
        durationMs: 180,
        amplitude: 0.61,
        visemeId: 'ou',
      },
    ],
  });

  assert.ok(envelope);
  assert.deepEqual(resolveAgentVoicePlaybackCueFromEnvelope(envelope, 0.08), {
    amplitude: 0.22,
    visemeId: 'ee',
  });
  assert.deepEqual(resolveAgentVoicePlaybackCueFromEnvelope(envelope, 0.23), {
    amplitude: 0.61,
    visemeId: 'ou',
  });
  assert.deepEqual(resolveAgentVoicePlaybackCueFromEnvelope(envelope, 0.4), {
    amplitude: 0,
    visemeId: null,
  });
});

test('agent voice playback envelope json serializer preserves admitted structure', () => {
  assert.deepEqual(toAgentVoicePlaybackCueEnvelopeJson({
    version: 'v1',
    source: 'desktop-local',
    cues: [{
      offsetMs: 40,
      durationMs: 80,
      amplitude: 0.35,
      visemeId: null,
    }],
  }), {
    version: 'v1',
    source: 'desktop-local',
    cues: [{
      offsetMs: 40,
      durationMs: 80,
      amplitude: 0.35,
      visemeId: null,
    }],
  });
});

test('runtime agent voice playback decision schedules from runtime-owned lipsync frames', () => {
  const decision = resolveRuntimeAgentVoicePlaybackDecision({
    voiceEvent: voiceEvent(),
    lipsyncEvent: lipsyncEvent(),
    activeTurnId: 'turn-1',
    activeStreamId: 'stream-1',
  });

  assert.equal(decision.kind, 'schedule');
  if (decision.kind !== 'schedule') {
    throw new Error('expected schedule');
  }
  assert.equal(decision.schedule.audioArtifactId, 'artifact-1');
  assert.equal(decision.schedule.cueEnvelope.source, 'runtime');
  assert.deepEqual(decision.schedule.cueEnvelope.cues, [
    { offsetMs: 0, durationMs: 80, amplitude: 0.18, visemeId: null },
    { offsetMs: 80, durationMs: 90, amplitude: 0.64, visemeId: null },
  ]);
});

test('runtime agent voice playback decision rejects stale streams and drift', () => {
  assert.deepEqual(resolveRuntimeAgentVoicePlaybackDecision({
    voiceEvent: voiceEvent(),
    lipsyncEvent: lipsyncEvent(),
    activeStreamId: 'other-stream',
  }), {
    kind: 'reject',
    reason: 'stale_stream',
  });

  assert.deepEqual(resolveRuntimeAgentVoicePlaybackDecision({
    voiceEvent: voiceEvent(),
    lipsyncEvent: lipsyncEvent({
      timeline: runtimeTimeline('lipsync', { offsetMs: 500 }),
    }),
    driftToleranceMs: 50,
  }), {
    kind: 'reject',
    reason: 'timeline_drift_exceeded',
  });
});

test('runtime agent voice playback decision returns cancel for terminal interruption', () => {
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

  assert.equal(decision.kind, 'cancel');
  if (decision.kind !== 'cancel') {
    throw new Error('expected cancel');
  }
  assert.equal(decision.reason, 'user_interrupt');
  assert.equal(decision.audioArtifactId, 'artifact-1');
});
