// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Apply a neutral standing idle pose to a freshly-loaded VRM. The default
// VRM rig comes up in T-pose with arms extended horizontally; without an
// idle pose write we briefly flash the T-pose before the first motion
// preset evaluates. Per vrm-backend-contract.md §2.1 step 7, the load
// sequence is:
//
//   VRMUtils.rotateVRM0  →  applyIdlePose  →  scene.traverse frustumCulled=false
//
// Algorithm: rotate upper arms ≈75° about Z toward the body (+/- π/2.4)
// so the arms hang naturally, plus a small elbow flex on the lower arms.
// Bones that are absent on a partial humanoid are skipped silently — a
// partial idle is acceptable. If `vrm.humanoid` itself is missing, the
// model lacks a humanoid skeleton entirely and we fail-close (per
// vrm-backend-contract.md §2.2 Load Failure: "applyIdlePose 抛错 (model
// 缺少 humanoid bone) → fail-close").

import type { VRM } from '@pixiv/three-vrm';

// Approximately 75° (π / 2.4 ≈ 1.309 rad). Matches airi pattern reference
// for a relaxed arms-down posture from a T-pose neutral.
const UPPER_ARM_TILT = Math.PI / 2.4;
const LOWER_ARM_FLEX = -0.1;

type BoneName = Parameters<NonNullable<VRM['humanoid']>['getNormalizedBoneNode']>[0];

type AxisRotation = {
  bone: BoneName;
  axis: 'x' | 'y' | 'z';
  value: number;
};

const IDLE_BONE_ROTATIONS: readonly AxisRotation[] = [
  { bone: 'leftUpperArm', axis: 'z', value: UPPER_ARM_TILT },
  { bone: 'rightUpperArm', axis: 'z', value: -UPPER_ARM_TILT },
  { bone: 'leftLowerArm', axis: 'x', value: LOWER_ARM_FLEX },
  { bone: 'rightLowerArm', axis: 'x', value: LOWER_ARM_FLEX },
];

/**
 * Write a neutral standing idle pose into the VRM humanoid bone graph.
 *
 * Throws if `vrm.humanoid` is missing (fail-close: model lacks humanoid
 * skeleton entirely). Individual missing bones are skipped silently.
 */
export function applyIdlePose(vrm: VRM): void {
  if (!vrm.humanoid) {
    throw new Error(
      'applyIdlePose: vrm.humanoid is missing — model lacks humanoid skeleton (fail-close)',
    );
  }
  for (const { bone, axis, value } of IDLE_BONE_ROTATIONS) {
    const node = vrm.humanoid.getNormalizedBoneNode(bone);
    if (!node) continue;
    node.rotation[axis] = value;
  }
}
