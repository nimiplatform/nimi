import { describe, expect, it } from 'vitest';
import {
  applyModelConfigCapabilityPatch,
  bindingToPickerSelection,
  pickerSelectionToBinding,
  readModelConfigRouteBinding,
  type ModelConfigRouteBinding,
} from '@nimiplatform/kit/core/model-config';
import type { AIConfig, AIScopeRef } from '@nimiplatform/kit/core/sdk-contract';

const scopeRef: AIScopeRef = { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' };

function configWithBinding(binding: ModelConfigRouteBinding | null): AIConfig {
  return {
    scopeRef,
    capabilities: {
      selectedBindings: { 'text.generate': binding },
      localProfileRefs: {},
      selectedParams: {},
    },
    profileOrigin: null,
  };
}

describe('model config route binding core helpers', () => {
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

  it('normalizes AIConfig binding patches without dropping runtime metadata', () => {
    const binding: ModelConfigRouteBinding = {
      source: 'local',
      connectorId: '',
      model: 'asset-1',
      modelId: 'asset-1',
      localModelId: 'qwen-local',
      engine: 'llama.cpp',
      provider: 'llama.cpp',
      adapter: 'llama_cpp',
      endpoint: 'http://127.0.0.1:8080',
      localProviderEndpoint: 'http://127.0.0.1:8080/v1',
      goRuntimeLocalModelId: 'qwen-local',
      goRuntimeStatus: 'installed',
      providerHints: { quant: 'q4' },
      maxContextTokens: 8192,
      maxOutputTokens: 1024,
    };

    const next = applyModelConfigCapabilityPatch(configWithBinding(null), 'text.generate', {
      binding,
      params: { temperature: '0.7' },
    });

    expect(readModelConfigRouteBinding(next, 'text.generate')).toEqual(binding);
    expect(next.capabilities.selectedParams['text.generate']).toEqual({ temperature: '0.7' });
  });
});
