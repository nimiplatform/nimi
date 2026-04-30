import { describe, expect, it } from 'vitest';

import {
  computeVrmFraming,
  type VrmFramingInputs,
} from './vrm-framing-domain.js';

// Reference character: 1.7m tall, centered at origin in X/Z, feet at y=0.
// Bbox spans x ∈ [-0.3, 0.3], y ∈ [0, 1.7], z ∈ [-0.2, 0.2].
const REF_BBOX_MIN = { x: -0.3, y: 0, z: -0.2 };
const REF_BBOX_MAX = { x: 0.3, y: 1.7, z: 0.2 };
const REF_TOTAL_HEIGHT = 1.7;
const REF_ASPECT = 0.45; // avatar's default tall-window aspect
const FOV = 30;
const FOV_TAN_HALF = Math.tan((FOV * Math.PI) / 180 / 2);

function makeInputs(intent: VrmFramingInputs['intent']): VrmFramingInputs {
  return {
    sceneBboxMin: REF_BBOX_MIN,
    sceneBboxMax: REF_BBOX_MAX,
    intent,
    aspect: REF_ASPECT,
  };
}

describe('computeVrmFraming', () => {
  it('returns fov=30 for every intent', () => {
    expect(computeVrmFraming(makeInputs('full-body')).cameraFov).toBe(30);
    expect(computeVrmFraming(makeInputs('bottom-companion')).cameraFov).toBe(30);
    expect(computeVrmFraming(makeInputs('head-shoulders')).cameraFov).toBe(30);
  });

  it('full-body: framedHeight = totalHeight × 1.1, camera Y at bbox center', () => {
    const r = computeVrmFraming(makeInputs('full-body'));
    expect(r.framedHeight).toBeCloseTo(REF_TOTAL_HEIGHT * 1.1, 6);
    expect(r.cameraPosition.y).toBeCloseTo((REF_BBOX_MIN.y + REF_BBOX_MAX.y) / 2, 6);
    expect(r.cameraLookAt.y).toBe(r.cameraPosition.y);
    expect(r.framedCenterY).toBe(r.cameraPosition.y);
  });

  it('bottom-companion: framedHeight ≈ totalHeight × 0.55; camera Y at waist (~65%)', () => {
    const r = computeVrmFraming(makeInputs('bottom-companion'));
    expect(r.framedHeight).toBeCloseTo(REF_TOTAL_HEIGHT * 0.55, 6);
    expect(r.cameraPosition.y).toBeCloseTo(REF_BBOX_MIN.y + REF_TOTAL_HEIGHT * 0.65, 6);
  });

  it('head-shoulders: framedHeight ≈ totalHeight × 0.30; camera Y at chest (~85%)', () => {
    const r = computeVrmFraming(makeInputs('head-shoulders'));
    expect(r.framedHeight).toBeCloseTo(REF_TOTAL_HEIGHT * 0.3, 6);
    expect(r.cameraPosition.y).toBeCloseTo(REF_BBOX_MIN.y + REF_TOTAL_HEIGHT * 0.85, 6);
  });

  it('framedWidth = framedHeight × aspect', () => {
    for (const intent of ['full-body', 'bottom-companion', 'head-shoulders'] as const) {
      const r = computeVrmFraming(makeInputs(intent));
      expect(r.framedWidth).toBeCloseTo(r.framedHeight * REF_ASPECT, 6);
    }
  });

  it('camera distance = 1.5 × framedHeight / tan(fov/2)', () => {
    for (const intent of ['full-body', 'bottom-companion', 'head-shoulders'] as const) {
      const r = computeVrmFraming(makeInputs(intent));
      const bboxCenterZ = (REF_BBOX_MIN.z + REF_BBOX_MAX.z) / 2;
      const expectedDistance = (1.5 * r.framedHeight) / FOV_TAN_HALF;
      expect(r.cameraPosition.z - bboxCenterZ).toBeCloseTo(expectedDistance, 5);
    }
  });

  it('lookAt sits on the camera Y line and on bbox center XZ', () => {
    const r = computeVrmFraming(makeInputs('bottom-companion'));
    expect(r.cameraLookAt.x).toBeCloseTo((REF_BBOX_MIN.x + REF_BBOX_MAX.x) / 2, 6);
    expect(r.cameraLookAt.z).toBeCloseTo((REF_BBOX_MIN.z + REF_BBOX_MAX.z) / 2, 6);
    expect(r.cameraLookAt.y).toBe(r.cameraPosition.y);
    expect(r.cameraPosition.x).toBeCloseTo(r.cameraLookAt.x, 6);
  });

  it('head-shoulders is closer than bottom-companion is closer than full-body', () => {
    const fb = computeVrmFraming(makeInputs('full-body'));
    const bc = computeVrmFraming(makeInputs('bottom-companion'));
    const hs = computeVrmFraming(makeInputs('head-shoulders'));
    expect(fb.framedHeight).toBeGreaterThan(bc.framedHeight);
    expect(bc.framedHeight).toBeGreaterThan(hs.framedHeight);
  });

  it('is a pure function — same inputs produce identical outputs', () => {
    const a = computeVrmFraming(makeInputs('bottom-companion'));
    const b = computeVrmFraming(makeInputs('bottom-companion'));
    expect(a).toEqual(b);
  });
});
