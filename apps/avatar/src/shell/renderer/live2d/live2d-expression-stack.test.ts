import { describe, expect, it, vi } from 'vitest';
import type { Live2DVisualModelShape } from './carrier-visual-runtime.js';
import {
  createLive2DExpressionInventory,
  createLive2DExpressionOverlay,
  parseLive2DExpressionInventoryEntry,
  summarizeLive2DExpressionInventory,
} from './live2d-expression-stack.js';

function jsonBuffer(value: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(value)).buffer;
}

function createModel(): Live2DVisualModelShape {
  const ids = ['ParamAngleX', 'ParamEyeLOpen', 'ParamMouthOpenY'];
  const defaults = [0, 1, 0];
  const values = [10, 0.8, 0.2];
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

describe('Live2D expression stack v2', () => {
  it('parses exp3 Add, Multiply, and Overwrite parameters into bounded inventory metadata', () => {
    const entry = parseLive2DExpressionInventoryEntry({
      expressionId: 'joy',
      sourcePath: '/models/ren/runtime/expressions/joy.exp3.json',
      bytes: jsonBuffer({
        Type: 'Live2D Expression',
        Parameters: [
          { Id: 'ParamAngleX', Value: 5, Blend: 'Add' },
          { Id: 'ParamEyeLOpen', Value: 0.5, Blend: 'Multiply' },
          { Id: 'ParamMouthOpenY', Value: 0.7, Blend: 'Overwrite' },
        ],
      }),
    });
    const inventory = createLive2DExpressionInventory([entry]);
    const summary = summarizeLive2DExpressionInventory({ modelId: 'ren', inventory });

    expect(inventory.expressionIds).toEqual(['joy']);
    expect(inventory.parameterIds).toEqual(['ParamAngleX', 'ParamEyeLOpen', 'ParamMouthOpenY']);
    expect(summary).toEqual(expect.objectContaining({
      expressionCount: 1,
      expressionParameterCount: 3,
      expressionStackSupported: true,
      expressionBlendModeCounts: { add: 1, multiply: 1, overwrite: 1 },
    }));
    expect(summary.expressionInventoryRef).toMatch(/^avatar\.live2d\.expression-inventory:ren:/);
  });

  it('applies additive, multiplicative, and overwrite expression parameters deterministically', () => {
    const inventory = createLive2DExpressionInventory([
      {
        expressionId: 'joy',
        sourcePath: '/models/ren/runtime/expressions/joy.exp3.json',
        parameters: [
          { id: 'ParamAngleX', value: 5, blend: 'add' },
          { id: 'ParamEyeLOpen', value: 0.5, blend: 'multiply' },
          { id: 'ParamMouthOpenY', value: 0.7, blend: 'overwrite' },
        ],
      },
    ]);
    const overlay = createLive2DExpressionOverlay(inventory);
    const model = createModel();

    const frame = overlay.apply(model, 'joy');

    expect(frame).toEqual(expect.objectContaining({
      activeExpressionId: 'joy',
      frameApplied: true,
      parameterIds: ['ParamAngleX', 'ParamEyeLOpen', 'ParamMouthOpenY'],
    }));
    expect(model.getParameterValueById?.('ParamAngleX')).toBe(15);
    expect(model.getParameterValueById?.('ParamEyeLOpen')).toBeCloseTo(0.4);
    expect(model.getParameterValueById?.('ParamMouthOpenY')).toBe(0.7);
  });

  it('resets stale expression-only parameters to model defaults when expression clears', () => {
    const inventory = createLive2DExpressionInventory([
      {
        expressionId: 'joy',
        sourcePath: '/models/ren/runtime/expressions/joy.exp3.json',
        parameters: [
          { id: 'ParamAngleX', value: 5, blend: 'add' },
          { id: 'ParamMouthOpenY', value: 0.7, blend: 'overwrite' },
        ],
      },
    ]);
    const overlay = createLive2DExpressionOverlay(inventory);
    const model = createModel();

    overlay.apply(model, 'joy');
    const clearFrame = overlay.apply(model, null);

    expect(clearFrame).toEqual(expect.objectContaining({
      activeExpressionId: null,
      frameApplied: true,
      resetParameterIds: ['ParamAngleX', 'ParamMouthOpenY'],
    }));
    expect(model.getParameterValueById?.('ParamAngleX')).toBe(0);
    expect(model.getParameterValueById?.('ParamMouthOpenY')).toBe(0);
  });

  it('leaves later direct mouth writes able to override expression mouth values', () => {
    const inventory = createLive2DExpressionInventory([
      {
        expressionId: 'talking-smile',
        sourcePath: '/models/ren/runtime/expressions/talking-smile.exp3.json',
        parameters: [
          { id: 'ParamMouthOpenY', value: 0.9, blend: 'overwrite' },
        ],
      },
    ]);
    const overlay = createLive2DExpressionOverlay(inventory);
    const model = createModel();

    overlay.apply(model, 'talking-smile');
    model.setParameterValueById('ParamMouthOpenY', 0.1, 1);

    expect(model.getParameterValueById?.('ParamMouthOpenY')).toBe(0.1);
  });

  it('fails closed on unknown blend modes', () => {
    expect(() => parseLive2DExpressionInventoryEntry({
      expressionId: 'bad',
      sourcePath: '/models/ren/runtime/expressions/bad.exp3.json',
      bytes: jsonBuffer({
        Type: 'Live2D Expression',
        Parameters: [
          { Id: 'ParamAngleX', Value: 1, Blend: 'Screen' },
        ],
      }),
    })).toThrow('blend mode is not admitted');
  });
});
