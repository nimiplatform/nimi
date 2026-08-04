import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReasonCode, isNimiError } from '@nimiplatform/kit/core/sdk-contract';
import {
  runRuntimeSpeechTranscribe,
  type RuntimeSpeechTranscribeInput,
  type RuntimeSpeechTranscribeRuntime,
} from '../src/runtime-speech-transcribe.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('audio.transcribe contract', () => {
  it('fails before loading URL media or dispatching a target-bearing job', async () => {
    const submitScenarioJob = vi.fn();
    const fetch = vi.fn();
    globalThis.fetch = fetch as typeof globalThis.fetch;
    const input: RuntimeSpeechTranscribeInput = {
      runtime: { ai: { submitScenarioJob } } as unknown as RuntimeSpeechTranscribeRuntime,
      appId: 'app.test',
      audioUrl: 'https://cdn.example.test/audio.wav',
      language: 'en',
      timestamps: true,
      scenarioId: 'transcribe-1',
      subjectUserId: 'user.test',
      surfaceId: 'test',
    };

    const result = await runRuntimeSpeechTranscribe(input);

    expect(Object.keys(input)).not.toEqual(expect.arrayContaining([
      'config',
      'binding',
      'model',
      'route',
      'targetRef',
    ]));
    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'audio.transcribe',
      reason: 'sdk-method-unavailable',
    });
    if (result.ok) throw new Error('expected unavailable result');
    expect(isNimiError(result.error)).toBe(true);
    expect(result.error.reasonCode).toBe(ReasonCode.AI_ROUTE_UNSUPPORTED);
    expect(fetch).not.toHaveBeenCalled();
    expect(submitScenarioJob).not.toHaveBeenCalled();
  });
});
