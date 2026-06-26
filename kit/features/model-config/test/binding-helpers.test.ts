import { describe, expect, it } from 'vitest';
import {
  applyModelConfigCapabilityPatch,
  readModelConfigTargetRef,
  summarizeTargetRef,
} from '@nimiplatform/kit/core/model-config';
import {
  pickerSelectionToTargetRef,
  targetRefToPickerSelection,
} from '../src/model-picker-selection-adapter.js';
import { summarizeModelConfigRuntimeTarget } from '../src/headless.js';
import type { NimiAIConfig, NimiAIConfigTargetRef, NimiAIScopeRef } from '@nimiplatform/kit/core/sdk-contract';

const scopeRef: NimiAIScopeRef = { kind: 'app', ownerId: 'desktop', surfaceId: 'chat' };

function configWithTargetRef(targetRef: NimiAIConfigTargetRef | null): NimiAIConfig {
  return {
    scopeRef,
    capabilities: {
      targetRefs: targetRef ? { 'text.generate': targetRef } : {},
      selectedParams: {},
    },
    profileOrigin: null,
  };
}

describe('model config compact target-ref helpers', () => {
  it('summarizes compact cloud refs without provider health or route shape', () => {
    const targetRef: NimiAIConfigTargetRef = {
      kind: 'cloud-connector',
      connectorId: 'connector-dashscope',
      remoteModelCatalogId: 'remote-catalog:dashscope:qwen3-tts-vc',
      provider: 'dashscope',
      providerModelId: 'qwen3-tts-vc',
    };

    expect(summarizeTargetRef(targetRef)).toEqual({
      label: 'dashscope',
      detail: 'qwen3-tts-vc',
    });
  });

  it('patches compact target refs and params without writing selectedBindings', () => {
    const targetRef: NimiAIConfigTargetRef = {
      kind: 'local-runtime',
      version: 'v2',
      readinessRef: 'readiness:desktop:text',
    };

    const next = applyModelConfigCapabilityPatch(configWithTargetRef(null), 'text.generate', {
      targetRef,
      params: { temperature: '0.7' },
    });

    expect(readModelConfigTargetRef(next, 'text.generate')).toEqual(targetRef);
    expect(next.capabilities.selectedParams['text.generate']).toEqual({ temperature: '0.7' });
    expect(JSON.stringify(next)).not.toContain('selectedBindings');
    expect(JSON.stringify(next)).not.toContain('NimiRuntimeRouteBinding');
  });

  it('preserves falsy JSON params when patching selected params', () => {
    const next = applyModelConfigCapabilityPatch(configWithTargetRef(null), 'text.generate', {
      params: {
        enabled: false,
        retries: 0,
        seed: '',
        optional: null,
      },
    });

    expect(next.capabilities.selectedParams['text.generate']).toEqual({
      enabled: false,
      retries: 0,
      seed: '',
      optional: null,
    });
  });

  it('maps compact target refs to the standard route model picker selection shape', () => {
    expect(targetRefToPickerSelection({
      kind: 'cloud-connector',
      connectorId: 'connector-dashscope',
      remoteModelCatalogId: 'remote-catalog:dashscope:qwen3-max',
      provider: 'dashscope',
      providerModelId: 'qwen3-max',
    })).toEqual({
      source: 'cloud',
      connectorId: 'connector-dashscope',
      model: 'qwen3-max',
      provider: 'dashscope',
      remoteModelCatalogId: 'remote-catalog:dashscope:qwen3-max',
      providerModelId: 'qwen3-max',
      modelLabel: 'qwen3-max',
    });

    expect(targetRefToPickerSelection({
      kind: 'local-runtime',
      version: 'v2',
      profileBindingId: 'local.chat.qwen3',
    })).toEqual({
      source: 'local',
      connectorId: '',
      model: 'local.chat.qwen3',
      localModelId: 'local.chat.qwen3',
      profileBindingId: 'local.chat.qwen3',
      readinessRef: undefined,
    });
  });

  it('maps standard route model picker selections back to compact target refs', () => {
    expect(pickerSelectionToTargetRef({
      source: 'cloud',
      connectorId: 'connector-openai',
      model: 'gpt-5-mini',
      provider: 'openai',
      remoteModelCatalogId: 'remote-catalog:openai:gpt-5-mini',
      providerModelId: 'gpt-5-mini',
    })).toEqual({
      kind: 'cloud-connector',
      connectorId: 'connector-openai',
      remoteModelCatalogId: 'remote-catalog:openai:gpt-5-mini',
      providerModelId: 'gpt-5-mini',
      provider: 'openai',
    });

    expect(pickerSelectionToTargetRef({
      source: 'local',
      connectorId: '',
      model: 'local.chat.gemma',
      localModelId: 'local-import/gemma-4-26B-A4B-it-Q8_0',
      goRuntimeLocalModelId: '01KLOCALGEMMA',
      modelId: 'gemma-4-26b',
      engine: 'llama',
    })).toEqual({
      kind: 'local-runtime',
      version: 'v2',
      profileBindingId: 'local-import/gemma-4-26B-A4B-it-Q8_0',
    });
  });
});

describe('model config runtime target summary', () => {
  it('hydrates local runtime labels and hides opaque ids before hydration', () => {
    const targetRef: NimiAIConfigTargetRef = {
      kind: 'local-runtime',
      version: 'v2',
      profileBindingId: '01KTEX0CSNAR9Q0B8KXNCF4WPW',
    };
    const config = configWithTargetRef(targetRef);

    expect(summarizeModelConfigRuntimeTarget({
      capabilityId: 'image.generate',
      bindingCapabilityId: 'text.generate',
      config,
      runtimeStatus: 'ready',
    }).modelLabel).toBe('Local runtime model');

    expect(summarizeModelConfigRuntimeTarget({
      capabilityId: 'image.generate',
      bindingCapabilityId: 'text.generate',
      config,
      runtimeStatus: 'ready',
      localModels: [{
        localModelId: '01KTEX0CSNAR9Q0B8KXNCF4WPW',
        modelId: 'local-import/z-image-turbo-Q4_K_M',
        label: 'local-import/z-image-turbo-Q4_K_M',
      }],
    }).modelLabel).toBe('z-image-turbo-Q4_K_M');
  });

  it('summarizes cloud connector targets and selected params', () => {
    const config = {
      ...configWithTargetRef({
        kind: 'cloud-connector',
        connectorId: 'connector-dashscope',
        remoteModelCatalogId: 'remote-catalog:dashscope:qwen3-max',
        provider: 'dashscope',
        providerModelId: 'qwen3-max',
      }),
      capabilities: {
        targetRefs: {
          'text.generate': {
          kind: 'cloud-connector' as const,
          connectorId: 'connector-dashscope',
          remoteModelCatalogId: 'remote-catalog:dashscope:qwen3-max',
          provider: 'dashscope',
          providerModelId: 'qwen3-max',
        },
        },
        selectedParams: {
          'text.generate': { temperature: '0.7', maxTokens: 1024 },
        },
      },
    };

    expect(summarizeModelConfigRuntimeTarget({
      capabilityId: 'chat.stream',
      bindingCapabilityId: 'text.generate',
      config,
      runtimeStatus: 'ready',
    })).toMatchObject({
      status: 'ready',
      source: 'cloud',
      modelLabel: 'qwen3-max',
      canDispatch: true,
      paramsSummary: ['temp 0.7', 'max 1024'],
    });
  });

  it('blocks profile slices until materialized into runtime targets', () => {
    const summary = summarizeModelConfigRuntimeTarget({
      capabilityId: 'text.generate',
      bindingCapabilityId: 'text.generate',
      config: configWithTargetRef({
        kind: 'profile-slice',
        sourceProfileId: 'creative-profile',
        sliceId: 'text-defaults',
      }),
      runtimeStatus: 'ready',
    });

    expect(summary.status).toBe('blocked');
    expect(summary.source).toBe('profile-slice');
    expect(summary.canDispatch).toBe(false);
    expect(summary.detail).toContain('materialize');
  });
});
