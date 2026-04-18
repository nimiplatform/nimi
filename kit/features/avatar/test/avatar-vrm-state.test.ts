import { describe, expect, it } from 'vitest';

import {
  resolveAvatarVrmExpressionWeights,
  resolveAvatarVrmViewportState,
} from '../src/vrm.js';

describe('avatar vrm state helpers', () => {
  it('derives speaking posture and clamps amplitude', () => {
    const state = resolveAvatarVrmViewportState({
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
          emotion: 'focus',
          amplitude: 2,
        },
      },
    });

    expect(state.posture).toBe('speaking-energized');
    expect(state.amplitude).toBe(1);
    expect(state.speakingEnergy).toBe(1);
    expect(state.eyeOpen).toBe(0.082);
  });

  it('maps viseme and phase into expression weights', () => {
    const weights = resolveAvatarVrmExpressionWeights({
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

    expect(weights.happy).toBe(0.52);
    expect(weights.ee).toBe(0.7);
  });

  it('maps playful mood into an explicit happy-relaxed blend', () => {
    const weights = resolveAvatarVrmExpressionWeights({
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

    expect(weights.happy).toBe(0.3);
    expect(weights.relaxed).toBe(0.18);
  });
});
