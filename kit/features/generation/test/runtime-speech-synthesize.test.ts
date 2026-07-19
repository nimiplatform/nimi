import { describe, expect, it, vi } from 'vitest';
import {
  runRuntimeSpeechSynthesize,
  type RuntimeSpeechSynthesizeRuntime,
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
import { createScenarioJobFixture } from './runtime-scenario-job-fixture.js';
import {
  createLocalAssetRecordFixture,
  createRuntimeLocalRpcFixture,
} from './runtime-local-rpc-fixture.js';

describe('runtime speech synthesis helper', () => {
  it('fails closed before dispatch when the AIConfig audio binding is missing', async () => {
    const runtime = createRuntimeHarness();

    const result = await runRuntimeSpeechSynthesize({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig(),
      text: 'read this aloud',
      scenarioId: 'missing-audio-binding',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.capability-studio.audio.synthesize',
    });

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'audio.synthesize',
      reason: 'ai-config-binding-missing',
    });
    expect(runtime.scheduling.peekScheduling).not.toHaveBeenCalled();
    expect(runtime.ai.submitScenarioJob).not.toHaveBeenCalled();
  });

  it('fails closed for local TTS when no admitted voice reference is selected', async () => {
    const runtime = createRuntimeHarness();

    const result = await runRuntimeSpeechSynthesize({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'audio.synthesize': {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local-runtime:tts-main',
          },
        },
      }),
      text: 'local voice needs authority',
      scenarioId: 'local-tts-missing-voice',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.capability-studio.audio.synthesize',
    });

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'audio.synthesize',
      reason: 'input-invalid',
    });
    expect(result.message).toContain('audio.synthesize local model requires an explicit admitted Voice reference');
    expect(runtime.scheduling.peekScheduling).not.toHaveBeenCalled();
    expect(runtime.ai.submitScenarioJob).not.toHaveBeenCalled();
  });

  it('submits audio.synthesize through the configured Runtime job route and summarizes audio artifacts', async () => {
    const runtime = createRuntimeHarness();
    const jobUpdates: string[] = [];
    const { runner: withScopes, callSpy: withScopesCalls } = createRuntimeScopeRunnerFixture({
      'x-nimi-access-token-id': 'token-1',
      'x-nimi-access-token-secret': 'secret-1',
    });
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    runtime.ai.submitScenarioJob.mockResolvedValue({
      job: createScenarioJobFixture({
        jobId: 'job-audio-1',
        status: ScenarioJobStatus.SUBMITTED,
        scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
        artifacts: [],
      }),
    });
    runtime.ai.subscribeScenarioJobEvents.mockImplementation(async function* () {
      yield {
        eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
        sequence: '1',
        traceId: 'trace-audio-event',
        job: createScenarioJobFixture({
          jobId: 'job-audio-1',
          status: ScenarioJobStatus.COMPLETED,
          scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
          traceId: 'trace-audio-event',
          artifacts: [
            audioArtifact({
              artifactId: 'artifact-inline-audio',
              mimeType: 'audio/mpeg',
              bytes: new Uint8Array([1, 2, 3]),
            }),
          ],
        }),
      };
    });
    runtime.ai.getScenarioArtifacts.mockResolvedValue({
      jobId: 'job-audio-1',
      traceId: 'trace-audio-artifacts',
      artifacts: [
        audioArtifact({
          artifactId: 'artifact-inline-audio',
          mimeType: 'audio/mpeg',
          bytes: new Uint8Array([1, 2, 3]),
        }),
        audioArtifact({
          artifactId: 'artifact-uri-audio',
          mimeType: 'audio/wav',
          uri: 'runtime-artifact://artifact-uri-audio',
        }),
      ],
      output: {
        output: {
          oneofKind: 'speechSynthesize',
          speechSynthesize: {
            artifacts: [
              audioArtifact({
                artifactId: 'artifact-inline-audio',
                mimeType: 'audio/mpeg',
                bytes: new Uint8Array([1, 2, 3]),
              }),
            ],
          },
        },
      },
    });

    const result = await runRuntimeSpeechSynthesize({
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
        selectedParams: {
          'audio.synthesize': {
            presetVoiceId: 'voice-main',
            language: 'zh-CN',
            audioFormat: 'mp3',
            sampleRateHz: '24000',
            speed: '1.05',
            pitch: '0',
            volume: '0.9',
            emotion: 'warm',
            timeoutMs: '90000',
          },
        },
      }),
      text: 'read this aloud',
      scenarioId: 'audio-synthesize',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.capability-studio.audio.synthesize',
      metadata: { productSurface: 'developer-backstage' },
      withScopes,
      onJobUpdate: (job) => jobUpdates.push(String(job.status)),
    });

    expect(result).toMatchObject({
      ok: true,
      capabilityId: 'audio.synthesize',
      output: {
        kind: 'audio-artifacts',
        jobId: 'job-audio-1',
        jobStatus: 'COMPLETED',
        artifactCount: 1,
        firstArtifact: {
          artifactId: 'artifact-inline-audio',
          mimeType: 'audio/mpeg',
          previewSource: 'inline-bytes',
          previewUrl: 'data:audio/mpeg;base64,AQID',
          sizeBytes: 3,
        },
      },
      trace: {
        traceId: 'trace-audio-artifacts',
        modelResolved: 'tts-model',
        routeDecision: 'cloud',
      },
    });

    expect(jobUpdates).toEqual([
      String(ScenarioJobStatus.SUBMITTED),
      String(ScenarioJobStatus.COMPLETED),
    ]);
    expect(withScopesCalls).toHaveBeenCalledOnce();
    expect(withScopesCalls.mock.calls[0]?.[0]).toEqual(['ai.spend.meter']);
    expect(runtime.scheduling.peekScheduling).toHaveBeenCalledOnce();
    const [schedulingInput] = runtime.scheduling.peekScheduling.mock.calls[0];
    expect(schedulingInput.targets[0]).toMatchObject({
      capability: 'audio.synthesize',
      targetId: 'runtime-connector',
      profileId: 'tts-model',
    });

    expect(runtime.ai.submitScenarioJob).toHaveBeenCalledOnce();
    const [request, options] = runtime.ai.submitScenarioJob.mock.calls[0];
    expect(request.scenarioType).toBe(ScenarioType.SPEECH_SYNTHESIZE);
    expect(request.executionMode).toBe(ExecutionMode.ASYNC_JOB);
    expect(request.head).toMatchObject({
      appId: 'nimi.zhiyu',
      subjectUserId: 'subject-user-1',
      modelId: 'tts-model',
      connectorId: 'runtime-connector',
      timeoutMs: 90000,
    });
    expect(request.spec.spec.oneofKind).toBe('speechSynthesize');
    expect(request.spec.spec.speechSynthesize).toMatchObject({
      text: 'read this aloud',
      language: 'zh-CN',
      audioFormat: 'mp3',
      sampleRateHz: 24000,
      speed: 1.05,
      pitch: 0,
      volume: 0.9,
      emotion: 'warm',
      voiceRef: {
        reference: {
          oneofKind: 'presetVoiceId',
          presetVoiceId: 'voice-main',
        },
      },
    });
    expect(request.labels).toMatchObject({
      appId: 'nimi.zhiyu',
      surfaceId: 'zhiyu.capability-studio.audio.synthesize',
      scenarioId: 'audio-synthesize',
      capabilityId: 'audio.synthesize',
      bindingCapabilityId: 'audio.synthesize',
      routePolicy: 'cloud',
      targetRefKind: 'cloud-connector',
      productSurface: 'developer-backstage',
    });
    expect(options.metadata).toMatchObject({
      surfaceId: 'zhiyu.capability-studio.audio.synthesize',
      scenarioId: 'audio-synthesize',
      productSurface: 'developer-backstage',
      aiConfigBindingCapabilityId: 'audio.synthesize',
      aiConfigBindingModel: 'tts-model',
      aiConfigTargetRefKind: 'cloud-connector',
      runtimeSchedulingState: 'runnable',
      'x-nimi-access-token-id': 'token-1',
      'x-nimi-access-token-secret': 'secret-1',
      'x-nimi-idempotency-key': 'audio-synthesize',
    });
  });

  it('accepts a pre-resolved speech binding and forwards abort signal to the Runtime job runner', async () => {
    const runtime = createRuntimeHarness();
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    const abort = new AbortController();
    abort.abort();

    const result = await runRuntimeSpeechSynthesize({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig(),
      binding: {
        bindingCapabilityId: 'audio.synthesize',
        targetRef: {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'local-tts-main',
        },
        model: 'speech/qwen3-tts-local',
        routePolicy: 'local',
        schedulingTarget: {
          capability: 'audio.synthesize',
          targetRef: {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local-tts-main',
          },
        },
        selectedParams: {
          voiceAssetId: 'voice-asset-1',
          timeoutMs: '90000',
        },
        metadata: {
          aiConfigBindingCapabilityId: 'audio.synthesize',
          aiConfigBindingModel: 'local-tts-main',
          aiConfigRuntimeModelAssetId: 'speech/qwen3-tts-local',
          aiConfigRuntimeModelLocalAssetId: 'local-tts-main',
          aiConfigTargetRefKind: 'local-runtime',
        },
      },
      text: 'abort this speech job',
      scenarioId: 'audio-pre-resolved-abort',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.capability-studio.audio.synthesize',
      signal: abort.signal,
      abortReason: 'test_audio_abort',
    });

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'audio.synthesize',
      reason: 'runtime-call-failed',
    });
    expect(result.message).toContain('Runtime Scenario job was aborted');
    expect(runtime.scheduling.peekScheduling).toHaveBeenCalledOnce();
    expect(runtime.ai.submitScenarioJob).not.toHaveBeenCalled();
  });

  it('preserves provider detail on audio.synthesize Runtime failures', async () => {
    const runtime = createRuntimeHarness();
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    const error = new Error('provider request failed') as Error & {
      reasonCode: string;
      details: { provider_message: string };
    };
    error.reasonCode = ReasonCode.AI_INPUT_INVALID;
    error.details = { provider_message: 'speech provider rejected preset voice' };
    runtime.ai.submitScenarioJob.mockRejectedValue(error);

    const result = await runRuntimeSpeechSynthesize({
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
        selectedParams: {
          'audio.synthesize': {
            presetVoiceId: 'voice-main',
          },
        },
      }),
      text: 'read this aloud',
      scenarioId: 'speech-provider-detail',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.capability-studio.audio.synthesize',
    });

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'audio.synthesize',
      reason: 'runtime-call-failed',
    });
    expect(result.message).toContain('AI_INPUT_INVALID: provider request failed');
    expect(result.message).toContain('Provider detail: speech provider rejected preset voice');
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
      subscribeScenarioJobEvents: vi.fn(async function* () {
        yield {
          eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
          sequence: '1',
          traceId: 'trace-audio-default',
          job: createScenarioJobFixture({
            jobId: 'job-audio-default',
            status: ScenarioJobStatus.COMPLETED,
            scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
            artifacts: [audioArtifact({ artifactId: 'artifact-default', bytes: new Uint8Array([1]) })],
          }),
        };
      }),
      getScenarioJob: vi.fn(),
      cancelScenarioJob: vi.fn(),
      getScenarioArtifacts: vi.fn(async (): Promise<Awaited<ReturnType<RuntimeSpeechSynthesizeRuntime['ai']['getScenarioArtifacts']>>> => ({
        jobId: 'job-audio-default',
        traceId: 'trace-audio-default',
        artifacts: [audioArtifact({ artifactId: 'artifact-default', bytes: new Uint8Array([1]) })],
        output: {
          output: {
            oneofKind: 'speechSynthesize',
            speechSynthesize: {
              artifacts: [audioArtifact({ artifactId: 'artifact-default', bytes: new Uint8Array([1]) })],
            },
          },
        },
      })),
    },
    local: createRuntimeLocalRpcFixture({
      listLocalAssets: vi.fn(async () => ({
        nextPageToken: '',
        assets: [createLocalAssetRecordFixture({
          localAssetId: 'local-tts-main',
          assetId: 'speech/qwen3-tts-local',
          kind: 'tts',
          engine: 'speech',
        })],
      })),
    }),
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

function audioArtifact(input: {
  artifactId?: string;
  mimeType?: string;
  bytes?: Uint8Array;
  uri?: string;
}) {
  return {
    artifactId: input.artifactId ?? '',
    mimeType: input.mimeType ?? 'audio/mpeg',
    bytes: input.bytes ?? new Uint8Array(),
    uri: input.uri ?? '',
    sha256: '',
    sizeBytes: input.bytes ? String(input.bytes.byteLength) : '0',
    durationMs: '0',
    fps: 0,
    width: 0,
    height: 0,
    sampleRateHz: 0,
    channels: 0,
    metadata: undefined,
  };
}
