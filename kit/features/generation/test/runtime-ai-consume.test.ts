import { describe, expect, it, vi } from 'vitest';
import { ReasonCode, isNimiError } from '@nimiplatform/kit/core/sdk-contract';
import {
  runRuntimeAIConsumeCapability,
  type RuntimeAIConsumeCapabilityId,
  type RuntimeAIConsumeInput,
  type RuntimeAIConsumeRuntime,
} from '../src/runtime-ai-consume.js';

function input(
  runtime: RuntimeAIConsumeRuntime,
  capabilityId: RuntimeAIConsumeCapabilityId = 'text.generate',
): RuntimeAIConsumeInput {
  return {
    runtime,
    appId: 'app.test',
    capabilityId,
    prompt: 'hello',
    scenarioId: `scenario:${capabilityId}`,
    subjectUserId: 'user.test',
    surfaceId: 'test',
  };
}

describe('runtime AI consume contract', () => {
  it('dispatches text.generate without caller execution truth', async () => {
    const executeScenario = vi.fn(async (
      _request: Parameters<RuntimeAIConsumeRuntime['ai']['executeScenario']>[0],
    ) => ({
      output: {
        output: {
          oneofKind: 'textGenerate',
          textGenerate: { text: 'hello runtime', toolCalls: [] },
        },
      },
      finishReason: 1,
      usage: { inputTokens: '2', outputTokens: '3', computeMs: '4' },
      routeDecision: 2,
      modelResolved: 'runtime-selected',
      traceId: 'trace-1',
      ignoredExtensions: [],
    }));
    const streamScenario = vi.fn();
    const runtime = { ai: { executeScenario, streamScenario } } as unknown as RuntimeAIConsumeRuntime;
    const request = input(runtime);

    const result = await runRuntimeAIConsumeCapability(request);

    expect(result).toMatchObject({
      ok: true,
      capabilityId: 'text.generate',
      output: {
        kind: 'text',
        text: 'hello runtime',
        inputTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
        streamed: false,
      },
      trace: { traceId: 'trace-1', modelResolved: 'runtime-selected' },
    });
    expect(executeScenario).toHaveBeenCalledTimes(1);
    const runtimeRequest = executeScenario.mock.calls[0]?.[0];
    expect(runtimeRequest.head).toEqual({ appId: 'app.test', subjectUserId: 'user.test', timeoutMs: 0 });
    expect(JSON.stringify(runtimeRequest)).not.toMatch(/connectorGrant|connectorId|implementation|providerModelTarget|targetRef|routePolicy/u);
    expect(Object.keys(request)).not.toEqual(expect.arrayContaining([
      'config',
      'binding',
      'model',
      'route',
      'targetRef',
    ]));
  });

  it('preserves ConnectorGrant typed failure for the first-party user projection', async () => {
    const executeScenario = vi.fn(async () => {
      throw Object.assign(new Error('an active connector grant must be selected'), {
        reasonCode: 'AI_CONNECTOR_GRANT_SELECTION_REQUIRED',
      });
    });
    const runtime = { ai: { executeScenario, streamScenario: vi.fn() } } as unknown as RuntimeAIConsumeRuntime;

    const result = await runRuntimeAIConsumeCapability(input(runtime));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected unavailable result');
    expect(isNimiError(result.error)).toBe(true);
    expect(result.error.reasonCode).toBe('AI_CONNECTOR_GRANT_SELECTION_REQUIRED');
    expect(result.reason).toBe('runtime-call-failed');
  });

  it.each<RuntimeAIConsumeCapabilityId>([
    'chat.stream',
    'text.embed',
  ])('keeps unsupported %s fail-closed without dispatch', async (capabilityId) => {
    const executeScenario = vi.fn();
    const streamScenario = vi.fn();
    const runtime = { ai: { executeScenario, streamScenario } } as unknown as RuntimeAIConsumeRuntime;

    const result = await runRuntimeAIConsumeCapability(input(runtime, capabilityId));

    expect(result).toMatchObject({
      ok: false,
      capabilityId,
      reason: 'sdk-method-unavailable',
    });
    if (result.ok) throw new Error('expected unavailable result');
    expect(isNimiError(result.error)).toBe(true);
    expect(result.error.reasonCode).toBe(ReasonCode.AI_ROUTE_UNSUPPORTED);
    expect(executeScenario).not.toHaveBeenCalled();
    expect(streamScenario).not.toHaveBeenCalled();
  });
});
