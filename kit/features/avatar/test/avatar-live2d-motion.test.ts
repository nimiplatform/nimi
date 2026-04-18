import { describe, expect, it } from 'vitest';

import {
  resolveAvatarLive2dMotionSelection,
  resolveAvatarLive2dRenderMotionPose,
} from '../src/live2d.js';

describe('avatar live2d motion helpers', () => {
  it('prefers the configured speech motion group while speaking', () => {
    expect(resolveAvatarLive2dMotionSelection({
      phase: 'speaking',
      idleMotionGroup: 'Idle',
      speechMotionGroup: 'TapBody',
      motionGroups: ['Idle', 'TapBody'],
    })).toEqual({
      group: 'TapBody',
      source: 'speech',
      priority: 3,
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
});
