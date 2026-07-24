// Contract tests for docs/authority/avatar-embodiment-rationale.md.
//
// Verifies the Three.js -> local pure-domain glue: applyVrmFraming computes a
// scene bbox via Box3.setFromObject and forwards plain-numeric vectors
// to computeVrmCameraFraming. The results must match the pure domain output
// for the same bbox + return the bbox vectors alongside.

import type { VRM } from '@pixiv/three-vrm';
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { applyVrmFraming, computeVrmCameraFraming } from './vrm-framing.js';

function makeStubVrm(min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }): VRM {
  const root = new Object3D();
  const w = max.x - min.x;
  const h = max.y - min.y;
  const d = max.z - min.z;
  const cx = (min.x + max.x) / 2;
  const cy = (min.y + max.y) / 2;
  const cz = (min.z + max.z) / 2;
  const mesh = new Mesh(new BoxGeometry(w, h, d), new MeshBasicMaterial());
  mesh.position.set(cx, cy, cz);
  root.add(mesh);
  return { scene: root } as unknown as VRM;
}

describe('applyVrmFraming', () => {
  it('matches computeVrmCameraFraming output for the same bbox', () => {
    const min = { x: -0.3, y: 0, z: -0.2 };
    const max = { x: 0.3, y: 1.7, z: 0.2 };
    const vrm = makeStubVrm(min, max);
    const aspect = 0.45;
    const intent = 'bottom-companion' as const;

    const expected = computeVrmCameraFraming({
      sceneBboxMin: min,
      sceneBboxMax: max,
      intent,
      aspect,
    });
    const actual = applyVrmFraming({ vrm, intent, aspect });

    expect(actual.cameraFov).toBe(expected.cameraFov);
    expect(actual.cameraPosition.x).toBeCloseTo(expected.cameraPosition.x, 5);
    expect(actual.cameraPosition.y).toBeCloseTo(expected.cameraPosition.y, 5);
    expect(actual.cameraPosition.z).toBeCloseTo(expected.cameraPosition.z, 5);
    expect(actual.cameraLookAt.x).toBeCloseTo(expected.cameraLookAt.x, 5);
    expect(actual.cameraLookAt.y).toBeCloseTo(expected.cameraLookAt.y, 5);
    expect(actual.cameraLookAt.z).toBeCloseTo(expected.cameraLookAt.z, 5);
    expect(actual.framedHeight).toBeCloseTo(expected.framedHeight, 5);
    expect(actual.framedWidth).toBeCloseTo(expected.framedWidth, 5);
    expect(actual.framedCenterY).toBeCloseTo(expected.framedCenterY, 5);
  });

  it('returns sceneBboxMin / sceneBboxMax with x/y/z matching the source bbox', () => {
    const min = { x: -0.3, y: 0, z: -0.2 };
    const max = { x: 0.3, y: 1.7, z: 0.2 };
    const vrm = makeStubVrm(min, max);
    const result = applyVrmFraming({ vrm, intent: 'full-body', aspect: 0.45 });
    // `three` types are opaque (workspace shim); duck-type the returned vectors.
    expect(typeof result.sceneBboxMin.x).toBe('number');
    expect(typeof result.sceneBboxMax.x).toBe('number');
    expect(result.sceneBboxMin.x).toBeCloseTo(min.x, 5);
    expect(result.sceneBboxMin.y).toBeCloseTo(min.y, 5);
    expect(result.sceneBboxMin.z).toBeCloseTo(min.z, 5);
    expect(result.sceneBboxMax.x).toBeCloseTo(max.x, 5);
    expect(result.sceneBboxMax.y).toBeCloseTo(max.y, 5);
    expect(result.sceneBboxMax.z).toBeCloseTo(max.z, 5);
  });

  it('different intents produce different framed heights for the same scene', () => {
    const vrm = makeStubVrm({ x: -0.3, y: 0, z: -0.2 }, { x: 0.3, y: 1.7, z: 0.2 });
    const fb = applyVrmFraming({ vrm, intent: 'full-body', aspect: 0.45 });
    const bc = applyVrmFraming({ vrm, intent: 'bottom-companion', aspect: 0.45 });
    const hs = applyVrmFraming({ vrm, intent: 'head-shoulders', aspect: 0.45 });
    expect(fb.framedHeight).toBeGreaterThan(bc.framedHeight);
    expect(bc.framedHeight).toBeGreaterThan(hs.framedHeight);
  });
});
