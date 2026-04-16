import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAgentVoicePlaybackCueEnvelope,
  resolveAgentVoicePlaybackCueFromEnvelope,
  toAgentVoicePlaybackCueEnvelopeJson,
} from '../src/shell/renderer/features/chat/chat-agent-voice-playback-envelope.js';

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
