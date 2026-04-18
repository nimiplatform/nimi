import { describe, expect, it } from 'vitest';

import {
  resolveAvatarLive2dViewportState,
  resolvePreferredLive2dIdleMotionGroup,
  resolvePreferredLive2dSpeechMotionGroup,
} from '../src/live2d.js';

describe('avatar live2d state helpers', () => {
  it('prefers idle and speech motion groups from model metadata', () => {
    const groups = ['IdleMain', 'VoiceLine'];
    expect(resolvePreferredLive2dIdleMotionGroup(groups)).toBe('IdleMain');
    expect(resolvePreferredLive2dSpeechMotionGroup(groups)).toBe('VoiceLine');
  });

  it('derives viewport state from avatar interaction cues', () => {
    const state = resolveAvatarLive2dViewportState({
      label: 'Airi',
      assetRef: 'desktop-avatar://resource-live2d/airi.model3.json',
      posterUrl: null,
      idlePreset: null,
      expressionProfileRef: null,
      interactionPolicyRef: null,
      defaultVoiceReference: null,
      style: undefined,
      snapshot: {
        presentation: {
          backendKind: 'live2d',
          avatarAssetRef: 'desktop-avatar://resource-live2d/airi.model3.json',
        },
        interaction: {
          phase: 'speaking',
          emotion: 'focus',
          actionCue: 'Speaking',
          amplitude: 0.5,
        },
      },
    }, { assetLabel: 'Airi Live2D' });

    expect(state.assetLabel).toBe('Airi Live2D');
    expect(state.motionSpeed).toBeCloseTo(1.5);
    expect(state.accentColor).toBe('#38bdf8');
  });
});
