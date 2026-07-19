import { describe, expect, it, vi } from 'vitest';
import {
  runRuntimeVoiceCatalog,
} from '../src/runtime.js';
import {
  ReasonCode,
  type NimiAIConfig,
} from '@nimiplatform/kit/core/sdk-contract';
import { createRuntimeScopeRunnerFixture } from './runtime-scope-runner-fixture.js';

describe('runtime voice catalog helper', () => {
  it('lists preset voices through the configured audio.synthesize binding', async () => {
    const runtime = createRuntimeHarness();
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    runtime.ai.listPresetVoices.mockResolvedValue({
      voices: [
        {
          voiceId: 'voice-a',
          name: 'Aiden',
          lang: 'en-US',
          supportedLangs: ['en-US'],
          labels: {},
          category: 'preset',
          previewAudioUri: 'runtime-artifact://voice-a-preview',
        },
        {
          voiceId: 'voice-b',
          name: 'Mei',
          lang: 'zh-CN',
          supportedLangs: ['zh-CN'],
          labels: {},
          category: 'preset',
          previewAudioUri: 'runtime-artifact://voice-b-preview',
        },
      ],
      modelResolved: 'tts-model',
      traceId: 'trace-voices',
    });

    const result = await runRuntimeVoiceCatalog({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'audio.synthesize': {
            kind: 'cloud-connector',
            connectorId: 'runtime-connector',
            remoteModelCatalogId: 'remote-catalog:runtime-connector:tts-model',
            providerModelId: 'tts-model',
          },
        },
      }),
      bindingCapabilityId: 'audio.synthesize',
      scenarioId: 'voice-catalog',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.voice-catalog',
      metadata: { productSurface: 'voice-catalog' },
    });

    expect(result).toMatchObject({
      ok: true,
      capabilityId: 'speech.bundle',
      message: 'Runtime returned 2 preset voice(s).',
      output: {
        kind: 'voice-catalog',
        modelResolved: 'tts-model',
        voiceCount: 2,
        sample: [
          { voiceId: 'voice-a', name: 'Aiden', lang: 'en-US' },
          { voiceId: 'voice-b', name: 'Mei', lang: 'zh-CN' },
        ],
      },
      trace: {
        traceId: 'trace-voices',
        modelResolved: 'tts-model',
        routeDecision: 'cloud',
      },
    });
    expect(runtime.ai.listPresetVoices).toHaveBeenCalledOnce();
    const [request, options] = runtime.ai.listPresetVoices.mock.calls[0];
    expect(request).toEqual({
      appId: 'nimi.zhiyu',
      subjectUserId: 'subject-user-1',
      modelId: 'tts-model',
      targetModelId: 'tts-model',
      connectorId: 'runtime-connector',
    });
    expect(options.metadata).toMatchObject({
      surfaceId: 'zhiyu.voice-catalog',
      scenarioId: 'voice-catalog',
      productSurface: 'voice-catalog',
      aiConfigBindingCapabilityId: 'audio.synthesize',
      aiConfigBindingModel: 'tts-model',
      aiConfigTargetRefKind: 'cloud-connector',
      runtimeSchedulingState: 'runnable',
    });
  });

  it('threads spend scope, abort signal, and diagnostics through the Runtime voice catalog call', async () => {
    const runtime = createRuntimeHarness();
    const signal = new AbortController().signal;
    const diagnostics: unknown[] = [];
    const { runner: withScopes, callSpy: withScopesCalls } = createRuntimeScopeRunnerFixture({
      'x-nimi-access-token-id': 'voice-token',
    });
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    runtime.ai.listPresetVoices.mockResolvedValue({
      voices: [],
      modelResolved: 'tts-model',
      traceId: 'trace-voices',
    });

    const result = await runRuntimeVoiceCatalog({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'audio.synthesize': {
            kind: 'cloud-connector',
            connectorId: 'runtime-connector',
            remoteModelCatalogId: 'remote-catalog:runtime-connector:tts-model',
            providerModelId: 'tts-model',
          },
        },
      }),
      bindingCapabilityId: 'audio.synthesize',
      scenarioId: 'voice-catalog-signal',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.voice-catalog',
      signal,
      abortReason: 'voice_catalog_timeout',
      withScopes,
      onRuntimeRequest: (request) => diagnostics.push(request),
    });

    expect(result).toMatchObject({
      ok: true,
      output: { voiceCount: 0 },
    });
    expect(withScopesCalls).toHaveBeenCalledOnce();
    expect(withScopesCalls).toHaveBeenCalledWith(['ai.spend.meter']);
    expect(diagnostics).toHaveLength(1);
    const [, options] = runtime.ai.listPresetVoices.mock.calls[0];
    expect(options.signal).toBe(signal);
    expect(options.metadata).toMatchObject({
      surfaceId: 'zhiyu.voice-catalog',
      scenarioId: 'voice-catalog-signal',
      'x-nimi-access-token-id': 'voice-token',
    });
  });

  it('preserves provider detail on voice catalog failures', async () => {
    const runtime = createRuntimeHarness();
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    const error = new Error('provider request failed') as Error & {
      reasonCode: string;
      details: { provider_message: string };
    };
    error.reasonCode = ReasonCode.AI_INPUT_INVALID;
    error.details = { provider_message: 'voice provider rejected catalog request' };
    runtime.ai.listPresetVoices.mockRejectedValue(error);

    const result = await runRuntimeVoiceCatalog({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'audio.synthesize': {
            kind: 'cloud-connector',
            connectorId: 'runtime-connector',
            remoteModelCatalogId: 'remote-catalog:runtime-connector:tts-model',
            providerModelId: 'tts-model',
          },
        },
      }),
      bindingCapabilityId: 'audio.synthesize',
      scenarioId: 'voice-provider-detail',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.voice-catalog',
    });

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'speech.bundle',
      reason: 'runtime-call-failed',
    });
    expect(result.message).toContain('AI_INPUT_INVALID: provider request failed');
    expect(result.message).toContain('Provider detail: voice provider rejected catalog request');
  });
});

function createAIConfig(input: {
  targetRefs?: NimiAIConfig['capabilities']['targetRefs'];
  selectedParams?: NimiAIConfig['capabilities']['selectedParams'];
} = {}): NimiAIConfig {
  return {
    scopeRef: {
      kind: 'app',
      ownerId: 'nimi.zhiyu',
      surfaceId: 'zhiyu-agent-home',
    },
    capabilities: {
      targetRefs: input.targetRefs ?? {},
      selectedParams: input.selectedParams ?? {},
    },
    profileOrigin: null,
  };
}

function createRuntimeHarness() {
  return {
    scheduling: {
      peekScheduling: vi.fn(),
    },
    ai: {
      listPresetVoices: vi.fn(),
    },
  };
}

function runnableSchedulingResponse() {
  return {
    occupancy: { globalUsed: 0, globalCap: 2, appUsed: 0, appCap: 1 },
    aggregateJudgement: {
      state: 1,
      detail: '',
      occupancy: { globalUsed: 0, globalCap: 2, appUsed: 0, appCap: 1 },
      resourceWarnings: [],
    },
    targetJudgements: [],
  };
}
