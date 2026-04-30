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
const CAMERA_DISTANCE_FACTOR = 1.5;

const FULL_BODY_HEIGHT_MARGIN = 1.1; // 10% breathing room around the model

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
    cameraYOffsetRatio: 0.65, // waist-up
    framedHeightRatio: 0.55,
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
  const bboxCenterX = (sceneBboxMin.x + sceneBboxMax.x) / 2;
  const bboxCenterY = (sceneBboxMin.y + sceneBboxMax.y) / 2;
  const bboxCenterZ = (sceneBboxMin.z + sceneBboxMax.z) / 2;

  const params = INTENT_PARAMS[intent];

  const cameraY =
    params.cameraYOffsetRatio === 'center'
      ? bboxCenterY
      : sceneBboxMin.y + totalHeight * params.cameraYOffsetRatio;

  const framedHeight = totalHeight * params.framedHeightRatio;
  const framedWidth = framedHeight * aspect;

  // distance such that vertical fov fits framedHeight, with 1.5× margin
  const cameraDistance =
    (CAMERA_DISTANCE_FACTOR * framedHeight) / Math.tan(FOV_RADIANS / 2);

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
