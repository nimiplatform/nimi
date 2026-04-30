// Wave 3 chunk 3-C — VrmProjectionAdapter tests.
//
// Covers BackendProjection conformance:
//   - applyActivity routes through resolver (motion / emotion /
//     expression branches; intensity scaling; unknown-name fail-close)
//   - applyEmotion / applyMotion / applyExpression / reset direct paths
//   - default fades / default weight
//   - negative test: BackendProjection signature does NOT carry
//     Live2D parameter id (TS-level via typed reference)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VRM } from '@pixiv/three-vrm';

import {
  createVrmProjectionAdapter,
  scaleByIntensity,
  DEFAULT_ACTIVITY_FADE_SEC,
  DEFAULT_DIRECT_MOTION_FADE_SEC,
  type ActivityMapping,
  type VrmActivityRoute,
} from './vrm-projection-adapter.js';
import type { BackendProjection } from '../carrier/backend-branch.js';
import type { VrmEmoteState } from './vrm-emote-state.js';
import type {
  VrmMotionPresetRegistry,
  PlayResult,
} from './vrm-motion-preset-registry.js';

function createMocks(routesByName: Record<string, VrmActivityRoute | null>): {
  vrm: VRM;
  emoteState: VrmEmoteState;
  motionRegistry: VrmMotionPresetRegistry;
  activityMapping: ActivityMapping;
  spies: {
    setEmote: ReturnType<typeof vi.fn>;
    applyTransientExpression: ReturnType<typeof vi.fn>;
    setLipsyncActive: ReturnType<typeof vi.fn>;
    tick: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    snapshot: ReturnType<typeof vi.fn>;
    play: ReturnType<typeof vi.fn>;
    stopAll: ReturnType<typeof vi.fn>;
    resolveVrmRoute: ReturnType<typeof vi.fn>;
  };
} {
  const vrm = { expressionManager: { setValue: vi.fn() } } as unknown as VRM;
  const setEmote = vi.fn();
  const applyTransientExpression = vi.fn();
  const setLipsyncActive = vi.fn();
  const emoteTick = vi.fn(() => ({ skippedCount: 0 }));
  const reset = vi.fn();
  const emoteSnapshot = vi.fn(() => ({
    activeEmote: null,
    targetWeights: Object.freeze({}),
    currentWeights: Object.freeze({}),
    lipsyncActive: false,
  }));
  const emoteState: VrmEmoteState = {
    setEmote,
    applyTransientExpression,
    setLipsyncActive,
    tick: emoteTick,
    reset,
    snapshot: emoteSnapshot,
  };

  const play = vi.fn<(...args: unknown[]) => PlayResult>(() => ({
    played: true,
  }));
  const stopAll = vi.fn();
  const motionRegistry: VrmMotionPresetRegistry = {
    loadAll: vi.fn(async () => ({ loadedIds: [], failedIds: [] })),
    play,
    stopAll,
    tick: vi.fn(),
    snapshot: vi.fn(() => ({
      loaded: [],
      activePresetId: null,
      fadeRemainingSec: 0,
    })),
    dispose: vi.fn(),
  };

  const resolveVrmRoute = vi.fn((name: string) => routesByName[name] ?? null);
  const activityMapping: ActivityMapping = { resolveVrmRoute };

  return {
    vrm,
    emoteState,
    motionRegistry,
    activityMapping,
    spies: {
      setEmote,
      applyTransientExpression,
      setLipsyncActive,
      tick: emoteTick,
      reset,
      snapshot: emoteSnapshot,
      play,
      stopAll,
      resolveVrmRoute,
    },
  };
}

describe('scaleByIntensity', () => {
  it('returns 1 for null', () => {
    expect(scaleByIntensity(null)).toBe(1);
  });
  it('returns 1 for undefined', () => {
    expect(scaleByIntensity(undefined)).toBe(1);
  });
  it('clamps to [0, 1]', () => {
    expect(scaleByIntensity(-0.5)).toBe(0);
    expect(scaleByIntensity(0)).toBe(0);
    expect(scaleByIntensity(0.5)).toBe(0.5);
    expect(scaleByIntensity(1)).toBe(1);
    expect(scaleByIntensity(1.5)).toBe(1);
  });
  it('returns 0 for non-finite', () => {
    expect(scaleByIntensity(Number.NaN)).toBe(0);
    expect(scaleByIntensity(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('createVrmProjectionAdapter — applyActivity', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('routes a motion+emotion+expression compound activity through all three branches', () => {
    const { vrm, emoteState, motionRegistry, activityMapping, spies } =
      createMocks({
        compound: {
          motion: 'nod_yes',
          emotion: 'happy',
          expression: 'aa',
          fade: 0.42,
        },
      });
    const adapter = createVrmProjectionAdapter({
      vrm,
      emoteState,
      motionRegistry,
      activityMapping,
    });

    adapter.applyActivity({ name: 'compound', intensity: 1 });

    expect(spies.resolveVrmRoute).toHaveBeenCalledWith('compound');
    expect(spies.play).toHaveBeenCalledWith({
      presetId: 'nod_yes',
      intensity: 1,
      fade: 0.42,
    });
    expect(spies.applyTransientExpression).toHaveBeenCalledWith('aa', 1);
    expect(spies.setEmote).toHaveBeenCalledWith('happy');
  });

  it('only triggers motionRegistry when route has motion only', () => {
    const { vrm, emoteState, motionRegistry, activityMapping, spies } =
      createMocks({ agree: { motion: 'nod_yes' } });
    const adapter = createVrmProjectionAdapter({
      vrm,
      emoteState,
      motionRegistry,
      activityMapping,
    });

    adapter.applyActivity({ name: 'agree', intensity: 1 });

    expect(spies.play).toHaveBeenCalledWith({
      presetId: 'nod_yes',
      intensity: 1,
      fade: DEFAULT_ACTIVITY_FADE_SEC,
    });
    expect(spies.setEmote).not.toHaveBeenCalled();
    expect(spies.applyTransientExpression).not.toHaveBeenCalled();
  });

  it('only triggers emoteState.setEmote when route has emotion only', () => {
    const { vrm, emoteState, motionRegistry, activityMapping, spies } =
      createMocks({ happy: { emotion: 'happy', fade: 0.4 } });
    const adapter = createVrmProjectionAdapter({
      vrm,
      emoteState,
      motionRegistry,
      activityMapping,
    });

    adapter.applyActivity({ name: 'happy', intensity: null });

    expect(spies.play).not.toHaveBeenCalled();
    expect(spies.setEmote).toHaveBeenCalledWith('happy');
    expect(spies.applyTransientExpression).not.toHaveBeenCalled();
  });

  it('only triggers applyTransientExpression when route has expression only', () => {
    const { vrm, emoteState, motionRegistry, activityMapping, spies } =
      createMocks({ rare_expr: { expression: 'aa' } });
    const adapter = createVrmProjectionAdapter({
      vrm,
      emoteState,
      motionRegistry,
      activityMapping,
    });

    adapter.applyActivity({ name: 'rare_expr', intensity: null });

    expect(spies.applyTransientExpression).toHaveBeenCalledWith('aa', 1);
    expect(spies.play).not.toHaveBeenCalled();
    expect(spies.setEmote).not.toHaveBeenCalled();
  });

  it('scales transient expression weight by intensity', () => {
    const { vrm, emoteState, motionRegistry, activityMapping, spies } =
      createMocks({ scaled: { expression: 'aa' } });
    const adapter = createVrmProjectionAdapter({
      vrm,
      emoteState,
      motionRegistry,
      activityMapping,
    });

    adapter.applyActivity({ name: 'scaled', intensity: 0.5 });

    expect(spies.applyTransientExpression).toHaveBeenCalledWith('aa', 0.5);
  });

  it('warns and no-ops on unknown activity name (fail-close)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { vrm, emoteState, motionRegistry, activityMapping, spies } =
      createMocks({});
    const adapter = createVrmProjectionAdapter({
      vrm,
      emoteState,
      motionRegistry,
      activityMapping,
    });

    adapter.applyActivity({ name: 'mystery_activity', intensity: 1 });

    expect(spies.resolveVrmRoute).toHaveBeenCalledWith('mystery_activity');
    expect(warn).toHaveBeenCalled();
    expect(spies.play).not.toHaveBeenCalled();
    expect(spies.setEmote).not.toHaveBeenCalled();
    expect(spies.applyTransientExpression).not.toHaveBeenCalled();
  });
});

describe('createVrmProjectionAdapter — direct projection methods', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('applyEmotion forwards current + previous to emoteState.setEmote', () => {
    const { vrm, emoteState, motionRegistry, activityMapping, spies } =
      createMocks({});
    const adapter = createVrmProjectionAdapter({
      vrm,
      emoteState,
      motionRegistry,
      activityMapping,
    });

    adapter.applyEmotion({ current: 'sad', previous: 'happy' });

    expect(spies.setEmote).toHaveBeenCalledWith('sad', { previous: 'happy' });
  });

  it('applyMotion uses default fade=0.3 + loop=false when omitted', () => {
    const { vrm, emoteState, motionRegistry, activityMapping, spies } =
      createMocks({});
    const adapter = createVrmProjectionAdapter({
      vrm,
      emoteState,
      motionRegistry,
      activityMapping,
    });

    adapter.applyMotion({ presetId: 'idle_subtle' });

    expect(spies.play).toHaveBeenCalledWith({
      presetId: 'idle_subtle',
      fade: DEFAULT_DIRECT_MOTION_FADE_SEC,
      loop: false,
    });
  });

  it('applyMotion forwards explicit fade + loop', () => {
    const { vrm, emoteState, motionRegistry, activityMapping, spies } =
      createMocks({});
    const adapter = createVrmProjectionAdapter({
      vrm,
      emoteState,
      motionRegistry,
      activityMapping,
    });

    adapter.applyMotion({ presetId: 'listen_lean', loop: true, fade: 0.5 });

    expect(spies.play).toHaveBeenCalledWith({
      presetId: 'listen_lean',
      fade: 0.5,
      loop: true,
    });
  });

  it('applyExpression forwards weight + fade', () => {
    const { vrm, emoteState, motionRegistry, activityMapping, spies } =
      createMocks({});
    const adapter = createVrmProjectionAdapter({
      vrm,
      emoteState,
      motionRegistry,
      activityMapping,
    });

    adapter.applyExpression({ name: 'blink', weight: 0.8, fade: 0.2 });

    expect(spies.applyTransientExpression).toHaveBeenCalledWith(
      'blink',
      0.8,
      0.2,
    );
  });

  it('applyExpression defaults weight=1 when omitted', () => {
    const { vrm, emoteState, motionRegistry, activityMapping, spies } =
      createMocks({});
    const adapter = createVrmProjectionAdapter({
      vrm,
      emoteState,
      motionRegistry,
      activityMapping,
    });

    adapter.applyExpression({ name: 'wink' });

    expect(spies.applyTransientExpression).toHaveBeenCalledWith(
      'wink',
      1,
      undefined,
    );
  });

  it('reset triggers emoteState.reset(vrm) + motionRegistry.stopAll', () => {
    const { vrm, emoteState, motionRegistry, activityMapping, spies } =
      createMocks({});
    const adapter = createVrmProjectionAdapter({
      vrm,
      emoteState,
      motionRegistry,
      activityMapping,
    });

    adapter.reset();

    expect(spies.reset).toHaveBeenCalledWith({ vrm });
    expect(spies.stopAll).toHaveBeenCalled();
  });
});

describe('createVrmProjectionAdapter — BackendProjection conformance (negative)', () => {
  it('returns a value structurally typed as BackendProjection (no Live2D parameter id surface)', () => {
    const { vrm, emoteState, motionRegistry, activityMapping } = createMocks(
      {},
    );
    // The TS compiler enforces the BackendProjection type here: any
    // attempt to add a Live2D `parameterId` field on any of these
    // method inputs would fail at compile time. This test asserts
    // the value is assignable to the typed reference (the audit
    // `pnpm typecheck` step further enforces this across the suite).
    const adapter: BackendProjection = createVrmProjectionAdapter({
      vrm,
      emoteState,
      motionRegistry,
      activityMapping,
    });
    expect(typeof adapter.applyActivity).toBe('function');
    expect(typeof adapter.applyEmotion).toBe('function');
    expect(typeof adapter.applyMotion).toBe('function');
    expect(typeof adapter.applyExpression).toBe('function');
    expect(typeof adapter.reset).toBe('function');
    // Spot-check: there is no setParameter on the surface.
    expect(
      (adapter as unknown as { setParameter?: unknown }).setParameter,
    ).toBeUndefined();
  });
});
