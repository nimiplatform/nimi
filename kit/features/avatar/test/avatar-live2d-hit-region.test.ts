// Contract tests for docs/authority/avatar-embodiment-rationale.md.
//
// Tests for live2d-hit-region:
//   - `computeLive2DHitRegion` (compatibility-driven bbox)
//   - the new `createLive2DHitRegion` factory (alpha-mask + tier-aware)
//
// Uses a stub canvas + stub WebGL context so the alpha probe path is
// driven deterministically without real WebGL.

import { describe, expect, it, vi } from 'vitest';

import {
  LIVE2D_ALPHA_MASK_THRESHOLD,
  LIVE2D_ALPHA_MASK_THRESHOLD_BYTE,
  LIVE2D_DEFAULT_HIT_REGION,
  computeLive2DHitRegion,
  createLive2DHitRegion,
} from '../src/live2d-hit-region.js';
import type { Live2DCompatibilityReport } from '../src/live2d-compatibility.js';

const VIEWPORT = { left: 100, top: 50, width: 400, height: 600 };

type FakeGl = {
  RGBA: number;
  UNSIGNED_BYTE: number;
  readPixels: (
    x: number,
    y: number,
    w: number,
    h: number,
    fmt: number,
    type: number,
    out: Uint8Array,
  ) => void;
};

function makeFakeGl(alphaByte: number | null, opts?: { throwOnRead?: boolean }): FakeGl {
  return {
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    readPixels: vi.fn((_x, _y, _w, _h, _fmt, _type, out: Uint8Array) => {
      if (opts?.throwOnRead) throw new Error('readPixels failed');
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = alphaByte ?? 0;
    }),
  };
}

function makeFakeCanvas(opts: {
  width?: number;
  height?: number;
  gl?: FakeGl | null;
  /** Throw when getContext is called (simulates failure). */
  throwOnGetContext?: boolean;
}): HTMLCanvasElement {
  const canvas = {
    width: opts.width ?? 400,
    height: opts.height ?? 600,
    getContext: vi.fn((kind: string) => {
      if (opts.throwOnGetContext) throw new Error('getContext failed');
      if (kind !== 'webgl2' && kind !== 'webgl') return null;
      return opts.gl ?? null;
    }),
  } as unknown as HTMLCanvasElement;
  return canvas;
}

// ---------------------------------------------------------------------------
// computeLive2DHitRegion (compatibility bbox path)
// ---------------------------------------------------------------------------

describe('computeLive2DHitRegion (compatibility bbox)', () => {
  it('returns LIVE2D_DEFAULT_HIT_REGION when no compatibility report', () => {
    expect(computeLive2DHitRegion()).toBe(LIVE2D_DEFAULT_HIT_REGION);
  });

  it('returns zero-area region for fail_closed + unsupported disposition', () => {
    const compatibility: Live2DCompatibilityReport = {
       
      adapter: {
        semantics: {
          hit_regions: {
            fallback: 'fail_closed',
            disposition: { status: 'unsupported' },
          },
        },
      } as any,
    } as Live2DCompatibilityReport;
    const region = computeLive2DHitRegion({ compatibility });
    expect(region.body).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });
});

// ---------------------------------------------------------------------------
// createLive2DHitRegion (alpha-mask path)
// ---------------------------------------------------------------------------

describe('live2d-hit-region constants', () => {
  it('exports LIVE2D_ALPHA_MASK_THRESHOLD = 10/255', () => {
    expect(LIVE2D_ALPHA_MASK_THRESHOLD).toBe(10 / 255);
  });

  it('exports LIVE2D_ALPHA_MASK_THRESHOLD_BYTE = 10', () => {
    expect(LIVE2D_ALPHA_MASK_THRESHOLD_BYTE).toBe(10);
  });
});

describe('createLive2DHitRegion (tier A)', () => {
  it('returns body and drag bbox covering full viewport', () => {
    const region = createLive2DHitRegion({
      getCanvas: () => makeFakeCanvas({ gl: makeFakeGl(255) }),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    expect(region.body).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
    expect(region.drag).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });

  it('returns a real isOpaqueAtClientPoint function (not null)', () => {
    const region = createLive2DHitRegion({
      getCanvas: () => makeFakeCanvas({ gl: makeFakeGl(255) }),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    expect(typeof region.isOpaqueAtClientPoint).toBe('function');
  });

  it('does not invoke onDegraded on tier A', () => {
    const onDegraded = vi.fn();
    createLive2DHitRegion({
      getCanvas: () => makeFakeCanvas({ gl: makeFakeGl(255) }),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
      onDegraded,
    });
    expect(onDegraded).not.toHaveBeenCalled();
  });

  it('returns true when alpha byte > threshold byte (default threshold)', () => {
    const region = createLive2DHitRegion({
      getCanvas: () => makeFakeCanvas({ gl: makeFakeGl(255) }),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBe(true);
  });

  it('returns false when alpha byte < threshold byte', () => {
    const region = createLive2DHitRegion({
      getCanvas: () => makeFakeCanvas({ gl: makeFakeGl(5) }),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBe(false);
  });

  it('returns false when alpha byte equals threshold byte (strict greater-than)', () => {
    const region = createLive2DHitRegion({
      getCanvas: () =>
        makeFakeCanvas({ gl: makeFakeGl(LIVE2D_ALPHA_MASK_THRESHOLD_BYTE) }),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBe(false);
  });

  it('honors caller-supplied threshold override', () => {
    const region = createLive2DHitRegion({
      getCanvas: () => makeFakeCanvas({ gl: makeFakeGl(30) }),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBe(true);
    expect(region.isOpaqueAtClientPoint!(150, 200, 200 / 255)).toBe(false);
  });

  it('returns null when getCanvas returns null so caller falls back to bbox', () => {
    const region = createLive2DHitRegion({
      getCanvas: () => null,
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBeNull();
  });

  it('returns null when getViewport returns null so caller falls back to bbox', () => {
    const region = createLive2DHitRegion({
      getCanvas: () => makeFakeCanvas({ gl: makeFakeGl(255) }),
      getViewport: () => null,
      deviceTier: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBeNull();
  });

  it('returns null when canvas.getContext returns null so caller falls back to bbox', () => {
    const region = createLive2DHitRegion({
      getCanvas: () => makeFakeCanvas({ gl: null }),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBeNull();
  });

  it('returns null when getContext throws so caller falls back to bbox', () => {
    const region = createLive2DHitRegion({
      getCanvas: () => makeFakeCanvas({ throwOnGetContext: true }),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBeNull();
  });

  it('returns null when readPixels throws so caller falls back to bbox', () => {
    const region = createLive2DHitRegion({
      getCanvas: () =>
        makeFakeCanvas({ gl: makeFakeGl(255, { throwOnRead: true }) }),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBeNull();
  });

  it('returns false for client coords outside viewport', () => {
    const region = createLive2DHitRegion({
      getCanvas: () => makeFakeCanvas({ gl: makeFakeGl(255) }),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    // left of viewport
    expect(region.isOpaqueAtClientPoint!(50, 200)).toBe(false);
    // above viewport
    expect(region.isOpaqueAtClientPoint!(150, 10)).toBe(false);
    // right boundary excluded
    expect(
      region.isOpaqueAtClientPoint!(VIEWPORT.left + VIEWPORT.width, 200),
    ).toBe(false);
    // below boundary excluded
    expect(
      region.isOpaqueAtClientPoint!(150, VIEWPORT.top + VIEWPORT.height),
    ).toBe(false);
  });

  it('returns null for zero-size canvas so caller falls back to bbox', () => {
    const region = createLive2DHitRegion({
      getCanvas: () =>
        makeFakeCanvas({ width: 0, height: 0, gl: makeFakeGl(255) }),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBeNull();
  });

  it('readPixels uses 1×1 readback (not full canvas)', () => {
    const gl = makeFakeGl(255);
    const region = createLive2DHitRegion({
      getCanvas: () =>
        makeFakeCanvas({ width: 400, height: 600, gl }),
      getViewport: () => VIEWPORT,
      deviceTier: 'A',
    });
    region.isOpaqueAtClientPoint!(150, 200);
    const call = (gl.readPixels as ReturnType<typeof vi.fn>).mock.calls[0]!;
    // (x, y, width, height, format, type, out)
    expect(call[2]).toBe(1); // width = 1
    expect(call[3]).toBe(1); // height = 1
  });
});

describe('createLive2DHitRegion (tier B)', () => {
  it('also returns a real isOpaqueAtClientPoint function', () => {
    const region = createLive2DHitRegion({
      getCanvas: () => makeFakeCanvas({ gl: makeFakeGl(120) }),
      getViewport: () => VIEWPORT,
      deviceTier: 'B',
    });
    expect(typeof region.isOpaqueAtClientPoint).toBe('function');
    expect(region.isOpaqueAtClientPoint!(150, 200)).toBe(true);
  });
});

describe('createLive2DHitRegion (tier C)', () => {
  it('returns isOpaqueAtClientPoint = null (bbox-only fallback)', () => {
    const region = createLive2DHitRegion({
      getCanvas: () => makeFakeCanvas({ gl: makeFakeGl(255) }),
      getViewport: () => VIEWPORT,
      deviceTier: 'C',
    });
    expect(region.isOpaqueAtClientPoint).toBeNull();
  });

  it('still exposes full-viewport body and drag bbox', () => {
    const region = createLive2DHitRegion({
      getCanvas: () => makeFakeCanvas({ gl: makeFakeGl(255) }),
      getViewport: () => VIEWPORT,
      deviceTier: 'C',
    });
    expect(region.body).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
    expect(region.drag).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
  });

  it('fires onDegraded once with reason_code = device_tier_c', () => {
    const onDegraded = vi.fn();
    createLive2DHitRegion({
      getCanvas: () => makeFakeCanvas({ gl: makeFakeGl(255) }),
      getViewport: () => VIEWPORT,
      deviceTier: 'C',
      onDegraded,
    });
    expect(onDegraded).toHaveBeenCalledTimes(1);
    expect(onDegraded.mock.calls[0]![0].reason_code).toBe('device_tier_c');
    expect(typeof onDegraded.mock.calls[0]![0].recordedAt).toBe('string');
    expect(
      Number.isFinite(Date.parse(onDegraded.mock.calls[0]![0].recordedAt)),
    ).toBe(true);
  });

  it('does not call canvas.getContext on tier C', () => {
    const canvas = makeFakeCanvas({ gl: makeFakeGl(255) });
    createLive2DHitRegion({
      getCanvas: () => canvas,
      getViewport: () => VIEWPORT,
      deviceTier: 'C',
    });
    expect(canvas.getContext).not.toHaveBeenCalled();
  });
});

describe('createLive2DHitRegion (default tier)', () => {
  it('defaults to tier C when caller provides no device tier', () => {
    const onDegraded = vi.fn();
    const region = createLive2DHitRegion({
      getCanvas: () => makeFakeCanvas({ gl: makeFakeGl(255) }),
      getViewport: () => VIEWPORT,
      onDegraded,
    });
    expect(region.isOpaqueAtClientPoint).toBeNull();
    expect(onDegraded).toHaveBeenCalledTimes(1);
  });
});
