// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Singleton GLTFLoader wired with VRMLoaderPlugin + VRMAnimationLoaderPlugin
// + the apps/avatar MToon outline policy plugin. Responsible for loading
// `.vrm` model files and `.vrma` motion preset files via the same loader
// instance (both plugins register on it; plugin order is matched against
// the asset's GLTF extensions list).
//
// Validated loading follows rule.nimi.avatar.embodiment.r056:
//
//     1. load VRM GLTF through the admitted Electron asset URL
//     2. VRMUtils.rotateVRM0(vrm)                     // VRM 0.x → 1.0 orient
//     3. applyIdlePose(vrm)                           // avoid T-pose flash
//     4. scene.traverse(o => o.frustumCulled = false) // close-up cull guard
//
// Steps 2 → 3 → 4 are STRICT and order-asserted in vrm-loader.test.ts.

import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { VrmAvatarModelManifest } from './vrm-model-manifest.js';
import { convertShellFileSrc, hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import { createMToonMaterialLoaderPlugin } from './vrm-mtoon-outline-policy.js';
import { applyIdlePose } from './vrm-pose.js';

let loaderSingleton: GLTFLoader | null = null;
type VrmGltfLoadResult = Awaited<ReturnType<GLTFLoader['loadAsync']>>;

/**
 * Return the process-singleton GLTFLoader. Plugins are registered on
 * first construction; subsequent calls reuse the same instance, as required
 * by K-NAV-VRM-001 and asserted in tests.
 *
 * The same loader handles both `.vrm` (VRMLoaderPlugin) and `.vrma`
 * (VRMAnimationLoaderPlugin); each plugin only activates when its
 * extension is present in the asset.
 */
export function getVrmLoader(): GLTFLoader {
  if (loaderSingleton) return loaderSingleton;
  const loader = new GLTFLoader();
  // Empty string disables CORS on the underlying `<img>` element used by
  // Three.js TextureLoader. The admitted Electron asset URLs are local and
  // same-origin; leaving CORS unset avoids an unnecessary preflight while the
  // page CSP continues to reject foreign image sources.
  loader.crossOrigin = '';
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
 * Convert a remote/browser model path into a URL the GLTFLoader can fetch.
 *
 * The shared helper maps an admitted Desktop Host materialization path onto
 * the Electron local-asset protocol; raw filesystem paths never reach fetch.
 */
export async function convertModelFilePathToUrl(path: string): Promise<string> {
  return hasElectronRuntime() ? convertShellFileSrc(path) : path;
}

async function loadVrmGltf(path: string): Promise<VrmGltfLoadResult> {
  const url = await convertModelFilePathToUrl(path);
  return getVrmLoader().loadAsync(url);
}

/**
 * Load a VRM model from a resolved manifest. Honours the validated r056 load
 * order. Every call returns a fresh scene so context recovery cannot reuse
 * stale GPU resources.
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
  let parsedScene: VRM['scene'] | null = null;
  try {
    const gltf = await loadVrmGltf(manifest.vrm.vrmFile);
    parsedScene = (gltf as VrmGltfLoadResult & { scene?: VRM['scene'] }).scene ?? null;
    const vrm = (gltf.userData as { vrm?: VRM }).vrm;
    if (!vrm) {
      throw new Error('Asset is not a valid VRM (gltf.userData.vrm missing)');
    }
    parsedScene = vrm.scene;
    // STRICT ORDER per K-NAV-VRM-001 — do not reorder these three steps.
    VRMUtils.rotateVRM0(vrm);
    applyIdlePose(vrm);
    vrm.scene.traverse((object: { frustumCulled?: boolean }) => {
      object.frustumCulled = false;
    });
    return vrm;
  } catch (error) {
    if (parsedScene) {
      try {
        VRMUtils.deepDispose(parsedScene);
      } catch (disposeError) {
        console.warn(`[avatar:vrm] failed to dispose a rejected parsed scene: ${disposeError instanceof Error ? disposeError.message : String(disposeError)}`);
      }
    }
    throw error;
  }
}
