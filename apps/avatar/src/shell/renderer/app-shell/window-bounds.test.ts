// Wave 4 — window-bounds-policy.yaml conformance tests.
//
// Asserts the renderer's bounds computer matches the policy table:
//   - composition.formula  (max-width + stacked height)
//   - padding_px = 16
//   - min/max width + height clamps
//   - companion_footprint min/max height clamps
//   - recompute_triggers debounce semantics

import { describe, expect, it, vi } from 'vitest';
import {
  COMPANION_FOOTPRINT_DEBOUNCE_MS,
  COMPANION_FOOTPRINT_MAX_HEIGHT_PX,
  COMPANION_FOOTPRINT_MIN_HEIGHT_PX,
  WINDOW_BOUNDS_MAX_HEIGHT_PX,
  WINDOW_BOUNDS_MAX_WIDTH_PX,
  WINDOW_BOUNDS_MIN_HEIGHT_PX,
  WINDOW_BOUNDS_MIN_WIDTH_PX,
  WINDOW_BOUNDS_PADDING_PX,
  computeWindowBounds,
  createWindowBoundsRecomputer,
} from './window-bounds.js';

describe('computeWindowBounds — composition.formula', () => {
  it('width = max(embodiment, companion) + 2*padding; height = embodiment + companion + 2*padding', () => {
    // 320 + 32 = 352 → above min 320, below max 1200, no clamp
    // height: 480 + 120 + 32 = 632 → above min 480, below max 1600, no clamp
    const result = computeWindowBounds({
      embodimentBounds: { width: 320, height: 480 },
      companionFootprint: { width: 280, height: 120 },
    });
    expect(result.width).toBe(320 + 2 * WINDOW_BOUNDS_PADDING_PX);
    expect(result.height).toBe(480 + 120 + 2 * WINDOW_BOUNDS_PADDING_PX);
    expect(result.clamped).toBe(false);
  });

  it('takes the wider of embodiment vs companion for width', () => {
    const wideCompanion = computeWindowBounds({
      embodimentBounds: { width: 200, height: 400 },
      companionFootprint: { width: 360, height: 100 },
    });
    expect(wideCompanion.width).toBe(360 + 2 * WINDOW_BOUNDS_PADDING_PX);

    const wideEmbodiment = computeWindowBounds({
      embodimentBounds: { width: 360, height: 400 },
      companionFootprint: { width: 200, height: 100 },
    });
    expect(wideEmbodiment.width).toBe(360 + 2 * WINDOW_BOUNDS_PADDING_PX);
  });

  it('rounds to integer pixels', () => {
    const result = computeWindowBounds({
      embodimentBounds: { width: 320.4, height: 480.6 },
      companionFootprint: { width: 280.7, height: 120.3 },
    });
    expect(Number.isInteger(result.width)).toBe(true);
    expect(Number.isInteger(result.height)).toBe(true);
  });

  it('clamps width to [min, max] and reports clamped=true', () => {
    const tooSmall = computeWindowBounds({
      embodimentBounds: { width: 100, height: 480 },
      companionFootprint: { width: 80, height: 120 },
    });
    expect(tooSmall.width).toBe(WINDOW_BOUNDS_MIN_WIDTH_PX);
    expect(tooSmall.clamped).toBe(true);

    const tooBig = computeWindowBounds({
      embodimentBounds: { width: 2000, height: 480 },
      companionFootprint: { width: 1500, height: 120 },
    });
    expect(tooBig.width).toBe(WINDOW_BOUNDS_MAX_WIDTH_PX);
    expect(tooBig.clamped).toBe(true);
  });

  it('clamps height to [min, max] and reports clamped=true', () => {
    const tooShort = computeWindowBounds({
      embodimentBounds: { width: 400, height: 100 },
      companionFootprint: { width: 300, height: 100 },
    });
    expect(tooShort.height).toBe(WINDOW_BOUNDS_MIN_HEIGHT_PX);
    expect(tooShort.clamped).toBe(true);

    const tooTall = computeWindowBounds({
      embodimentBounds: { width: 400, height: 2000 },
      companionFootprint: { width: 300, height: 200 },
    });
    expect(tooTall.height).toBe(WINDOW_BOUNDS_MAX_HEIGHT_PX);
    expect(tooTall.clamped).toBe(true);
  });

  it('clamps companion footprint height to [min, max] before composing', () => {
    // Companion height 0 → clamped up to MIN. Adds at least MIN_HEIGHT to embodiment.
    const tinyCompanion = computeWindowBounds({
      embodimentBounds: { width: 400, height: 480 },
      companionFootprint: { width: 300, height: 0 },
    });
    expect(tinyCompanion.height).toBe(
      480 + COMPANION_FOOTPRINT_MIN_HEIGHT_PX + 2 * WINDOW_BOUNDS_PADDING_PX,
    );

    // Companion height 1000 → clamped down to MAX
    const hugeCompanion = computeWindowBounds({
      embodimentBounds: { width: 400, height: 480 },
      companionFootprint: { width: 300, height: 1000 },
    });
    expect(hugeCompanion.height).toBe(
      480 + COMPANION_FOOTPRINT_MAX_HEIGHT_PX + 2 * WINDOW_BOUNDS_PADDING_PX,
    );
  });

  it('treats non-finite or negative inputs as zero (fail-close)', () => {
    const result = computeWindowBounds({
      embodimentBounds: { width: Number.NaN, height: -50 },
      companionFootprint: { width: Number.POSITIVE_INFINITY, height: 120 },
    });
    // sanitize → zero embodiment + zero companion width → falls into MIN clamps
    expect(result.width).toBe(WINDOW_BOUNDS_MIN_WIDTH_PX);
    expect(result.height).toBe(WINDOW_BOUNDS_MIN_HEIGHT_PX);
    expect(result.clamped).toBe(true);
  });
});

describe('createWindowBoundsRecomputer — recompute_triggers', () => {
  function makeDeps(overrides?: Partial<Parameters<typeof createWindowBoundsRecomputer>[0]>) {
    const applySize = vi.fn();
    const onRecomputed = vi.fn();
    const setTimer = vi.fn((handler: () => void) => {
      // capture handler and return a synthetic handle; tests advance manually
      pendingHandler = handler;
      return Symbol('timer');
    });
    let pendingHandler: (() => void) | null = null;
    const clearTimer = vi.fn(() => {
      pendingHandler = null;
    });
    return {
      deps: {
        getEmbodimentBounds: () => ({ width: 320, height: 480 }),
        getCompanionFootprint: () => ({ width: 280, height: 120 }),
        applySize,
        onRecomputed,
        setTimer,
        clearTimer,
        ...overrides,
      } as Parameters<typeof createWindowBoundsRecomputer>[0],
      applySize,
      onRecomputed,
      setTimer,
      clearTimer,
      flushTimer: () => pendingHandler?.(),
    };
  }

  it('model_load applies size synchronously and emits after native apply succeeds', async () => {
    const ctx = makeDeps();
    const recomputer = createWindowBoundsRecomputer(ctx.deps);
    recomputer.trigger('model_load');
    expect(ctx.applySize).toHaveBeenCalledTimes(1);
    expect(ctx.applySize).toHaveBeenCalledWith({
      width: 320 + 2 * WINDOW_BOUNDS_PADDING_PX,
      height: 480 + 120 + 2 * WINDOW_BOUNDS_PADDING_PX,
    });
    await Promise.resolve();
    expect(ctx.onRecomputed).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'model_load', clamped: false }),
    );
    expect(ctx.setTimer).not.toHaveBeenCalled();
  });

  it('model_switch applies size synchronously and emits after native apply succeeds', async () => {
    const ctx = makeDeps();
    const recomputer = createWindowBoundsRecomputer(ctx.deps);
    recomputer.trigger('model_switch');
    expect(ctx.applySize).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(ctx.onRecomputed).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'model_switch' }),
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

  it('companion_footprint_change is debounced via setTimer with policy delay', async () => {
    const ctx = makeDeps();
    const recomputer = createWindowBoundsRecomputer(ctx.deps);
    recomputer.trigger('companion_footprint_change');
    // Not applied yet
    expect(ctx.applySize).not.toHaveBeenCalled();
    expect(ctx.setTimer).toHaveBeenCalledTimes(1);
    expect((ctx.setTimer.mock.calls[0] as unknown as [unknown, number])[1]).toBe(
      COMPANION_FOOTPRINT_DEBOUNCE_MS,
    );

    ctx.flushTimer();
    expect(ctx.applySize).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(ctx.onRecomputed).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'companion_footprint_change' }),
    );
  });

  it('rapid companion_footprint_change bursts coalesce into one set_size', () => {
    const ctx = makeDeps();
    const recomputer = createWindowBoundsRecomputer(ctx.deps);
    recomputer.trigger('companion_footprint_change');
    recomputer.trigger('companion_footprint_change');
    recomputer.trigger('companion_footprint_change');
    expect(ctx.clearTimer).toHaveBeenCalledTimes(2); // earlier two cleared
    expect(ctx.setTimer).toHaveBeenCalledTimes(3);
    ctx.flushTimer();
    expect(ctx.applySize).toHaveBeenCalledTimes(1);
  });

  it('skips recompute when no model is loaded (getEmbodimentBounds=null)', () => {
    const ctx = makeDeps({ getEmbodimentBounds: () => null });
    const recomputer = createWindowBoundsRecomputer(ctx.deps);
    recomputer.trigger('model_load');
    expect(ctx.applySize).not.toHaveBeenCalled();
    expect(ctx.onRecomputed).not.toHaveBeenCalled();
  });

  it('synchronous trigger cancels a pending debounced footprint trigger', () => {
    const ctx = makeDeps();
    const recomputer = createWindowBoundsRecomputer(ctx.deps);
    recomputer.trigger('companion_footprint_change');
    expect(ctx.setTimer).toHaveBeenCalledTimes(1);
    recomputer.trigger('model_load');
    expect(ctx.clearTimer).toHaveBeenCalledTimes(1);
    expect(ctx.applySize).toHaveBeenCalledTimes(1);
    expect(ctx.applySize).toHaveBeenCalledWith(
      expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
    );
  });

  it('dispose clears pending timer and ignores subsequent triggers', () => {
    const ctx = makeDeps();
    const recomputer = createWindowBoundsRecomputer(ctx.deps);
    recomputer.trigger('companion_footprint_change');
    recomputer.dispose();
    expect(ctx.clearTimer).toHaveBeenCalled();
    recomputer.trigger('model_load');
    expect(ctx.applySize).not.toHaveBeenCalled();
  });
});
