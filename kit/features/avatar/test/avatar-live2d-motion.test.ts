import { describe, expect, it } from 'vitest';

import {
  resolveAvatarLive2dMotionSelection,
  resolveAvatarLive2dRenderMotionPose,
} from '../src/live2d.js';

describe('avatar live2d motion helpers', () => {
  it('prefers the configured speech motion group while speaking', () => {
    expect(resolveAvatarLive2dMotionSelection({
      phase: 'speaking',
      emotion: 'joy',
      idleMotionGroup: 'Idle',
      speechMotionGroup: 'TapBody',
      motionGroups: ['Idle', 'TapBody'],
    })).toEqual({
      group: 'TapBody',
      source: 'speech',
      priority: 3,
      downgrade: 'none',
    });
  });

  it('prefers an emotion motion group before idle when the model exposes one', () => {
    expect(resolveAvatarLive2dMotionSelection({
      phase: 'idle',
      emotion: 'joy',
      idleMotionGroup: 'Idle',
      speechMotionGroup: 'TapBody',
      motionGroups: ['Idle', 'HappyLoop'],
    })).toEqual({
      group: 'HappyLoop',
      source: 'emotion',
      priority: 2,
      downgrade: 'none',
    });
  });

  it('explicitly downgrades expressive emotion to idle when no matching motion group exists', () => {
    expect(resolveAvatarLive2dMotionSelection({
      phase: 'idle',
      emotion: 'concerned',
      idleMotionGroup: 'Idle',
      speechMotionGroup: null,
      motionGroups: ['Idle'],
    })).toEqual({
      group: 'Idle',
      source: 'idle',
      priority: 1,
      downgrade: 'emotion-to-idle',
    });
  });

  it('ramps speaking motion pose instead of snapping to the raw input', () => {
    const pose = resolveAvatarLive2dRenderMotionPose({
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

    expect(pose.smoothedAmplitude).toBeGreaterThan(0);
    expect(pose.smoothedAmplitude).toBeLessThan(0.9);
    expect(pose.speakingEnergy).toBeGreaterThan(0);
    expect(pose.speakingEnergy).toBeLessThan(0.9);
  });

  it('lets surprised motion pose sit higher than concerned motion pose at idle', () => {
    const surprised = resolveAvatarLive2dRenderMotionPose({
      previousSmoothedAmplitude: 0,
      previousSpeakingEnergy: 0,
      deltaTimeSeconds: 1 / 60,
      seconds: 1,
      state: {
        phase: 'idle',
        emotion: 'surprised',
        amplitude: 0,
        badgeLabel: 'Surprised',
        assetLabel: 'Fixture',
        motionSpeed: 0.66,
        accentColor: '#000',
        glowColor: '#fff',
      },
    });
    const concerned = resolveAvatarLive2dRenderMotionPose({
      previousSmoothedAmplitude: 0,
      previousSpeakingEnergy: 0,
      deltaTimeSeconds: 1 / 60,
      seconds: 1,
      state: {
        phase: 'idle',
        emotion: 'concerned',
        amplitude: 0,
        badgeLabel: 'Concerned',
        assetLabel: 'Fixture',
        motionSpeed: 0.48,
        accentColor: '#000',
        glowColor: '#fff',
      },
    });

    expect(surprised.swayY).toBeGreaterThan(concerned.swayY);
  });
});
