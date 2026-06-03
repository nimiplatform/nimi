// Wave 1 (step 2) of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Computes BackendNominalBounds for the Live2D branch. Authority for the
// nominal viewport size is the model's CanvasInfo (model3 / Cubism Core)
// plus an optional alpha-mask body bbox refinement. When alpha-mask data is
// unavailable, the bounds reduce to the canvas size with the body anchored at
// the visual center.
//
// Spec: backend-branch-contract.md §"BackendNominalBounds";
//       live2d-render-contract.md §"Model Loading".

import type { BackendNominalBounds } from './backend-branch.js';

/** Live2D fallback nominal viewport (logical px). Used when the loaded
 *  model exposes no usable canvas information; preserves baseline
 *  avatar-carrier behavior so existing speaking/activity paths remain
 *  pixel-equivalent. */
export const LIVE2D_FALLBACK_NOMINAL_BOUNDS: BackendNominalBounds = Object.freeze({
  width: 400,
  height: 600,
  bodyCenterX: 0.5,
  bodyCenterY: 0.5,
});

export type Live2DNominalBoundsInput = {
  /** Optional Cubism model handle. When present the canvas size is read
   *  from `getCanvasWidth/Height`; when absent the fallback bounds apply. */
  model?: Live2DNominalBoundsModel | null;
};

export type Live2DNominalBoundsModel = {
  getCanvasWidth?: () => number;
  getCanvasHeight?: () => number;
};

function readCanvasSize(model: Live2DNominalBoundsModel | null | undefined): { width: number; height: number } | null {
  if (!model) return null;
  const handle = model as unknown as {
    getCanvasWidth?: () => number;
    getCanvasHeight?: () => number;
  };
  const width = typeof handle.getCanvasWidth === 'function' ? handle.getCanvasWidth() : NaN;
  const height = typeof handle.getCanvasHeight === 'function' ? handle.getCanvasHeight() : NaN;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

export function computeLive2DNominalBounds(
  input: Live2DNominalBoundsInput = {},
): BackendNominalBounds {
  const canvas = readCanvasSize(input.model ?? null);
  if (!canvas) {
    return LIVE2D_FALLBACK_NOMINAL_BOUNDS;
  }
  return Object.freeze({
    width: Math.round(canvas.width),
    height: Math.round(canvas.height),
    bodyCenterX: 0.5,
    bodyCenterY: 0.5,
  });
}
