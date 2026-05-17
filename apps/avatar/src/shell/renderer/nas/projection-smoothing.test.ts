import { describe, expect, it, vi } from 'vitest';
import type { EmbodimentProjectionApi, ProjectionBounds } from './embodiment-projection-api.js';
import {
  PROJECTION_SIGNAL_SMOOTHING_MAX_PENDING_SIGNALS,
  createSmoothedProjection,
} from './projection-smoothing.js';

function createBaseProjection() {
  const signals = new Map<string, number>();
  const calls: string[] = [];
  const bounds: ProjectionBounds = { x: 1, y: 2, width: 3, height: 4 };
  const projection: EmbodimentProjectionApi = {
    async triggerMotion(motionId) {
      calls.push(`motion:${motionId}`);
    },
    stopMotion() {
      calls.push('motion-stop');
    },
    setSignal(signalId, value) {
      calls.push(`set:${signalId}:${value}`);
      signals.set(signalId, value);
    },
    getSignal(signalId) {
      return signals.get(signalId) ?? 0;
    },
    addSignal(signalId, delta) {
      calls.push(`add:${signalId}:${delta}`);
      signals.set(signalId, (signals.get(signalId) ?? 0) + delta);
    },
    async setExpression(expressionId) {
      calls.push(`expression:${expressionId}`);
    },
    clearExpression() {
      calls.push('expression-clear');
    },
    setPose(poseId) {
      calls.push(`pose:${poseId}`);
    },
    clearPose() {
      calls.push('pose-clear');
    },
    async wait(ms) {
      calls.push(`wait:${ms}`);
    },
    getSurfaceBounds() {
      return bounds;
    },
    async runDefaultActivity(activityId) {
      calls.push(`activity:${activityId}`);
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
    flushOne() {
      callbacks.shift()?.();
    },
    get pendingCount() {
      return callbacks.length;
    },
  };
}

describe('createSmoothedProjection', () => {
  it('coalesces repeated setSignal writes so the latest value wins', () => {
    const base = createBaseProjection();
    const manual = createManualFlushRequester();
    const handle = createSmoothedProjection({ projection: base.projection, requestFlush: manual.requestFlush });

    handle.projection.setSignal('ParamAngleX', 1, 0.2);
    handle.projection.setSignal('ParamAngleX', 2, 0.4);
    handle.projection.setSignal('ParamBodyX', 3, 0.5);

    expect(base.calls).toEqual([]);
    expect(handle.projection.getSignal('ParamAngleX')).toBe(2);
    expect(manual.pendingCount).toBe(1);

    manual.flushOne();

    expect(base.calls).toEqual(['set:ParamAngleX:2', 'set:ParamBodyX:3']);
    expect(base.signals.get('ParamAngleX')).toBe(2);
    expect(handle.getStats()).toMatchObject({
      pendingSignalCount: 0,
      flushCount: 1,
      coalescedSetCount: 1,
    });
  });

  it('accumulates addSignal writes and preserves read-your-write behavior', () => {
    const base = createBaseProjection();
    base.signals.set('ParamMouthOpenY', 0.25);
    const manual = createManualFlushRequester();
    const handle = createSmoothedProjection({ projection: base.projection, requestFlush: manual.requestFlush });

    handle.projection.addSignal('ParamMouthOpenY', 0.1);
    handle.projection.addSignal('ParamMouthOpenY', 0.15);

    expect(handle.projection.getSignal('ParamMouthOpenY')).toBeCloseTo(0.5);
    expect(base.signals.get('ParamMouthOpenY')).toBe(0.25);

    manual.flushOne();

    expect(base.calls).toEqual(['add:ParamMouthOpenY:0.25']);
    expect(base.signals.get('ParamMouthOpenY')).toBeCloseTo(0.5);
  });

  it('flushes pending signals before non-signal projection calls', async () => {
    const base = createBaseProjection();
    const manual = createManualFlushRequester();
    const handle = createSmoothedProjection({ projection: base.projection, requestFlush: manual.requestFlush });

    handle.projection.setSignal('ParamAngleY', 4);
    await handle.projection.setExpression('happy');

    expect(base.calls).toEqual(['set:ParamAngleY:4', 'expression:happy']);
    expect(manual.pendingCount).toBe(0);
  });

  it('bounds pending signal memory by flushing before adding a new signal beyond the cap', () => {
    const base = createBaseProjection();
    const manual = createManualFlushRequester();
    const handle = createSmoothedProjection({ projection: base.projection, requestFlush: manual.requestFlush });

    for (let index = 0; index < PROJECTION_SIGNAL_SMOOTHING_MAX_PENDING_SIGNALS; index += 1) {
      handle.projection.setSignal(`Param${index}`, index);
    }
    handle.projection.setSignal('ParamOverflow', 999);

    expect(base.calls).toHaveLength(PROJECTION_SIGNAL_SMOOTHING_MAX_PENDING_SIGNALS);
    expect(handle.getStats().pendingSignalCount).toBe(1);
  });

  it('flushes and ignores later signal writes after dispose', () => {
    const base = createBaseProjection();
    const manual = createManualFlushRequester();
    const handle = createSmoothedProjection({ projection: base.projection, requestFlush: manual.requestFlush });

    handle.projection.setSignal('ParamAngleX', 1);
    handle.dispose();
    handle.projection.setSignal('ParamAngleX', 2);
    manual.flushOne();

    expect(base.calls).toEqual(['set:ParamAngleX:1']);
    expect(base.signals.get('ParamAngleX')).toBe(1);
  });

  it('does not smooth surface bounds reads', () => {
    const base = createBaseProjection();
    const manual = createManualFlushRequester();
    const handle = createSmoothedProjection({ projection: base.projection, requestFlush: manual.requestFlush });

    expect(handle.projection.getSurfaceBounds()).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(base.calls).toEqual([]);
  });

  it('does not leak consumer exceptions from flush into scheduled callback cancellation', () => {
    const projection = createBaseProjection().projection;
    const setSignalSpy = vi.spyOn(projection, 'setSignal').mockImplementation(() => {
      throw new Error('renderer signal write failed');
    });
    const manual = createManualFlushRequester();
    const handle = createSmoothedProjection({ projection, requestFlush: manual.requestFlush });

    handle.projection.setSignal('ParamAngleX', 1);

    expect(() => manual.flushOne()).toThrow('renderer signal write failed');
    expect(setSignalSpy).toHaveBeenCalledOnce();
  });
});
