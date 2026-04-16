import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveChatAgentAvatarVrmAssetUrl,
  resolveChatAgentAvatarVrmExpressionWeights,
  resolveChatAgentAvatarVrmViewportState,
} from '../src/shell/renderer/features/chat/chat-agent-avatar-vrm-viewport-state.js';

test('avatar vrm viewport state clamps amplitude and derives speaking motion state', () => {
  const state = resolveChatAgentAvatarVrmViewportState({
    label: 'Companion',
    assetRef: 'https://cdn.nimi.test/avatars/airi.vrm',
    posterUrl: 'https://cdn.nimi.test/avatars/airi.png',
    idlePreset: 'companion.idle.soft',
    expressionProfileRef: 'profile://airi/default',
    interactionPolicyRef: 'policy://airi/chat',
    defaultVoiceReference: 'voice://airi/default',
    style: undefined,
    snapshot: {
      presentation: {
        backendKind: 'vrm',
        avatarAssetRef: 'https://cdn.nimi.test/avatars/airi.vrm',
      },
      interaction: {
        phase: 'speaking',
        emotion: 'focus',
        actionCue: 'Responding',
        amplitude: 2,
      },
    },
  });

  assert.equal(state.phase, 'speaking');
  assert.equal(state.emotion, 'focus');
  assert.equal(state.amplitude, 1);
  assert.equal(state.badgeLabel, 'Responding');
  assert.equal(state.assetLabel, 'airi.vrm');
  assert.ok(state.motionSpeed > 2);
  assert.equal(state.accentColor, '#38bdf8');
});

test('avatar vrm viewport state uses stable idle defaults when interaction detail is sparse', () => {
  const state = resolveChatAgentAvatarVrmViewportState({
    label: 'Companion',
    assetRef: 'fallback://airi-shell',
    posterUrl: null,
    idlePreset: null,
    expressionProfileRef: null,
    interactionPolicyRef: null,
    defaultVoiceReference: null,
    style: undefined,
    snapshot: {
      presentation: {
        backendKind: 'vrm',
        avatarAssetRef: 'fallback://airi-shell',
      },
      interaction: {
        phase: 'idle',
      },
    },
  });

  assert.equal(state.badgeLabel, 'Ready');
  assert.equal(state.assetLabel, 'airi-shell');
  assert.equal(state.emotion, 'neutral');
  assert.equal(state.motionSpeed, 0.35);
  assert.equal(state.sparklesSpeed, 0.25);
});

test('avatar vrm viewport state resolves concrete asset urls only for non-fallback refs', () => {
  assert.equal(resolveChatAgentAvatarVrmAssetUrl('fallback://airi-shell'), null);
  assert.equal(resolveChatAgentAvatarVrmAssetUrl(' https://cdn.nimi.test/avatars/airi.vrm '), 'https://cdn.nimi.test/avatars/airi.vrm');
});

test('avatar vrm viewport state maps emotion and viseme cues into expression weights', () => {
  const weights = resolveChatAgentAvatarVrmExpressionWeights({
    label: 'Companion',
    assetRef: 'https://cdn.nimi.test/avatars/airi.vrm',
    posterUrl: null,
    idlePreset: null,
    expressionProfileRef: null,
    interactionPolicyRef: null,
    defaultVoiceReference: null,
    style: undefined,
    snapshot: {
      presentation: {
        backendKind: 'vrm',
        avatarAssetRef: 'https://cdn.nimi.test/avatars/airi.vrm',
      },
      interaction: {
        phase: 'speaking',
        emotion: 'joy',
        visemeId: 'ee',
        amplitude: 0.5,
      },
    },
  });

  assert.equal(weights.happy, 0.52);
  assert.equal(weights.ee, 0.675);
});
