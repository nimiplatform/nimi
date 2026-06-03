import { describe, expect, it } from 'vitest';
import {
  GENERATED_MOTION_MAX_ROTATION_RAD,
  isVrmGeneratedRouteId,
  VRM_GENERATED_ROUTE_IDS,
  type VrmGeneratedMotionProvider,
  type VrmGeneratedMotionRuntime,
} from '../src/vrm-generated-motion.js';

describe('avatar VRM generated motion protocol', () => {
  it('admits the generated route ids from the Avatar generated-motion table', () => {
    expect(VRM_GENERATED_ROUTE_IDS).toEqual([
      'idle_subtle',
      'listen_lean',
      'nod_yes',
      'shake_no',
      'greet_wave',
    ]);
    expect(isVrmGeneratedRouteId('greet_wave')).toBe(true);
    expect(isVrmGeneratedRouteId('walk_forward')).toBe(false);
  });

  it('exposes generic provider/runtime contracts without renderer dependencies', () => {
    type TestVrm = { sceneId: string };
    type TestClip = { clipId: string };
    const provider: VrmGeneratedMotionProvider<TestVrm, TestClip> = {
      generate(input) {
        return {
          ok: true,
          clip: { clipId: input.routeId },
          evidence: { routeId: input.routeId, providerKind: 'test' },
        };
      },
    };
    const runtime: VrmGeneratedMotionRuntime<TestVrm> = {
      attach: () => undefined,
      play: (input) => ({ played: true, evidence: { routeId: input.routeId, providerKind: 'test' } }),
      stopAll: () => undefined,
      tick: () => undefined,
      snapshot: () => ({ attached: true, activeRouteId: 'idle_subtle', fadeRemainingSec: 0 }),
      dispose: () => undefined,
    };

    expect(provider.generate({ vrm: { sceneId: 'vrm' }, routeId: 'idle_subtle', intensity: null, loop: false })).toEqual({
      ok: true,
      clip: { clipId: 'idle_subtle' },
      evidence: { routeId: 'idle_subtle', providerKind: 'test' },
    });
    expect(runtime.snapshot().activeRouteId).toBe('idle_subtle');
    expect(GENERATED_MOTION_MAX_ROTATION_RAD).toBe(1.2);
  });
});
