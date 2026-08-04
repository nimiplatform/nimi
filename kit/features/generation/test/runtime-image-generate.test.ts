import { describe, expect, it, vi } from 'vitest';
import { ReasonCode, isNimiError } from '@nimiplatform/kit/core/sdk-contract';
import {
  runRuntimeImageGenerate,
  type RuntimeImageGenerateInput,
  type RuntimeImageGenerateRuntime,
} from '../src/runtime-image-generate.js';

describe('image.generate contract', () => {
  it('keeps the media request contract and fails before Scenario dispatch', async () => {
    const submitScenarioJob = vi.fn();
    const input: RuntimeImageGenerateInput = {
      runtime: { ai: { submitScenarioJob } } as unknown as RuntimeImageGenerateRuntime,
      appId: 'app.test',
      prompt: 'a blue sphere',
      negativePrompt: 'noise',
      count: 1,
      aspectRatio: '1:1',
      scenarioId: 'image-1',
      subjectUserId: 'user.test',
      surfaceId: 'test',
    };

    const result = await runRuntimeImageGenerate(input);

    expect(Object.keys(input)).not.toEqual(expect.arrayContaining([
      'config',
      'binding',
      'model',
      'route',
      'targetRef',
    ]));
    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'image.generate',
      reason: 'sdk-method-unavailable',
    });
    if (result.ok) throw new Error('expected unavailable result');
    expect(isNimiError(result.error)).toBe(true);
    expect(result.error.reasonCode).toBe(ReasonCode.AI_ROUTE_UNSUPPORTED);
    expect(submitScenarioJob).not.toHaveBeenCalled();
  });
});
