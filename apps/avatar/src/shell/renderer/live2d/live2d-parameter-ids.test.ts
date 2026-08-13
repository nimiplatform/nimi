import { describe, expect, it } from 'vitest';
import type { Live2DVisualModelShape } from './carrier-visual-runtime.js';
import { readLive2DKnownParameterIds } from './live2d-parameter-ids.js';

function modelWithIds(input: Record<string, unknown>): Live2DVisualModelShape {
  return input as unknown as Live2DVisualModelShape;
}

describe('readLive2DKnownParameterIds', () => {
  it('discovers Cubism Framework id handles from the production _parameterIds array', () => {
    const model = modelWithIds({
      _parameterIds: [
        { getString: () => 'ParamAngleX' },
        { getString: () => 'ParamMouthOpenY' },
      ],
    });

    expect(readLive2DKnownParameterIds(model)).toEqual(
      new Set(['ParamAngleX', 'ParamMouthOpenY']),
    );
  });

  it('combines public string ids with framework id handles', () => {
    const model = modelWithIds({
      parameters: { ids: ['ParamEyeLOpen'] },
      _parameterIds: [{ getString: () => 'ParamEyeROpen' }],
    });

    expect(readLive2DKnownParameterIds(model)).toEqual(
      new Set(['ParamEyeLOpen', 'ParamEyeROpen']),
    );
  });
});
