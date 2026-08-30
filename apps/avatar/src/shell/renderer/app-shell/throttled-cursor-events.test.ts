// Contract tests for .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Unit tests for the 60Hz cap on the `set_ignore_cursor_events` IPC
// wrapper. Covers the canonical rapid-pointermove saturation guard, dedup,
// leading-edge fire,
// trailing-edge debounce + dispose semantics.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createThrottledCursorEvents,
  THROTTLED_CURSOR_EVENTS_MIN_INTERVAL_MS,
} from './throttled-cursor-events.js';

describe('throttled-cursor-events — constants', () => {
  it('exports the 60Hz cap as a named constant ≈ 16.67ms', () => {
    expect(THROTTLED_CURSOR_EVENTS_MIN_INTERVAL_MS).toBeCloseTo(1000 / 60, 5);
  });
});

describe('createThrottledCursorEvents — leading edge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the IPC immediately on the first setIgnore call', async () => {
    const ipc = vi.fn(async () => undefined);
    let now = 0;
    const handle = createThrottledCursorEvents({
      ipcOverride: ipc,
      nowMsFn: () => now,
    });
    handle.setIgnore(true);
    expect(ipc).toHaveBeenCalledTimes(1);
    expect(ipc).toHaveBeenCalledWith(true);
  });

  it('deduplicates same-value calls (no IPC for repeats)', () => {
    const ipc = vi.fn(async () => undefined);
    let now = 0;
    const handle = createThrottledCursorEvents({
      ipcOverride: ipc,
      nowMsFn: () => now,
    });
    handle.setIgnore(true);
    handle.setIgnore(true);
    handle.setIgnore(true);
    expect(ipc).toHaveBeenCalledTimes(1);
  });
});

describe('createThrottledCursorEvents — trailing edge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces calls within the rate-limit window; latest value wins', () => {
    const ipc = vi.fn(async () => undefined);
    let now = 0;
    const handle = createThrottledCursorEvents({
      ipcOverride: ipc,
      nowMsFn: () => now,
    });
    handle.setIgnore(true); // fires immediately at t=0
    expect(ipc).toHaveBeenCalledTimes(1);
    expect(ipc).toHaveBeenLastCalledWith(true);
    // Within 16.67ms window — these queue + coalesce.
    now = 5;
    handle.setIgnore(false);
    now = 10;
    handle.setIgnore(true);
    now = 12;
    handle.setIgnore(false);
    expect(ipc).toHaveBeenCalledTimes(1);
    // Advance past the window; the trailing-edge fire delivers `false`
    // (the latest queued value).
    now = 100;
    vi.advanceTimersByTime(100);
    expect(ipc).toHaveBeenCalledTimes(2);
    expect(ipc).toHaveBeenLastCalledWith(false);
  });

  it('fires immediately again after the window elapses', () => {
    const ipc = vi.fn(async () => undefined);
    let now = 0;
    const handle = createThrottledCursorEvents({
      ipcOverride: ipc,
      nowMsFn: () => now,
    });
    handle.setIgnore(true);
    expect(ipc).toHaveBeenCalledTimes(1);
    now = 100; // well past 16.67ms
    handle.setIgnore(false);
    expect(ipc).toHaveBeenCalledTimes(2);
    expect(ipc).toHaveBeenLastCalledWith(false);
  });

  it('cancels a queued click-through when interaction returns to the applied state', async () => {
    const ipc = vi.fn(async () => undefined);
    let now = 0;
    const handle = createThrottledCursorEvents({
      ipcOverride: ipc,
      nowMsFn: () => now,
    });
    handle.setIgnore(false);
    await Promise.resolve();
    now = 5;
    handle.setIgnore(true);
    handle.setIgnore(false);

    now = 100;
    vi.advanceTimersByTime(100);
    expect(ipc).toHaveBeenCalledTimes(1);
    expect(ipc).toHaveBeenLastCalledWith(false);
  });
});

describe('createThrottledCursorEvents — 60Hz rate cap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('caps IPC fires at ~60Hz when 1000 calls are made within 10ms', () => {
    // Canonical 60Hz saturation guard.
    const ipc = vi.fn(async () => undefined);
    let now = 0;
    const handle = createThrottledCursorEvents({
      ipcOverride: ipc,
      nowMsFn: () => now,
    });
    for (let i = 0; i < 1000; i += 1) {
      // Alternate value so dedup doesn't suppress all of them.
      handle.setIgnore(i % 2 === 0);
      now += 0.01;
    }
    // Within 10ms total simulated time the IPC should have fired at most
    // ceil(10 / 16.67) = 1 time (just the leading edge). Trailing edge
    // is queued but not yet flushed.
    expect(ipc.mock.calls.length).toBeLessThanOrEqual(2);
    // Drain the trailing edge.
    now = 100;
    vi.advanceTimersByTime(100);
    // After draining at most 2 fires: leading + trailing.
    expect(ipc.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('createThrottledCursorEvents — flush + dispose', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flush() delivers any pending coalesced value synchronously', async () => {
    const ipc = vi.fn(async () => undefined);
    let now = 0;
    const handle = createThrottledCursorEvents({
      ipcOverride: ipc,
      nowMsFn: () => now,
    });
    handle.setIgnore(true); // leading-edge fire
    now = 5;
    handle.setIgnore(false); // queued
    expect(ipc).toHaveBeenCalledTimes(1);
    await handle.flush();
    expect(ipc).toHaveBeenCalledTimes(2);
    expect(ipc).toHaveBeenLastCalledWith(false);
  });

  it('does not mark a failed IPC value as applied', async () => {
    const ipc = vi
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockRejectedValueOnce(new Error('native ipc failed'))
      .mockResolvedValue(undefined);
    let now = 0;
    const handle = createThrottledCursorEvents({
      ipcOverride: (value) => ipc(value),
      nowMsFn: () => now,
    });
    handle.setIgnore(true);
    await Promise.resolve();
    now = 100;
    handle.setIgnore(true);
    await Promise.resolve();

    expect(ipc).toHaveBeenCalledTimes(2);
    expect(ipc).toHaveBeenNthCalledWith(1, true);
    expect(ipc).toHaveBeenNthCalledWith(2, true);
  });

  it('dispose() cancels pending timer + drops further calls', () => {
    const ipc = vi.fn(async () => undefined);
    let now = 0;
    const handle = createThrottledCursorEvents({
      ipcOverride: ipc,
      nowMsFn: () => now,
    });
    handle.setIgnore(true); // leading edge
    now = 5;
    handle.setIgnore(false); // queued
    handle.dispose();
    now = 100;
    vi.advanceTimersByTime(100);
    expect(ipc).toHaveBeenCalledTimes(1); // pending timer was cancelled
    handle.setIgnore(true);
    handle.setIgnore(false);
    expect(ipc).toHaveBeenCalledTimes(1); // post-dispose calls are dropped
  });
});
