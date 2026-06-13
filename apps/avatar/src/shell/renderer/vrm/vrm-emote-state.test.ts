import { describe, expect, it, vi } from 'vitest';

import {
  createVrmEmoteState,
  type VrmEmoteTable,
  type VrmExpressionWritable,
} from './vrm-emote-state.js';

const SAMPLE_TABLE: VrmEmoteTable = {
  emotes: {
    happy: {
      blendDurationSec: 0.4,
      expressions: [
        { name: 'happy', weight: 0.7 },
        { name: 'aa', weight: 0.2 },
      ],
    },
  },
};

function createMockVrm(): VrmExpressionWritable {
  return {
    expressionManager: {
      setValue: vi.fn(),
    },
  };
}

describe('createVrmEmoteState', () => {
  it('converges to target within blendDurationSec under fixed 60fps stepping', () => {
    const state = createVrmEmoteState({ emoteTable: SAMPLE_TABLE });
    const vrm = createMockVrm();
    const dt = 1 / 60;

    state.setEmote('happy');

    const halfFrames = Math.round(0.2 / dt);
    for (let frame = 0; frame < halfFrames; frame += 1) {
      state.tick({ vrm, deltaSec: dt });
    }
    const mid = state.snapshot().currentWeights.happy;
    expect(mid).toBeGreaterThan(0.1);
    expect(mid).toBeLessThan(0.7);

    const restFrames = Math.ceil(0.2 / dt) + 1;
    for (let frame = 0; frame < restFrames; frame += 1) {
      state.tick({ vrm, deltaSec: dt });
    }
    const done = state.snapshot().currentWeights;
    expect(done.happy).toBe(0.7);
    expect(done.aa).toBe(0.2);
  });

  it('treats non-finite frame delta as a zero-length tick', () => {
    const state = createVrmEmoteState({ emoteTable: SAMPLE_TABLE });
    const vrm = createMockVrm();

    state.setEmote('happy');
    state.tick({ vrm, deltaSec: Number.NaN });

    expect(state.snapshot().currentWeights.happy).toBe(0);
  });
});
