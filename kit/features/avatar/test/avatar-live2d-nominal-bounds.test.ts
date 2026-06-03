import { describe, expect, it } from 'vitest';

import {
  computeLive2DNominalBounds,
  LIVE2D_FALLBACK_NOMINAL_BOUNDS,
} from '../src/live2d-nominal-bounds.js';

describe('Live2D nominal bounds', () => {
  it('uses the admitted fallback when no model is loaded', () => {
    expect(computeLive2DNominalBounds()).toBe(LIVE2D_FALLBACK_NOMINAL_BOUNDS);
    expect(LIVE2D_FALLBACK_NOMINAL_BOUNDS).toEqual({
      width: 400,
      height: 600,
      bodyCenterX: 0.5,
      bodyCenterY: 0.5,
    });
  });

  it('projects finite Cubism canvas dimensions into nominal bounds', () => {
    expect(computeLive2DNominalBounds({
      model: {
        getCanvasWidth: () => 512.4,
        getCanvasHeight: () => 719.6,
      },
    })).toEqual({
      width: 512,
      height: 720,
      bodyCenterX: 0.5,
      bodyCenterY: 0.5,
    });
  });

  it('fails closed to fallback for absent or invalid canvas dimensions', () => {
    expect(computeLive2DNominalBounds({
      model: {
        getCanvasWidth: () => Number.NaN,
        getCanvasHeight: () => 720,
      },
    })).toBe(LIVE2D_FALLBACK_NOMINAL_BOUNDS);
    expect(computeLive2DNominalBounds({
      model: {
        getCanvasWidth: () => 512,
        getCanvasHeight: () => 0,
      },
    })).toBe(LIVE2D_FALLBACK_NOMINAL_BOUNDS);
  });
});
