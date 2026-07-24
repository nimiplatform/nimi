// Authority: docs/authority/avatar-embodiment-rationale.md.
//
// Thin `.vrma` loader + `clipFromVRMAnimation` wrapper. Houses the
// `loadVrmAnimation` function that previously lived in vrm-loader.ts
// (chunk 2-B). vrm-loader.ts re-exports loadVrmAnimation so existing
// import paths stay valid (back-compat).
//
// The upstream `@pixiv/three-vrm-animation` package exports
// `createVRMAnimationClip(animation, vrm)` (verified against
// node_modules/.pnpm/@pixiv+three-vrm-animation@3.5.2/.../types/index.d.ts).
// We expose a thin `clipFromVRMAnimation` named wrapper to match the
// API name used in vrm-backend-contract.md §3.1 ("clipFromVRMAnimation
// 转 THREE.AnimationClip"). Wrapper rationale: contract surface is
// stable across upstream renames; if upstream renames the function in
// a future release, only the wrapper updates.

import type { VRM } from '@pixiv/three-vrm';
import {
  createVRMAnimationClip,
  type VRMAnimation,
} from '@pixiv/three-vrm-animation';

import { getVrmLoader } from './vrm-loader.js';
import { suspendCreateImageBitmapForTauriVrmLoad } from './vrm-tauri-quirks.js';

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
 *
 * Suspend wrap is applied identically to VRM loads — `.vrma` files
 * usually carry no textures, but the wrap is cheap and keeps a uniform
 * code path across both asset kinds.
 */
export async function loadVrmAnimation(url: string): Promise<VRMAnimation | null> {
  const restore = suspendCreateImageBitmapForTauriVrmLoad();
  try {
    const gltf = await getVrmLoader().loadAsync(url);
    const animations = (gltf.userData as { vrmAnimations?: unknown[] }).vrmAnimations;
    if (!Array.isArray(animations) || animations.length === 0) return null;
    return animations[0] as VRMAnimation;
  } finally {
    restore();
  }
}

/**
 * Build a Three.js `AnimationClip` from a `VRMAnimation` for the given
 * VRM instance. Thin wrapper around `@pixiv/three-vrm-animation`'s
 * `createVRMAnimationClip` — exposed under the contract-stable name
 * `clipFromVRMAnimation` (matches vrm-backend-contract.md §3.1).
 */
export function clipFromVRMAnimation(animation: VRMAnimation, vrm: VRM): AnimationClip {
  return createVRMAnimationClip(animation, vrm);
}
