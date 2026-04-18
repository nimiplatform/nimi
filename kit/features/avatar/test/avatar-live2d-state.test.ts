import { describe, expect, it } from 'vitest';

import {
  resolveAvatarLive2dViewportState,
  resolvePreferredLive2dEmotionMotionGroup,
  resolvePreferredLive2dIdleMotionGroup,
  resolvePreferredLive2dSpeechMotionGroup,
} from '../src/live2d.js';

describe('avatar live2d state helpers', () => {
  it('prefers idle and speech motion groups from model metadata', () => {
    const groups = ['IdleMain', 'VoiceLine'];
    expect(resolvePreferredLive2dIdleMotionGroup(groups)).toBe('IdleMain');
    expect(resolvePreferredLive2dSpeechMotionGroup(groups)).toBe('VoiceLine');
  });

  it('prefers explicit emotion motion groups when model metadata exposes them', () => {
    const groups = ['IdleMain', 'HappyLoop', 'Shock'];
    expect(resolvePreferredLive2dEmotionMotionGroup(groups, 'joy')).toBe('HappyLoop');
    expect(resolvePreferredLive2dEmotionMotionGroup(groups, 'surprised')).toBe('Shock');
    expect(resolvePreferredLive2dEmotionMotionGroup(groups, 'focus')).toBe(null);
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
    expect(state.motionSpeed).toBeCloseTo(1.52);
    expect(state.accentColor).toBe('#38bdf8');
  });

  it('uses canonical mood to change Live2D motion pacing beyond palette-only styling', () => {
    const playful = resolveAvatarLive2dViewportState({
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
          phase: 'idle',
          emotion: 'playful',
        },
      },
    }, { assetLabel: 'Airi Live2D' });
    const calm = resolveAvatarLive2dViewportState({
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
          phase: 'idle',
          emotion: 'calm',
        },
      },
    }, { assetLabel: 'Airi Live2D' });

    expect(playful.motionSpeed).toBeGreaterThan(calm.motionSpeed);
    expect(playful.accentColor).toBe('#f59e0b');
    expect(calm.accentColor).toBe('#2dd4bf');
  });
});
