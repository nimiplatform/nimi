import { describe, expect, it, vi } from 'vitest';
import {
  runRuntimeSpeechTranscribe,
} from '../src/runtime.js';
import {
  ExecutionMode,
  ReasonCode,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
  type NimiAIConfig,
} from '@nimiplatform/kit/core/sdk-contract';
import { createRuntimeScopeRunnerFixture } from './runtime-scope-runner-fixture.js';

describe('runtime speech transcription helper', () => {
  it('submits audio.transcribe through the configured Runtime job route and returns transcript text', async () => {
    const runtime = createRuntimeHarness();
    const { runner: withScopes, callSpy: withScopesCalls } = createRuntimeScopeRunnerFixture({
      'x-nimi-access-token-id': 'token-1',
    });
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    runtime.ai.submitScenarioJob.mockResolvedValue({
      job: {
        jobId: 'job-transcribe-1',
        status: ScenarioJobStatus.SUBMITTED,
        scenarioType: ScenarioType.SPEECH_TRANSCRIBE,
        artifacts: [],
      },
    });
    runtime.ai.subscribeScenarioJobEvents.mockImplementation(async function* () {
      yield {
        eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
        sequence: '1',
        traceId: 'trace-transcribe-event',
        job: {
          jobId: 'job-transcribe-1',
          status: ScenarioJobStatus.COMPLETED,
          scenarioType: ScenarioType.SPEECH_TRANSCRIBE,
          traceId: 'trace-transcribe-event',
          artifacts: [],
        },
      };
    });
    runtime.ai.getScenarioArtifacts.mockResolvedValue({
      traceId: 'trace-transcribe-artifacts',
      artifacts: [],
      output: {
        output: {
          oneofKind: 'speechTranscribe',
          speechTranscribe: {
            text: 'accepted transcript',
            artifacts: [],
          },
        },
      },
    });

    const result = await runRuntimeSpeechTranscribe({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'audio.transcribe': {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local.stt.scenario',
          },
        },
        selectedParams: {
          'audio.transcribe': {
            language: 'en-US',
            responseFormat: 'json',
            speakerCount: '2',
            prompt: 'product demo',
            timestamps: true,
            diarization: true,
            timeoutMs: '120000',
          },
        },
      }),
      audio: {
        type: 'bytes',
        bytes: new Uint8Array([7, 8, 9]),
        mimeType: 'audio/wav',
      },
      scenarioId: 'speech-transcribe',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.transcribe-studio',
      metadata: { productSurface: 'transcribe-studio' },
      withScopes,
    });

    expect(result).toMatchObject({
      ok: true,
      capabilityId: 'audio.transcribe',
      output: {
        kind: 'transcript',
        text: 'accepted transcript',
        jobId: 'job-transcribe-1',
        jobStatus: 'COMPLETED',
        artifactCount: 0,
      },
      trace: {
        traceId: 'trace-transcribe-artifacts',
        modelResolved: 'local.stt.scenario',
        routeDecision: 'local',
      },
    });
    expect(withScopesCalls).toHaveBeenCalledOnce();
    expect(withScopesCalls.mock.calls[0]?.[0]).toEqual(['ai.spend.meter']);
    expect(runtime.ai.submitScenarioJob).toHaveBeenCalledOnce();
    const [request, options] = runtime.ai.submitScenarioJob.mock.calls[0];
    expect(request.scenarioType).toBe(ScenarioType.SPEECH_TRANSCRIBE);
    expect(request.executionMode).toBe(ExecutionMode.ASYNC_JOB);
    expect(request.head).toMatchObject({
      appId: 'nimi.zhiyu',
      subjectUserId: 'subject-user-1',
      modelId: 'local.stt.scenario',
      connectorId: '',
      timeoutMs: 120000,
    });
    expect(request.spec.spec.speechTranscribe).toMatchObject({
      mimeType: 'audio/wav',
      language: 'en-US',
      responseFormat: 'json',
      speakerCount: 2,
      prompt: 'product demo',
      timestamps: true,
      diarization: true,
    });
    expect(request.spec.spec.speechTranscribe.audioSource.source.oneofKind).toBe('audioBytes');
    expect(request.spec.spec.speechTranscribe.audioSource.source.audioBytes).toEqual(new Uint8Array([7, 8, 9]));
    expect(options.metadata).toMatchObject({
      surfaceId: 'zhiyu.transcribe-studio',
      scenarioId: 'speech-transcribe',
      productSurface: 'transcribe-studio',
      aiConfigBindingCapabilityId: 'audio.transcribe',
      aiConfigBindingModel: 'local.stt.scenario',
      aiConfigTargetRefKind: 'local-runtime',
      runtimeSchedulingState: 'runnable',
      'x-nimi-access-token-id': 'token-1',
      'x-nimi-idempotency-key': 'speech-transcribe',
    });
  });

  it('loads audio bytes from URL before dispatch for app consumers', async () => {
    const runtime = createRuntimeHarness();
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    runtime.ai.submitScenarioJob.mockResolvedValue({
      job: {
        jobId: 'job-transcribe-url',
        status: ScenarioJobStatus.SUBMITTED,
        scenarioType: ScenarioType.SPEECH_TRANSCRIBE,
        artifacts: [],
      },
    });
    runtime.ai.subscribeScenarioJobEvents.mockImplementation(async function* () {
      yield {
        eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
        sequence: '1',
        traceId: 'trace-url-event',
        job: {
          jobId: 'job-transcribe-url',
          status: ScenarioJobStatus.COMPLETED,
          scenarioType: ScenarioType.SPEECH_TRANSCRIBE,
          traceId: 'trace-url-event',
          artifacts: [],
        },
      };
    });
    runtime.ai.getScenarioArtifacts.mockResolvedValue({
      traceId: 'trace-url-artifacts',
      artifacts: [],
      output: {
        output: {
          oneofKind: 'speechTranscribe',
          speechTranscribe: { text: 'url transcript', artifacts: [] },
        },
      },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'audio/wav; charset=binary' : null },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })) as unknown as typeof fetch;

    try {
      const result = await runRuntimeSpeechTranscribe({
        runtime,
        appId: 'nimi.zhiyu',
        config: createAIConfig({
          targetRefs: {
            'audio.transcribe': {
              kind: 'local-runtime',
              version: 'v2',
              profileBindingId: 'local.stt.scenario',
            },
          },
        }),
        audioUrl: 'https://example.com/sample.wav',
        scenarioId: 'speech-transcribe-url',
        subjectUserId: 'subject-user-1',
        surfaceId: 'zhiyu.transcribe-studio',
      });
      expect(result).toMatchObject({
        ok: true,
        output: { text: 'url transcript' },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const [request] = runtime.ai.submitScenarioJob.mock.calls[0];
    expect(request.spec.spec.speechTranscribe.mimeType).toBe('audio/wav');
    expect(request.spec.spec.speechTranscribe.audioSource.source.oneofKind).toBe('audioBytes');
    expect(request.spec.spec.speechTranscribe.audioSource.source.audioBytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('does not fetch URL audio before binding and principal preflight passes', async () => {
    const runtime = createRuntimeHarness();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'audio/wav' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })) as unknown as typeof fetch;

    try {
      const result = await runRuntimeSpeechTranscribe({
        runtime,
        appId: 'nimi.zhiyu',
        config: createAIConfig(),
        audioUrl: 'https://example.com/private-audio.wav',
        scenarioId: 'speech-transcribe-missing-binding',
        subjectUserId: 'subject-user-1',
        surfaceId: 'zhiyu.transcribe-studio',
      });

      expect(result).toMatchObject({
        ok: false,
        capabilityId: 'audio.transcribe',
        reason: 'ai-config-binding-missing',
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(runtime.scheduling.peekScheduling).not.toHaveBeenCalled();
      expect(runtime.ai.submitScenarioJob).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('preserves provider detail on audio.transcribe Runtime failures', async () => {
    const runtime = createRuntimeHarness();
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    const error = new Error('provider request failed') as Error & {
      reasonCode: string;
      details: { provider_message: string };
    };
    error.reasonCode = ReasonCode.AI_INPUT_INVALID;
    error.details = { provider_message: 'transcription provider rejected audio' };
    runtime.ai.submitScenarioJob.mockRejectedValue(error);

    const result = await runRuntimeSpeechTranscribe({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'audio.transcribe': {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local.stt.scenario',
          },
        },
      }),
      audio: {
        type: 'bytes',
        bytes: new Uint8Array([7, 8, 9]),
        mimeType: 'audio/wav',
      },
      scenarioId: 'transcribe-provider-detail',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.transcribe-studio',
    });

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'audio.transcribe',
      reason: 'runtime-call-failed',
    });
    expect(result.message).toContain('AI_INPUT_INVALID: provider request failed');
    expect(result.message).toContain('Provider detail: transcription provider rejected audio');
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
      submitScenarioJob: vi.fn(),
      subscribeScenarioJobEvents: vi.fn(),
      getScenarioJob: vi.fn(),
      cancelScenarioJob: vi.fn(),
      getScenarioArtifacts: vi.fn(),
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
