import { describe, expect, it, vi } from 'vitest';
import type { Live2DVisualModelShape } from './carrier-visual-runtime.js';
import {
  createLive2DLookAtIdleController,
  LIVE2D_LOOK_AT_IDLE_PARAMETER_IDS,
} from './live2d-look-at-idle.js';

function createModel(parameterIds: readonly string[]): Live2DVisualModelShape {
  const values: number[] = parameterIds.map((id) => id.endsWith('Open') ? 1 : 0);
  const defaults: number[] = [...values];
  const indexFor = (parameterId: unknown): number => parameterIds.indexOf(String(parameterId));
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
    parameters: { ids: parameterIds, values, defaultValues: defaults },
    getCanvasWidth: () => 2,
    getCanvasHeight: () => 2,
    getDrawableCount: () => 1,
    getDrawableOpacity: () => 1,
    getDrawableDynamicFlagIsVisible: () => true,
    getDrawableVertexCount: () => 4,
  };
}

describe('Live2D look-at / idle-life controller', () => {
  it('maps focus angle state to eye-ball parameters and applies forced blink when supported', () => {
    const model = createModel([
      ...LIVE2D_LOOK_AT_IDLE_PARAMETER_IDS.gaze,
      ...LIVE2D_LOOK_AT_IDLE_PARAMETER_IDS.blink,
    ]);
    const controller = createLive2DLookAtIdleController(model);

    const frame = controller.apply({
      model,
      deltaTimeSeconds: 1 / 30,
      seconds: 4.21,
      directParameters: new Map([
        ['ParamAngleX', 15],
        ['ParamAngleY', -10],
      ]),
    });

    expect(frame).toEqual(expect.objectContaining({
      applied: true,
      gazeSupported: true,
      blinkSupported: true,
      reasonCode: 'ready',
      parameterIds: ['ParamEyeBallX', 'ParamEyeBallY', 'ParamEyeLOpen', 'ParamEyeROpen'],
    }));
    expect(model.setParameterValueById).toHaveBeenCalledWith('ParamEyeBallX', expect.any(Number), 1);
    expect(model.setParameterValueById).toHaveBeenCalledWith('ParamEyeBallY', expect.any(Number), 1);
    expect(model.setParameterValueById).toHaveBeenCalledWith('ParamEyeLOpen', 0, 1);
    expect(model.setParameterValueById).toHaveBeenCalledWith('ParamEyeROpen', 0, 1);
  });

  it('degrades explicitly without writing when compatible eye parameters are absent', () => {
    const model = createModel(['ParamAngleX']);
    const controller = createLive2DLookAtIdleController(model);

    const frame = controller.apply({
      model,
      deltaTimeSeconds: 1 / 60,
      seconds: 1,
      directParameters: new Map([
        ['ParamAngleX', 8],
      ]),
    });

    expect(frame).toEqual({
      applied: false,
      gazeSupported: false,
      blinkSupported: false,
      parameterIds: [],
      reasonCode: 'eye_parameters_missing',
    });
    expect(model.setParameterValueById).not.toHaveBeenCalled();
  });
});
