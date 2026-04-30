import { describe, expect, it } from 'vitest';

import {
  initialVrmViewportState,
  setEmote,
  setPhase,
  setPosture,
} from './vrm-viewport-state.js';

describe('vrm-viewport-state', () => {
  it('initialVrmViewportState has the documented defaults', () => {
    expect(initialVrmViewportState.phase).toBe('idle');
    expect(initialVrmViewportState.posture).toBe('neutral');
    expect(initialVrmViewportState.emote).toBeNull();
  });

  describe('setPhase', () => {
    it('returns a new object when phase changes', () => {
      const next = setPhase(initialVrmViewportState, 'speaking');
      expect(next).not.toBe(initialVrmViewportState);
      expect(next.phase).toBe('speaking');
      expect(next.posture).toBe(initialVrmViewportState.posture);
      expect(next.emote).toBe(initialVrmViewportState.emote);
    });

    it('preserves identity when phase is unchanged', () => {
      const same = setPhase(initialVrmViewportState, 'idle');
      expect(same).toBe(initialVrmViewportState);
    });
  });

  describe('setPosture', () => {
    it('returns a new object when posture changes', () => {
      const next = setPosture(initialVrmViewportState, 'lean-forward');
      expect(next).not.toBe(initialVrmViewportState);
      expect(next.posture).toBe('lean-forward');
      expect(next.phase).toBe(initialVrmViewportState.phase);
    });

    it('preserves identity when posture is unchanged', () => {
      const same = setPosture(initialVrmViewportState, 'neutral');
      expect(same).toBe(initialVrmViewportState);
    });
  });

  describe('setEmote', () => {
    it('returns a new object when emote changes from null to a name', () => {
      const next = setEmote(initialVrmViewportState, 'happy');
      expect(next).not.toBe(initialVrmViewportState);
      expect(next.emote).toBe('happy');
    });

    it('returns a new object when emote changes from a name to null', () => {
      const set = setEmote(initialVrmViewportState, 'happy');
      const cleared = setEmote(set, null);
      expect(cleared).not.toBe(set);
      expect(cleared.emote).toBeNull();
    });

    it('preserves identity when emote is unchanged (null → null)', () => {
      const same = setEmote(initialVrmViewportState, null);
      expect(same).toBe(initialVrmViewportState);
    });

    it('preserves identity when emote is unchanged (same string)', () => {
      const set = setEmote(initialVrmViewportState, 'happy');
      const same = setEmote(set, 'happy');
      expect(same).toBe(set);
    });
  });

  it('setters can be composed without mutating the original state', () => {
    const original = initialVrmViewportState;
    const a = setPhase(original, 'speaking');
    const b = setPosture(a, 'lean-forward');
    const c = setEmote(b, 'happy');
    // Each step returned a different object.
    expect(a).not.toBe(original);
    expect(b).not.toBe(a);
    expect(c).not.toBe(b);
    // Original is unchanged.
    expect(original.phase).toBe('idle');
    expect(original.posture).toBe('neutral');
    expect(original.emote).toBeNull();
    // Final state contains all updates.
    expect(c).toEqual({ phase: 'speaking', posture: 'lean-forward', emote: 'happy' });
  });
});
