import { describe, expect, it, vi } from 'vitest';
import type { Live2DVisualModelShape } from './carrier-visual-runtime.js';
import {
  createLive2DParameterLaneScheduler,
  LIVE2D_PARAMETER_LANE_ORDER,
} from './live2d-parameter-lane-scheduler.js';

function createModel(initial: Record<string, number>): Live2DVisualModelShape {
  const ids = Object.keys(initial);
  const values = ids.map((id) => initial[id] ?? 0);
  const defaults = [...values];
  const indexFor = (parameterId: unknown): number => ids.indexOf(String(parameterId));
  return {
    loadParameters: vi.fn(),
    saveParameters: vi.fn(),
    update: vi.fn(),
    setParameterValueById: vi.fn((parameterId: unknown, value: number) => {
      const index = indexFor(parameterId);
      if (index >= 0) values[index] = value;
    }),
    getParameterValueById: vi.fn((parameterId: unknown) => {
      const index = indexFor(parameterId);
      return index >= 0 ? values[index] ?? 0 : Number.NaN;
    }),
    getParameterDefaultValueById: vi.fn((parameterId: unknown) => {
      const index = indexFor(parameterId);
      return index >= 0 ? defaults[index] ?? 0 : Number.NaN;
    }),
    addParameterValueById: vi.fn((parameterId: unknown, value: number) => {
      const index = indexFor(parameterId);
      if (index >= 0) values[index] = (values[index] ?? 0) + value;
    }),
    multiplyParameterValueById: vi.fn((parameterId: unknown, value: number) => {
      const index = indexFor(parameterId);
      if (index >= 0) values[index] = (values[index] ?? 0) * value;
    }),
    parameters: { ids, values, defaultValues: defaults },
    getCanvasWidth: () => 2,
    getCanvasHeight: () => 2,
    getDrawableCount: () => 1,
    getDrawableOpacity: () => 1,
    getDrawableDynamicFlagIsVisible: () => true,
    getDrawableVertexCount: () => 4,
  };
}

function tickingNow(): () => number {
  let value = 0;
  return () => {
    value += 0.25;
    return value;
  };
}

describe('Live2D parameter lane scheduler', () => {
  it('applies deterministic lanes and lets direct writes protect mouth, eye, and angle parameters', () => {
    const model = createModel({
      ParamMouthOpenY: 0,
      ParamEyeLOpen: 1,
      ParamAngleX: 0,
    });
    const scheduler = createLive2DParameterLaneScheduler({ now: tickingNow() });
    const stats = scheduler.run({
      model,
      parameters: {
        speechLipsync: new Map([
          ['ParamMouthOpenY', 0.3],
        ]),
        live2dExtensionDirect: new Map([
          ['ParamMouthOpenY', 0.1],
          ['ParamEyeLOpen', 0.8],
          ['ParamAngleX', 11],
        ]),
      },
      lanes: {
        motion: () => {
          model.setParameterValueById('ParamMouthOpenY', 0.6);
          model.setParameterValueById('ParamEyeLOpen', 0.2);
          model.setParameterValueById('ParamAngleX', 1);
          return true;
        },
        expression: () => {
          model.setParameterValueById('ParamMouthOpenY', 0.9);
          model.setParameterValueById('ParamEyeLOpen', 0.1);
          model.setParameterValueById('ParamAngleX', 4);
          return true;
        },
        physics: () => {
          model.setParameterValueById('ParamAngleX', 7);
          return true;
        },
        breath_blink: () => {
          model.setParameterValueById('ParamEyeLOpen', 0.4);
          return true;
        },
      },
    });

    expect(stats.laneOrder).toEqual(LIVE2D_PARAMETER_LANE_ORDER);
    expect(stats.appliedLanes).toEqual([
      'motion',
      'expression',
      'physics',
      'breath_blink',
      'speech_lipsync',
      'live2d_extension_direct',
    ]);
    expect(model.getParameterValueById?.('ParamMouthOpenY')).toBe(0.1);
    expect(model.getParameterValueById?.('ParamEyeLOpen')).toBe(0.8);
    expect(model.getParameterValueById?.('ParamAngleX')).toBe(11);
  });

  it('warns and no-ops unsupported direct parameter ids without repeated warnings', () => {
    const model = createModel({ ParamAngleX: 0 });
    const warn = vi.fn();
    const scheduler = createLive2DParameterLaneScheduler({ now: tickingNow(), warn });

    const frame = scheduler.run({
      model,
      parameters: {
        speechLipsync: new Map(),
        live2dExtensionDirect: new Map([
          ['ParamMissing', 1],
          ['ParamAngleX', 2],
        ]),
      },
      lanes: {},
    });
    scheduler.run({
      model,
      parameters: {
        speechLipsync: new Map(),
        live2dExtensionDirect: new Map([
          ['ParamMissing', 3],
        ]),
      },
      lanes: {},
    });

    expect(frame.unsupportedParameterIds).toEqual(['ParamMissing']);
    expect(model.setParameterValueById).not.toHaveBeenCalledWith('ParamMissing', expect.any(Number), expect.any(Number));
    expect(model.getParameterValueById?.('ParamAngleX')).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('ParamMissing');
  });
});
