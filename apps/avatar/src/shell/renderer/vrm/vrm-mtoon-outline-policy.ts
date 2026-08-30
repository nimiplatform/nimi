// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// MToon material loader plugin factory with an outline-fallback policy for
// GPU environments that cannot render outline meshes acceptably (software
// rasterisers and similar limited-shader paths). Per
// rule.nimi.avatar.embodiment.r061, outline is decorative; when the GPU is incompatible
// we fall back to the base MToon material instead of fail-closing.
//
// Algorithm reference: airi `AiriMToonMaterialLoaderPlugin`
// (composables/vrm/material-mtoon). The app-isolation contract requires this
// file MUST NOT import anything from the airi package directory; only the
// algorithm shape and constant set are reused. License: airi MIT.
//
// Detection criteria (case-insensitive substring match against
// `gl.getParameter(gl.RENDERER)`):
//   - 'SwiftShader' / 'llvmpipe' / 'software' → outline disabled
//   - everything else → outline ON
//
// Implementation: subclass-style wrap of MToonMaterialLoaderPlugin so we can
// preserve the official extendMaterialParams pipeline (renderOrderOffset /
// debug mode / etc) while neutralising outline width when incompatible.

import {
  MToonMaterialLoaderPlugin,
  type MToonMaterialLoaderPluginOptions,
} from '@pixiv/three-vrm';

const OUTLINE_INCOMPATIBLE_RENDERER_FRAGMENTS: readonly string[] = [
  'swiftshader',
  'llvmpipe',
  'software',
];

type RendererProbe = {
  renderer: string | null;
  outlineCompatible: boolean;
};

let detectionCache: RendererProbe | null = null;

/**
 * Read the active GPU renderer string from a probe WebGL context, classify
 * it for outline compatibility, and cache the result. The detection runs
 * at most once per process — outline policy is static for the lifetime
 * of the renderer.
 *
 * Exposed for tests to inspect/reset; production code calls
 * `createMToonMaterialLoaderPlugin` and lets the cache populate lazily.
 */
export function detectOutlineCompatibility(): RendererProbe {
  if (detectionCache) return detectionCache;
  detectionCache = probeRendererForOutlineCompatibility();
  return detectionCache;
}

/**
 * Reset the cached probe (test-only seam). Subsequent calls to
 * `detectOutlineCompatibility` will re-probe.
 */
export function __resetOutlineCompatibilityCacheForTests(): void {
  detectionCache = null;
}

function probeRendererForOutlineCompatibility(): RendererProbe {
  if (typeof document === 'undefined') {
    // SSR / non-browser: assume compatible. Real probe runs in renderer.
    return { renderer: null, outlineCompatible: true };
  }
  let renderer: string | null = null;
  try {
    const probeCanvas = document.createElement('canvas');
    const gl =
      (probeCanvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
      (probeCanvas.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) {
      return { renderer: null, outlineCompatible: true };
    }
    // Try debug_renderer_info for an unmasked renderer; fall back to plain
    // RENDERER if the extension is unavailable.
    const debugExt = gl.getExtension('WEBGL_debug_renderer_info') as
      | { UNMASKED_RENDERER_WEBGL: number }
      | null;
    if (debugExt) {
      const value = gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL);
      renderer = typeof value === 'string' ? value : null;
    }
    if (!renderer) {
      const value = gl.getParameter(gl.RENDERER);
      renderer = typeof value === 'string' ? value : null;
    }
  } catch {
    return { renderer: null, outlineCompatible: true };
  }
  return {
    renderer,
    outlineCompatible: classifyOutlineCompatibility(renderer),
  };
}

/**
 * Pure classifier — exported for test injection paths that bypass the
 * canvas probe by feeding a known renderer string.
 */
export function classifyOutlineCompatibility(renderer: string | null): boolean {
  if (!renderer) return true;
  const lower = renderer.toLowerCase();
  for (const fragment of OUTLINE_INCOMPATIBLE_RENDERER_FRAGMENTS) {
    if (lower.includes(fragment)) return false;
  }
  return true;
}

// @nimi-authority: rule.nimi.avatar.embodiment.r061
/**
 * Construct an MToon material loader plugin instance for use as the
 * `mtoonMaterialPlugin` option of `VRMLoaderPlugin`. Outline rendering is
 * enabled by default. On GPUs identified as outline-incompatible we
 * neutralise outline by setting `renderOrderOffset = 0` and post-hooking
 * `afterRoot` to zero out per-material `outlineWidthMultiplier` — meshes
 * fall back to the base MToon material rendering path.
 *
 * The returned instance can be used by `loader.register((parser) =>
 *   new VRMLoaderPlugin(parser, { mtoonMaterialPlugin: createMToonMaterialLoaderPlugin(parser) }))`.
 */
export function createMToonMaterialLoaderPlugin(
  parser: unknown,
  options?: MToonMaterialLoaderPluginOptions,
  // Test seam: allow callers to inject the renderer probe result. When
  // unset, the cached probe via `detectOutlineCompatibility` is used.
  probeOverride?: RendererProbe,
): MToonMaterialLoaderPlugin {
  const probe = probeOverride ?? detectOutlineCompatibility();
  const plugin = new MToonMaterialLoaderPlugin(
    parser as ConstructorParameters<typeof MToonMaterialLoaderPlugin>[0],
    options,
  );
  if (probe.outlineCompatible) {
    return plugin;
  }
  // Outline-incompatible path: emit a one-time info log with a stable
  // structured reason code so downstream diagnostics surfaces can pick it
  // up. We deliberately log via `console.info` (not `warn`) — outline-off
  // is a documented graceful fallback per §7.1.
  console.info('[vrm.mtoon]', {
    event: 'mtoon_outline_disabled',
    renderer: probe.renderer,
  });
  // Wrap afterRoot so that, after the official plugin has built materials,
  // we walk gltf.userData.vrmMToonMaterials and zero out outlineWidth*.
  // We do not subclass — we monkey-bind because MToonMaterialLoaderPlugin
  // constructor already executed.
  const originalAfterRoot = plugin.afterRoot.bind(plugin);
  plugin.afterRoot = async (gltf: unknown): Promise<void> => {
    await originalAfterRoot(gltf as Parameters<typeof originalAfterRoot>[0]);
    const userData = (gltf as { userData?: Record<string, unknown> }).userData;
    const materials = userData?.['vrmMToonMaterials'];
    if (!Array.isArray(materials)) return;
    for (const material of materials) {
      if (!material || typeof material !== 'object') continue;
      const mat = material as Record<string, unknown>;
      // MToonMaterial outline knobs (per @pixiv/three-vrm-materials-mtoon
      // surface). Zeroing width multiplier collapses outline geometry to
      // nothing; the base material path renders unchanged.
      if ('outlineWidthMultiplyTexture' in mat) {
        mat['outlineWidthMultiplyTexture'] = null;
      }
      mat['outlineWidthFactor'] = 0;
      mat['outlineLightingMixFactor'] = 0;
    }
  };
  return plugin;
}
