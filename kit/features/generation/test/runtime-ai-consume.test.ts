import { describe, expect, it, vi } from 'vitest';
import { ReasonCode, isNimiError } from '@nimiplatform/kit/core/sdk-contract';
import {
  runRuntimeAIConsumeCapability,
  type RuntimeAIConsumeCapabilityId,
  type RuntimeAIConsumeInput,
  type RuntimeAIConsumeRuntime,
} from '../src/runtime-ai-consume.js';

describe('runtime AI consume contract', () => {
  it.each<RuntimeAIConsumeCapabilityId>([
    'text.generate',
    'chat.stream',
    'text.embed',
  ])('fails %s closed without dispatch or execution-truth inputs', async (capabilityId) => {
    const executeScenario = vi.fn();
    const streamScenario = vi.fn();
    const runtime = { ai: { executeScenario, streamScenario } } as unknown as RuntimeAIConsumeRuntime;
    const input: RuntimeAIConsumeInput = {
      runtime,
      appId: 'app.test',
      capabilityId,
      prompt: 'hello',
      scenarioId: `scenario:${capabilityId}`,
      subjectUserId: 'user.test',
      surfaceId: 'test',
    };

    const result = await runRuntimeAIConsumeCapability(input);

    expect(Object.keys(input)).not.toEqual(expect.arrayContaining([
      'config',
      'binding',
      'model',
      'route',
      'targetRef',
    ]));
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
