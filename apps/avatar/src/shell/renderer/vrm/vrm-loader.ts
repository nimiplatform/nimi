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
//     1. suspendCreateImageBitmapForTauriVrmLoad()    // Tauri WKWebView quirk
//     2. load VRM GLTF via loader.loadAsync(url) or Tauri binary read + parse()
//     3. VRMUtils.rotateVRM0(vrm)                     // VRM 0.x → 1.0 orient
//     4. applyIdlePose(vrm)                           // avoid T-pose flash
//     5. scene.traverse(o => o.frustumCulled = false) // close-up cull guard
//     6. setCachedVrm(vrmFile, vrm)
//
// Steps 3 → 4 → 5 are STRICT and order-asserted in vrm-loader.test.ts.
// Step 1's restore() runs in a `finally` so a loader failure still un-pins
// `window.createImageBitmap`. Cache hits short-circuit before step 1
// (no quirk wrap needed; nothing is loading).

import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { VrmAvatarModelManifest } from './vrm-model-manifest.js';
import { convertTauriFileSrc, hasElectronRuntime } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  hasAvatarHostRuntime,
  hasAvatarTauriHostRuntime,
  invokeAvatarHostCommand,
} from '../app-shell/avatar-host-bridge.js';
import { getCachedVrm, setCachedVrm } from './vrm-instance-cache.js';
import { createMToonMaterialLoaderPlugin } from './vrm-mtoon-outline-policy.js';
import { applyIdlePose } from './vrm-pose.js';
import { suspendCreateImageBitmapForTauriVrmLoad } from './vrm-tauri-quirks.js';

let loaderSingleton: GLTFLoader | null = null;
type VrmGltfLoadResult = Awaited<ReturnType<GLTFLoader['loadAsync']>>;
type GltfParserRuntime = {
  parse(
    data: ArrayBuffer,
    path: string,
    onLoad: (gltf: VrmGltfLoadResult) => void,
    onError?: (error: unknown) => void,
  ): void;
};

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
  // Three.js TextureLoader. Default 'anonymous' triggers a CORS preflight
  // that WKWebView fails for custom-scheme blob URLs ("blob:tauri://…"),
  // causing every embedded GLB texture to error out with
  // "THREE.GLTFLoader: Couldn't load texture". Blob URLs are inherently
  // same-origin so disabling CORS is safe; the `<img>` still rejects
  // cross-origin URLs by virtue of the page's CSP `img-src`.
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
 * In a Tauri runtime the renderer is served from `tauri://localhost` and
 * browser-fetchable filesystem URLs must be passed through `convertFileSrc`.
 * Avatar-owned local VRM package files are loaded through the Avatar Tauri
 * binary-read command instead, because Windows `\\?\` paths are not valid
 * browser fetch targets.
 *
 * The Tauri import is dynamic so non-Tauri bundles don't pay the cost
 * and the test environment can mock the module.
 */
export async function convertModelFilePathToUrl(path: string): Promise<string> {
  return hasAvatarTauriHostRuntime() || hasElectronRuntime() ? convertTauriFileSrc(path) : path;
}

function isTauriRuntime(): boolean {
  return hasAvatarTauriHostRuntime();
}

function isRemoteOrBrowserUrl(path: string): boolean {
  if (/^[a-z]:[\\/]/iu.test(path)) return false;
  return /^[a-z][a-z0-9+.-]*:/iu.test(path) && !/^file:/iu.test(path);
}

async function readTauriBinaryFile(path: string): Promise<ArrayBuffer> {
  if (!hasAvatarHostRuntime()) {
    throw new Error('VRM local file loading requires an Avatar host bridge');
  }
  const bytes = await invokeAvatarHostCommand<number[]>('nimi_avatar_read_binary_file', { path });
  return new Uint8Array(bytes).buffer;
}

function parseVrmGltfFromArrayBuffer(
  loader: GLTFLoader,
  data: ArrayBuffer,
): Promise<VrmGltfLoadResult> {
  const parser = loader as unknown as GltfParserRuntime;
  return new Promise((resolve, reject) => {
    parser.parse(
      data,
      '',
      (gltf) => resolve(gltf as VrmGltfLoadResult),
      (error) => reject(error),
    );
  });
}

async function loadVrmGltf(path: string): Promise<VrmGltfLoadResult> {
  if (isTauriRuntime() && !isRemoteOrBrowserUrl(path)) {
    const data = await readTauriBinaryFile(path);
    return parseVrmGltfFromArrayBuffer(getVrmLoader(), data);
  }
  const url = await convertModelFilePathToUrl(path);
  return getVrmLoader().loadAsync(url);
}

/**
 * Load a VRM model from a resolved manifest. Honours the validated r056 load
 * order and the local createImageBitmap suspend wrap. Cache hits short-circuit
 * the loader entirely.
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
  const cacheKey = manifest.vrm.vrmFile;
  const cached = getCachedVrm(cacheKey);
  if (cached) return cached;

  const restore = suspendCreateImageBitmapForTauriVrmLoad();
  try {
    const gltf = await loadVrmGltf(manifest.vrm.vrmFile);
    const vrm = (gltf.userData as { vrm?: VRM }).vrm;
    if (!vrm) {
      throw new Error('Asset is not a valid VRM (gltf.userData.vrm missing)');
    }
    // STRICT ORDER per K-NAV-VRM-001 — do not reorder these three steps.
    VRMUtils.rotateVRM0(vrm);
    applyIdlePose(vrm);
    vrm.scene.traverse((object: { frustumCulled?: boolean }) => {
      object.frustumCulled = false;
    });
    setCachedVrm(cacheKey, vrm);
    return vrm;
  } finally {
    restore();
  }
}
