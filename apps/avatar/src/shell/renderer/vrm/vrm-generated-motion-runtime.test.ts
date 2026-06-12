import type { VRM } from '@pixiv/three-vrm';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createAction: () => ({
    play: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    reset: vi.fn().mockReturnThis(),
    crossFadeTo: vi.fn().mockReturnThis(),
    timeScale: 1 as number,
    loop: 0 as number,
  }),
}));

vi.mock('three', () => {
  return {
    LoopRepeat: 2201,
    LoopOnce: 2200,
    AnimationMixer: class FakeAnimationMixer {
      public _actions = new Map<unknown, ReturnType<typeof mocks.createAction>>();
      public update = vi.fn();
      public stopAllAction = vi.fn();
      public uncacheRoot = vi.fn();
      clipAction(clip: unknown): ReturnType<typeof mocks.createAction> {
        const cached = this._actions.get(clip);
        if (cached) return cached;
        const action = mocks.createAction();
        this._actions.set(clip, action);
        return action;
      }
    },
  };
});

import {
  createMissingVrmGeneratedMotionProvider,
  createVrmGeneratedMotionRuntime,
  DEFAULT_GENERATED_MOTION_FADE_SEC,
  GENERATED_MOTION_INTENSITY_MAX,
  GENERATED_MOTION_INTENSITY_MIN,
} from './vrm-generated-motion-runtime.js';
import type { VrmGeneratedMotionProvider } from './vrm-generated-motion-contract.js';

function fakeVrm(): VRM {
  return { scene: { name: 'fake-vrm' } } as unknown as VRM;
}

describe('createMissingVrmGeneratedMotionProvider', () => {
  it('fails closed and never returns placeholder success', () => {
    const provider = createMissingVrmGeneratedMotionProvider();
    const result = provider.generate({
      vrm: fakeVrm(),
      routeId: 'idle_subtle',
      intensity: null,
      loop: false,
    });

    expect(result).toEqual({
      status: 'fail_closed',
      routeId: 'idle_subtle',
      reasonCode: 'missing_profile',
      evidence: {
        routeId: 'idle_subtle',
        providerKind: 'missing',
        reasonCode: 'missing_profile',
      },
    });
  });
});

describe('createVrmGeneratedMotionRuntime', () => {
  it('fails closed before attach', () => {
    const runtime = createVrmGeneratedMotionRuntime(createMissingVrmGeneratedMotionProvider());
    expect(runtime.play({ routeId: 'idle_subtle' })).toEqual({
      played: false,
      reason: 'generated_motion_runtime_not_attached',
      evidence: {
        routeId: 'idle_subtle',
        providerKind: 'runtime',
      },
    });
  });

  it('fails closed when provider is missing after attach', () => {
    const runtime = createVrmGeneratedMotionRuntime(createMissingVrmGeneratedMotionProvider());
    runtime.attach(fakeVrm());

    const result = runtime.play({ routeId: 'listen_lean' });

    expect(result.played).toBe(false);
    if (!result.played) {
      expect(result.reason).toBe('missing_profile');
    }
    expect(runtime.snapshot()).toEqual({
      attached: true,
      activeRouteId: null,
      fadeRemainingSec: 0,
    });
  });

  it('plays a generated clip and applies default fade on crossfade', () => {
    const provider: VrmGeneratedMotionProvider = {
      generate(input) {
        return {
          status: 'ok' as const,
          clip: { name: input.routeId } as never,
          routeId: input.routeId,
          evidence: { routeId: input.routeId, providerKind: 'test' },
        };
      },
    };
    const runtime = createVrmGeneratedMotionRuntime(provider);
    runtime.attach(fakeVrm());

    expect(runtime.play({ routeId: 'idle_subtle', loop: true })).toEqual({
      played: true,
      evidence: { routeId: 'idle_subtle', providerKind: 'test' },
    });
    expect(runtime.snapshot().activeRouteId).toBe('idle_subtle');

    runtime.play({ routeId: 'nod_yes' });
    expect(runtime.snapshot()).toEqual({
      attached: true,
      activeRouteId: 'nod_yes',
      fadeRemainingSec: DEFAULT_GENERATED_MOTION_FADE_SEC,
    });
  });

  it('clamps generated motion intensity bounds without throwing', () => {
    const provider: VrmGeneratedMotionProvider = {
      generate(input) {
        return {
          status: 'ok' as const,
          clip: { name: input.routeId } as never,
          routeId: input.routeId,
          evidence: { routeId: input.routeId, providerKind: 'test' },
        };
      },
    };
    const runtime = createVrmGeneratedMotionRuntime(provider);
    runtime.attach(fakeVrm());

    expect(runtime.play({ routeId: 'idle_subtle', intensity: 99 }).played).toBe(true);
    expect(GENERATED_MOTION_INTENSITY_MAX).toBe(1.4);
    expect(runtime.play({ routeId: 'idle_subtle', intensity: 0.1 }).played).toBe(true);
    expect(GENERATED_MOTION_INTENSITY_MIN).toBe(0.5);
  });
});
