// Contract tests for .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Verifies that deriveVrmNominalBounds returns the policy default when
// the VRM is null (boot placeholder), derives clamped bounds from a
// loaded scene, and varies bodyCenterY per framing intent.

import type { VRM } from '@pixiv/three-vrm';
import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import {
  VRM_DEFAULT_NOMINAL_BOUNDS,
  VRM_NOMINAL_BOUNDS_MAX_HEIGHT,
  VRM_NOMINAL_BOUNDS_MAX_WIDTH,
  VRM_NOMINAL_BOUNDS_MIN_HEIGHT,
  VRM_NOMINAL_BOUNDS_MIN_WIDTH,
  VRM_NOMINAL_PX_PER_WORLD_UNIT,
  deriveVrmNominalBounds,
  deriveVrmProjectedHitGeometry,
} from './vrm-nominal-bounds.js';

// Build a fake VRM whose `scene` is a real Object3D containing a single
// box-shaped mesh proxy. Box3.setFromObject walks the children + reads
// geometry / boundingBox, so the cleanest approach is to subclass
// Object3D and override `traverse` is fragile — instead we synthesize a
// real Object3D with a child whose .geometry has a boundingBox-ish shape.
// For the unit test, the simplest path is to use Object3D + manually
// expand the bbox via three.js own Box3.expandByObject — which is what
// Box3.setFromObject does internally. We do that by attaching a
// `boundingBox` to children via Mesh-like proxy. To keep the test free
// of three.js internals, we use a plain Object3D root with no children
// and instead rely on a sentinel mock by stubbing `Box3.setFromObject`
// behavior: simpler, we stash bbox extent via Object3D.position and
// use a tiny custom three.js mesh.
//
// Practical path: use real three Mesh + BoxGeometry — both ship in the
// already-installed `three` package.

import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three';

function makeStubVrm(min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }): VRM {
  const root = new Object3D();
  // BoxGeometry centered at origin with given extents:
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

describe('VRM_DEFAULT_NOMINAL_BOUNDS', () => {
  it('matches window-bounds-policy.yaml backends.vrm (360 × 720, bodyCenterY 0.55)', () => {
    expect(VRM_DEFAULT_NOMINAL_BOUNDS).toEqual({
      width: 360,
      height: 720,
      bodyCenterX: 0.5,
      bodyCenterY: 0.55,
    });
  });
});

describe('deriveVrmNominalBounds', () => {
  it('returns the default fallback when vrm is null (boot placeholder)', () => {
    const result = deriveVrmNominalBounds({
      vrm: null,
      intent: 'bottom-companion',
    });
    expect(result).toEqual(VRM_DEFAULT_NOMINAL_BOUNDS);
  });

  it('derives bounds from a real bbox and clamps to the sanity range', () => {
    // 1.7m character → bottom-companion framedHeight = 0.55 * 1.7 = 0.935 m
    // → 0.935 * 280 ≈ 261.8 px → clamped to MIN_HEIGHT (480).
    const vrm = makeStubVrm({ x: -0.3, y: 0, z: -0.2 }, { x: 0.3, y: 1.7, z: 0.2 });
    const result = deriveVrmNominalBounds({
      vrm,
      intent: 'bottom-companion',
    });
    expect(result.width).toBeGreaterThanOrEqual(VRM_NOMINAL_BOUNDS_MIN_WIDTH);
    expect(result.width).toBeLessThanOrEqual(VRM_NOMINAL_BOUNDS_MAX_WIDTH);
    expect(result.height).toBeGreaterThanOrEqual(VRM_NOMINAL_BOUNDS_MIN_HEIGHT);
    expect(result.height).toBeLessThanOrEqual(VRM_NOMINAL_BOUNDS_MAX_HEIGHT);
  });

  it('uses the documented px-per-world-unit when bounds fall inside the clamp range', () => {
    // A 3m character → full-body framedHeight = 1.05 * 3 = 3.15 m → 3.15 * 280 = 882 px
    // (within [480, 960]). framedWidth = 3.15 * 0.45 = 1.4175 m * 280 = 396.9 px
    // (within [320, 600]).
    const vrm = makeStubVrm({ x: -0.5, y: 0, z: -0.3 }, { x: 0.5, y: 3, z: 0.3 });
    const result = deriveVrmNominalBounds({
      vrm,
      intent: 'full-body',
    });
    const expectedHeight = 3.15 * VRM_NOMINAL_PX_PER_WORLD_UNIT;
    const expectedWidth = 3.15 * 0.45 * VRM_NOMINAL_PX_PER_WORLD_UNIT;
    expect(result.height).toBeCloseTo(expectedHeight, 4);
    expect(result.width).toBeCloseTo(expectedWidth, 4);
  });

  it('framing intent governs bodyCenterY: full-body=0.5, bottom-companion=0.55, head-shoulders=0.7', () => {
    const vrm = makeStubVrm({ x: -0.3, y: 0, z: -0.2 }, { x: 0.3, y: 1.7, z: 0.2 });
    expect(
      deriveVrmNominalBounds({ vrm, intent: 'full-body' }).bodyCenterY,
    ).toBe(0.5);
    expect(
      deriveVrmNominalBounds({ vrm, intent: 'bottom-companion' }).bodyCenterY,
    ).toBe(0.55);
    expect(
      deriveVrmNominalBounds({ vrm, intent: 'head-shoulders' }).bodyCenterY,
    ).toBe(0.7);
  });

  it('bodyCenterX is always 0.5 (VRM models are world-centered on X)', () => {
    const vrm = makeStubVrm({ x: -0.3, y: 0, z: -0.2 }, { x: 0.3, y: 1.7, z: 0.2 });
    for (const intent of ['full-body', 'bottom-companion', 'head-shoulders'] as const) {
      const r = deriveVrmNominalBounds({ vrm, intent });
      expect(r.bodyCenterX).toBe(0.5);
    }
  });

  it('has no current-window aspect input, preventing native resize feedback', () => {
    const vrm = makeStubVrm({ x: -0.5, y: 0, z: -0.3 }, { x: 0.5, y: 3, z: 0.3 });
    const logical = deriveVrmNominalBounds({ vrm, intent: 'full-body' });
    const narrowHit = deriveVrmProjectedHitGeometry({
      vrm,
      intent: 'full-body',
      aspect: 0.4,
    });
    const wideHit = deriveVrmProjectedHitGeometry({
      vrm,
      intent: 'full-body',
      aspect: 0.6,
    });
    expect(wideHit.body).not.toEqual(narrowHit.body);
    expect(deriveVrmNominalBounds({ vrm, intent: 'full-body' })).toEqual(logical);
  });

  it('falls back to default when scene bbox is degenerate (zero size)', () => {
    // Scene with no children → Box3.setFromObject yields an empty box
    // (min = +Infinity, max = -Infinity). framedHeight becomes -Inf, so
    // we must fall back to default.
    const empty = { scene: new Object3D() } as unknown as VRM;
    const result = deriveVrmNominalBounds({
      vrm: empty,
      intent: 'bottom-companion',
    });
    expect(result).toEqual(VRM_DEFAULT_NOMINAL_BOUNDS);
  });
});
