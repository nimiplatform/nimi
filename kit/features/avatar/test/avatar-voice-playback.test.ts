import { describe, expect, it } from 'vitest';

import {
  resolveAgentVoicePlaybackEstimatedFrame,
  resolveAgentVoicePlaybackAmplitude,
  resolveAgentVoicePlaybackCue,
  resolveAgentVoicePlaybackVisemeId,
} from '../src/headless.js';

describe('avatar voice playback headless cues', () => {
  it('keeps amplitude near zero for silent samples', () => {
    const silent = new Uint8Array(64).fill(128);
    expect(resolveAgentVoicePlaybackAmplitude(silent)).toBe(0);
  });

  it('scales noisy samples into a unit range', () => {
    const samples = new Uint8Array([128, 160, 96, 180, 72, 200, 56, 168]);
    const amplitude = resolveAgentVoicePlaybackAmplitude(samples);
    expect(amplitude).toBeGreaterThan(0.25);
    expect(amplitude).toBeLessThanOrEqual(1);
  });

  it('fails closed when amplitude is too low', () => {
    expect(resolveAgentVoicePlaybackVisemeId(0.08, 0.4)).toBeNull();
  });

  it('distinguishes open and front mouth shapes from different signal profiles', () => {
    const openCue = resolveAgentVoicePlaybackCue(
      new Uint8Array([128, 208, 232, 208, 128, 48, 24, 48]),
      0.31,
      new Uint8Array([230, 220, 188, 132, 84, 52, 24, 12]),
    );
    const frontCue = resolveAgentVoicePlaybackCue(
      new Uint8Array([128, 180, 92, 188, 84, 176, 96, 172]),
      0.31,
      new Uint8Array([32, 40, 76, 112, 168, 220, 228, 240]),
    );
    expect(openCue.amplitude).toBeGreaterThan(0.25);
    expect(frontCue.amplitude).toBeGreaterThan(0.25);
    expect(['aa', 'oh', 'ou']).toContain(openCue.visemeId);
    expect(['ee', 'ih']).toContain(frontCue.visemeId);
    expect(openCue.visemeId).not.toBe(frontCue.visemeId);
  });

  it('does not depend on wall-clock rotation for identical signals', () => {
    const samples = new Uint8Array([128, 174, 220, 190, 128, 78, 44, 84]);
    const frequency = new Uint8Array([220, 212, 160, 108, 66, 40, 22, 10]);
    const early = resolveAgentVoicePlaybackCue(samples, 0.12, frequency);
    const late = resolveAgentVoicePlaybackCue(samples, 1.92, frequency);
    expect(early.visemeId).toBe(late.visemeId);
  });

  it('can surface rounded mouth shapes from low-band dominant signals', () => {
    const roundedCue = resolveAgentVoicePlaybackCue(
      new Uint8Array([128, 156, 174, 164, 128, 108, 88, 102]),
      0.48,
      new Uint8Array([208, 198, 170, 116, 74, 40, 18, 8]),
    );
    expect(roundedCue.amplitude).toBeGreaterThan(0.12);
    expect(['ou', 'oh']).toContain(roundedCue.visemeId);
  });

  it('smooths amplitude and holds viseme briefly across weak adjacent frames', () => {
    const first = resolveAgentVoicePlaybackEstimatedFrame({
      previous: null,
      nextCue: {
        amplitude: 0.62,
        visemeId: 'ee',
      },
    });
    const second = resolveAgentVoicePlaybackEstimatedFrame({
      previous: first,
      nextCue: {
        amplitude: 0.55,
        visemeId: null,
      },
    });

    expect(second.cue.amplitude).toBeGreaterThan(0.5);
    expect(second.cue.visemeId).toBe('ee');
    expect(second.stableFrames).toBe(2);
  });

  it('damps rapid viseme flips when signal change is weak', () => {
    const next = resolveAgentVoicePlaybackEstimatedFrame({
      previous: {
        cue: {
          amplitude: 0.48,
          visemeId: 'oh',
        },
        stableFrames: 1,
      },
      nextCue: {
        amplitude: 0.53,
        visemeId: 'ee',
      },
    });

    expect(next.cue.visemeId).toBe('oh');
    expect(next.cue.amplitude).toBeGreaterThanOrEqual(0.48);
  });
});
