// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Per-device tier detector for local Avatar carrier performance policy:
//
//   Tier A — M-series Apple Silicon (M1+) → full alpha-mask + bbox + 60Hz
//   Tier B — Intel macOS / Win 11 / Linux Wayland integrated GPU → full
//            alpha-mask + bbox + 60Hz; outline policy decided per GPU
//   Tier C — older devices / capability detection failure / pointermove
//            > 60Hz hardware fallback → bbox-only; alpha-mask not invoked;
//            emits `avatar.hit_region.degraded { reason_code:
//            'device_tier_c' }` upstream (chunk 4-B wires the emission)
//
// Detection is one-shot at avatar boot and cached. Subsequent calls
// return the cached result; HMR / tests can clear the cache via
// `clearDeviceTierCache()`. The detector probes a throwaway `<canvas>`
// in the same shape as `vrm-mtoon-outline-policy.ts` (chunk 2-B): it
// reads `WEBGL_debug_renderer_info.UNMASKED_RENDERER_WEBGL` when the
// extension is available and falls back to plain `gl.RENDERER`. The
// algorithm is intentionally identical to the MToon outline policy
// probe — but we do NOT import from there (zero coupling so tier
// classification can evolve independently, e.g. add benchmark-based
// tiering without forcing outline-policy changes).

const APPLE_GPU_FRAGMENTS: readonly string[] = [
  'apple gpu',
  'apple m',
  'm1',
  'm2',
  'm3',
  'm4',
];

const SOFTWARE_FALLBACK_FRAGMENTS: readonly string[] = [
  'swiftshader',
  'llvmpipe',
  'software',
];

export type DeviceTier = 'A' | 'B' | 'C';

export type DeviceTierDetection = {
  tier: DeviceTier;
  /** Reason / evidence for the classification decision. Stable string
   *  suitable for evidence emission (e.g. `device_tier_c`). */
  reason: string;
  /** Captured at detection time; written once at avatar boot. */
  detectedAtMs: number;
  /** Renderer string (from `gl.RENDERER` / `UNMASKED_RENDERER_WEBGL`)
   *  or null if WebGL was unavailable / probe threw. */
  rendererString: string | null;
  /** Whether real WebGL was available during detection. */
  webglAvailable: boolean;
};

export type DetectDeviceTierInputs = {
  /** Test seam: provide a mock renderer string + webgl availability flag.
   *  Default: probe a real canvas + getContext. */
  probeOverride?: { rendererString: string | null; webglAvailable: boolean };
};

let cache: DeviceTierDetection | null = null;

/**
 * Run device-tier detection. The first call probes; subsequent calls
 * return the cached value (unless `probeOverride` is supplied, in which
 * case we always recompute against the override and write to the cache).
 */
export function detectDeviceTier(
  input: DetectDeviceTierInputs = {},
): DeviceTierDetection {
  if (input.probeOverride !== undefined) {
    const detection = classify(
      input.probeOverride.rendererString,
      input.probeOverride.webglAvailable,
    );
    cache = detection;
    return detection;
  }
  if (cache != null) return cache;
  const probed = probeRenderer();
  const detection = classify(probed.rendererString, probed.webglAvailable);
  cache = detection;
  return detection;
}

/** Module-level cache accessor. Returns null if detection has not yet
 *  run in this session. */
export function getCachedDeviceTier(): DeviceTierDetection | null {
  return cache;
}

/** Clear the cached detection. Used by HMR + tests. */
export function clearDeviceTierCache(): void {
  cache = null;
}

// ---------------------------------------------------------------------------
// Classification + probe
// ---------------------------------------------------------------------------

function classify(
  rendererString: string | null,
  webglAvailable: boolean,
): DeviceTierDetection {
  const detectedAtMs = nowMs();
  if (typeof window === 'undefined') {
    return {
      tier: 'C',
      reason: 'ssr_no_window',
      detectedAtMs,
      rendererString: null,
      webglAvailable: false,
    };
  }
  if (!webglAvailable) {
    return {
      tier: 'C',
      reason: 'webgl_unavailable',
      detectedAtMs,
      rendererString,
      webglAvailable: false,
    };
  }
  const lower = rendererString != null ? rendererString.toLowerCase() : null;
  if (lower != null) {
    for (const frag of SOFTWARE_FALLBACK_FRAGMENTS) {
      if (lower.includes(frag)) {
        return {
          tier: 'C',
          reason: 'software_fallback',
          detectedAtMs,
          rendererString,
          webglAvailable: true,
        };
      }
    }
    for (const frag of APPLE_GPU_FRAGMENTS) {
      if (lower.includes(frag)) {
        return {
          tier: 'A',
          reason: 'apple_silicon',
          detectedAtMs,
          rendererString,
          webglAvailable: true,
        };
      }
    }
    return {
      tier: 'B',
      reason: 'real_gpu',
      detectedAtMs,
      rendererString,
      webglAvailable: true,
    };
  }
  // WebGL is available but the renderer string was unreadable. We
  // classify as Tier C — capability detection failure per §2.3.2.
  return {
    tier: 'C',
    reason: 'renderer_string_unavailable',
    detectedAtMs,
    rendererString: null,
    webglAvailable: true,
  };
}

function probeRenderer(): {
  rendererString: string | null;
  webglAvailable: boolean;
} {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { rendererString: null, webglAvailable: false };
  }
  let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  try {
    const probeCanvas = document.createElement('canvas');
    gl =
      (probeCanvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
      (probeCanvas.getContext('webgl') as WebGLRenderingContext | null);
  } catch {
    return { rendererString: null, webglAvailable: false };
  }
  if (gl == null) {
    return { rendererString: null, webglAvailable: false };
  }
  let rendererString: string | null = null;
  try {
    const debugExt = gl.getExtension('WEBGL_debug_renderer_info') as
      | { UNMASKED_RENDERER_WEBGL: number }
      | null;
    if (debugExt) {
      const value = gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL);
      rendererString = typeof value === 'string' ? value : null;
    }
    if (rendererString == null) {
      const value = gl.getParameter(gl.RENDERER);
      rendererString = typeof value === 'string' ? value : null;
    }
  } catch {
    rendererString = null;
  }
  return { rendererString, webglAvailable: true };
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
