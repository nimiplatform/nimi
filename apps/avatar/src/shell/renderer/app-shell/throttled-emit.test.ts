// Contract tests for .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Unit tests for the generic 100ms-cap consumer-callback throttle used to
// throttle `onHitRegionChange` payload delivery. Covers the canonical
// ≤ 1 fire per 100ms limit regardless of input rate.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createThrottledEmit,
  THROTTLED_EMIT_DEFAULT_MIN_INTERVAL_MS,
} from './throttled-emit.js';

describe('throttled-emit — constants', () => {
  it('exports the 100ms default as a named constant', () => {
    expect(THROTTLED_EMIT_DEFAULT_MIN_INTERVAL_MS).toBe(100);
  });
});

describe('createThrottledEmit — leading edge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the consumer callback immediately on first emit', () => {
    const cb = vi.fn();
    let now = 0;
    const handle = createThrottledEmit<number>({
      callback: cb,
      nowMsFn: () => now,
    });
    handle.emit(42);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(42);
  });
});

describe('createThrottledEmit — trailing edge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces emits within the window; latest value wins', () => {
    const cb = vi.fn();
    let now = 0;
    const handle = createThrottledEmit<string>({
      callback: cb,
      nowMsFn: () => now,
    });
    handle.emit('a'); // leading edge fires
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith('a');
    now = 20;
    handle.emit('b');
    now = 50;
    handle.emit('c');
    now = 80;
    handle.emit('d');
    expect(cb).toHaveBeenCalledTimes(1);
    now = 200;
    vi.advanceTimersByTime(200);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith('d');
  });

  it('caps consumer fires at ≤ 1 per 100ms when 1000 emits arrive in 10ms', () => {
    // Canonical 100ms saturation guard.
    const cb = vi.fn();
    let now = 0;
    const handle = createThrottledEmit<number>({
      callback: cb,
      nowMsFn: () => now,
    });
    for (let i = 0; i < 1000; i += 1) {
      handle.emit(i);
      now += 0.01;
    }
    // After 10ms the leading edge has fired once; trailing edge queued.
    expect(cb.mock.calls.length).toBeLessThanOrEqual(1);
    now = 200;
    vi.advanceTimersByTime(200);
    // After full drain: leading + trailing = 2 max.
    expect(cb.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('respects custom minIntervalMs', () => {
    const cb = vi.fn();
    let now = 0;
    const handle = createThrottledEmit<number>({
      callback: cb,
      minIntervalMs: 1000,
      nowMsFn: () => now,
    });
    handle.emit(1);
    now = 500;
    handle.emit(2);
    expect(cb).toHaveBeenCalledTimes(1);
    now = 1100;
    vi.advanceTimersByTime(1100);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith(2);
  });
});

describe('createThrottledEmit — flush + dispose', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flush() delivers pending coalesced value synchronously', () => {
    const cb = vi.fn();
    let now = 0;
    const handle = createThrottledEmit<number>({
      callback: cb,
      nowMsFn: () => now,
    });
    handle.emit(1); // leading
    now = 30;
    handle.emit(2); // queued
    expect(cb).toHaveBeenCalledTimes(1);
    handle.flush();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith(2);
  });

  it('dispose() cancels pending timer + drops further emits', () => {
    const cb = vi.fn();
    let now = 0;
    const handle = createThrottledEmit<number>({
      callback: cb,
      nowMsFn: () => now,
    });
    handle.emit(1); // leading
    now = 30;
    handle.emit(2); // queued
    handle.dispose();
    now = 200;
    vi.advanceTimersByTime(200);
    expect(cb).toHaveBeenCalledTimes(1);
    handle.emit(3);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('survives a throwing consumer without leaking', () => {
    let calls = 0;
    const cb = (_: number) => {
      calls += 1;
      throw new Error('consumer threw');
    };
    let now = 0;
    const handle = createThrottledEmit<number>({
      callback: cb,
      nowMsFn: () => now,
    });
    expect(() => handle.emit(1)).not.toThrow();
    expect(calls).toBe(1);
  });
});
