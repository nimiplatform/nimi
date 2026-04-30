// Wave 2 chunk 2-B of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Singleton GLTFLoader wired with VRMLoaderPlugin + VRMAnimationLoaderPlugin
// + the apps/avatar MToon outline policy plugin. Responsible for loading
// `.vrm` model files and `.vrma` motion preset files via the same loader
// instance (both plugins register on it; plugin order is matched against
// the asset's GLTF extensions list).
//
// Load order is governed by vrm-backend-contract.md §2.1 (NAV-VRM-001):
//
//     1. suspendCreateImageBitmapForTauriVrmLoad()    // Tauri WKWebView quirk
//     2. loader.loadAsync(url)
//     3. VRMUtils.rotateVRM0(vrm)                     // VRM 0.x → 1.0 orient
//     4. applyIdlePose(vrm)                           // avoid T-pose flash
//     5. scene.traverse(o => o.frustumCulled = false) // close-up cull guard
//     6. setCachedVrm(url, vrm)
//
// Steps 3 → 4 → 5 are STRICT and order-asserted in vrm-loader.test.ts.
// Step 1's restore() runs in a `finally` so a loader failure still un-pins
// `window.createImageBitmap`. Cache hits short-circuit before step 1
// (no quirk wrap needed; nothing is loading).

import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { VrmAvatarModelManifest } from '../carrier/model-resolver.js';
import { getCachedVrm, setCachedVrm } from './vrm-instance-cache.js';
import { createMToonMaterialLoaderPlugin } from './vrm-mtoon-outline-policy.js';
import { applyIdlePose } from './vrm-pose.js';
import { suspendCreateImageBitmapForTauriVrmLoad } from './vrm-tauri-quirks.js';

let loaderSingleton: GLTFLoader | null = null;

/**
 * Return the process-singleton GLTFLoader. Plugins are registered on
 * first construction; subsequent calls reuse the same instance — required
 * by acceptance_invariant #6 (singleton) and asserted in tests.
 *
 * The same loader handles both `.vrm` (VRMLoaderPlugin) and `.vrma`
 * (VRMAnimationLoaderPlugin); each plugin only activates when its
 * extension is present in the asset.
 */
export function getVrmLoader(): GLTFLoader {
  if (loaderSingleton) return loaderSingleton;
  const loader = new GLTFLoader();
  loader.crossOrigin = 'anonymous';
  loader.register((parser) => {
    return new VRMLoaderPlugin(
      parser as ConstructorParameters<typeof VRMLoaderPlugin>[0],
      {
        mtoonMaterialPlugin: createMToonMaterialLoaderPlugin(parser),
      },
    ) as unknown as ReturnType<Parameters<GLTFLoader['register']>[0]>;
  });
  loader.register((parser) => {
    return new VRMAnimationLoaderPlugin(
      parser as ConstructorParameters<typeof VRMAnimationLoaderPlugin>[0],
    ) as unknown as ReturnType<Parameters<GLTFLoader['register']>[0]>;
  });
  loaderSingleton = loader;
  return loader;
}

/**
 * Test-only seam to drop the singleton so a fresh loader is constructed
 * on the next `getVrmLoader` call. Production code must not invoke this.
 */
export function __resetVrmLoaderForTests(): void {
  loaderSingleton = null;
}

/**
 * Convert a manifest model file path into a URL the GLTFLoader can fetch.
 *
 * In a Tauri runtime the renderer is served from `tauri://localhost` and
 * raw filesystem paths must be passed through `convertFileSrc` to be
 * routed through the asset protocol. In dev / SSR / test environments the
 * path is returned unchanged (callers are expected to feed already-URL
 * strings in those contexts, e.g. fixtures served by Vite).
 *
 * The Tauri import is dynamic so non-Tauri bundles don't pay the cost
 * and the test environment can mock the module.
 */
export async function convertModelFilePathToUrl(path: string): Promise<string> {
  if (!isTauriRuntime()) return path;
  try {
    const mod = (await import('@tauri-apps/api/core')) as {
      convertFileSrc?: (filePath: string, protocol?: string) => string;
    };
    if (typeof mod.convertFileSrc !== 'function') return path;
    return mod.convertFileSrc(path);
  } catch {
    // Lazy import failed (e.g. webview without API surface) — pass through
    // and let the loader surface its own error if the URL is unreachable.
    return path;
  }
}

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w['__TAURI_INTERNALS__']) || Boolean(w['__TAURI_IPC__']);
}

/**
 * Load a VRM model from a resolved manifest. Honours the strict load order
 * from vrm-backend-contract.md §2.1 and the createImageBitmap suspend wrap
 * from §6.1. Cache hits short-circuit the loader entirely.
 *
 * Throws when:
 *   - manifest.kind is not 'vrm'
 *   - GLTFLoader rejects (file not found / parse error)
 *   - the parsed gltf does not expose `userData.vrm` (asset is not VRM)
 *   - applyIdlePose throws (model lacks humanoid skeleton — fail-close)
 */
export async function loadVrmFromManifest(manifest: VrmAvatarModelManifest): Promise<VRM> {
  if (manifest.kind !== 'vrm') {
    throw new Error('loadVrmFromManifest expects manifest.kind === "vrm"');
  }
  const url = await convertModelFilePathToUrl(manifest.vrm.vrmFile);
  const cached = getCachedVrm(url);
  if (cached) return cached;

  const restore = suspendCreateImageBitmapForTauriVrmLoad();
  try {
    const gltf = await getVrmLoader().loadAsync(url);
    const vrm = (gltf.userData as { vrm?: VRM }).vrm;
    if (!vrm) {
      throw new Error('Asset is not a valid VRM (gltf.userData.vrm missing)');
    }
    // STRICT ORDER per NAV-VRM-001 — do not reorder these three steps.
    VRMUtils.rotateVRM0(vrm);
    applyIdlePose(vrm);
    vrm.scene.traverse((object: { frustumCulled?: boolean }) => {
      object.frustumCulled = false;
    });
    setCachedVrm(url, vrm);
    return vrm;
  } finally {
    restore();
  }
}

// `.vrma` loader was moved to vrm-animation-loader.ts (chunk 3-B) so the
// `clipFromVRMAnimation` retargeting wrapper can sit alongside it. Both
// names are re-exported here for back-compat with chunk 2-B import sites
// (vrm-loader.test.ts + future motion preset registry).
export { clipFromVRMAnimation, loadVrmAnimation } from './vrm-animation-loader.js';
