// Wave 4 chunk 4-B of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Tests for vrm-hit-region. Uses an in-memory fake VrmRenderTarget so we
// can drive the alpha-byte return value deterministically without
// touching real WebGL.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearDeviceTierCache } from '../app-shell/device-tier-detector.js';
import type { VrmRenderTarget } from './vrm-render-target.js';
import {
  ALPHA_MASK_THRESHOLD,
  ALPHA_MASK_THRESHOLD_BYTE,
  createVrmHitRegion,
} from './vrm-hit-region.js';

const VIEWPORT = { left: 100, top: 50, width: 400, height: 600 };

function makeFakeRenderTarget(alphaByte: number | null): VrmRenderTarget {
  return {
    capture: vi.fn(() => ({
      takenAtMs: 1,
      fboWidth: 64,
      fboHeight: 64,
    })),
    probeAlphaAtClient: vi.fn(() => alphaByte),
    dispose: vi.fn(),
  };
}

afterEach(() => {
  clearDeviceTierCache();
});

describe('vrm-hit-region constants', () => {
  it('exports ALPHA_MASK_THRESHOLD = 10/255', () => {
    expect(ALPHA_MASK_THRESHOLD).toBe(10 / 255);
  });

  it('exports ALPHA_MASK_THRESHOLD_BYTE = 10', () => {
    expect(ALPHA_MASK_THRESHOLD_BYTE).toBe(10);
  });

  it('byte and float thresholds agree', () => {
    expect(ALPHA_MASK_THRESHOLD * 255).toBeCloseTo(ALPHA_MASK_THRESHOLD_BYTE);
  });
});

describe('createVrmHitRegion (tier A)', () => {
  it('returns body and drag bbox covering full viewport', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(255),
      getViewport: () => VIEWPORT,
      deviceTierOverride: 'A',
    });
    expect(region.body).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
    expect(region.drag).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });

  it('returns a real isOpaqueAtClientPoint function (not null)', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(255),
      getViewport: () => VIEWPORT,
      deviceTierOverride: 'A',
    });
    expect(typeof region.isOpaqueAtClientPoint).toBe('function');
  });

  it('does not invoke onDegraded on tier A', () => {
    const onDegraded = vi.fn();
    createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(255),
      getViewport: () => VIEWPORT,
      deviceTierOverride: 'A',
      onDegraded,
    });
    expect(onDegraded).not.toHaveBeenCalled();
  });

  it('returns true when alpha byte > threshold byte', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(255),
      getViewport: () => VIEWPORT,
      deviceTierOverride: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBe(true);
  });

  it('returns false when alpha byte < threshold byte', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(5),
      getViewport: () => VIEWPORT,
      deviceTierOverride: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBe(false);
  });

  it('returns false when alpha byte equals threshold byte (strict greater-than)', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(ALPHA_MASK_THRESHOLD_BYTE),
      getViewport: () => VIEWPORT,
      deviceTierOverride: 'A',
    });
    // Threshold semantics: alpha > threshold (strict). Exactly-at-threshold is transparent.
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBe(false);
  });

  it('returns false when probe returns null (no capture yet)', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(null),
      getViewport: () => VIEWPORT,
      deviceTierOverride: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBe(false);
  });

  it('honors a caller-supplied threshold override', () => {
    // alpha byte = 30; default threshold byte = 10 → opaque
    // override threshold = 200/255 → threshold byte = 200 → transparent
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(30),
      getViewport: () => VIEWPORT,
      deviceTierOverride: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBe(true);
    expect(region.isOpaqueAtClientPoint!(150, 200, 200 / 255)).toBe(false);
  });

  it('returns false when getViewport returns null', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(255),
      getViewport: () => null,
      deviceTierOverride: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBe(false);
  });

  it('returns false when getViewport returns zero-area rect', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(255),
      getViewport: () => ({ left: 0, top: 0, width: 0, height: 0 }),
      deviceTierOverride: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBe(false);
  });

  it('forwards client coords + viewport to probeAlphaAtClient', () => {
    const target = makeFakeRenderTarget(255);
    const region = createVrmHitRegion({
      renderTarget: target,
      getViewport: () => VIEWPORT,
      deviceTierOverride: 'A',
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
      deviceTierOverride: 'B',
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
      deviceTierOverride: 'C',
    });
    expect(region.isOpaqueAtClientPoint).toBeNull();
  });

  it('still exposes full-viewport body and drag bbox', () => {
    const region = createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(255),
      getViewport: () => VIEWPORT,
      deviceTierOverride: 'C',
    });
    expect(region.body).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
    expect(region.drag).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });

  it('fires onDegraded once with reason_code = device_tier_c', () => {
    const onDegraded = vi.fn();
    createVrmHitRegion({
      renderTarget: makeFakeRenderTarget(255),
      getViewport: () => VIEWPORT,
      deviceTierOverride: 'C',
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
      deviceTierOverride: 'C',
    });
    expect(target.probeAlphaAtClient).not.toHaveBeenCalled();
  });
});

describe('createVrmHitRegion (cache fallback)', () => {
  it('falls back to tier C when no cached detection and no override', () => {
    clearDeviceTierCache();
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
