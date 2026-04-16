import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveAgentVoicePlaybackEstimatedFrame,
  resolveAgentVoicePlaybackAmplitude,
  resolveAgentVoicePlaybackCue,
  resolveAgentVoicePlaybackVisemeId,
} from '../src/shell/renderer/features/chat/chat-agent-voice-playback-state.js';

test('agent voice playback amplitude stays near zero for silent samples', () => {
  const silent = new Uint8Array(64).fill(128);
  assert.equal(resolveAgentVoicePlaybackAmplitude(silent), 0);
});

test('agent voice playback amplitude scales noisy samples into a unit range', () => {
  const samples = new Uint8Array([128, 160, 96, 180, 72, 200, 56, 168]);
  const amplitude = resolveAgentVoicePlaybackAmplitude(samples);
  assert.ok(amplitude > 0.25);
  assert.ok(amplitude <= 1);
});

test('agent voice playback viseme falls closed when amplitude is too low', () => {
  assert.equal(resolveAgentVoicePlaybackVisemeId(0.08, 0.4), null);
});

test('agent voice playback cue distinguishes open and front mouth shapes from different signal profiles', () => {
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
  assert.ok(openCue.amplitude > 0.25);
  assert.ok(frontCue.amplitude > 0.25);
  assert.ok(openCue.visemeId === 'aa' || openCue.visemeId === 'oh' || openCue.visemeId === 'ou');
  assert.ok(frontCue.visemeId === 'ee' || frontCue.visemeId === 'ih');
  assert.notEqual(openCue.visemeId, frontCue.visemeId);
});

test('agent voice playback estimator no longer depends on wall-clock rotation for identical signals', () => {
  const samples = new Uint8Array([128, 174, 220, 190, 128, 78, 44, 84]);
  const frequency = new Uint8Array([220, 212, 160, 108, 66, 40, 22, 10]);
  const early = resolveAgentVoicePlaybackCue(samples, 0.12, frequency);
  const late = resolveAgentVoicePlaybackCue(samples, 1.92, frequency);
  assert.equal(early.visemeId, late.visemeId);
});

test('agent voice playback estimator can surface rounded mouth shapes from low-band dominant signals', () => {
  const roundedCue = resolveAgentVoicePlaybackCue(
    new Uint8Array([128, 156, 174, 164, 128, 108, 88, 102]),
    0.48,
    new Uint8Array([208, 198, 170, 116, 74, 40, 18, 8]),
  );
  assert.ok(roundedCue.amplitude > 0.12);
  assert.ok(roundedCue.visemeId === 'ou' || roundedCue.visemeId === 'oh');
});

test('agent voice playback estimator smooths amplitude and holds viseme briefly across weak adjacent frames', () => {
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

  assert.ok(second.cue.amplitude > 0.5);
  assert.equal(second.cue.visemeId, 'ee');
  assert.equal(second.stableFrames, 2);
});

test('agent voice playback estimator damps rapid viseme flips when signal change is weak', () => {
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

  assert.equal(next.cue.visemeId, 'oh');
  assert.ok(next.cue.amplitude >= 0.48);
});
