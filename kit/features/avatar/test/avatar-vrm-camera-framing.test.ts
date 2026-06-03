import { describe, expect, it } from 'vitest';

import {
  computeVrmCameraFraming,
  type VrmCameraFramingInput,
} from '../src/vrm.js';

const REF_BBOX_MIN = { x: -0.3, y: 0, z: -0.2 };
const REF_BBOX_MAX = { x: 0.3, y: 1.7, z: 0.2 };
const REF_TOTAL_HEIGHT = 1.7;
const REF_ASPECT = 0.45;
const FOV = 30;
const FOV_TAN_HALF = Math.tan((FOV * Math.PI) / 180 / 2);
const CAMERA_DISTANCE_FACTOR = 1.05;
const BODY_WIDTH_RATIO = 0.45;
const HORIZONTAL_SAFETY = 1.05;

function makeInput(intent: VrmCameraFramingInput['intent']): VrmCameraFramingInput {
  return {
    sceneBboxMin: REF_BBOX_MIN,
    sceneBboxMax: REF_BBOX_MAX,
    intent,
    aspect: REF_ASPECT,
  };
}

describe('computeVrmCameraFraming', () => {
  it('returns fov=30 for every intent', () => {
    expect(computeVrmCameraFraming(makeInput('full-body')).cameraFov).toBe(30);
    expect(computeVrmCameraFraming(makeInput('bottom-companion')).cameraFov).toBe(30);
    expect(computeVrmCameraFraming(makeInput('head-shoulders')).cameraFov).toBe(30);
  });

  it('full-body frames full height with margin and centers camera Y', () => {
    const result = computeVrmCameraFraming(makeInput('full-body'));
    expect(result.framedHeight).toBeCloseTo(REF_TOTAL_HEIGHT * 1.05, 6);
    expect(result.cameraPosition.y).toBeCloseTo((REF_BBOX_MIN.y + REF_BBOX_MAX.y) / 2, 6);
    expect(result.cameraLookAt.y).toBe(result.cameraPosition.y);
    expect(result.framedCenterY).toBe(result.cameraPosition.y);
  });

  it('bottom-companion fits full height and biases camera above center', () => {
    const result = computeVrmCameraFraming(makeInput('bottom-companion'));
    expect(result.framedHeight).toBeCloseTo(REF_TOTAL_HEIGHT, 6);
    expect(result.cameraPosition.y).toBeCloseTo(REF_BBOX_MIN.y + REF_TOTAL_HEIGHT * 0.55, 6);
  });

  it('head-shoulders uses horizontal fit as a floor on tall windows', () => {
    const result = computeVrmCameraFraming(makeInput('head-shoulders'));
    const cappedBodyWidth = Math.min(
      REF_BBOX_MAX.x - REF_BBOX_MIN.x,
      REF_TOTAL_HEIGHT * BODY_WIDTH_RATIO,
    );
    const horizontalFit = (cappedBodyWidth * HORIZONTAL_SAFETY) / REF_ASPECT;
    expect(result.framedHeight).toBeCloseTo(horizontalFit, 6);
    expect(result.cameraPosition.y).toBeCloseTo(REF_BBOX_MIN.y + REF_TOTAL_HEIGHT * 0.85, 6);
  });

  it('keeps framedWidth tied to aspect', () => {
    for (const intent of ['full-body', 'bottom-companion', 'head-shoulders'] as const) {
      const result = computeVrmCameraFraming(makeInput(intent));
      expect(result.framedWidth).toBeCloseTo(result.framedHeight * REF_ASPECT, 6);
    }
  });

  it('uses perspective camera distance derived from framed height', () => {
    for (const intent of ['full-body', 'bottom-companion', 'head-shoulders'] as const) {
      const result = computeVrmCameraFraming(makeInput(intent));
      const bboxCenterZ = (REF_BBOX_MIN.z + REF_BBOX_MAX.z) / 2;
      const expectedDistance = (CAMERA_DISTANCE_FACTOR * result.framedHeight) / (2 * FOV_TAN_HALF);
      expect(result.cameraPosition.z - bboxCenterZ).toBeCloseTo(expectedDistance, 5);
    }
  });

  it('aims lookAt at bbox center XZ and camera Y', () => {
    const result = computeVrmCameraFraming(makeInput('bottom-companion'));
    expect(result.cameraLookAt.x).toBeCloseTo((REF_BBOX_MIN.x + REF_BBOX_MAX.x) / 2, 6);
    expect(result.cameraLookAt.z).toBeCloseTo((REF_BBOX_MIN.z + REF_BBOX_MAX.z) / 2, 6);
    expect(result.cameraLookAt.y).toBe(result.cameraPosition.y);
    expect(result.cameraPosition.x).toBeCloseTo(result.cameraLookAt.x, 6);
  });

  it('orders intent distance from full-body to bottom-companion to head-shoulders', () => {
    const fullBody = computeVrmCameraFraming(makeInput('full-body'));
    const bottomCompanion = computeVrmCameraFraming(makeInput('bottom-companion'));
    const headShoulders = computeVrmCameraFraming(makeInput('head-shoulders'));
    expect(fullBody.framedHeight).toBeGreaterThan(bottomCompanion.framedHeight);
    expect(bottomCompanion.framedHeight).toBeGreaterThan(headShoulders.framedHeight);
  });

  it('is pure for identical inputs', () => {
    const first = computeVrmCameraFraming(makeInput('bottom-companion'));
    const second = computeVrmCameraFraming(makeInput('bottom-companion'));
    expect(first).toEqual(second);
  });
});
