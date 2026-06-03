// Wave 4 chunk 4-B of topic 2026-04-30-avatar-vrm-backend-branch.
//
// VRM `BackendHitRegion` factory. Wires the alpha-mask probe path on
// device tiers A/B (returns a real `isOpaqueAtClientPoint` backed by
// `vrm-render-target` chunk 4-A) and degrades to bbox-only on tier C
// (returns `isOpaqueAtClientPoint = null` and fires `onDegraded` once
// with `reason_code: 'device_tier_c'`).
//
// Spec authorities:
//   - .nimi/spec/avatar/kernel/app-shell-contract.md §2.3.1
//     (alpha-mask threshold = 10/255; alpha-mask precedes bbox; null
//      `isOpaqueAtClientPoint` indicates device tier C / not-supported)
//   - .nimi/spec/avatar/kernel/backend-branch-contract.md §BackendHitRegion
//
// Alpha-mask threshold is centralized as a NAMED constant per packet
// acceptance_invariant 13: drift audits forbid scattered float / byte
// literals in the function body. Tests verify the constant is exported.
//
// Per packet forbidden_shortcuts: only 1×1 readPixels is permitted; the
// underlying `vrm-render-target.probeAlphaAtClient` honors that. This
// file does not perform any pixel reads itself.

import type { BackendHitRegion } from './backend-branch.js';

/** Alpha-mask threshold: pixels with alpha < 10/255 are treated as
 *  transparent for hit-test purposes. Source: app-shell-contract.md
 *  §2.3.1; airi industrial baseline. */
export const VRM_ALPHA_MASK_THRESHOLD = 10 / 255;

/** Byte-equivalent of {@link VRM_ALPHA_MASK_THRESHOLD}. Used inside the
 *  probe because `VrmRenderTarget.probeAlphaAtClient` returns a byte
 *  value [0, 255]. */
export const VRM_ALPHA_MASK_THRESHOLD_BYTE = 10;

export type VrmHitRegionDegradedDetail = {
  reason_code: 'device_tier_c';
  /** ISO-8601 timestamp captured at the moment degradation was decided. */
  recordedAt: string;
};

export type VrmHitRegionDeviceTier = 'A' | 'B' | 'C';

export type VrmHitRegionRenderTarget = {
  probeAlphaAtClient(input: {
    clientX: number;
    clientY: number;
    viewport: {
      left: number;
      top: number;
      width: number;
      height: number;
    };
  }): number | null;
};

export type CreateVrmHitRegionInputs = {
  /** Render target from chunk 4-A. The factory holds the reference and
   *  the returned `isOpaqueAtClientPoint` invokes
   *  `renderTarget.probeAlphaAtClient` on each call. */
  renderTarget: VrmHitRegionRenderTarget;
  /** Returns the on-screen rect of the avatar canvas (left/top in
   *  window coords; width/height in CSS pixels). The surface caller
   *  wires this — typically a closure that reads
   *  `canvasRef.current?.getBoundingClientRect()`. Returns null when
   *  the canvas is not mounted; the probe then resolves to false. */
  getViewport: () => {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null;
  /** Device tier projection supplied by the app shell. Defaults to C so
   *  callers fail closed to bbox-only when the tier is unavailable. */
  deviceTier?: VrmHitRegionDeviceTier;
  /** Fires once per `createVrmHitRegion` call when the degraded path
   *  is taken (tier C). Lets the carrier surface emit
   *  `avatar.hit_region.degraded` evidence upstream. */
  onDegraded?: (detail: VrmHitRegionDegradedDetail) => void;
};

/** Static body / drag bbox: full-canvas viewport. The alpha-mask
 *  probe is the primary hit path on tiers A/B; bbox is the tier-C
 *  fallback. Per-frame bbox snapshot updates are chunk 4-C's
 *  territory (embodiment-stage drives a throttled
 *  `onHitRegionChange`). */
const FULL_VIEWPORT_RECT: BackendHitRegion['body'] = Object.freeze({
  left: 0,
  top: 0,
  right: 1,
  bottom: 1,
});

function nowIsoString(): string {
  return new Date().toISOString();
}

/**
 * Build a `BackendHitRegion` for the VRM backend.
 *
 * On tier A or B → `isOpaqueAtClientPoint` is a real function that maps
 * `(clientX, clientY, threshold?)` to a boolean by calling
 * `renderTarget.probeAlphaAtClient` and comparing against the
 * (overridable) alpha-mask threshold.
 *
 * On tier C → `isOpaqueAtClientPoint` is `null`, indicating bbox-only;
 * `onDegraded` fires once at construction time with
 * `reason_code: 'device_tier_c'`.
 */
export function createVrmHitRegion(
  input: CreateVrmHitRegionInputs,
): BackendHitRegion {
  const tier = input.deviceTier ?? 'C';

  if (tier === 'C') {
    input.onDegraded?.({
      reason_code: 'device_tier_c',
      recordedAt: nowIsoString(),
    });
    return {
      body: FULL_VIEWPORT_RECT,
      drag: FULL_VIEWPORT_RECT,
      isOpaqueAtClientPoint: null,
    };
  }

  const { renderTarget, getViewport } = input;

  const isOpaqueAtClientPoint = (
    clientX: number,
    clientY: number,
    threshold?: number,
  ): boolean => {
    const viewport = getViewport();
    if (viewport == null) return false;
    if (viewport.width <= 0 || viewport.height <= 0) return false;
    const alphaByte = renderTarget.probeAlphaAtClient({
      clientX,
      clientY,
      viewport,
    });
    if (alphaByte == null) return false;
    const effectiveThreshold = threshold ?? VRM_ALPHA_MASK_THRESHOLD;
    const thresholdByte = effectiveThreshold * 255;
    return alphaByte > thresholdByte;
  };

  return {
    body: FULL_VIEWPORT_RECT,
    drag: FULL_VIEWPORT_RECT,
    isOpaqueAtClientPoint,
  };
}
