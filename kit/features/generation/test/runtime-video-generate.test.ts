import { describe, expect, it, vi } from 'vitest';
import { ReasonCode, isNimiError } from '@nimiplatform/kit/core/sdk-contract';
import {
  runRuntimeVideoGenerate,
  type RuntimeVideoGenerateInput,
  type RuntimeVideoGenerateRuntime,
} from '../src/runtime-video-generate.js';

describe('video.generate contract', () => {
  it('retains modality payload fields and fails before Scenario dispatch', async () => {
    const submitScenarioJob = vi.fn();
    const input: RuntimeVideoGenerateInput = {
      runtime: { ai: { submitScenarioJob } } as unknown as RuntimeVideoGenerateRuntime,
      appId: 'app.test',
      mode: 't2v',
      prompt: 'waves at dusk',
      options: { durationSec: 4, ratio: '16:9' },
      scenarioId: 'video-1',
      subjectUserId: 'user.test',
      surfaceId: 'test',
    };

    const result = await runRuntimeVideoGenerate(input);

    expect(Object.keys(input)).not.toEqual(expect.arrayContaining([
      'config',
      'binding',
      'model',
      'route',
      'targetRef',
    ]));
    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'video.generate',
      reason: 'sdk-method-unavailable',
    });
    if (result.ok) throw new Error('expected unavailable result');
    expect(isNimiError(result.error)).toBe(true);
    expect(result.error.reasonCode).toBe(ReasonCode.AI_ROUTE_UNSUPPORTED);
    expect(submitScenarioJob).not.toHaveBeenCalled();
  });
});
