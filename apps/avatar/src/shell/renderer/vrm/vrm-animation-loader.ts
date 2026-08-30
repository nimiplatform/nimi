// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Avatar-owned `.vrma` interchange loader and retargeting wrapper.
//
// The upstream `@pixiv/three-vrm-animation` package exports
// `createVRMAnimationClip(animation, vrm)` (verified against
// node_modules/.pnpm/@pixiv+three-vrm-animation@3.5.2/.../types/index.d.ts).
// The local `clipFromVRMAnimation` wrapper keeps the upstream conversion
// dependency inside the VRM interchange implementation.

import type { VRM } from '@pixiv/three-vrm';
import {
  createVRMAnimationClip,
  type VRMAnimation,
} from '@pixiv/three-vrm-animation';

import { getVrmLoader } from './vrm-loader.js';

// `three` is shimmed via `declare module 'three'` in three-loader-shim.d.ts
// (no @types/three at this wave), so AnimationClip is exposed as `any`.
// We use a structural type alias here so callers see a non-`any` surface.
type AnimationClip = unknown;

/**
 * Load a `.vrma` motion preset file via the singleton GLTFLoader. The
 * VRMAnimationLoaderPlugin populates `gltf.userData.vrmAnimations` on
 * success. Returns the first VRMAnimation (convention: one preset per
 * file) or `null` if the asset has no VRMC_vrm_animation extension.
 *
 * The caller pairs this with `clipFromVRMAnimation(animation, vrm)` to
 * retarget onto a specific VRM (humanoid bone retargeting per the VRM
 * standard).
 */
export async function loadVrmAnimation(url: string): Promise<VRMAnimation | null> {
  const gltf = await getVrmLoader().loadAsync(url);
  const animations = (gltf.userData as { vrmAnimations?: unknown[] }).vrmAnimations;
  if (!Array.isArray(animations) || animations.length === 0) return null;
  return animations[0] as VRMAnimation;
}

/**
 * Build a Three.js `AnimationClip` from a `VRMAnimation` for the given
 * VRM instance. Thin wrapper around `@pixiv/three-vrm-animation`'s
 * `createVRMAnimationClip`.
 */
export function clipFromVRMAnimation(animation: VRMAnimation, vrm: VRM): AnimationClip {
  return createVRMAnimationClip(animation, vrm);
}
