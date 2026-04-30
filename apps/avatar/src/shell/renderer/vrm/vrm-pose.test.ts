import { describe, expect, it } from 'vitest';
import type { VRM } from '@pixiv/three-vrm';

import { applyIdlePose } from './vrm-pose.js';

type Rotation = { x: number; y: number; z: number };
type FakeBoneNode = { rotation: Rotation };

function makeBone(): FakeBoneNode {
  return { rotation: { x: 0, y: 0, z: 0 } };
}

function makeVrmWith(bones: Record<string, FakeBoneNode | undefined>): VRM {
  return {
    humanoid: {
      getNormalizedBoneNode: (name: string) => bones[name] ?? null,
    },
  } as unknown as VRM;
}

describe('applyIdlePose', () => {
  it('writes upper arm Z rotations symmetrically (≈ ±π/2.4)', () => {
    const leftUpperArm = makeBone();
    const rightUpperArm = makeBone();
    const leftLowerArm = makeBone();
    const rightLowerArm = makeBone();
    const vrm = makeVrmWith({
      leftUpperArm,
      rightUpperArm,
      leftLowerArm,
      rightLowerArm,
    });

    applyIdlePose(vrm);

    const expected = Math.PI / 2.4;
    expect(leftUpperArm.rotation.z).toBeCloseTo(expected, 6);
    expect(rightUpperArm.rotation.z).toBeCloseTo(-expected, 6);
    expect(leftLowerArm.rotation.x).toBeCloseTo(-0.1, 6);
    expect(rightLowerArm.rotation.x).toBeCloseTo(-0.1, 6);
  });

  it('skips silently when individual bones are missing (partial humanoid)', () => {
    const leftUpperArm = makeBone();
    // rightUpperArm + lower arms intentionally absent.
    const vrm = makeVrmWith({ leftUpperArm });
    expect(() => applyIdlePose(vrm)).not.toThrow();
    expect(leftUpperArm.rotation.z).toBeCloseTo(Math.PI / 2.4, 6);
  });

  it('throws fail-close when vrm.humanoid is missing entirely', () => {
    const vrm = { humanoid: undefined } as unknown as VRM;
    expect(() => applyIdlePose(vrm)).toThrow(/humanoid/);
  });

  it('throws when vrm.humanoid is null', () => {
    const vrm = { humanoid: null } as unknown as VRM;
    expect(() => applyIdlePose(vrm)).toThrow(/humanoid/);
  });
});
