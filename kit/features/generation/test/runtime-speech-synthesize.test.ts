import { describe, expect, it, vi } from 'vitest';
import { ReasonCode, isNimiError } from '@nimiplatform/kit/core/sdk-contract';
import {
  runRuntimeSpeechSynthesize,
  type RuntimeSpeechSynthesizeInput,
  type RuntimeSpeechSynthesizeRuntime,
} from '../src/runtime-speech-synthesize.js';

describe('audio.synthesize contract', () => {
  it('retains voice-reference payload fields and fails before Runtime dispatch', async () => {
    const submitScenarioJob = vi.fn();
    const input: RuntimeSpeechSynthesizeInput = {
      runtime: { ai: { submitScenarioJob } } as unknown as RuntimeSpeechSynthesizeRuntime,
      appId: 'app.test',
      text: 'hello',
      voiceRef: { kind: 'voice_asset_id', voiceAssetId: 'voice-1' },
      language: 'en',
      audioFormat: 'mp3',
      scenarioId: 'speech-1',
      subjectUserId: 'user.test',
      surfaceId: 'test',
    };

    const result = await runRuntimeSpeechSynthesize(input);

    expect(Object.keys(input)).not.toEqual(expect.arrayContaining([
      'config',
      'binding',
      'model',
      'route',
      'targetRef',
    ]));
    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'audio.synthesize',
      reason: 'sdk-method-unavailable',
    });
    if (result.ok) throw new Error('expected unavailable result');
    expect(isNimiError(result.error)).toBe(true);
    expect(result.error.reasonCode).toBe(ReasonCode.AI_ROUTE_UNSUPPORTED);
    expect(submitScenarioJob).not.toHaveBeenCalled();
  });
});
