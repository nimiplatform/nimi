import type { VRM } from '@pixiv/three-vrm';
import { describe, expect, it, vi } from 'vitest';

vi.mock('three', () => {
  return {
    NumberKeyframeTrack: class FakeNumberKeyframeTrack {
      constructor(
        public name: string,
        public times: number[],
        public values: number[],
      ) {}
    },
    AnimationClip: class FakeAnimationClip {
      constructor(
        public name: string,
        public duration: number,
        public tracks: unknown[],
      ) {}
    },
  };
});

import {
  createVrmCapabilityProfile,
  validateVrmCapabilityProfile,
} from './vrm-capability-profile.js';
import {
  createDeterministicVrmGeneratedMotionProvider,
  generateDeterministicVrmMotion,
} from './vrm-deterministic-motion-provider.js';

function makeVrm(missing: string[] = []): VRM {
  const missingSet = new Set(missing);
  return {
    expressionManager: { setValue: vi.fn() },
    humanoid: {
      getNormalizedBoneNode(name: string) {
        if (missingSet.has(name)) return null;
        return { name: `${name}Node` };
      },
    },
  } as unknown as VRM;
}

describe('createVrmCapabilityProfile', () => {
  it('marks all initial generated routes supported when required bones exist', () => {
    const profile = createVrmCapabilityProfile(makeVrm());

    expect(profile.backendKind).toBe('vrm');
    expect(profile.generatedMotion.supportedRoutes.sort()).toEqual(
      ['greet_wave', 'idle_subtle', 'listen_lean', 'nod_yes', 'shake_no'].sort(),
    );
    expect(profile.generatedMotion.unsupportedRoutes).toEqual([]);
    expect(profile.expressionPresets.present).toBe(true);
    expect(profile.lookat.supported).toBe(false);
    expect(profile.poseLimits.maxRotationDeg).toBeGreaterThan(0);
    expect(() => validateVrmCapabilityProfile(profile)).not.toThrow();
  });

  it('marks route unsupported when a required bone is missing', () => {
    const profile = createVrmCapabilityProfile(makeVrm(['rightHand']));

    expect(profile.generatedMotion.supportedRoutes).not.toContain('greet_wave');
    expect(profile.generatedMotion.unsupportedRoutes).toContainEqual({
      routeId: 'greet_wave',
      reason: 'missing_bones:rightHand',
    });
  });

  it('fails closed for incomplete capability profiles', () => {
    const profile = createVrmCapabilityProfile(makeVrm());
    expect(() => validateVrmCapabilityProfile({
      ...profile,
      expressionPresets: undefined,
    } as unknown as typeof profile)).toThrow(/expressionPresets is required/);
    expect(() => validateVrmCapabilityProfile({
      ...profile,
      poseLimits: undefined,
    } as unknown as typeof profile)).toThrow(/poseLimits\.maxRotationDeg is required/);
  });
});

describe('generateDeterministicVrmMotion', () => {
  it('fails closed for unknown route id', () => {
    const result = generateDeterministicVrmMotion({
      vrm: makeVrm(),
      routeId: 'unknown_route',
      intensity: null,
      loop: false,
    });

    expect(result).toEqual({
      status: 'fail_closed',
      routeId: 'unknown_route',
      reasonCode: 'missing_route',
      evidence: {
        routeId: 'unknown_route',
        providerKind: 'deterministic_vrm',
        reasonCode: 'missing_route',
      },
    });
  });

  it('fails closed for missing required route bone', () => {
    const result = generateDeterministicVrmMotion({
      vrm: makeVrm(['head']),
      routeId: 'nod_yes',
      intensity: null,
      loop: false,
    });

    expect(result.status).toBe('fail_closed');
    if (result.status === 'fail_closed') {
      expect(result.reasonCode).toBe('unsupported_capability');
    }
  });

  it('returns deterministic clips for identical input', () => {
    const provider = createDeterministicVrmGeneratedMotionProvider();
    const input = {
      vrm: makeVrm(),
      routeId: 'shake_no',
      intensity: 1,
      loop: false,
    };

    const first = provider.generate(input);
    const second = provider.generate(input);

    expect(first).toEqual(second);
    expect(first.status).toBe('ok');
    if (first.status === 'ok') {
      expect((first.clip as { name: string }).name).toBe('nimi.shake_no');
    }
  });

  it('clamps intensity and rotation for greet_wave without LLM input', () => {
    const result = generateDeterministicVrmMotion({
      vrm: makeVrm(),
      routeId: 'greet_wave',
      intensity: 10,
      loop: false,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const tracks = (result.clip as { tracks: Array<{ values: number[] }> }).tracks;
    const maxAbs = Math.max(...tracks.flatMap((track) => track.values.map(Math.abs)));
    expect(maxAbs).toBeLessThanOrEqual(1.2);
  });

  it('fails closed when an explicit mapping sidecar gate is low confidence', () => {
    const result = generateDeterministicVrmMotion(
      {
        vrm: makeVrm(),
        routeId: 'greet_wave',
        intensity: 1,
        loop: false,
      },
      {
        mappingSidecars: [
          {
            sidecar_id: 'sidecar-greet-wave-vrm',
            route_id: 'greet_wave',
            backend_kind: 'vrm',
            profile_id: 'vrm-runtime-probe-v1',
            confidence: 0.5,
            threshold: 0.82,
            manual_confirmation: 'confirmed',
            source_kind: 'llm_semantic_match',
            target_fields: [
              { target_kind: 'humanoid_bone', name: 'spine' },
              { target_kind: 'humanoid_bone', name: 'rightUpperArm' },
              { target_kind: 'humanoid_bone', name: 'rightLowerArm' },
              { target_kind: 'humanoid_bone', name: 'rightHand' },
            ],
          },
        ],
      },
    );

    expect(result.status).toBe('fail_closed');
    if (result.status === 'fail_closed') {
      expect(result.reasonCode).toBe('mapping_confidence_below_threshold');
    }
  });
});
