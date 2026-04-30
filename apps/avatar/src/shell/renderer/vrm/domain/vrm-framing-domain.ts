// Wave 2 chunk 2-A of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Pure-function camera framing domain for the VRM backend. ZERO Three.js
// imports — operates on plain numeric vectors so it can be unit-tested
// without a renderer and reused by both the R3F surface (chunk 2-C) and
// the nominalBounds derivation (chunk 2-B).
//
// Algorithm reference: airi `composables/vrm/framing` (MIT). This file
// is an independent rewrite; see apps/avatar/AGENTS.md "External
// Reference" section for the borrowing accounting.
//
// Per vrm-backend-contract.md §4 (NAV-VRM-005):
//   - `bottom-companion` is the avatar default (waist-up framing)
//   - `full-body` is for idle / motion-preview at full body scale
//   - `head-shoulders` is the closest framing for speaking emphasis
// All intents share fov=30°. framedHeight × aspect = framedWidth (the
// nominalBounds derivation collapses framedHeight + aspect into width
// and height in physical pixels downstream).

export type VrmFramingIntent = 'full-body' | 'bottom-companion' | 'head-shoulders';

export type Vec3Plain = { x: number; y: number; z: number };

export type VrmFramingInputs = {
  sceneBboxMin: Vec3Plain;
  sceneBboxMax: Vec3Plain;
  intent: VrmFramingIntent;
  /** viewport width / viewport height */
  aspect: number;
};

export type VrmFramingResult = {
  cameraPosition: Vec3Plain;
  cameraLookAt: Vec3Plain;
  /** field of view, degrees */
  cameraFov: number;
  /** world-units of the framed region (vertical extent) */
  framedHeight: number;
  /** = framedHeight * aspect */
  framedWidth: number;
  /** world-Y of the framed region center (== camera.y, lookAt.y) */
  framedCenterY: number;
};

const FOV_DEGREES = 30;
const FOV_RADIANS = (FOV_DEGREES * Math.PI) / 180;

/** Distance multiplier vs. theoretical exact-fit; > 1.0 leaves margin. */
const CAMERA_DISTANCE_FACTOR = 1.05;

const FULL_BODY_HEIGHT_MARGIN = 1.05; // 5% breathing room around the model

/** Per-intent vertical framing parameters. */
type IntentParams = {
  /** y position relative to bboxMin.y, expressed as a fraction of total height */
  cameraYOffsetRatio: number | 'center';
  /** framedHeight as a fraction of total height (camera's vertical viewport) */
  framedHeightRatio: number;
};

const INTENT_PARAMS: Record<VrmFramingIntent, IntentParams> = {
  'full-body': {
    cameraYOffsetRatio: 'center',
    framedHeightRatio: FULL_BODY_HEIGHT_MARGIN,
  },
  'bottom-companion': {
    // The avatar window is typically tall+narrow (aspect ≈ 0.4). Vertical
    // framing alone leaves character width clipped, so the algorithm
    // re-fits via aspect below — but the *intent* center is biased above
    // the bbox midpoint to keep the head and shoulders prominent rather
    // than centered like full-body.
    cameraYOffsetRatio: 0.55,
    framedHeightRatio: 1.0,
  },
  'head-shoulders': {
    cameraYOffsetRatio: 0.85, // chest-up
    framedHeightRatio: 0.3,
  },
};

/**
 * Compute camera position / lookAt / fov / framed bounds for a VRM scene.
 *
 * Pure function: identical inputs → identical numeric outputs. No
 * Three.js side effects.
 */
export function computeVrmFraming(inputs: VrmFramingInputs): VrmFramingResult {
  const { sceneBboxMin, sceneBboxMax, intent, aspect } = inputs;

  const totalHeight = sceneBboxMax.y - sceneBboxMin.y;
  // Box3.setFromObject reads the SkinnedMesh BIND-POSE bbox (T-pose),
  // not the current pose. After applyIdlePose lowers the arms, the bbox
  // still reports a full arm-span horizontally — making `totalWidth`
  // close to `totalHeight` for any humanoid VRM. Cap it at the typical
  // standing humanoid body width (~0.45 × height) so the horizontal-fit
  // floor below doesn't wreck framing on tall+narrow viewports.
  const HUMANOID_BODY_WIDTH_RATIO = 0.45;
  const rawTotalWidth = sceneBboxMax.x - sceneBboxMin.x;
  const totalWidth = Math.min(rawTotalWidth, totalHeight * HUMANOID_BODY_WIDTH_RATIO);
  const bboxCenterX = (sceneBboxMin.x + sceneBboxMax.x) / 2;
  const bboxCenterY = (sceneBboxMin.y + sceneBboxMax.y) / 2;
  const bboxCenterZ = (sceneBboxMin.z + sceneBboxMax.z) / 2;

  const params = INTENT_PARAMS[intent];

  const cameraY =
    params.cameraYOffsetRatio === 'center'
      ? bboxCenterY
      : sceneBboxMin.y + totalHeight * params.cameraYOffsetRatio;

  // The intent's vertical framing target is `intentFramedHeight`. The avatar
  // window is typically tall+narrow (aspect ≈ 0.4) — so a vertical-only fit
  // leaves the camera so far back that the character occupies a tiny stripe
  // in the middle of the viewport. Compute the framedHeight that would be
  // *required* to make the character's horizontal extent (with a small
  // safety margin) fill the horizontal viewport, and take the larger of
  // the two so that whichever axis is the binding constraint determines
  // the camera distance.
  const intentFramedHeight = totalHeight * params.framedHeightRatio;
  const HORIZONTAL_SAFETY = 1.05;
  const horizontalFitFramedHeight =
    aspect > 0 ? (totalWidth * HORIZONTAL_SAFETY) / aspect : intentFramedHeight;
  const framedHeight = Math.max(intentFramedHeight, horizontalFitFramedHeight);
  const framedWidth = framedHeight * aspect;

  // Distance such that the vertical FOV exactly contains
  // `CAMERA_DISTANCE_FACTOR × framedHeight` of world units.
  // Perspective camera vertical viewport at `d` is `2 × d × tan(fov/2)`,
  // so `d = factor × framedHeight / (2 × tan(fov/2))`. The factor of 2
  // was previously missing — that bug pushed the camera 2× too far back
  // and made the VRM render at ~½ the intended size.
  const cameraDistance =
    (CAMERA_DISTANCE_FACTOR * framedHeight) / (2 * Math.tan(FOV_RADIANS / 2));

  return {
    cameraPosition: {
      x: bboxCenterX,
      y: cameraY,
      z: bboxCenterZ + cameraDistance,
    },
    cameraLookAt: {
      x: bboxCenterX,
      y: cameraY,
      z: bboxCenterZ,
    },
    cameraFov: FOV_DEGREES,
    framedHeight,
    framedWidth,
    framedCenterY: cameraY,
  };
}
