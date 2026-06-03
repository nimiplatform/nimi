// Wave 3 chunk 3-A - VrmEmoteState tests.
//
// Covers: setEmote ramp; unknown emote warn; emote swap decay/ramp;
// lipsync viseme suppression; transient overlay decay; reset zeroing;
// primary-weight cap fail-close; snapshot consistency.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createVrmEmoteState,
  VISEME_NAMES,
  PRIMARY_EXPRESSION_WEIGHT_CAP,
  type VrmExpressionWritable,
  type VrmEmoteTable,
} from '../src/vrm.js';

type SetValueFn = (name: string, weight: number) => void;

function createMockVrm(opts?: { missingPresets?: ReadonlySet<string> }): {
  vrm: VrmExpressionWritable;
  setValue: ReturnType<typeof vi.fn<SetValueFn>>;
} {
  const setValue = vi.fn<SetValueFn>((name) => {
    if (opts?.missingPresets?.has(name)) {
      throw new Error(`mock: missing preset "${name}"`);
    }
  });
  const vrm = {
    expressionManager: { setValue },
  } satisfies VrmExpressionWritable;
  return { vrm, setValue };
}

const SAMPLE_TABLE: VrmEmoteTable = {
  emotes: {
    happy: {
      blendDurationSec: 0.4,
      expressions: [
        { name: 'happy', weight: 0.7 },
        { name: 'aa', weight: 0.2 },
      ],
    },
    sad: {
      blendDurationSec: 0.5,
      expressions: [
        { name: 'sad', weight: 0.7 },
        { name: 'oh', weight: 0.15 },
      ],
    },
    neutral: {
      blendDurationSec: 0.6,
      expressions: [{ name: 'neutral', weight: 0.8 }],
    },
  },
};

describe('createVrmEmoteState', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('ramps current weights toward target via tick', () => {
    const state = createVrmEmoteState({ emoteTable: SAMPLE_TABLE });
    const { vrm, setValue } = createMockVrm();
    state.setEmote('happy');
    // Mid-ramp: tick half the blend duration.
    state.tick({ vrm, deltaSec: 0.2 });
    const mid = state.snapshot();
    expect(mid.activeEmote).toBe('happy');
    expect(mid.targetWeights.happy).toBe(0.7);
    expect(mid.currentWeights.happy).toBeGreaterThan(0);
    expect(mid.currentWeights.happy).toBeLessThan(0.7);

    // Full ramp: enough delta to land on target.
    state.tick({ vrm, deltaSec: 1.0 });
    const done = state.snapshot();
    expect(done.currentWeights.happy).toBeCloseTo(0.7, 6);
    expect(done.currentWeights.aa).toBeCloseTo(0.2, 6);
    // expressionManager.setValue was flushed for each known expression.
    const flushedNames = setValue.mock.calls.map((c) => c[0]);
    expect(flushedNames).toContain('happy');
    expect(flushedNames).toContain('aa');
  });

  it('warns and no-ops on unknown emote', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = createVrmEmoteState({ emoteTable: SAMPLE_TABLE });
    state.setEmote('nonexistent');
    const snap = state.snapshot();
    expect(snap.activeEmote).toBeNull();
    expect(Object.keys(snap.targetWeights)).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]?.[0]).toContain('unknown emote');
  });

  it('decays previous emote and ramps new one on swap', () => {
    const state = createVrmEmoteState({ emoteTable: SAMPLE_TABLE });
    const { vrm } = createMockVrm();
    state.setEmote('happy');
    state.tick({ vrm, deltaSec: 1.0 }); // saturate happy
    expect(state.snapshot().currentWeights.happy).toBeCloseTo(0.7, 6);

    state.setEmote('sad');
    // After setEmote('sad'): happy/aa targets become 0; sad/oh targets are set.
    const justSwapped = state.snapshot();
    expect(justSwapped.activeEmote).toBe('sad');
    expect(justSwapped.targetWeights.happy).toBe(0);
    expect(justSwapped.targetWeights.aa).toBe(0);
    expect(justSwapped.targetWeights.sad).toBe(0.7);

    // After several ticks worth of blend: happy decays toward 0, sad ramps up.
    state.tick({ vrm, deltaSec: 1.0 });
    const after = state.snapshot();
    expect(after.currentWeights.happy).toBeCloseTo(0, 6);
    expect(after.currentWeights.sad).toBeCloseTo(0.7, 6);
  });

  it('suppresses viseme expressions when lipsyncActive=true', () => {
    const state = createVrmEmoteState({ emoteTable: SAMPLE_TABLE });
    const { vrm, setValue } = createMockVrm();
    state.setEmote('happy'); // happy + aa (viseme)
    state.tick({ vrm, deltaSec: 1.0 }); // saturate; baseline call counts
    setValue.mockClear();

    state.setLipsyncActive(true);
    const result = state.tick({ vrm, deltaSec: 0.1 });
    expect(result.skippedCount).toBeGreaterThan(0);
    // No setValue call for any viseme name this tick.
    for (const call of setValue.mock.calls) {
      expect(VISEME_NAMES.has(call[0])).toBe(false);
    }
  });

  it('flushes viseme expressions normally when lipsyncActive=false', () => {
    const state = createVrmEmoteState({ emoteTable: SAMPLE_TABLE });
    const { vrm, setValue } = createMockVrm();
    state.setEmote('happy');
    state.tick({ vrm, deltaSec: 1.0 });
    setValue.mockClear();

    state.setLipsyncActive(false);
    const result = state.tick({ vrm, deltaSec: 0.1 });
    expect(result.skippedCount).toBe(0);
    const flushedNames = setValue.mock.calls.map((c) => c[0]);
    expect(flushedNames).toContain('aa');
  });

  it('decays a transient expression overlay back toward zero', () => {
    const state = createVrmEmoteState({ emoteTable: SAMPLE_TABLE });
    const { vrm } = createMockVrm();
    state.applyTransientExpression('blink', 1, 0.2);
    state.tick({ vrm, deltaSec: 0.1 });
    const mid = state.snapshot();
    expect(mid.currentWeights.blink).toBeGreaterThan(0);
    expect(mid.currentWeights.blink).toBeLessThan(1);

    state.tick({ vrm, deltaSec: 0.2 });
    const done = state.snapshot();
    expect(done.currentWeights.blink ?? 0).toBeLessThanOrEqual(0.05);
  });

  it('clamps transient weight into [0, 1] range', () => {
    const state = createVrmEmoteState({ emoteTable: SAMPLE_TABLE });
    const { vrm } = createMockVrm();
    state.applyTransientExpression('blink', 5, 0.4);
    state.tick({ vrm, deltaSec: 0.0 });
    expect(state.snapshot().currentWeights.blink).toBeLessThanOrEqual(1);

    state.applyTransientExpression('blink', -3, 0.4);
    state.tick({ vrm, deltaSec: 0.0 });
    expect(state.snapshot().currentWeights.blink ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('reset() zeros all currentWeights and flushes setValue(name, 0)', () => {
    const state = createVrmEmoteState({ emoteTable: SAMPLE_TABLE });
    const { vrm, setValue } = createMockVrm();
    state.setEmote('happy');
    state.tick({ vrm, deltaSec: 1.0 });
    setValue.mockClear();

    state.reset({ vrm });
    const snap = state.snapshot();
    expect(snap.activeEmote).toBeNull();
    expect(Object.keys(snap.currentWeights)).toHaveLength(0);
    // Each previously-known expression was flushed to 0.
    const zeroCalls = setValue.mock.calls.filter((c) => c[1] === 0);
    expect(zeroCalls.length).toBeGreaterThan(0);
    const zeroedNames = new Set(zeroCalls.map((c) => c[0]));
    expect(zeroedNames.has('happy')).toBe(true);
    expect(zeroedNames.has('aa')).toBe(true);
  });

  it('safely skips when expressionManager.setValue throws (missing preset)', () => {
    const state = createVrmEmoteState({ emoteTable: SAMPLE_TABLE });
    const { vrm, setValue } = createMockVrm({ missingPresets: new Set(['aa']) });
    state.setEmote('happy');
    // Should not throw even though aa preset is "missing".
    expect(() => state.tick({ vrm, deltaSec: 1.0 })).not.toThrow();
    // happy was still flushed.
    const happyCalls = setValue.mock.calls.filter((c) => c[0] === 'happy');
    expect(happyCalls.length).toBeGreaterThan(0);
  });

  it('throws at construction when bundle primary weight exceeds 0.8', () => {
    const bad: VrmEmoteTable = {
      emotes: {
        too_much: {
          blendDurationSec: 0.4,
          expressions: [
            { name: 'happy', weight: 0.95 },
            { name: 'aa', weight: 0.2 },
          ],
        },
      },
    };
    expect(() => createVrmEmoteState({ emoteTable: bad })).toThrow(/primary weight/);
    // sanity: 0.8 itself is allowed.
    expect(PRIMARY_EXPRESSION_WEIGHT_CAP).toBe(0.8);
    const okTable: VrmEmoteTable = {
      emotes: {
        edge: {
          blendDurationSec: 0.4,
          expressions: [{ name: 'happy', weight: 0.8 }],
        },
      },
    };
    expect(() => createVrmEmoteState({ emoteTable: okTable })).not.toThrow();
  });

  it('snapshot returns a deep, frozen-target view that does not leak state', () => {
    const state = createVrmEmoteState({ emoteTable: SAMPLE_TABLE });
    const { vrm } = createMockVrm();
    state.setEmote('happy');
    state.tick({ vrm, deltaSec: 0.1 });
    const snap = state.snapshot();
    expect(Object.isFrozen(snap.targetWeights)).toBe(true);
    expect(Object.isFrozen(snap.currentWeights)).toBe(true);
    // Subsequent ticks must not mutate the prior snapshot's frozen records.
    const captured = { ...snap.currentWeights };
    state.tick({ vrm, deltaSec: 1.0 });
    for (const k of Object.keys(captured)) {
      expect(snap.currentWeights[k]).toBe(captured[k]);
    }
  });

  it('setLipsyncActive only toggles the suppress flag (no other state churn)', () => {
    const state = createVrmEmoteState({ emoteTable: SAMPLE_TABLE });
    expect(state.snapshot().lipsyncActive).toBe(false);
    state.setLipsyncActive(true);
    expect(state.snapshot().lipsyncActive).toBe(true);
    state.setLipsyncActive(false);
    expect(state.snapshot().lipsyncActive).toBe(false);
  });
});
