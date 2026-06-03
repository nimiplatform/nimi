import { describe, expect, it } from 'vitest';

import {
  parseAgentVoicePlaybackCueEnvelope,
  resolveAgentVoicePlaybackCueFromEnvelope,
  resolveRuntimeVoicePlaybackFrameCue,
  toAgentVoicePlaybackCueEnvelopeJson,
} from '../src/runtime.js';

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
