// Wave 4 chunk 4-B of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Tests for vrm-hit-region. Uses an in-memory fake VrmRenderTarget so we
// can drive the alpha-byte return value deterministically without
// touching real WebGL.

import { describe, expect, it, vi } from 'vitest';

import {
  VRM_ALPHA_MASK_THRESHOLD,
  VRM_ALPHA_MASK_THRESHOLD_BYTE,
  createVrmHitRegion,
  type VrmHitRegionRenderTarget,
} from '../src/vrm-hit-region.js';

const VIEWPORT = { left: 100, top: 50, width: 400, height: 600 };

function makeFakeRenderTarget(alphaByte: number | null): VrmHitRegionRenderTarget {
  return {
    probeAlphaAtClient: vi.fn(() => alphaByte),
  };
}

describe('vrm-hit-region constants', () => {
  it('exports VRM_ALPHA_MASK_THRESHOLD = 10/255', () => {
    expect(VRM_ALPHA_MASK_THRESHOLD).toBe(10 / 255);
  });

  it('exports VRM_ALPHA_MASK_THRESHOLD_BYTE = 10', () => {
    expect(VRM_ALPHA_MASK_THRESHOLD_BYTE).toBe(10);
  });

  it('byte and float thresholds agree', () => {
    expect(VRM_ALPHA_MASK_THRESHOLD * 255).toBeCloseTo(VRM_ALPHA_MASK_THRESHOLD_BYTE);
  });
});

describe('createVrmHitRegion (tier A)', () => {
  it('returns body and drag bbox covering full viewport', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(255),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    expect(region.body).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
    expect(region.drag).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });

  it('returns a real isOpaqueAtClientPoint function (not null)', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(255),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    expect(typeof region.isOpaqueAtClientPoint).toBe('function');
  });

  it('does not invoke onDegraded on tier A', () => {
    const onDegraded = vi.fn();
    createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(255),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
      onDegraded,
    });
    expect(onDegraded).not.toHaveBeenCalled();
  });

  it('returns true when alpha byte > threshold byte', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(255),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBe(true);
  });

  it('returns false when alpha byte < threshold byte', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(5),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBe(false);
  });

  it('returns false when alpha byte equals threshold byte (strict greater-than)', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(VRM_ALPHA_MASK_THRESHOLD_BYTE),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    // Threshold semantics: alpha > threshold (strict). Exactly-at-threshold is transparent.
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBe(false);
  });

  it('returns null when probe returns null so caller falls back to bbox', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(null),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBeNull();
  });

  it('honors a caller-supplied threshold override', () => {
    // alpha byte = 30; default threshold byte = 10 → opaque
    // override threshold = 200/255 → threshold byte = 200 → transparent
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(30),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBe(true);
    expect(region.isOpaqueAtClientPoint!(150, 200, 200 / 255)).toBe(false);
  });

  it('returns null when getViewport returns null so caller falls back to bbox', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(255),
      getViewport: () => null,
      deviceTier: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBeNull();
  });

  it('returns null when getViewport returns zero-area rect so caller falls back to bbox', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(255),
      getViewport: () => ({ left: 0, top: 0, width: 0, height: 0 }),
      deviceTier: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBeNull();
  });

  it('forwards client coords + viewport to probeAlphaAtClient', () => {
    const target = makeFakeRenderTarget(255);
    const region = createVrmHitRegion({
      renderTarget: target,
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    region.isOpaqueAtClientPoint!(150, 200);
    expect(target.probeAlphaAtClient).toHaveBeenCalledWith({
      clientX: 150,
      clientY: 200,
      viewport: VIEWPORT,
    });
  });
});

describe('createVrmHitRegion (tier B)', () => {
  it('also returns a real isOpaqueAtClientPoint function', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(120),
      getViewport: () => VIEWPORT,
      deviceTier: 'B',
    });
    expect(typeof region.isOpaqueAtClientPoint).toBe('function');
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBe(true);
  });
});

describe('createVrmHitRegion (tier C)', () => {
  it('returns isOpaqueAtClientPoint = null (bbox-only fallback)', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(255),
      getViewport: () => VIEWPORT,
      deviceTier: 'C',
    });
    expect(region.isOpaqueAtClientPoint).toBeNull();
  });

  it('still exposes full-viewport body and drag bbox', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(255),
      getViewport: () => VIEWPORT,
      deviceTier: 'C',
    });
    expect(region.body).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
    expect(region.drag).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });

  it('fires onDegraded once with reason_code = device_tier_c', () => {
    const onDegraded = vi.fn();
    createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(255),
      getViewport: () => VIEWPORT,
      deviceTier: 'C',
      onDegraded,
    });
    expect(onDegraded).toHaveBeenCalledTimes(1);
    expect(onDegraded.mock.calls[0]![0].reason_code).toBe('device_tier_c');
    expect(typeof onDegraded.mock.calls[0]![0].recordedAt).toBe('string');
    // ISO-8601 sanity
    expect(
      Number.isFinite(Date.parse(onDegraded.mock.calls[0]![0].recordedAt)),
    ).toBe(true);
  });

  it('does not call probeAlphaAtClient on tier C', () => {
    const target = makeFakeRenderTarget(255);
    createVrmHitRegion({
      renderTarget: target,
      getViewport: () => VIEWPORT,
      deviceTier: 'C',
    });
    expect(target.probeAlphaAtClient).not.toHaveBeenCalled();
  });
});

describe('createVrmHitRegion (default tier)', () => {
  it('defaults to tier C when caller provides no device tier', () => {
    const onDegraded = vi.fn();
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(255),
      getViewport: () => VIEWPORT,
      onDegraded,
    });
    expect(region.isOpaqueAtClientPoint).toBeNull();
    expect(onDegraded).toHaveBeenCalledTimes(1);
  });
});
