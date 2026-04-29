import { describe, expect, it } from 'vitest';
import {
  bindingToPickerSelection,
  pickerSelectionToBinding,
} from '../src/headless.js';

describe('model config binding helpers', () => {
  it('preserves cloud provider metadata between picker selection and stored binding', () => {
    const binding = pickerSelectionToBinding({
      source: 'cloud',
      connectorId: 'connector-dashscope',
      provider: 'dashscope',
      model: 'qwen3-tts-vc',
      modelLabel: 'qwen3-tts-vc',
    });

    expect(binding).toEqual({
      source: 'cloud',
      connectorId: 'connector-dashscope',
      provider: 'dashscope',
      model: 'qwen3-tts-vc',
      modelLabel: 'qwen3-tts-vc',
    });

    expect(bindingToPickerSelection(binding)).toEqual({
      source: 'cloud',
      connectorId: 'connector-dashscope',
      provider: 'dashscope',
      model: 'qwen3-tts-vc',
      modelLabel: 'qwen3-tts-vc',
      localModelId: undefined,
      engine: undefined,
    });
  });
});
