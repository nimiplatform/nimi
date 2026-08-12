import { describe, expect, it, vi } from 'vitest';
import { ScenarioType, isNimiError } from '@nimiplatform/kit/core/sdk-contract';
import {
  runRuntimeAIConsumeCapability,
  type RuntimeAIConsumeCapabilityId,
  type RuntimeAIConsumeInput,
  type RuntimeAIConsumeRuntime,
} from '../src/runtime-ai-consume.js';

function input(
  runtime: RuntimeAIConsumeRuntime,
  capabilityId: RuntimeAIConsumeCapabilityId = 'text.generate',
  overrides: Partial<RuntimeAIConsumeInput> = {},
): RuntimeAIConsumeInput {
  return {
    runtime, appId: 'app.test', capabilityId, prompt: 'hello', scenarioId: `scenario:${capabilityId}`,
    subjectUserId: 'user.test', surfaceId: 'test', ...overrides,
  };
}

function runtimeStreamEvents() {
  const events = [
    { traceId: 'trace-stream-1', payload: { oneofKind: 'started', started: {} } },
    { traceId: '', payload: { oneofKind: 'delta', delta: { delta: { oneofKind: 'text', text: { text: 'hello ' } } } } },
    { traceId: '', payload: { oneofKind: 'delta', delta: { delta: { oneofKind: 'text', text: { text: 'runtime' } } } } },
    { traceId: '', payload: { oneofKind: 'completed', completed: {
      finishReason: 1, usage: { inputTokens: '2', outputTokens: '3', computeMs: '4' },
    } } },
  ];
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
  };
}

describe('runtime AI consume contract', () => {
  it('dispatches text.generate without caller execution truth', async () => {
    const executeScenario = vi.fn<RuntimeAIConsumeRuntime['ai']['executeScenario']>(async (_request) => ({
      output: { output: { oneofKind: 'textGenerate', textGenerate: {
        text: 'hello runtime', toolCalls: [], toolResults: [], toolApprovalRequests: [], sources: [], rawChunks: [],
      } } },
      finishReason: 1, usage: {
        inputTokens: '2', outputTokens: '3', cachedInputTokens: '0', reasoningOutputTokens: '0', computeMs: '4',
      },
      routeDecision: 2, modelResolved: 'runtime-selected', traceId: 'trace-1', ignoredExtensions: [],
    }));
    const streamScenario = vi.fn();
    const runtime = { ai: { executeScenario, streamScenario } } as unknown as RuntimeAIConsumeRuntime;
    const request = input(runtime, 'text.generate', {
      parameters: {
        temperature: 0.25,
        topP: 0.75,
        maxTokens: 321,
        topK: 17,
        presencePenalty: 0.5,
        frequencyPenalty: -0.25,
        stop: ['DONE'],
        seed: 42,
      },
    });

    const result = await runRuntimeAIConsumeCapability(request);

    expect(result).toMatchObject({
      ok: true, capabilityId: 'text.generate',
      output: { kind: 'text', text: 'hello runtime', inputTokens: 2, outputTokens: 3, totalTokens: 5, streamed: false },
      trace: { traceId: 'trace-1', modelResolved: 'runtime-selected' },
    });
    expect(executeScenario).toHaveBeenCalledTimes(1);
    const runtimeRequest = executeScenario.mock.calls[0]?.[0];
    if (!runtimeRequest) throw new Error('expected execute request');
    expect(runtimeRequest.head).toEqual({ appId: 'app.test', subjectUserId: 'user.test', timeoutMs: 0 });
    const spec = runtimeRequest.spec?.spec;
    if (spec?.oneofKind !== 'textGenerate') throw new Error('expected textGenerate spec');
    expect(spec.textGenerate).toMatchObject({
      temperature: 0.25,
      topP: 0.75,
      maxTokens: 321,
      topK: 17,
      presencePenalty: 0.5,
      frequencyPenalty: -0.25,
      stop: ['DONE'],
      seed: '42',
    });
    expect(JSON.stringify(runtimeRequest)).not.toMatch(/connectorId|implementation|providerModelTarget|targetRef|routePolicy/u);
    expect(Object.keys(request)).not.toEqual(expect.arrayContaining(['config', 'binding', 'model', 'route', 'targetRef']));
  });

  it('streams deltas, accumulated partials, and the terminal result', async () => {
    const executeScenario = vi.fn();
    const streamScenario = vi.fn<RuntimeAIConsumeRuntime['ai']['streamScenario']>((_request) => (
      runtimeStreamEvents() as ReturnType<RuntimeAIConsumeRuntime['ai']['streamScenario']>
    ));
    const runtime = { ai: { executeScenario, streamScenario } } as unknown as RuntimeAIConsumeRuntime;
    const onDelta = vi.fn();
    const onPartial = vi.fn();

    const result = await runRuntimeAIConsumeCapability(input(runtime, 'chat.stream', {
      onDelta,
      onPartial,
      parameters: {
        temperature: 0,
        topP: 0,
        maxTokens: 0,
        topK: 0,
        presencePenalty: 0,
        frequencyPenalty: 0,
        stop: 'STOP',
        seed: 0,
      },
    }));

    expect(streamScenario).toHaveBeenCalledTimes(1);
    expect(executeScenario).not.toHaveBeenCalled();
    expect(onDelta.mock.calls).toEqual([
      ['hello ', 'hello '],
      ['runtime', 'hello runtime'],
    ]);
    expect(onPartial.mock.calls).toEqual([['hello '], ['hello runtime']]);
    expect(result).toMatchObject({
      ok: true, capabilityId: 'chat.stream', message: 'hello runtime',
      output: {
        kind: 'text', text: 'hello runtime', finishReason: 'stop', inputTokens: 2,
        outputTokens: 3, totalTokens: 5, streamed: true,
      },
      trace: { traceId: 'trace-stream-1' },
    });
    const runtimeRequest = streamScenario.mock.calls[0]?.[0];
    if (!runtimeRequest) throw new Error('expected stream request');
    expect(runtimeRequest.executionMode).toBe(2);
    expect(runtimeRequest.head?.appId).toBe('app.test');
    const spec = runtimeRequest.spec?.spec;
    if (spec?.oneofKind !== 'textGenerate') throw new Error('expected textGenerate spec');
    expect(spec.textGenerate).toMatchObject({
      temperature: 0,
      topP: 0,
      maxTokens: 0,
      topK: 0,
      presencePenalty: 0,
      frequencyPenalty: 0,
      stop: ['STOP'],
      seed: '0',
    });
  });

  it('aborts a stream and returns a typed fail-closed result', async () => {
    const streamScenario = vi.fn<RuntimeAIConsumeRuntime['ai']['streamScenario']>((_request, options) => ({
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise((_, reject) => {
            options?.signal?.addEventListener('abort', () => {
              const error = new Error('Aborted');
              error.name = 'AbortError';
              reject(error);
            }, { once: true });
          }),
        };
      },
    }));
    const runtime = { ai: { executeScenario: vi.fn(), streamScenario } } as unknown as RuntimeAIConsumeRuntime;
    const controller = new AbortController();
    const pending = runRuntimeAIConsumeCapability(input(runtime, 'chat.stream', { signal: controller.signal }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    const result = await pending;

    expect(result).toMatchObject({ ok: false, capabilityId: 'chat.stream', reason: 'runtime-call-failed' });
    if (result.ok) throw new Error('expected unavailable result');
    expect(isNimiError(result.error)).toBe(true);
    expect(result.message).toMatch(/abort/i);
  });

  it('executes text.embed with batch inputs and projects the embedding summary', async () => {
    const executeScenario = vi.fn<RuntimeAIConsumeRuntime['ai']['executeScenario']>(async () => ({
      output: { output: { oneofKind: 'textEmbed', textEmbed: {
        vectors: [{ values: [0.1, 0.2, 0.3] }, { values: [0.4, 0.5, 0.6] }],
      } } },
      finishReason: 1,
      usage: {
        inputTokens: '4', outputTokens: '0', cachedInputTokens: '0', reasoningOutputTokens: '0', computeMs: '2',
      },
      routeDecision: 1,
      modelResolved: 'runtime-embedder',
      traceId: 'trace-embed-1',
      ignoredExtensions: [],
    }));
    const streamScenario = vi.fn();
    const runtime = { ai: { executeScenario, streamScenario } } as unknown as RuntimeAIConsumeRuntime;

    const result = await runRuntimeAIConsumeCapability(input(runtime, 'text.embed', {
      prompt: '',
      inputs: [' first ', 'second'],
    }));

    expect(executeScenario).toHaveBeenCalledTimes(1);
    const runtimeRequest = executeScenario.mock.calls[0]?.[0];
    if (!runtimeRequest) throw new Error('expected embed request');
    expect(runtimeRequest.scenarioType).toBe(ScenarioType.TEXT_EMBED);
    const spec = runtimeRequest.spec?.spec;
    if (spec?.oneofKind !== 'textEmbed') throw new Error('expected textEmbed spec');
    expect(spec.textEmbed.inputs).toEqual(['first', 'second']);
    expect(result).toMatchObject({
      ok: true,
      capabilityId: 'text.embed',
      output: {
        kind: 'embedding', vectorCount: 2, dimensions: 3, sample: [0.1, 0.2, 0.3], totalTokens: 4,
      },
      trace: { traceId: 'trace-embed-1', modelResolved: 'runtime-embedder', routeDecision: 'local' },
    });
    expect(streamScenario).not.toHaveBeenCalled();
  });
});
