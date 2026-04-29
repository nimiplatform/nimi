// Wave 3 — Live2D lipsync bridge unit test.
// Covers: ParamMouthOpenY + ParamMouthForm projection writes, audioLevel→form
// derivation, time-anchored frame scheduling (`monotonic_with_wall_anchor`),
// past-due frame catch-up, cancel/reset semantics, and opt-out for models
// without ParamMouthForm.

import { describe, expect, it, vi } from 'vitest';
import {
  Live2DLipsyncBridge,
  LIVE2D_PARAM_MOUTH_OPEN,
  LIVE2D_PARAM_MOUTH_FORM,
  audioLevelToMouthForm,
} from './lipsync-bridge.js';
import type { EmbodimentProjectionApi } from '../nas/embodiment-projection-api.js';

function makeProjection(): { projection: EmbodimentProjectionApi; setSignal: ReturnType<typeof vi.fn> } {
  const setSignal = vi.fn();
  const projection: EmbodimentProjectionApi = {
    triggerMotion: vi.fn(async () => undefined),
    stopMotion: vi.fn(),
    setSignal,
    getSignal: vi.fn(() => 0),
    addSignal: vi.fn(),
    setExpression: vi.fn(async () => undefined),
    clearExpression: vi.fn(),
    setPose: vi.fn(),
    clearPose: vi.fn(),
    wait: vi.fn(async () => undefined),
    getSurfaceBounds: vi.fn(() => ({ x: 0, y: 0, width: 400, height: 600 })),
  };
  return { projection, setSignal };
}

describe('audioLevelToMouthForm', () => {
  it('maps 0 → -1 (closed-vowel) and 1 → +1 (open-vowel)', () => {
    expect(audioLevelToMouthForm(0)).toBe(-1);
    expect(audioLevelToMouthForm(1)).toBe(1);
    expect(audioLevelToMouthForm(0.5)).toBe(0);
  });

  it('clamps out-of-range and rejects non-finite', () => {
    expect(audioLevelToMouthForm(-1)).toBe(-1);
    expect(audioLevelToMouthForm(2)).toBe(1);
    expect(audioLevelToMouthForm(Number.NaN)).toBe(0);
    expect(audioLevelToMouthForm(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('Live2DLipsyncBridge — applyFrame', () => {
  it('writes ParamMouthOpenY and ParamMouthForm', () => {
    const { projection, setSignal } = makeProjection();
    const bridge = new Live2DLipsyncBridge({ projection, mouthFormSignalId: LIVE2D_PARAM_MOUTH_FORM });
    bridge.applyFrame({ offsetMs: 0, mouthOpenY: 0.6, audioLevel: 0.8 });
    expect(setSignal).toHaveBeenCalledWith(LIVE2D_PARAM_MOUTH_OPEN, 0.6, 1);
    // 0.8 → 0.6 (= 0.8 * 2 - 1)
    expect(setSignal).toHaveBeenCalledWith(LIVE2D_PARAM_MOUTH_FORM, expect.closeTo(0.6, 5), 1);
  });

  it('clamps mouthOpenY to [0,1] range', () => {
    const { projection, setSignal } = makeProjection();
    const bridge = new Live2DLipsyncBridge({ projection, mouthFormSignalId: LIVE2D_PARAM_MOUTH_FORM });
    bridge.applyFrame({ offsetMs: 0, mouthOpenY: 1.5, audioLevel: 0.5 });
    expect(setSignal).toHaveBeenCalledWith(LIVE2D_PARAM_MOUTH_OPEN, 1, 1);
    bridge.applyFrame({ offsetMs: 0, mouthOpenY: -0.3, audioLevel: 0.5 });
    expect(setSignal).toHaveBeenCalledWith(LIVE2D_PARAM_MOUTH_OPEN, 0, 1);
  });

  it('skips ParamMouthForm when model opts out (mouthFormSignalId=null)', () => {
    const { projection, setSignal } = makeProjection();
    const bridge = new Live2DLipsyncBridge({ projection, mouthFormSignalId: null });
    bridge.applyFrame({ offsetMs: 0, mouthOpenY: 0.5, audioLevel: 0.7 });
    const calls = setSignal.mock.calls.map((c) => c[0]);
    expect(calls).toContain(LIVE2D_PARAM_MOUTH_OPEN);
    expect(calls).not.toContain(LIVE2D_PARAM_MOUTH_FORM);
  });

  it('rejects non-finite mouthOpenY (fail-close)', () => {
    const { projection, setSignal } = makeProjection();
    const bridge = new Live2DLipsyncBridge({ projection, mouthFormSignalId: LIVE2D_PARAM_MOUTH_FORM });
    bridge.applyFrame({ offsetMs: 0, mouthOpenY: Number.NaN, audioLevel: 0.5 });
    expect(setSignal).not.toHaveBeenCalled();
  });
});

describe('Live2DLipsyncBridge — scheduleFrames', () => {
  it('applies all frames immediately when no audio anchor (synthetic path)', () => {
    const { projection, setSignal } = makeProjection();
    const bridge = new Live2DLipsyncBridge({ projection, mouthFormSignalId: LIVE2D_PARAM_MOUTH_FORM });
    bridge.scheduleFrames({
      frames: [
        { offsetMs: 0, mouthOpenY: 0.1, audioLevel: 0.2 },
        { offsetMs: 80, mouthOpenY: 0.5, audioLevel: 0.6 },
        { offsetMs: 160, mouthOpenY: 0.2, audioLevel: 0.3 },
      ],
      audioStartedAtMs: null,
    });
    const openCalls = setSignal.mock.calls.filter((c) => c[0] === LIVE2D_PARAM_MOUTH_OPEN);
    expect(openCalls).toHaveLength(3);
    expect(openCalls.map((c) => c[1])).toEqual([0.1, 0.5, 0.2]);
  });

  it('applies past-due frames immediately when wall-clock anchor is in the past', () => {
    const { projection, setSignal } = makeProjection();
    const setTimer = vi.fn((handler) => {
      handler();
      return Symbol('handle');
    });
    const bridge = new Live2DLipsyncBridge({
      projection,
      setTimer,
      now: () => 10_000,
    });
    bridge.scheduleFrames({
      frames: [
        { offsetMs: 0, mouthOpenY: 0.3, audioLevel: 0.4 },
        { offsetMs: 80, mouthOpenY: 0.7, audioLevel: 0.8 },
      ],
      audioStartedAtMs: 9_900, // 100ms in the past — both offsets already due
    });
    expect(setTimer).not.toHaveBeenCalled();
    const openCalls = setSignal.mock.calls.filter((c) => c[0] === LIVE2D_PARAM_MOUTH_OPEN);
    expect(openCalls).toHaveLength(2);
  });

  it('schedules future frames via setTimer with delay = audioStartedAtMs + offset - now', () => {
    const { projection } = makeProjection();
    const setTimer = vi.fn(() => Symbol('handle'));
    const bridge = new Live2DLipsyncBridge({
      projection,
      setTimer,
      now: () => 10_000,
    });
    bridge.scheduleFrames({
      frames: [
        { offsetMs: 50, mouthOpenY: 0.3, audioLevel: 0.4 }, // due at 10_050
        { offsetMs: 200, mouthOpenY: 0.7, audioLevel: 0.6 }, // due at 10_200
      ],
      audioStartedAtMs: 10_000,
    });
    expect(setTimer).toHaveBeenCalledTimes(2);
    expect((setTimer.mock.calls[0] as unknown as [unknown, number])[1]).toBe(50);
    expect((setTimer.mock.calls[1] as unknown as [unknown, number])[1]).toBe(200);
  });
});

describe('Live2DLipsyncBridge — cancel + reset', () => {
  it('cancel() clears pending timers', () => {
    const { projection } = makeProjection();
    const handles: symbol[] = [];
    const setTimer = vi.fn(() => {
      const h = Symbol('h');
      handles.push(h);
      return h;
    });
    const clearTimer = vi.fn();
    const bridge = new Live2DLipsyncBridge({
      projection,
      setTimer,
      clearTimer,
      now: () => 0,
    });
    bridge.scheduleFrames({
      frames: [
        { offsetMs: 100, mouthOpenY: 0.5, audioLevel: 0.5 },
        { offsetMs: 200, mouthOpenY: 0.6, audioLevel: 0.6 },
      ],
      audioStartedAtMs: 0,
    });
    expect(setTimer).toHaveBeenCalledTimes(2);
    bridge.cancel();
    expect(clearTimer).toHaveBeenCalledTimes(2);
  });

  it('reset() forces both params to neutral', () => {
    const { projection, setSignal } = makeProjection();
    const bridge = new Live2DLipsyncBridge({ projection, mouthFormSignalId: LIVE2D_PARAM_MOUTH_FORM });
    bridge.reset();
    expect(setSignal).toHaveBeenCalledWith(LIVE2D_PARAM_MOUTH_OPEN, 0, 1);
    expect(setSignal).toHaveBeenCalledWith(LIVE2D_PARAM_MOUTH_FORM, 0, 1);
  });

  it('cancelAndReset() cancels timers and resets params', () => {
    const { projection, setSignal } = makeProjection();
    const setTimer = vi.fn(() => Symbol('h'));
    const clearTimer = vi.fn();
    const bridge = new Live2DLipsyncBridge({
      projection,
      mouthFormSignalId: LIVE2D_PARAM_MOUTH_FORM,
      setTimer,
      clearTimer,
      now: () => 0,
    });
    bridge.scheduleFrames({
      frames: [{ offsetMs: 100, mouthOpenY: 0.5, audioLevel: 0.5 }],
      audioStartedAtMs: 0,
    });
    setSignal.mockClear();
    bridge.cancelAndReset();
    expect(clearTimer).toHaveBeenCalledTimes(1);
    expect(setSignal).toHaveBeenCalledWith(LIVE2D_PARAM_MOUTH_OPEN, 0, 1);
    expect(setSignal).toHaveBeenCalledWith(LIVE2D_PARAM_MOUTH_FORM, 0, 1);
  });
});
