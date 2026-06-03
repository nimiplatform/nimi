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

  it('prefers admitted envelope truth over local estimator fallback', () => {
    const frame = resolveRuntimeVoicePlaybackFrameCue({
      playbackCueEnvelope: {
        version: 'v1',
        source: 'provider',
        cues: [{
          offsetMs: 0,
          durationMs: 300,
          amplitude: 0.77,
          visemeId: 'ee',
        }],
      },
      currentTimeSeconds: 0.12,
      timeDomainSamples: new Uint8Array([128, 220, 64, 216, 72, 208, 80, 200]),
      frequencySamples: new Uint8Array([24, 36, 54, 88, 144, 208, 220, 240]),
    });

    expect(frame.source).toBe('envelope');
    expect(frame.cue.visemeId).toBe('ee');
    expect(frame.cue.amplitude).toBe(0.77);
  });

  it('falls back to estimator when the envelope is absent', () => {
    const frame = resolveRuntimeVoicePlaybackFrameCue({
      playbackCueEnvelope: null,
      currentTimeSeconds: 0.32,
      timeDomainSamples: new Uint8Array([128, 164, 182, 168, 128, 98, 82, 96]),
      frequencySamples: new Uint8Array([220, 208, 172, 118, 70, 42, 16, 8]),
    });

    expect(frame.source).toBe('estimator');
    expect(frame.cue.amplitude).toBeGreaterThan(0.12);
    expect(['ou', 'oh', 'aa']).toContain(frame.cue.visemeId);
    expect(frame.estimatorFrame).toBeTruthy();
  });

  it('carries estimator state so fallback output can be stabilized across frames', () => {
    const first = resolveRuntimeVoicePlaybackFrameCue({
      playbackCueEnvelope: null,
      currentTimeSeconds: 0.16,
      timeDomainSamples: new Uint8Array([128, 170, 214, 184, 128, 86, 50, 82]),
      frequencySamples: new Uint8Array([232, 220, 176, 110, 68, 36, 18, 8]),
    });
    const second = resolveRuntimeVoicePlaybackFrameCue({
      playbackCueEnvelope: null,
      currentTimeSeconds: 0.18,
      timeDomainSamples: new Uint8Array([128, 168, 206, 178, 128, 92, 58, 88]),
      frequencySamples: new Uint8Array([228, 214, 170, 116, 70, 38, 18, 8]),
      previousEstimatorFrame: first.estimatorFrame,
    });

    expect(first.source).toBe('estimator');
    expect(second.source).toBe('estimator');
    expect(first.estimatorFrame).toBeTruthy();
    expect(second.estimatorFrame).toBeTruthy();
    expect(second.cue.amplitude).toBeGreaterThan(0.12);
    expect(second.estimatorFrame?.stableFrames).toBeGreaterThanOrEqual(1);
  });
});
