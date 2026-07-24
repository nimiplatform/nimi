// Authority: docs/authority/avatar-embodiment-rationale.md.
//
// Glue layer between Three.js (`Box3` / `Vector3`) and the Avatar-owned pure
// `computeVrmCameraFraming` domain function.
// This module is the ONLY VRM file that imports both Three.js and the pure
// domain — it computes the scene bounding box once per call and forwards
// the plain-numeric vectors to the domain. The caller (carrier surface,
// chunk 2-C / 2-E) consumes the result to drive `<Canvas camera={...}>`
// props.
//
// Camera-application is the surface's job. This module does NOT mutate
// any Three.js camera object — it returns a pure derivation result so the
// surface can pass `cameraPosition` / `cameraLookAt` / `cameraFov` into
// React props (`<Canvas camera={{ position, fov }}>`) and let R3F handle
// the lookAt update at mount time.

import type { VRM } from '@pixiv/three-vrm';
// `three` is shimmed as opaque (any) at the workspace level via
// kit/ui/src/types/three-shim.d.ts. We deliberately do NOT add a workspace
// `@types/three` dependency at this wave — kit/auth/desktop-particle-*.tsx
// also depends on the opaque shim. Box3 / Vector3 here therefore come
// through as `any` at the type level; the runtime import resolves to the
// real three.js classes from the `three` package (same one used by the
// VRM loader). The carrier surface only consumes the plain numeric fields
// (x/y/z, framedHeight, framedWidth), so the loose typing is acceptable.
import { Box3, Vector3 } from 'three';

export type VrmFramingIntent = 'full-body' | 'bottom-companion' | 'head-shoulders';

export type VrmFramingResult = {
  cameraPosition: Vector3Like;
  cameraLookAt: Vector3Like;
  cameraFov: number;
  framedHeight: number;
  framedWidth: number;
  framedCenterY: number;
};

/** Minimal Vector3-shape returned by applyVrmFraming (subset of THREE.Vector3). */
export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export type ApplyFramingInputs = {
  vrm: VRM;
  intent: VrmFramingIntent;
  /** viewport width / viewport height (BackendSurfaceProps.width / height). */
  aspect: number;
};

export type VrmCameraFramingInput = {
  sceneBboxMin: Vector3Like;
  sceneBboxMax: Vector3Like;
  intent: VrmFramingIntent;
  aspect: number;
};

const FOV_DEGREES = 30;
const FOV_RADIANS = (FOV_DEGREES * Math.PI) / 180;
const CAMERA_DISTANCE_FACTOR = 1.05;
const FULL_BODY_HEIGHT_MARGIN = 1.05;
const HUMANOID_BODY_WIDTH_RATIO = 0.45;
const HORIZONTAL_SAFETY = 1.05;

const INTENT_PARAMS: Record<
  VrmFramingIntent,
  { cameraYOffsetRatio: number | 'center'; framedHeightRatio: number }
> = {
  'full-body': {
    cameraYOffsetRatio: 'center',
    framedHeightRatio: FULL_BODY_HEIGHT_MARGIN,
  },
  'bottom-companion': {
    cameraYOffsetRatio: 0.55,
    framedHeightRatio: 1,
  },
  'head-shoulders': {
    cameraYOffsetRatio: 0.85,
    framedHeightRatio: 0.3,
  },
};

export type ApplyFramingResult = VrmFramingResult & {
  /** THREE.Vector3 instance — minimal interface (x/y/z) since `three` types are opaque. */
  sceneBboxMin: Vector3Like;
  /** THREE.Vector3 instance — minimal interface (x/y/z) since `three` types are opaque. */
  sceneBboxMax: Vector3Like;
};

export function computeVrmCameraFraming(input: VrmCameraFramingInput): VrmFramingResult {
  const { sceneBboxMin, sceneBboxMax, intent, aspect } = input;
  const totalHeight = sceneBboxMax.y - sceneBboxMin.y;
  const rawTotalWidth = sceneBboxMax.x - sceneBboxMin.x;
  const totalWidth = Math.min(rawTotalWidth, totalHeight * HUMANOID_BODY_WIDTH_RATIO);
  const bboxCenterX = (sceneBboxMin.x + sceneBboxMax.x) / 2;
  const bboxCenterY = (sceneBboxMin.y + sceneBboxMax.y) / 2;
  const bboxCenterZ = (sceneBboxMin.z + sceneBboxMax.z) / 2;
  const params = INTENT_PARAMS[intent];
  const cameraY = params.cameraYOffsetRatio === 'center'
    ? bboxCenterY
    : sceneBboxMin.y + totalHeight * params.cameraYOffsetRatio;
  const intentFramedHeight = totalHeight * params.framedHeightRatio;
  const horizontalFitFramedHeight =
    aspect > 0 ? (totalWidth * HORIZONTAL_SAFETY) / aspect : intentFramedHeight;
  const framedHeight = Math.max(intentFramedHeight, horizontalFitFramedHeight);
  const framedWidth = framedHeight * aspect;
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

/**
 * Compute a Three.js scene bbox from `vrm.scene` and feed it into the pure
 * `computeVrmCameraFraming` domain. Returns the framing result alongside the
 * raw bbox vectors so the caller can apply other camera adjustments
 * (e.g. cull margins).
 */
export function applyVrmFraming(inputs: ApplyFramingInputs): ApplyFramingResult {
  const { vrm, intent, aspect } = inputs;
  const bbox = new Box3().setFromObject(vrm.scene);
  const sceneBboxMin = bbox.min.clone();
  const sceneBboxMax = bbox.max.clone();
  const result = computeVrmCameraFraming({
    sceneBboxMin: { x: sceneBboxMin.x, y: sceneBboxMin.y, z: sceneBboxMin.z },
    sceneBboxMax: { x: sceneBboxMax.x, y: sceneBboxMax.y, z: sceneBboxMax.z },
    intent,
    aspect,
  });
  return {
    ...result,
    sceneBboxMin,
    sceneBboxMax,
  };
}
