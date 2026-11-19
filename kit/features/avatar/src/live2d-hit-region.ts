// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// The static region has no model evidence. Mounted carriers supply current
// geometry for coarse capture, and a readable one-pixel alpha sample for
// precise pointer decisions.

import type { BackendHitRegion } from './backend-branch.js';
import type { Live2DCompatibilityReport } from './live2d-compatibility.js';

/** Local alpha-mask threshold: pixels with alpha < 10/255 are transparent for
 * hit-test purposes under rule.nimi.avatar.embodiment.r004. */
export const LIVE2D_ALPHA_MASK_THRESHOLD = 10 / 255;

/** Byte-equivalent of {@link LIVE2D_ALPHA_MASK_THRESHOLD}. Used inside
 *  the probe because the gl.readPixels output is a UNSIGNED_BYTE
 *  [0, 255]. */
export const LIVE2D_ALPHA_MASK_THRESHOLD_BYTE = 10;

/** Before a model has rendered there is no known body or drag target. */
export const LIVE2D_DEFAULT_HIT_REGION: BackendHitRegion = Object.freeze({
  body: Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 }),
  drag: Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 }),
  isOpaqueAtClientPoint: null,
});

export type Live2DHitRegionInput = {
  compatibility?: Live2DCompatibilityReport | null;
};

const ZERO_REGION: BackendHitRegion = Object.freeze({
  body: { left: 0, top: 0, right: 0, bottom: 0 },
  drag: { left: 0, top: 0, right: 0, bottom: 0 },
  isOpaqueAtClientPoint: null,
});

const FULL_VIEWPORT_RECT: BackendHitRegion['body'] = Object.freeze({
  left: 0,
  top: 0,
  right: 1,
  bottom: 1,
});

export function computeLive2DHitRegion(
  input: Live2DHitRegionInput = {},
): BackendHitRegion {
  const adapter = input.compatibility?.adapter ?? null;
  const hitRegions = adapter?.semantics?.hit_regions;
  const fallback = hitRegions?.fallback ?? 'alpha_mask_only';
  if (fallback === 'fail_closed' && hitRegions?.disposition?.status !== 'supported') {
    return ZERO_REGION;
  }
  return LIVE2D_DEFAULT_HIT_REGION;
}

// ---------------------------------------------------------------------------
// Wave 4 chunk 4-B: alpha-mask isOpaqueAtClientPoint factory
// ---------------------------------------------------------------------------

export type Live2DHitRegionDegradedDetail = {
  reason_code: 'device_tier_c';
  /** ISO-8601 timestamp captured at the moment degradation was decided. */
  recordedAt: string;
};

export type Live2DHitRegionDeviceTier = 'A' | 'B' | 'C';

export type CreateLive2DHitRegionInputs = {
  /** Returns the live2d cubism canvas element (or null if not mounted). */
  getBodyBounds?: () => BackendHitRegion['body'] | null;
  getCanvas: () => HTMLCanvasElement | null;
  /** Returns the canvas's bounding client rect (left/top in window
   *  coords; width/height in CSS pixels). */
  getViewport: () => {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null;
  /** Device tier projection supplied by the app shell. Defaults to C so
   *  callers fail closed to bbox-only when the tier is unavailable. */
  deviceTier?: Live2DHitRegionDeviceTier;
  /** Fires once per `createLive2DHitRegion` call when the degraded path
   *  is taken (tier C). Lets the carrier surface emit
   *  `avatar.hit_region.degraded` evidence upstream. */
  onDegraded?: (detail: Live2DHitRegionDegradedDetail) => void;
};

function nowIsoString(): string {
  return new Date().toISOString();
}

/** Read pixel alpha at the given canvas-pixel coordinate via the gl
 *  context bound on the cubism canvas. 1×1 readback only — full-canvas
 *  reads are forbidden by the app-shell contract. Returns
 *  null on probe failure (no gl context, readPixels throw).
 *
 *  NOTE on concurrent renders: cubism's render() may be in flight when
 *  this is called; reading pixels right after the visible render
 *  captures the most recent frame. A small race is acceptable per the
 *  per-frame budget. */
function readAlphaByteFromCanvas(
  canvas: HTMLCanvasElement,
  canvasX: number,
  canvasY: number,
): number | null {
  let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  try {
    gl =
      (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
  } catch {
    return null;
  }
  if (gl == null || gl.isContextLost?.()) return null;
  // On a non-preserved context, outside the
  // renderer's own frame callback the default framebuffer may already be
  // invalidated, so a zero alpha sample is not evidence of transparency.
  // Report precision as unavailable and let the bounded body rectangle own
  // hit-testing until the renderer supplies a current-frame alpha target.
  const contextAttributes = typeof gl.getContextAttributes === 'function'
    ? gl.getContextAttributes()
    : null;
  if (contextAttributes?.preserveDrawingBuffer === false) return null;
  try {
    const pixels = new Uint8Array(4);
    gl.readPixels(canvasX, canvasY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels[3] ?? 0;
  } catch {
    return null;
  }
}

/**
 * Build a `BackendHitRegion` for the Live2D backend with alpha-mask
 * support.
 *
 * On tier A or B → `isOpaqueAtClientPoint` is a real function that
 * reads pixel alpha from the cubism canvas via 1×1 `gl.readPixels` and
 * compares against the (overridable) alpha-mask threshold.
 *
 * On tier C → `isOpaqueAtClientPoint` is `null`, indicating bbox-only;
 * `onDegraded` fires once at construction time with
 * `reason_code: 'device_tier_c'`.
 */
export function createLive2DHitRegion(
  input: CreateLive2DHitRegionInputs,
): BackendHitRegion {
  const tier = input.deviceTier ?? 'C';

  if (tier === 'C') {
    input.onDegraded?.({
      reason_code: 'device_tier_c',
      recordedAt: nowIsoString(),
    });
    return {
      get body() { return input.getBodyBounds?.() ?? ZERO_REGION.body; },
      drag: ZERO_REGION.drag,
      isOpaqueAtClientPoint: null,
    };
  }

  const { getCanvas, getViewport } = input;

  const isOpaqueAtClientPoint = (
    clientX: number,
    clientY: number,
    threshold?: number,
  ): boolean | null => {
    const canvas = getCanvas();
    if (canvas == null) return null;
    const viewport = getViewport();
    if (viewport == null) return null;
    if (viewport.width <= 0 || viewport.height <= 0) return null;
    // Map client coord → viewport-relative [0, 1] → canvas pixel.
    const relX = (clientX - viewport.left) / viewport.width;
    const relYTop = (clientY - viewport.top) / viewport.height;
    if (relX < 0 || relX >= 1 || relYTop < 0 || relYTop >= 1) return false;
    const canvasW = canvas.width;
    const canvasH = canvas.height;
    if (canvasW <= 0 || canvasH <= 0) return null;
    const canvasX = Math.min(
      canvasW - 1,
      Math.max(0, Math.floor(relX * canvasW)),
    );
    const canvasYTopLeft = Math.min(
      canvasH - 1,
      Math.max(0, Math.floor(relYTop * canvasH)),
    );
    // gl.readPixels Y origin is bottom-left; flip from window top-left.
    const canvasY = canvasH - 1 - canvasYTopLeft;
    const alphaByte = readAlphaByteFromCanvas(canvas, canvasX, canvasY);
    if (alphaByte == null) return null;
    const effectiveThreshold = threshold ?? LIVE2D_ALPHA_MASK_THRESHOLD;
    const thresholdByte = effectiveThreshold * 255;
    return alphaByte > thresholdByte;
  };

  return {
    get body() { return input.getBodyBounds?.() ?? ZERO_REGION.body; },
    drag: FULL_VIEWPORT_RECT,
    isOpaqueAtClientPoint,
  };
}
