import { describe, expect, it, vi } from 'vitest';
import {
  runRuntimeVideoGenerate,
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

describe('runtime video generation helper', () => {
  it('submits video.generate through the configured Runtime job route and summarizes video artifacts', async () => {
    const runtime = createRuntimeHarness();
    const { runner: withScopes, callSpy: withScopesCalls } = createRuntimeScopeRunnerFixture({
      'x-nimi-access-token-id': 'token-1',
    });
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    runtime.ai.submitScenarioJob.mockResolvedValue({
      job: {
        jobId: 'job-video-1',
        status: ScenarioJobStatus.SUBMITTED,
        scenarioType: ScenarioType.VIDEO_GENERATE,
        artifacts: [],
      },
    });
    runtime.ai.subscribeScenarioJobEvents.mockImplementation(async function* () {
      yield {
        eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
        sequence: '1',
        traceId: 'trace-video-event',
        job: {
          jobId: 'job-video-1',
          status: ScenarioJobStatus.COMPLETED,
          scenarioType: ScenarioType.VIDEO_GENERATE,
          traceId: 'trace-video-event',
          artifacts: [
            videoArtifact({
              artifactId: 'artifact-video-uri',
              uri: 'runtime-artifact://artifact-video-uri',
            }),
          ],
        },
      };
    });
    runtime.ai.getScenarioArtifacts.mockResolvedValue({
      traceId: 'trace-video-artifacts',
      artifacts: [
        videoArtifact({
          artifactId: 'artifact-video-uri',
          uri: 'runtime-artifact://artifact-video-uri',
        }),
      ],
      output: {
        output: {
          oneofKind: 'videoGenerate',
          videoGenerate: {
            artifacts: [
              videoArtifact({
                artifactId: 'artifact-video-uri',
                uri: 'runtime-artifact://artifact-video-uri',
              }),
            ],
          },
        },
      },
    });

    const result = await runRuntimeVideoGenerate({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'video.generate': {
            kind: 'cloud-connector',
            connectorId: 'runtime-video-connector',
            remoteModelCatalogId: 'remote-catalog:runtime-video-connector:runtime-video-model',
            providerModelId: 'runtime-video-model',
          },
        },
        selectedParams: {
          'video.generate': {
            mode: 't2v',
            negativePrompt: 'blur',
            ratio: '9:16',
            durationSec: '6',
            resolution: '720p',
            fps: '24',
            seed: '42',
            cameraFixed: true,
            generateAudio: true,
            timeoutMs: '123000',
          },
        },
      }),
      prompt: 'Generate a moving product shot',
      scenarioId: 'video-generate',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.video-studio',
      metadata: { productSurface: 'video-studio' },
      withScopes,
    });

    expect(result).toMatchObject({
      ok: true,
      capabilityId: 'video.generate',
      output: {
        kind: 'video-artifacts',
        jobId: 'job-video-1',
        jobStatus: 'COMPLETED',
        artifactCount: 1,
        firstArtifact: {
          artifactId: 'artifact-video-uri',
          mimeType: 'video/mp4',
          previewSource: 'hosted-uri',
          previewUrl: 'runtime-artifact://artifact-video-uri',
        },
      },
      trace: {
        traceId: 'trace-video-artifacts',
        modelResolved: 'runtime-video-model',
        routeDecision: 'cloud',
      },
    });
    expect(withScopesCalls).toHaveBeenCalledOnce();
    expect(withScopesCalls.mock.calls[0]?.[0]).toEqual(['ai.spend.meter']);
    expect(runtime.ai.submitScenarioJob).toHaveBeenCalledOnce();
    const [request, options] = runtime.ai.submitScenarioJob.mock.calls[0];
    expect(request.scenarioType).toBe(ScenarioType.VIDEO_GENERATE);
    expect(request.executionMode).toBe(ExecutionMode.ASYNC_JOB);
    expect(request.head).toMatchObject({
      appId: 'nimi.zhiyu',
      subjectUserId: 'subject-user-1',
      modelId: 'runtime-video-model',
      connectorId: 'runtime-video-connector',
      timeoutMs: 123000,
    });
    expect(request.spec.spec.videoGenerate).toMatchObject({
      prompt: 'Generate a moving product shot',
      negativePrompt: 'blur',
      mode: 1,
      options: {
        ratio: '9:16',
        durationSec: 6,
        resolution: '720p',
        fps: 24,
        seed: '42',
        cameraFixed: true,
        generateAudio: true,
      },
    });
    expect(options.metadata).toMatchObject({
      surfaceId: 'zhiyu.video-studio',
      scenarioId: 'video-generate',
      productSurface: 'video-studio',
      aiConfigBindingCapabilityId: 'video.generate',
      aiConfigBindingModel: 'runtime-video-model',
      aiConfigTargetRefKind: 'cloud-connector',
      runtimeSchedulingState: 'runnable',
      'x-nimi-access-token-id': 'token-1',
      'x-nimi-idempotency-key': 'video-generate',
    });
  });

  it('preserves provider detail on video.generate Runtime failures', async () => {
    const runtime = createRuntimeHarness();
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    const error = new Error('provider request failed') as Error & {
      reasonCode: string;
      details: { provider_message: string };
    };
    error.reasonCode = ReasonCode.AI_INPUT_INVALID;
    error.details = { provider_message: 'video provider rejected ratio 9:99' };
    runtime.ai.submitScenarioJob.mockRejectedValue(error);

    const result = await runRuntimeVideoGenerate({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'video.generate': {
            kind: 'cloud-connector',
            connectorId: 'runtime-video-connector',
            remoteModelCatalogId: 'remote-catalog:runtime-video-connector:runtime-video-model',
            providerModelId: 'runtime-video-model',
          },
        },
      }),
      prompt: 'Generate a moving product shot',
      scenarioId: 'video-provider-detail',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.video-studio',
    });

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'video.generate',
      reason: 'runtime-call-failed',
    });
    expect(result.message).toContain('AI_INPUT_INVALID: provider request failed');
    expect(result.message).toContain('Provider detail: video provider rejected ratio 9:99');
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
      logicalModelIds: {},
      targetRefs: input.targetRefs ?? {},
      selectedComponents: {},
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

function videoArtifact(input: {
  artifactId?: string;
  mimeType?: string;
  bytes?: Uint8Array;
  uri?: string;
}) {
  return {
    artifactId: input.artifactId ?? '',
    mimeType: input.mimeType ?? 'video/mp4',
    bytes: input.bytes ?? new Uint8Array(),
    uri: input.uri ?? '',
    sizeBytes: input.bytes ? String(input.bytes.byteLength) : '0',
    durationMs: '0',
    width: 0,
    height: 0,
    metadata: undefined,
  };
}
