import { describe, expect, it } from 'vitest';

import { resolveAvatarLive2dViewportState } from '../src/live2d.js';
import {
  DEFAULT_AVATAR_PHASE_LABELS,
  resolveAvatarPhaseLabel,
} from '../src/phase-label.js';
import type { AvatarVrmViewportRenderInput } from '../src/vrm.js';
import { resolveAvatarVrmViewportState } from '../src/vrm.js';

function buildViewportInput(interaction: AvatarVrmViewportRenderInput['snapshot']['interaction']): AvatarVrmViewportRenderInput {
  return {
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
      interaction,
    },
  };
}

describe('shared avatar phase labels', () => {
  it('unifies idle wording as Idle across stage and viewport badges', () => {
    expect(DEFAULT_AVATAR_PHASE_LABELS.idle).toBe('Idle');
    expect(resolveAvatarPhaseLabel('idle')).toBe('Idle');
    expect(resolveAvatarPhaseLabel('thinking')).toBe('Thinking');
    expect(resolveAvatarPhaseLabel('listening')).toBe('Listening');
    expect(resolveAvatarPhaseLabel('speaking')).toBe('Speaking');
    expect(resolveAvatarPhaseLabel('transitioning')).toBe('Transitioning');
  });

  it('applies partial injected label maps over English defaults', () => {
    const labels = { idle: '待命', speaking: '正在说话' };
    expect(resolveAvatarPhaseLabel('idle', labels)).toBe('待命');
    expect(resolveAvatarPhaseLabel('speaking', labels)).toBe('正在说话');
    expect(resolveAvatarPhaseLabel('thinking', labels)).toBe('Thinking');
  });

  it('returns the phase id from the vrm domain when no action cue is present', () => {
    const state = resolveAvatarVrmViewportState(buildViewportInput({ phase: 'listening' }));
    expect(state.badgeLabel).toBe('listening');

    const cued = resolveAvatarVrmViewportState(buildViewportInput({ phase: 'listening', actionCue: 'Hearing you' }));
    expect(cued.badgeLabel).toBe('Hearing you');
  });

  it('returns the phase id from the live2d domain when no action cue is present', () => {
    const state = resolveAvatarLive2dViewportState(buildViewportInput({ phase: 'idle' }));
    expect(state.badgeLabel).toBe('idle');
  });
});
