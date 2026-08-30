import { describe, expect, it } from 'vitest';
import {
  createSmoothedSignalProjection,
  SIGNAL_PROJECTION_SMOOTHING_MAX_PENDING_SIGNALS,
  type AvatarSignalProjection,
} from './signal-projection.js';

function createBaseProjection() {
  const signals = new Map<string, number>();
  const calls: string[] = [];
  const projection: AvatarSignalProjection = {
    setSignal(signalId, value) {
      calls.push(`set:${signalId}:${value}`);
      signals.set(signalId, value);
    },
    getSignal: (signalId) => signals.get(signalId) ?? 0,
    addSignal(signalId, delta) {
      calls.push(`add:${signalId}:${delta}`);
      signals.set(signalId, (signals.get(signalId) ?? 0) + delta);
    },
  };
  return { projection, calls, signals };
}

function createManualFlushRequester() {
  const callbacks: Array<() => void> = [];
  return {
    requestFlush(callback: () => void) {
      callbacks.push(callback);
      return () => {
        const index = callbacks.indexOf(callback);
        if (index >= 0) callbacks.splice(index, 1);
      };
    },
    flushOne: () => callbacks.shift()?.(),
    pendingCount: () => callbacks.length,
  };
}

describe('createSmoothedSignalProjection', () => {
  it('coalesces signal writes without carrying activity fallback behavior', () => {
    const base = createBaseProjection();
    const manual = createManualFlushRequester();
    const handle = createSmoothedSignalProjection({
      projection: base.projection,
      requestFlush: manual.requestFlush,
    });

    handle.projection.setSignal('ParamAngleX', 1, 0.2);
    handle.projection.setSignal('ParamAngleX', 2, 0.4);
    handle.projection.addSignal('ParamAngleX', 0.5);

    expect(handle.projection.getSignal('ParamAngleX')).toBe(2.5);
    expect(manual.pendingCount()).toBe(1);
    manual.flushOne();
    expect(base.calls).toEqual(['set:ParamAngleX:2.5']);
    expect(base.signals.get('ParamAngleX')).toBe(2.5);
  });

  it('bounds pending signal state and ignores writes after dispose', () => {
    const base = createBaseProjection();
    const manual = createManualFlushRequester();
    const handle = createSmoothedSignalProjection({
      projection: base.projection,
      requestFlush: manual.requestFlush,
    });
    for (let index = 0; index < SIGNAL_PROJECTION_SMOOTHING_MAX_PENDING_SIGNALS; index += 1) {
      handle.projection.setSignal(`Param${index}`, index);
    }
    handle.projection.setSignal('ParamOverflow', 999);
    expect(base.calls).toHaveLength(SIGNAL_PROJECTION_SMOOTHING_MAX_PENDING_SIGNALS);
    handle.dispose();
    handle.projection.setSignal('ParamOverflow', 1000);
    expect(base.signals.get('ParamOverflow')).toBe(999);
  });
});
