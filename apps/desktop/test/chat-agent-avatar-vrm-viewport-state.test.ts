import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseDesktopAgentAvatarAssetRef,
  resolveChatAgentAvatarVrmAssetUrl,
  resolveChatAgentAvatarVrmExpressionWeights,
  resolveChatAgentAvatarVrmViewportState,
} from '../src/shell/renderer/features/chat/chat-agent-avatar-vrm-viewport-state.js';
import type { ChatAgentAvatarPointerInteractionState } from '../src/shell/renderer/features/chat/chat-agent-avatar-pointer-interaction.js';

function assertCloseTo(actual: number, expected: number, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

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
  assert.equal(state.posture, 'speaking-energized');
  assert.equal(state.emotion, 'focus');
  assert.equal(state.amplitude, 1);
  assert.equal(state.speakingEnergy, 1);
  assert.equal(state.badgeLabel, 'Responding');
  assert.equal(state.assetLabel, 'airi.vrm');
  assert.ok(state.motionSpeed > 2);
  assert.ok(state.speakingPulseAmount > 0.04);
  assert.equal(state.eyeOpen, 0.082);
  assert.equal(state.accentColor, '#38bdf8');
  assert.equal(state.pointerInfluence, 0);
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
  assert.equal(state.posture, 'idle-settled');
  assert.equal(state.emotion, 'neutral');
  assert.equal(state.motionSpeed, 0.35);
  assert.equal(state.sparklesSpeed, 0.25);
  assert.equal(state.mouthOpen, 0.11);
  assert.equal(state.eyeOpen, 0.08);
});

test('avatar vrm viewport state derives bounded pointer-follow offsets under idle hover', () => {
  const pointerInteraction: ChatAgentAvatarPointerInteractionState = {
    hovered: true,
    normalizedX: 2,
    normalizedY: -2,
    interactionBoost: 'engaged',
  };
  const state = resolveChatAgentAvatarVrmViewportState({
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
        phase: 'idle',
        attentionTarget: 'pointer',
      },
    },
  }, pointerInteraction);

  assertCloseTo(state.pointerInfluence, 0.5616);
  assert.equal(state.posture, 'idle-settled');
  assertCloseTo(state.headFollowX, 0.134784);
  assertCloseTo(state.headFollowY, 0.078624);
  assertCloseTo(state.eyeFollowX, 0.050544);
  assertCloseTo(state.eyeFollowY, 0.033696);
  assert.ok(state.motionSpeed > 0.35);
});

test('avatar vrm viewport state reduces pointer influence while speaking to preserve readability', () => {
  const pointerInteraction: ChatAgentAvatarPointerInteractionState = {
    hovered: true,
    normalizedX: 0.9,
    normalizedY: -0.4,
    interactionBoost: 'engaged',
  };
  const state = resolveChatAgentAvatarVrmViewportState({
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
        attentionTarget: 'pointer',
        amplitude: 0.9,
      },
    },
  }, pointerInteraction);

  assertCloseTo(state.pointerInfluence, 0.20952);
  assert.equal(state.posture, 'speaking-energized');
  assert.ok(state.headFollowX < 0.05);
  assert.ok(state.motionSpeed > 2.45);
});

test('avatar vrm viewport state exposes explicit listening posture defaults', () => {
  const state = resolveChatAgentAvatarVrmViewportState({
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
        phase: 'listening',
      },
    },
  });

  assert.equal(state.posture, 'listening-attentive');
  assert.equal(state.speakingEnergy, 0);
  assert.equal(state.mouthOpen, 0.11);
  assert.equal(state.eyeOpen, 0.09);
  assert.equal(state.blinkSpeed, 3.6);
});

test('avatar vrm viewport state resolves concrete asset urls only for non-fallback refs', () => {
  assert.equal(resolveChatAgentAvatarVrmAssetUrl('fallback://airi-shell'), null);
  assert.equal(resolveChatAgentAvatarVrmAssetUrl('desktop-avatar://resource-1/AliciaSolid.vrm'), null);
  assert.equal(resolveChatAgentAvatarVrmAssetUrl(' https://cdn.nimi.test/avatars/airi.vrm '), 'https://cdn.nimi.test/avatars/airi.vrm');
});

test('avatar vrm viewport state parses desktop-local avatar refs', () => {
  assert.deepEqual(
    parseDesktopAgentAvatarAssetRef('desktop-avatar://resource-1/AliciaSolid.vrm'),
    {
      resourceId: 'resource-1',
      filename: 'AliciaSolid.vrm',
    },
  );
  assert.equal(parseDesktopAgentAvatarAssetRef('https://cdn.nimi.test/avatars/airi.vrm'), null);
});

test('avatar vrm viewport state converts file urls to tauri asset urls when tauri runtime is present', () => {
  const runtimeGlobal = globalThis as typeof globalThis & {
    __NIMI_TAURI_RUNTIME__?: unknown;
    window?: Window & typeof globalThis;
  };
  const previousRuntime = runtimeGlobal.__NIMI_TAURI_RUNTIME__;
  const previousWindow = runtimeGlobal.window;
  try {
    runtimeGlobal.__NIMI_TAURI_RUNTIME__ = {};
    runtimeGlobal.window = {
      __TAURI_INTERNALS__: {
        convertFileSrc: (path: string, protocol = 'asset') => `${protocol}://localhost/${path}`,
      },
    } as unknown as Window & typeof globalThis;
    const resolved = resolveChatAgentAvatarVrmAssetUrl('file:///Users/snwozy/Downloads/AliciaSolid.vrm');
    assert.equal(resolved, 'asset://localhost//Users/snwozy/Downloads/AliciaSolid.vrm');
  } finally {
    if (previousRuntime === undefined) {
      delete runtimeGlobal.__NIMI_TAURI_RUNTIME__;
    } else {
      runtimeGlobal.__NIMI_TAURI_RUNTIME__ = previousRuntime;
    }
    if (previousWindow === undefined) {
      Reflect.deleteProperty(runtimeGlobal as Record<string, unknown>, 'window');
    } else {
      runtimeGlobal.window = previousWindow;
    }
  }
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
  assert.equal(weights.ee, 0.7);
});

test('avatar vrm viewport state maps playful mood into explicit expression weights', () => {
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
        phase: 'idle',
        emotion: 'playful',
      },
    },
  });

  assert.equal(weights.happy, 0.3);
  assert.equal(weights.relaxed, 0.18);
});

test('avatar vrm viewport state provides explicit speaking fallback when viseme is missing', () => {
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
        amplitude: 0.5,
      },
    },
  });

  assert.equal(weights.aa, 0.52);
});

test('avatar vrm viewport state adds a relaxed baseline while listening', () => {
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
        phase: 'listening',
      },
    },
  });

  assert.equal(weights.relaxed, 0.16);
});
