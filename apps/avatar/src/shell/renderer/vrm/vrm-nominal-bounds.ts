// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Derives the shared `BackendNominalBounds` carrier shape from a loaded
// VRM scene + framing intent. Replaces the static placeholder previously
// hard-coded in `vrm-backend.tsx`. The default (vrm == null / pre-load)
// matches the policy admitted in
// `config/avatar-window-bounds-policy.yaml`
// `backends.vrm` — 360 × 720 with `bottom-companion` framing intent
// (waist-up, narrow tall window).
//
// `nominalBounds` on `BackendBranch` is a static r003 field; it carries the
// bounded bootstrap fallback used
// by `embodiment-stage` for the very first window-resize tick. The
// post-load logical window truth flows through `onSurfaceBoundsChange`, while
// viewport-projected body/drag geometry flows independently through
// `onHitRegionChange`. The canonical fallback is 360x720 with a
// `bottom-companion` default.

import type { VRM } from '@pixiv/three-vrm';
import type {
  BackendHitRegion,
  BackendNominalBounds,
} from '@nimiplatform/kit/features/avatar/headless';
import type { VrmFramingIntent } from './vrm-framing.js';
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
 * Default nominal bounds. Source: window-bounds-policy.yaml
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

export type DeriveVrmLogicalWindowBoundsInputs = {
  /** null at boot before VRM is ready; falls back to VRM_DEFAULT_NOMINAL_BOUNDS. */
  vrm: VRM | null;
  /** Default 'bottom-companion' per window-bounds-policy.yaml. */
  intent: VrmFramingIntent;
};

export type DeriveVrmProjectedHitGeometryInputs = DeriveVrmLogicalWindowBoundsInputs & {
  /** Current viewport width / height. Used only for projected hit geometry. */
  aspect: number;
};

export type VrmLogicalWindowGeometry = Readonly<{
  bounds: BackendNominalBounds;
  source: 'scene_geometry' | 'configured_fallback';
  reasonCode: 'scene_geometry_unavailable' | null;
}>;

export type VrmProjectedHitGeometry = Readonly<{
  body: BackendHitRegion['body'];
  drag: BackendHitRegion['drag'];
  source: 'scene_geometry' | 'configured_fallback';
  reasonCode: 'scene_geometry_unavailable' | null;
}>;

export const VRM_INVALID_HIT_REGION_RECT: BackendHitRegion['body'] = Object.freeze({
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
});

/** Logical Avatar window aspect. It must never be replaced with the current
 *  native window aspect, otherwise set_size feeds its own output back into
 *  the next nominal-bounds derivation. */
export const VRM_LOGICAL_WINDOW_ASPECT = 0.45;

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

// @nimi-authority: rule.nimi.avatar.embodiment.r059
/**
 * Derive `BackendNominalBounds` from a VRM scene + framing intent.
 *
 * If `vrm == null` (pre-load) or the scene bbox cannot be computed,
 * returns `VRM_DEFAULT_NOMINAL_BOUNDS` directly. Otherwise computes
 * `framedHeight × VRM_NOMINAL_PX_PER_WORLD_UNIT` and applies the
 * sanity clamp.
 */
export function deriveVrmNominalBounds(
  inputs: DeriveVrmLogicalWindowBoundsInputs,
): BackendNominalBounds {
  return deriveVrmLogicalWindowGeometry(inputs).bounds;
}

// @nimi-authority: rule.nimi.avatar.embodiment.r059
export function deriveVrmLogicalWindowGeometry(
  inputs: DeriveVrmLogicalWindowBoundsInputs,
): VrmLogicalWindowGeometry {
  const { vrm, intent } = inputs;
  if (vrm === null) {
    return configuredFallbackWindowGeometry();
  }
  let framing: ReturnType<typeof applyVrmFraming>;
  try {
    framing = applyVrmFraming({
      vrm,
      intent,
      aspect: VRM_LOGICAL_WINDOW_ASPECT,
    });
  } catch {
    return configuredFallbackWindowGeometry();
  }
  const values = [
    framing.framedHeight,
    framing.framedWidth,
    framing.cameraLookAt.x,
    framing.cameraLookAt.y,
    framing.sceneBboxMin.x,
    framing.sceneBboxMin.y,
    framing.sceneBboxMax.x,
    framing.sceneBboxMax.y,
  ];
  if (values.some((value) => !Number.isFinite(value))
    || framing.framedHeight <= 0
    || framing.framedWidth <= 0
    || framing.sceneBboxMax.x <= framing.sceneBboxMin.x
    || framing.sceneBboxMax.y <= framing.sceneBboxMin.y) {
    return configuredFallbackWindowGeometry();
  }
  const rawWidth = framing.framedWidth * VRM_NOMINAL_PX_PER_WORLD_UNIT;
  const rawHeight = framing.framedHeight * VRM_NOMINAL_PX_PER_WORLD_UNIT;
  const width = clamp(rawWidth, VRM_NOMINAL_BOUNDS_MIN_WIDTH, VRM_NOMINAL_BOUNDS_MAX_WIDTH);
  const height = clamp(
    rawHeight,
    VRM_NOMINAL_BOUNDS_MIN_HEIGHT,
    VRM_NOMINAL_BOUNDS_MAX_HEIGHT,
  );
  const bounds = Object.freeze({
    width,
    height,
    bodyCenterX: 0.5,
    bodyCenterY: bodyCenterYForIntent(intent),
  });
  return Object.freeze({
    bounds,
    source: 'scene_geometry',
    reasonCode: null,
  });
}

// @nimi-authority: rule.nimi.avatar.embodiment.r062
export function deriveVrmProjectedHitGeometry(
  inputs: DeriveVrmProjectedHitGeometryInputs,
): VrmProjectedHitGeometry {
  const { vrm, intent, aspect } = inputs;
  if (vrm === null) return configuredFallbackProjectedHitGeometry();
  let framing: ReturnType<typeof applyVrmFraming>;
  try {
    framing = applyVrmFraming({ vrm, intent, aspect });
  } catch {
    return configuredFallbackProjectedHitGeometry();
  }
  const values = [
    framing.framedHeight,
    framing.framedWidth,
    framing.cameraLookAt.x,
    framing.cameraLookAt.y,
    framing.sceneBboxMin.x,
    framing.sceneBboxMin.y,
    framing.sceneBboxMax.x,
    framing.sceneBboxMax.y,
  ];
  if (values.some((value) => !Number.isFinite(value))
    || framing.framedHeight <= 0
    || framing.framedWidth <= 0
    || framing.sceneBboxMax.x <= framing.sceneBboxMin.x
    || framing.sceneBboxMax.y <= framing.sceneBboxMin.y) {
    return configuredFallbackProjectedHitGeometry();
  }
  const viewportLeft = framing.cameraLookAt.x - framing.framedWidth / 2;
  const viewportBottom = framing.cameraLookAt.y - framing.framedHeight / 2;
  const body = Object.freeze({
    left: clamp((framing.sceneBboxMin.x - viewportLeft) / framing.framedWidth, 0, 1),
    top: clamp(1 - ((framing.sceneBboxMax.y - viewportBottom) / framing.framedHeight), 0, 1),
    right: clamp((framing.sceneBboxMax.x - viewportLeft) / framing.framedWidth, 0, 1),
    bottom: clamp(1 - ((framing.sceneBboxMin.y - viewportBottom) / framing.framedHeight), 0, 1),
  });
  if (body.right <= body.left || body.bottom <= body.top) {
    return configuredFallbackProjectedHitGeometry();
  }
  return Object.freeze({
    body,
    drag: body,
    source: 'scene_geometry',
    reasonCode: null,
  });
}

function configuredFallbackWindowGeometry(): VrmLogicalWindowGeometry {
  return Object.freeze({
    bounds: VRM_DEFAULT_NOMINAL_BOUNDS,
    source: 'configured_fallback',
    reasonCode: 'scene_geometry_unavailable',
  });
}

function configuredFallbackProjectedHitGeometry(): VrmProjectedHitGeometry {
  return Object.freeze({
    body: VRM_INVALID_HIT_REGION_RECT,
    drag: VRM_INVALID_HIT_REGION_RECT,
    source: 'configured_fallback',
    reasonCode: 'scene_geometry_unavailable',
  });
}
