import { describe, expect, it, vi } from 'vitest';
import {
  runRuntimeAIConsumeCapability,
  type RuntimeAIConsumeCapabilityId,
} from '../src/runtime.js';
import { ExecutionMode, ReasonCode, ScenarioType, type NimiAIConfig } from '@nimiplatform/kit/core/sdk-contract';

describe('runtime AI consume helper', () => {
  it('fails closed before dispatch when the AIConfig target binding is missing', async () => {
    const runtime = createRuntimeHarness();

    const result = await runRuntimeAIConsumeCapability({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig(),
      capabilityId: 'text.generate',
      bindingCapabilityId: 'text.generate',
      prompt: 'hello runtime',
      scenarioId: 'missing-binding',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.capability-studio.text.generate',
    });

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'text.generate',
      reason: 'ai-config-binding-missing',
    });
    expect(runtime.scheduling.peekScheduling).not.toHaveBeenCalled();
    expect(runtime.ai.executeScenario).not.toHaveBeenCalled();
    expect(runtime.ai.streamScenario).not.toHaveBeenCalled();
  });

  it('runs text.generate through the configured Runtime route and forwards params and metadata', async () => {
    const runtime = createRuntimeHarness();
    const withScopes = vi.fn(<T,>(
      _scopes: readonly string[],
      operation: (options: { readonly metadata?: Record<string, string> }) => Promise<T>,
    ) => operation({ metadata: { 'x-nimi-access-token-id': 'token-1', 'x-nimi-access-token-secret': 'secret-1' } }));
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    runtime.ai.executeScenario.mockResolvedValue(textGenerateScenarioResponse('shared helper ok'));

    const result = await runRuntimeAIConsumeCapability({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'text.generate': {
            kind: 'cloud-connector',
            connectorId: 'runtime-connector',
            remoteModelCatalogId: 'remote-catalog:runtime-connector:runtime-model',
            providerModelId: 'runtime-model',
          },
        },
        selectedParams: {
          'text.generate': {
            temperature: '0.25',
            topP: 0.8,
            maxTokens: '128',
            stopSequences: ['END', ''],
            timeoutMs: '90000',
          },
        },
      }),
      capabilityId: 'text.generate',
      bindingCapabilityId: 'text.generate',
      prompt: 'hello runtime',
      directive: 'Answer briefly.',
      scenarioId: 'text-generate',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.capability-studio.text.generate',
      metadata: {
        productSurface: 'capability-studio',
      },
      withScopes,
    });

    expect(result).toMatchObject({
      ok: true,
      capabilityId: 'text.generate',
      output: {
        kind: 'text',
        text: 'shared helper ok',
        finishReason: 'stop',
        inputTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
        streamed: false,
      },
      trace: {
        traceId: 'trace-text',
        modelResolved: 'runtime-model',
        routeDecision: 'cloud',
      },
    });

    expect(runtime.scheduling.peekScheduling).toHaveBeenCalledOnce();
    const [schedulingInput] = runtime.scheduling.peekScheduling.mock.calls[0];
    expect(schedulingInput.targets[0]).toMatchObject({
      capability: 'text.generate',
      targetId: 'runtime-connector',
      profileId: 'runtime-model',
    });

    expect(runtime.ai.executeScenario).toHaveBeenCalledOnce();
    expect(withScopes).toHaveBeenCalledOnce();
    expect(withScopes.mock.calls[0]?.[0]).toEqual(['ai.spend.meter']);
    const [request, options] = runtime.ai.executeScenario.mock.calls[0];
    expect(request.scenarioType).toBe(ScenarioType.TEXT_GENERATE);
    expect(request.executionMode).toBe(ExecutionMode.SYNC);
    expect(request.head).toMatchObject({
      appId: 'nimi.zhiyu',
      subjectUserId: 'subject-user-1',
      modelId: 'runtime-model',
      connectorId: 'runtime-connector',
      routePolicy: 2,
      timeoutMs: 90000,
    });
    expect(request.spec.spec.textGenerate).toMatchObject({
      temperature: 0.25,
      topP: 0.8,
      maxTokens: 128,
      stop: ['END'],
    });
    expect(request.spec.spec.textGenerate.input[0].content).toBe('Answer briefly.\n\nhello runtime');
    expect(options.metadata).toMatchObject({
      surfaceId: 'zhiyu.capability-studio.text.generate',
      productSurface: 'capability-studio',
      'x-nimi-access-token-id': 'token-1',
      'x-nimi-access-token-secret': 'secret-1',
      aiConfigBindingCapabilityId: 'text.generate',
      aiConfigBindingModel: 'runtime-model',
      aiConfigTargetRefKind: 'cloud-connector',
      runtimeSchedulingState: 'runnable',
    });
  });

  it('preserves SDK reason code and provider detail on text.generate failures', async () => {
    const runtime = createRuntimeHarness();
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    const error = new Error('provider request failed') as Error & {
      reasonCode: string;
      details: { provider_message: string };
    };
    error.reasonCode = ReasonCode.AI_INPUT_INVALID;
    error.details = {
      provider_message: 'llama.cpp rejected model id local/local-import/gemma-4-26B-A4B-it-Q8_0',
    };
    runtime.ai.executeScenario.mockRejectedValue(error);

    const result = await runRuntimeAIConsumeCapability({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'text.generate': {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local/local-import/gemma-4-26B-A4B-it-Q8_0',
          },
        },
      }),
      capabilityId: 'text.generate',
      bindingCapabilityId: 'text.generate',
      prompt: 'hello runtime',
      scenarioId: 'provider-detail',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.capability-studio.text.generate',
    });

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'text.generate',
      reason: 'runtime-call-failed',
    });
    expect(result.message).toContain('AI_INPUT_INVALID: provider request failed');
    expect(result.message).toContain(
      'Provider detail: llama.cpp rejected model id local/local-import/gemma-4-26B-A4B-it-Q8_0',
    );
  });

  it('streams chat.stream partial text and only succeeds after Runtime terminal completion', async () => {
    const runtime = createRuntimeHarness();
    const partials: string[] = [];
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    runtime.ai.streamScenario.mockImplementation(async function* () {
      yield streamStartedEvent();
      yield streamTextDeltaEvent('hel');
      yield streamTextDeltaEvent('lo');
      yield streamCompletedEvent();
    });

    const result = await runRuntimeAIConsumeCapability({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'text.generate': {
            kind: 'cloud-connector',
            connectorId: 'runtime-connector',
            remoteModelCatalogId: 'remote-catalog:runtime-connector:runtime-model',
            providerModelId: 'runtime-model',
          },
        },
      }),
      capabilityId: 'chat.stream',
      bindingCapabilityId: 'text.generate',
      prompt: 'stream this',
      scenarioId: 'chat-stream',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.capability-studio.chat.stream',
      onPartial: (text) => partials.push(text),
    });

    expect(partials).toEqual(['hel', 'hello']);
    expect(result).toMatchObject({
      ok: true,
      capabilityId: 'chat.stream',
      output: {
        kind: 'text',
        text: 'hello',
        finishReason: 'stop',
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        streamed: true,
      },
      trace: {
        traceId: 'trace-stream',
      },
    });

    expect(runtime.ai.executeScenario).not.toHaveBeenCalled();
    expect(runtime.ai.streamScenario).toHaveBeenCalledOnce();
    const [request, options] = runtime.ai.streamScenario.mock.calls[0];
    expect(request.scenarioType).toBe(ScenarioType.TEXT_GENERATE);
    expect(request.executionMode).toBe(ExecutionMode.STREAM);
    expect(request.head.subjectUserId).toBe('subject-user-1');
    expect(options.metadata).toMatchObject({
      surfaceId: 'zhiyu.capability-studio.chat.stream',
      aiConfigCapabilityId: 'chat.stream',
      aiConfigBindingCapabilityId: 'text.generate',
    });
  });

  it('returns unavailable when chat.stream receives a Runtime failure event', async () => {
    const runtime = createRuntimeHarness();
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    runtime.ai.streamScenario.mockImplementation(async function* () {
      yield streamStartedEvent();
      yield streamFailedEvent();
    });

    const result = await runRuntimeAIConsumeCapability({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'text.generate': {
            kind: 'cloud-connector',
            connectorId: 'runtime-connector',
            remoteModelCatalogId: 'remote-catalog:runtime-connector:missing-model',
            providerModelId: 'missing-model',
          },
        },
      }),
      capabilityId: 'chat.stream',
      bindingCapabilityId: 'text.generate',
      prompt: 'stream failure',
      scenarioId: 'chat-stream-failure',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.capability-studio.chat.stream',
    });

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'chat.stream',
      reason: 'runtime-call-failed',
      message: 'AI_MODEL_NOT_FOUND: missing model',
    });
    expect(runtime.ai.executeScenario).not.toHaveBeenCalled();
  });

  it('runs text.embed through the configured Runtime route and summarizes vector output', async () => {
    const runtime = createRuntimeHarness();
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    runtime.ai.executeScenario.mockResolvedValue(textEmbedScenarioResponse());

    const result = await runRuntimeAIConsumeCapability({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'text.embed': {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'embedding-model',
          },
        },
      }),
      capabilityId: 'text.embed',
      bindingCapabilityId: 'text.embed',
      prompt: 'embed this',
      scenarioId: 'text-embed',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.capability-studio.text.embed',
    });

    expect(result).toMatchObject({
      ok: true,
      capabilityId: 'text.embed',
      output: {
        kind: 'embedding',
        vectorCount: 1,
        dimensions: 3,
        sample: [0.1, 0.2, 0.3],
        totalTokens: 4,
      },
      trace: {
        traceId: 'trace-embed',
        modelResolved: 'embedding-model',
        routeDecision: 'local',
      },
    });

    expect(runtime.ai.executeScenario).toHaveBeenCalledOnce();
    const [request, options] = runtime.ai.executeScenario.mock.calls[0];
    expect(request.scenarioType).toBe(ScenarioType.TEXT_EMBED);
    expect(request.executionMode).toBe(ExecutionMode.SYNC);
    expect(request.head).toMatchObject({
      appId: 'nimi.zhiyu',
      subjectUserId: 'subject-user-1',
      modelId: 'embedding-model',
      connectorId: '',
      routePolicy: 1,
    });
    expect(request.spec.spec.textEmbed.inputs).toEqual(['embed this']);
    expect(options.metadata).toMatchObject({
      surfaceId: 'zhiyu.capability-studio.text.embed',
      aiConfigBindingCapabilityId: 'text.embed',
      aiConfigBindingModel: 'embedding-model',
      aiConfigTargetRefKind: 'local-runtime',
      runtimeSchedulingState: 'runnable',
    });
  });

  it('fails closed when text.embed receives malformed Runtime output', async () => {
    const runtime = createRuntimeHarness();
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    runtime.ai.executeScenario.mockResolvedValue(textGenerateScenarioResponse('not an embedding'));

    const result = await runRuntimeAIConsumeCapability({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'text.embed': {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'embedding-model',
          },
        },
      }),
      capabilityId: 'text.embed',
      bindingCapabilityId: 'text.embed',
      prompt: 'embed malformed',
      scenarioId: 'text-embed-malformed',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.capability-studio.text.embed',
    });

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'text.embed',
      reason: 'runtime-call-failed',
    });
    expect(result.message).toContain('SDK_AI_RUNTIME_OUTPUT_INVALID');
    expect(result.message).toContain('textEmbed output');
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
      executeScenario: vi.fn(),
      streamScenario: vi.fn(),
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

function textGenerateScenarioResponse(text: string) {
  return {
    output: {
      output: {
        oneofKind: 'textGenerate',
        textGenerate: {
          text,
          toolCalls: [],
          toolResults: [],
          toolApprovalRequests: [],
          sources: [],
          rawChunks: [],
        },
      },
    },
    finishReason: 1,
    usage: {
      inputTokens: 2,
      outputTokens: 3,
      cachedInputTokens: 0,
      reasoningOutputTokens: 0,
    },
    traceId: 'trace-text',
    modelResolved: 'runtime-model',
    routeDecision: 2,
    ignoredExtensions: [],
  };
}

function streamStartedEvent() {
  return {
    eventType: 1,
    sequence: '1',
    traceId: 'trace-stream',
    payload: {
      oneofKind: 'started',
      started: {
        modelResolved: 'runtime-model',
      },
    },
  };
}

function streamTextDeltaEvent(text: string) {
  return {
    eventType: 2,
    sequence: '2',
    traceId: 'trace-stream',
    payload: {
      oneofKind: 'delta',
      delta: {
        delta: {
          oneofKind: 'text',
          text: { text },
        },
      },
    },
  };
}

function streamCompletedEvent() {
  return {
    eventType: 5,
    sequence: '3',
    traceId: 'trace-stream',
    payload: {
      oneofKind: 'completed',
      completed: {
        finishReason: 1,
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          cachedInputTokens: 0,
          reasoningOutputTokens: 0,
        },
      },
    },
  };
}

function streamFailedEvent() {
  return {
    eventType: 7,
    sequence: '3',
    traceId: 'trace-stream',
    payload: {
      oneofKind: 'failed',
      failed: {
        reasonCode: ReasonCode.AI_MODEL_NOT_FOUND,
        actionHint: 'missing model',
      },
    },
  };
}

function textEmbedScenarioResponse() {
  return {
    output: {
      output: {
        oneofKind: 'textEmbed',
        textEmbed: {
          vectors: [{ values: [0.1, 0.2, 0.3] }],
        },
      },
    },
    usage: {
      inputTokens: 4,
      outputTokens: 0,
      cachedInputTokens: 0,
      reasoningOutputTokens: 0,
    },
    traceId: 'trace-embed',
    modelResolved: 'embedding-model',
    routeDecision: 1,
    ignoredExtensions: [],
  };
}

type _RuntimeAIConsumeCapabilityIdCoverage = RuntimeAIConsumeCapabilityId;
