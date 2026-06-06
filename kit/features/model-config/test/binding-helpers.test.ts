import { describe, expect, it } from 'vitest';
import {
  applyModelConfigCapabilityPatch,
  readModelConfigTargetRef,
  summarizeTargetRef,
} from '@nimiplatform/kit/core/model-config';
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
});
