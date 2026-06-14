import { describe, expect, it } from 'vitest';
import {
  applyModelConfigCapabilityPatch,
  readModelConfigTargetRef,
  summarizeTargetRef,
} from '@nimiplatform/kit/core/model-config';
import {
  pickerSelectionToTargetRef,
  targetRefToPickerSelection,
} from '../src/binding-helpers.js';
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
      provider: 'dashscope',
      providerModelId: 'qwen3-max',
    })).toEqual({
      source: 'cloud',
      connectorId: 'connector-dashscope',
      model: 'qwen3-max',
      provider: 'dashscope',
      modelLabel: 'qwen3-max',
    });

    expect(targetRefToPickerSelection({
      kind: 'local-runtime',
      targetId: 'llama',
      profileId: 'local.chat.qwen3',
      readinessRef: 'local.chat.qwen3',
    })).toEqual({
      source: 'local',
      connectorId: '',
      model: 'local.chat.qwen3',
      localModelId: 'local.chat.qwen3',
      engine: 'llama',
    });
  });

  it('maps standard route model picker selections back to compact target refs', () => {
    expect(pickerSelectionToTargetRef({
      source: 'cloud',
      connectorId: 'connector-openai',
      model: 'gpt-5-mini',
      provider: 'openai',
    })).toEqual({
      kind: 'cloud-connector',
      connectorId: 'connector-openai',
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
      targetId: 'llama',
      profileId: '01KLOCALGEMMA',
      readinessRef: 'runtime-route:local:llama:01KLOCALGEMMA',
    });
  });
});
