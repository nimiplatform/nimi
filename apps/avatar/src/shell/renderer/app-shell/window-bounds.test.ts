// Wave 4 — window-bounds-policy.yaml conformance tests.
//
// Asserts the renderer's bounds computer matches the policy table:
//   - width_px  = embodiment_bounds.width  * avatar_scale + 2 * padding_px
//   - height_px = embodiment_bounds.height * avatar_scale + 2 * padding_px
//   - padding_px = 16
//   - min/max width + height clamps
//   - recompute_triggers fire synchronously

import { describe, expect, it, vi } from 'vitest';
import {
  WINDOW_BOUNDS_DEFAULT_AVATAR_SCALE,
  WINDOW_BOUNDS_MAX_HEIGHT_PX,
  WINDOW_BOUNDS_MAX_WIDTH_PX,
  WINDOW_BOUNDS_MIN_HEIGHT_PX,
  WINDOW_BOUNDS_MIN_WIDTH_PX,
  WINDOW_BOUNDS_PADDING_PX,
  computeWindowBounds,
  createWindowBoundsRecomputer,
} from './window-bounds.js';

describe('computeWindowBounds - composition.formula', () => {
  it('sizes from embodiment bounds, avatar scale, and padding only', () => {
    const result = computeWindowBounds({
      embodimentBounds: { width: 320, height: 480 },
      avatarScale: 1.25,
    });
    expect(result.width).toBe(320 * 1.25 + 2 * WINDOW_BOUNDS_PADDING_PX);
    expect(result.height).toBe(480 * 1.25 + 2 * WINDOW_BOUNDS_PADDING_PX);
    expect(result.clamped).toBe(false);
  });

  it('defaults avatar scale to 1 when omitted or invalid', () => {
    const omitted = computeWindowBounds({
      embodimentBounds: { width: 400, height: 600 },
    });
    const invalid = computeWindowBounds({
      embodimentBounds: { width: 400, height: 600 },
      avatarScale: 0,
    });
    const expected = {
      width: 400 * WINDOW_BOUNDS_DEFAULT_AVATAR_SCALE + 2 * WINDOW_BOUNDS_PADDING_PX,
      height: 600 * WINDOW_BOUNDS_DEFAULT_AVATAR_SCALE + 2 * WINDOW_BOUNDS_PADDING_PX,
      clamped: false,
    };
    expect(omitted).toEqual(expected);
    expect(invalid).toEqual(expected);
  });

  it('rounds to integer pixels', () => {
    const result = computeWindowBounds({
      embodimentBounds: { width: 320.4, height: 480.6 },
      avatarScale: 1.1,
    });
    expect(Number.isInteger(result.width)).toBe(true);
    expect(Number.isInteger(result.height)).toBe(true);
  });

  it('clamps width to [min, max] and reports clamped=true', () => {
    const tooSmall = computeWindowBounds({
      embodimentBounds: { width: 100, height: 480 },
      avatarScale: 1,
    });
    expect(tooSmall.width).toBe(WINDOW_BOUNDS_MIN_WIDTH_PX);
    expect(tooSmall.clamped).toBe(true);

    const tooBig = computeWindowBounds({
      embodimentBounds: { width: 2000, height: 480 },
      avatarScale: 1,
    });
    expect(tooBig.width).toBe(WINDOW_BOUNDS_MAX_WIDTH_PX);
    expect(tooBig.clamped).toBe(true);
  });

  it('clamps height to [min, max] and reports clamped=true', () => {
    const tooShort = computeWindowBounds({
      embodimentBounds: { width: 400, height: 100 },
      avatarScale: 1,
    });
    expect(tooShort.height).toBe(WINDOW_BOUNDS_MIN_HEIGHT_PX);
    expect(tooShort.clamped).toBe(true);

    const tooTall = computeWindowBounds({
      embodimentBounds: { width: 400, height: 2000 },
      avatarScale: 1,
    });
    expect(tooTall.height).toBe(WINDOW_BOUNDS_MAX_HEIGHT_PX);
    expect(tooTall.clamped).toBe(true);
  });

  it('treats non-finite or negative embodiment inputs as zero', () => {
    const result = computeWindowBounds({
      embodimentBounds: { width: Number.NaN, height: -50 },
      avatarScale: Number.POSITIVE_INFINITY,
    });
    expect(result.width).toBe(WINDOW_BOUNDS_MIN_WIDTH_PX);
    expect(result.height).toBe(WINDOW_BOUNDS_MIN_HEIGHT_PX);
    expect(result.clamped).toBe(true);
  });
});

describe('createWindowBoundsRecomputer - recompute_triggers', () => {
  function makeDeps(overrides?: Partial<Parameters<typeof createWindowBoundsRecomputer>[0]>) {
    const applySize = vi.fn();
    const onRecomputed = vi.fn();
    return {
      deps: {
        getEmbodimentBounds: () => ({ width: 320, height: 480 }),
        getAvatarScale: () => 1.25,
        applySize,
        onRecomputed,
        ...overrides,
      } as Parameters<typeof createWindowBoundsRecomputer>[0],
      applySize,
      onRecomputed,
    };
  }

  it('model_load applies size synchronously and emits after native apply succeeds', async () => {
    const ctx = makeDeps();
    const recomputer = createWindowBoundsRecomputer(ctx.deps);
    recomputer.trigger('model_load');
    expect(ctx.applySize).toHaveBeenCalledTimes(1);
    expect(ctx.applySize).toHaveBeenCalledWith({
      width: 320 * 1.25 + 2 * WINDOW_BOUNDS_PADDING_PX,
      height: 480 * 1.25 + 2 * WINDOW_BOUNDS_PADDING_PX,
    });
    await Promise.resolve();
    expect(ctx.onRecomputed).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'model_load', avatarScale: 1.25, clamped: false }),
    );
  });

  it('model_switch applies size synchronously', async () => {
    const ctx = makeDeps();
    const recomputer = createWindowBoundsRecomputer(ctx.deps);
    recomputer.trigger('model_switch');
    expect(ctx.applySize).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(ctx.onRecomputed).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'model_switch' }),
    );
  });

  it('avatar_scale_change applies size synchronously with the latest scale', async () => {
    let scale = 1;
    const ctx = makeDeps({ getAvatarScale: () => scale });
    const recomputer = createWindowBoundsRecomputer(ctx.deps);
    scale = 1.5;
    recomputer.trigger('avatar_scale_change');
    expect(ctx.applySize).toHaveBeenCalledWith({
      width: 320 * 1.5 + 2 * WINDOW_BOUNDS_PADDING_PX,
      height: 480 * 1.5 + 2 * WINDOW_BOUNDS_PADDING_PX,
    });
    await Promise.resolve();
    expect(ctx.onRecomputed).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'avatar_scale_change', avatarScale: 1.5 }),
    );
  });

  it('does not emit recomputed success when native applySize fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = makeDeps({
      applySize: vi.fn(async () => {
        throw new Error('native set_size failed');
      }),
    });
    const recomputer = createWindowBoundsRecomputer(ctx.deps);
    recomputer.trigger('model_load');
    await Promise.resolve();
    await Promise.resolve();

    expect(ctx.onRecomputed).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('skips recompute when no model is loaded (getEmbodimentBounds=null)', () => {
    const ctx = makeDeps({ getEmbodimentBounds: () => null });
    const recomputer = createWindowBoundsRecomputer(ctx.deps);
    recomputer.trigger('model_load');
    expect(ctx.applySize).not.toHaveBeenCalled();
    expect(ctx.onRecomputed).not.toHaveBeenCalled();
  });

  it('dispose ignores subsequent triggers', () => {
    const ctx = makeDeps();
    const recomputer = createWindowBoundsRecomputer(ctx.deps);
    recomputer.dispose();
    recomputer.trigger('model_load');
    expect(ctx.applySize).not.toHaveBeenCalled();
  });
});
