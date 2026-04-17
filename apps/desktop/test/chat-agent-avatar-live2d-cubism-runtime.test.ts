import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveChatAgentAvatarLive2dMotionSelection,
  resolveChatAgentAvatarLive2dRenderMotionPose,
} from '../src/shell/renderer/features/chat/chat-agent-avatar-live2d-cubism-runtime.js';

test('speaking prefers the configured speech motion group', () => {
  const selection = resolveChatAgentAvatarLive2dMotionSelection({
    phase: 'speaking',
    idleMotionGroup: 'Idle',
    speechMotionGroup: 'TapBody',
    motionGroups: ['Idle', 'TapBody'],
  });

  assert.deepEqual(selection, {
    group: 'TapBody',
    source: 'speech',
    priority: 3,
  });
});

test('speaking falls back to the first non-idle motion group when speech group is missing', () => {
  const selection = resolveChatAgentAvatarLive2dMotionSelection({
    phase: 'speaking',
    idleMotionGroup: 'Idle',
    speechMotionGroup: null,
    motionGroups: ['Idle', 'Wave', 'Jump'],
  });

  assert.deepEqual(selection, {
    group: 'Wave',
    source: 'fallback-nonidle',
    priority: 2,
  });
});

test('speaking falls back to idle when it is the only available motion group', () => {
  const selection = resolveChatAgentAvatarLive2dMotionSelection({
    phase: 'speaking',
    idleMotionGroup: 'Idle',
    speechMotionGroup: null,
    motionGroups: ['Idle'],
  });

  assert.deepEqual(selection, {
    group: 'Idle',
    source: 'idle',
    priority: 1,
  });
});

test('idle falls back to the first motion group when idle is missing', () => {
  const selection = resolveChatAgentAvatarLive2dMotionSelection({
    phase: 'idle',
    idleMotionGroup: null,
    speechMotionGroup: 'TapBody',
    motionGroups: ['Wave', 'TapBody'],
  });

  assert.deepEqual(selection, {
    group: 'Wave',
    source: 'fallback-any',
    priority: 1,
  });
});

test('ambient-only is returned when the model exposes no motion groups', () => {
  const selection = resolveChatAgentAvatarLive2dMotionSelection({
    phase: 'idle',
    idleMotionGroup: null,
    speechMotionGroup: null,
    motionGroups: [],
  });

  assert.deepEqual(selection, {
    group: null,
    source: 'ambient-only',
    priority: 0,
  });
});

test('render motion pose ramps speaking amplitude and energy instead of snapping directly to raw input', () => {
  const pose = resolveChatAgentAvatarLive2dRenderMotionPose({
    previousSmoothedAmplitude: 0,
    previousSpeakingEnergy: 0,
    deltaTimeSeconds: 1 / 60,
    seconds: 2,
    state: {
      phase: 'speaking',
      emotion: 'neutral',
      amplitude: 0.9,
      badgeLabel: 'Speaking',
      assetLabel: 'Fixture',
      motionSpeed: 1.5,
      accentColor: '#000',
      glowColor: '#fff',
    },
  });

  assert.ok(pose.smoothedAmplitude > 0);
  assert.ok(pose.smoothedAmplitude < 0.9);
  assert.ok(pose.speakingEnergy > 0);
  assert.ok(pose.speakingEnergy < 0.9);
  assert.notEqual(pose.scale, 1);
});

test('render motion pose decays speaking energy gradually after speaking stops', () => {
  const pose = resolveChatAgentAvatarLive2dRenderMotionPose({
    previousSmoothedAmplitude: 0.62,
    previousSpeakingEnergy: 0.74,
    deltaTimeSeconds: 1 / 60,
    seconds: 3,
    state: {
      phase: 'idle',
      emotion: 'neutral',
      amplitude: 0,
      badgeLabel: 'Ready',
      assetLabel: 'Fixture',
      motionSpeed: 0.52,
      accentColor: '#000',
      glowColor: '#fff',
    },
  });

  assert.ok(pose.smoothedAmplitude > 0);
  assert.ok(pose.smoothedAmplitude < 0.62);
  assert.ok(pose.speakingEnergy > 0);
  assert.ok(pose.speakingEnergy < 0.74);
});

test('render motion pose gives listening a higher resting y-offset than thinking', () => {
  const listening = resolveChatAgentAvatarLive2dRenderMotionPose({
    previousSmoothedAmplitude: 0,
    previousSpeakingEnergy: 0,
    deltaTimeSeconds: 1 / 60,
    seconds: 1,
    state: {
      phase: 'listening',
      emotion: 'neutral',
      amplitude: 0,
      badgeLabel: 'Listening',
      assetLabel: 'Fixture',
      motionSpeed: 0.76,
      accentColor: '#000',
      glowColor: '#fff',
    },
  });
  const thinking = resolveChatAgentAvatarLive2dRenderMotionPose({
    previousSmoothedAmplitude: 0,
    previousSpeakingEnergy: 0,
    deltaTimeSeconds: 1 / 60,
    seconds: 1,
    state: {
      phase: 'thinking',
      emotion: 'neutral',
      amplitude: 0,
      badgeLabel: 'Thinking',
      assetLabel: 'Fixture',
      motionSpeed: 0.68,
      accentColor: '#000',
      glowColor: '#fff',
    },
  });

  assert.ok(listening.swayY > thinking.swayY);
});
