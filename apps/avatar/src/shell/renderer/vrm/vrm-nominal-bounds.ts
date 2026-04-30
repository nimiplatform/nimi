// Wave 2 chunk 2-E of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Derives `BackendNominalBounds` (carrier/backend-branch.ts) from a loaded
// VRM scene + framing intent. Replaces the static placeholder previously
// hard-coded in `vrm-backend.tsx`. The default (vrm == null / pre-load)
// matches the policy admitted in
// `apps/avatar/spec/kernel/tables/window-bounds-policy.yaml`
// `backends.vrm` — 360 × 720 with `bottom-companion` framing intent
// (waist-up, narrow tall window).
//
// `nominalBounds` on `BackendBranch` is a STATIC field per
// `backend-branch-contract.md` §2.9; it carries the BOOT placeholder used
// by `embodiment-stage` for the very first window-resize tick. The
// post-load truth flows through the per-frame `onHitRegionChange` payload
// (which embodiment-stage maps to `set_size` if the alpha bounding box
// shrinks). Wave_2 acceptance_invariant 13 only requires:
//   1. this file exists,
//   2. the fallback is 360x720 with `bottom-companion` default,
//   3. the function is callable on a loaded VRM and returns derived bounds.
//
// Future wave_4+ work may switch to dynamic per-frame nominal bounds via
// a contract evolution — out of scope here.

import type { VRM } from '@pixiv/three-vrm';
import type { BackendNominalBounds } from '../carrier/backend-branch.js';
import type { VrmFramingIntent } from './domain/vrm-framing-domain.js';
import { applyVrmFraming } from './vrm-framing.js';

/**
 * Conversion factor from world-units (Three.js scene space; VRM models
 * use 1 unit ≈ 1 metre) to physical pixels for nominalBounds. A 1.7 m
 * character framed by `bottom-companion` (= 0.55 of total height ≈ 0.94 m)
 * therefore maps to 0.94 × 280 ≈ 263 px height; full-body framing
 * (1.1 × 1.7 ≈ 1.87 m) maps to ~524 px height. Combined with the sanity
 * clamp below this gives a reasonable companion-window envelope across
 * intents without per-window calibration.
 *
 * 280 was picked empirically for the avatar's tall-narrow companion
 * window (aspect ≈ 0.45). Exported so tests can assert the contract.
 */
export const VRM_NOMINAL_PX_PER_WORLD_UNIT = 280;

/** Sanity clamps so a misbehaving model can't drive the window absurdly large or small. */
export const VRM_NOMINAL_BOUNDS_MIN_WIDTH = 320;
export const VRM_NOMINAL_BOUNDS_MAX_WIDTH = 600;
export const VRM_NOMINAL_BOUNDS_MIN_HEIGHT = 480;
export const VRM_NOMINAL_BOUNDS_MAX_HEIGHT = 960;

/**
 * Wave_2 default nominal bounds. Source: window-bounds-policy.yaml
 * `backends.vrm` (360 × 720, framing_intent_default=bottom-companion,
 * aspect_default=0.45). `bodyCenterY = 0.55` mirrors the bottom-companion
 * intent (waist-up framing places the body center slightly above
 * viewport mid-line).
 */
export const VRM_DEFAULT_NOMINAL_BOUNDS: Readonly<BackendNominalBounds> = Object.freeze({
  width: 360,
  height: 720,
  bodyCenterX: 0.5,
  bodyCenterY: 0.55,
});

export type DeriveNominalBoundsInputs = {
  /** null at boot before VRM is ready; falls back to VRM_DEFAULT_NOMINAL_BOUNDS. */
  vrm: VRM | null;
  /** Default 'bottom-companion' per window-bounds-policy.yaml. */
  intent: VrmFramingIntent;
  /** Default 0.45 per window-bounds-policy.yaml. */
  aspect: number;
};

/**
 * Body-center Y depends on framing intent. Higher value means the body
 * center sits closer to the bottom of the viewport (because Y is inverted
 * in viewport-normalized 0..1 from top).
 *
 * - full-body: 0.5 — body fits viewport, center is mid-screen.
 * - bottom-companion: 0.55 — waist-up framing, body slightly below middle.
 * - head-shoulders: 0.7 — chest-up framing, body well below middle.
 */
function bodyCenterYForIntent(intent: VrmFramingIntent): number {
  switch (intent) {
    case 'full-body':
      return 0.5;
    case 'bottom-companion':
      return 0.55;
    case 'head-shoulders':
      return 0.7;
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Derive `BackendNominalBounds` from a VRM scene + framing intent.
 *
 * If `vrm == null` (pre-load) or the scene bbox cannot be computed,
 * returns `VRM_DEFAULT_NOMINAL_BOUNDS` directly. Otherwise computes
 * `framedHeight × VRM_NOMINAL_PX_PER_WORLD_UNIT` and applies the
 * sanity clamp.
 */
export function deriveVrmNominalBounds(
  inputs: DeriveNominalBoundsInputs,
): BackendNominalBounds {
  const { vrm, intent, aspect } = inputs;
  if (vrm === null) {
    return VRM_DEFAULT_NOMINAL_BOUNDS;
  }
  let framedHeight: number;
  let framedWidth: number;
  try {
    const result = applyVrmFraming({ vrm, intent, aspect });
    framedHeight = result.framedHeight;
    framedWidth = result.framedWidth;
  } catch {
    return VRM_DEFAULT_NOMINAL_BOUNDS;
  }
  // Defensive: a degenerate scene (zero-size bbox) collapses to default.
  if (
    !Number.isFinite(framedHeight) ||
    !Number.isFinite(framedWidth) ||
    framedHeight <= 0 ||
    framedWidth <= 0
  ) {
    return VRM_DEFAULT_NOMINAL_BOUNDS;
  }
  const rawWidth = framedWidth * VRM_NOMINAL_PX_PER_WORLD_UNIT;
  const rawHeight = framedHeight * VRM_NOMINAL_PX_PER_WORLD_UNIT;
  const width = clamp(rawWidth, VRM_NOMINAL_BOUNDS_MIN_WIDTH, VRM_NOMINAL_BOUNDS_MAX_WIDTH);
  const height = clamp(
    rawHeight,
    VRM_NOMINAL_BOUNDS_MIN_HEIGHT,
    VRM_NOMINAL_BOUNDS_MAX_HEIGHT,
  );
  return Object.freeze({
    width,
    height,
    bodyCenterX: 0.5,
    bodyCenterY: bodyCenterYForIntent(intent),
  });
}
