import assert from 'node:assert/strict';
import test from 'node:test';

import {
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

test('agent voice playback cue derives a stable viseme cycle from time and amplitude', () => {
  const cue = resolveAgentVoicePlaybackCue(new Uint8Array([128, 190, 64, 196, 60, 188, 70, 182]), 0.31);
  assert.ok(cue.amplitude > 0.25);
  assert.equal(cue.visemeId, 'oh');
});
