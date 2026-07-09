import { describe, expect, it, vi } from 'vitest';
import {
  runRuntimeImageGenerate,
} from '../src/runtime.js';
import {
  ExecutionMode,
  ReasonCode,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
  fromNimiRuntimeProtoStruct,
  type NimiAIConfig,
} from '@nimiplatform/kit/core/sdk-contract';

describe('runtime image generation helper', () => {
  it('fails closed before dispatch when the AIConfig image binding is missing', async () => {
    const runtime = createRuntimeHarness();

    const result = await runRuntimeImageGenerate({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig(),
      prompt: 'Song dynasty scholar portrait',
      scenarioId: 'missing-image-binding',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.image-studio',
    });

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'image.generate',
      reason: 'ai-config-binding-missing',
    });
    expect(runtime.scheduling.peekScheduling).not.toHaveBeenCalled();
    expect(runtime.ai.submitScenarioJob).not.toHaveBeenCalled();
  });

  it('submits image.generate through the configured Runtime job route and summarizes Runtime artifacts', async () => {
    const runtime = createRuntimeHarness();
    const jobUpdates: string[] = [];
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    runtime.ai.submitScenarioJob.mockResolvedValue({
      job: {
        jobId: 'job-image-1',
        status: ScenarioJobStatus.SUBMITTED,
        scenarioType: ScenarioType.IMAGE_GENERATE,
        artifacts: [],
      },
    });
    runtime.ai.subscribeScenarioJobEvents.mockImplementation(async function* () {
      yield {
        eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
        sequence: '1',
        traceId: 'trace-image-event',
        job: {
          jobId: 'job-image-1',
          status: ScenarioJobStatus.COMPLETED,
          scenarioType: ScenarioType.IMAGE_GENERATE,
          traceId: 'trace-image-event',
          artifacts: [
            imageArtifact({
              artifactId: 'artifact-inline',
              mimeType: 'image/png',
              bytes: new Uint8Array([137, 80, 78, 71]),
            }),
            imageArtifact({
              artifactId: 'artifact-runtime-read',
              mimeType: 'image/png',
            }),
          ],
        },
      };
    });
    runtime.ai.getScenarioArtifacts.mockResolvedValue({
      traceId: 'trace-artifacts',
      artifacts: [
        imageArtifact({
          artifactId: 'artifact-inline',
          mimeType: 'image/png',
          bytes: new Uint8Array([137, 80, 78, 71]),
        }),
        imageArtifact({
          artifactId: 'artifact-runtime-read',
          mimeType: 'image/png',
          width: 512,
          height: 512,
        }),
        imageArtifact({
          artifactId: 'artifact-uri',
          mimeType: 'image/webp',
          uri: 'runtime-artifact://artifact-uri',
        }),
        imageArtifact({
          artifactId: 'artifact-metadata-only',
          mimeType: 'image/png',
        }),
      ],
      output: {
        output: {
          oneofKind: 'imageGenerate',
          imageGenerate: {
            artifacts: [
              imageArtifact({
                artifactId: 'artifact-inline',
                mimeType: 'image/png',
                bytes: new Uint8Array([137, 80, 78, 71]),
              }),
            ],
          },
        },
      },
    });
    runtime.artifacts.readArtifactBytes.mockImplementation(async ({ artifactId }) => {
      if (artifactId === 'artifact-runtime-read') {
        return {
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: 'image/png',
          sizeBytes: '3',
          mimeInferred: false,
        };
      }
      return {
        bytes: new Uint8Array(),
        mimeType: 'image/png',
        sizeBytes: '0',
        mimeInferred: false,
      };
    });
    const withScopes = vi.fn(<T,>(
      _scopes: readonly string[],
      operation: (options: { readonly metadata?: Record<string, string> }) => Promise<T>,
    ) => operation({ metadata: { 'x-nimi-access-token-id': 'token-1', 'x-nimi-access-token-secret': 'secret-1' } }));

    const result = await runRuntimeImageGenerate({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'image.generate': {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local-runtime:image-main',
          },
        },
        selectedParams: {
          'image.generate': {
            size: '1024x1024',
            count: '1',
            seed: '42',
            responseFormat: 'b64_json',
            timeoutMs: '90000',
            steps: '25',
            cfgScale: '1.5',
            modelFamily: 'z-image-turbo',
            companionSlots: {
              llm_path: 'local-runtime:z-image-llm',
              vae_path: 'local-runtime:z-image-ae',
            },
          },
        },
      }),
      prompt: 'Song dynasty scholar portrait',
      negativePrompt: 'low quality',
      scenarioId: 'image-generate',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.image-studio',
      metadata: { productSurface: 'image-studio' },
      withScopes,
      onJobUpdate: (job) => jobUpdates.push(String(job.status)),
    });

    expect(result).toMatchObject({
      ok: true,
      capabilityId: 'image.generate',
      output: {
        kind: 'image-artifacts',
        jobId: 'job-image-1',
        jobStatus: 'COMPLETED',
        artifactCount: 4,
        artifacts: [
          {
            artifactId: 'artifact-inline',
            mimeType: 'image/png',
            previewSource: 'inline-bytes',
            previewUrl: 'data:image/png;base64,iVBORw==',
          },
          {
            artifactId: 'artifact-runtime-read',
            mimeType: 'image/png',
            previewSource: 'runtime-artifact-read',
            previewUrl: 'data:image/png;base64,AQID',
            sizeBytes: 3,
            width: 512,
            height: 512,
          },
          {
            artifactId: 'artifact-uri',
            mimeType: 'image/webp',
            uri: 'runtime-artifact://artifact-uri',
            previewSource: 'hosted-uri',
            previewUrl: 'runtime-artifact://artifact-uri',
          },
          {
            artifactId: 'artifact-metadata-only',
            mimeType: 'image/png',
            previewSource: 'metadata-only',
          },
        ],
      },
      trace: {
        traceId: 'trace-artifacts',
        modelResolved: 'image-main',
        routeDecision: 'local',
      },
    });

    expect(jobUpdates).toEqual([
      String(ScenarioJobStatus.SUBMITTED),
      String(ScenarioJobStatus.COMPLETED),
    ]);
    expect(withScopes).toHaveBeenCalledOnce();
    expect(withScopes.mock.calls[0]?.[0]).toEqual(['ai.spend.meter']);
    expect(runtime.scheduling.peekScheduling).toHaveBeenCalledOnce();
    const [schedulingInput] = runtime.scheduling.peekScheduling.mock.calls[0];
    expect(schedulingInput.targets[0]).toMatchObject({
      capability: 'image.generate',
      targetId: 'local-runtime:image-main',
      profileId: 'local-runtime:image-main',
    });

    expect(runtime.ai.submitScenarioJob).toHaveBeenCalledOnce();
    const [request, options] = runtime.ai.submitScenarioJob.mock.calls[0];
    expect(request.scenarioType).toBe(ScenarioType.IMAGE_GENERATE);
    expect(request.executionMode).toBe(ExecutionMode.ASYNC_JOB);
    expect(request.head).toMatchObject({
      appId: 'nimi.zhiyu',
      subjectUserId: 'subject-user-1',
      modelId: 'image-main',
      connectorId: '',
      timeoutMs: 90000,
    });
    expect(request.spec.spec.oneofKind).toBe('imageGenerate');
    expect(request.spec.spec.imageGenerate).toMatchObject({
      prompt: 'Song dynasty scholar portrait',
      negativePrompt: 'low quality',
      size: '1024x1024',
      n: 1,
      seed: '42',
      responseFormat: 'b64_json',
    });
    expect(request.labels).toMatchObject({
      appId: 'nimi.zhiyu',
      surfaceId: 'zhiyu.image-studio',
      scenarioId: 'image-generate',
      capabilityId: 'image.generate',
      bindingCapabilityId: 'image.generate',
      routePolicy: 'local',
      targetRefKind: 'local-runtime',
      productSurface: 'image-studio',
    });
    expect(options.metadata).toMatchObject({
      surfaceId: 'zhiyu.image-studio',
      scenarioId: 'image-generate',
      productSurface: 'image-studio',
      aiConfigBindingCapabilityId: 'image.generate',
      aiConfigBindingModel: 'local-runtime:image-main',
      aiConfigTargetRefKind: 'local-runtime',
      runtimeSchedulingState: 'runnable',
      'x-nimi-access-token-id': 'token-1',
      'x-nimi-access-token-secret': 'secret-1',
      'x-nimi-idempotency-key': 'image-generate',
    });
    const imageExtension = request.extensions.find((extension: { namespace: string }) => (
      extension.namespace === 'nimi.scenario.image.request'
    ));
    expect(imageExtension).toBeTruthy();
    const extensionPayload = fromNimiRuntimeProtoStruct(imageExtension.payload);
    expect(extensionPayload).toMatchObject({
      steps: 25,
      cfgScale: 1.5,
      profile_overrides: {
        steps: 25,
        cfgScale: 1.5,
      },
      profile_entries: [
        {
          entry_id: 'main-image',
          asset_id: 'image-main',
          asset_kind: 'image',
          engine: 'media',
        },
        {
          entry_id: 'companion-llm',
          asset_id: 'z-image-llm',
          asset_kind: 'chat',
          engine: 'llama',
          engine_slot: 'llm_path',
          required: true,
        },
        {
          entry_id: 'companion-vae',
          asset_id: 'z-image-ae',
          asset_kind: 'vae',
          engine: 'media',
          engine_slot: 'vae_path',
          required: true,
        },
      ],
    });
  });

  it('accepts a pre-resolved image binding for caller-owned local asset materialization', async () => {
    const runtime = createRuntimeHarness();
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    runtime.ai.submitScenarioJob.mockResolvedValue({
      job: {
        jobId: 'job-image-pre-resolved',
        status: ScenarioJobStatus.SUBMITTED,
        scenarioType: ScenarioType.IMAGE_GENERATE,
        artifacts: [],
      },
    });

    const result = await runRuntimeImageGenerate({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig(),
      binding: {
        bindingCapabilityId: 'image.generate',
        targetRef: {
          kind: 'local-runtime',
          version: 'v2',
          profileBindingId: 'local-main-image',
        },
        model: 'local-import/z-image-turbo-Q4_K_M',
        routePolicy: 'local',
        schedulingTarget: {
          capability: 'image.generate',
          targetRef: {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local-main-image',
          },
        },
        selectedParams: {
          timeoutMs: '90000',
          profile_entries: [{
            entry_id: 'main-image',
            kind: 'asset',
            title: 'Main image model',
            capability: 'image.generate',
            asset_id: 'local-import/z-image-turbo-Q4_K_M',
            asset_kind: 'image',
            engine: 'media',
            required: true,
          }],
          entry_overrides: [{
            entry_id: 'main-image',
            local_asset_id: 'local-main-image',
          }],
        },
        metadata: {
          aiConfigBindingCapabilityId: 'image.generate',
          aiConfigBindingModel: 'local-main-image',
          aiConfigRuntimeModelAssetId: 'local-import/z-image-turbo-Q4_K_M',
          aiConfigRuntimeModelLocalAssetId: 'local-main-image',
          aiConfigTargetRefKind: 'local-runtime',
        },
      },
      prompt: 'local materialized image',
      scenarioId: 'image-pre-resolved-binding',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.image-studio',
    });

    expect(result).toMatchObject({
      ok: true,
      capabilityId: 'image.generate',
      trace: {
        modelResolved: 'local-import/z-image-turbo-Q4_K_M',
        routeDecision: 'local',
      },
    });
    expect(runtime.scheduling.peekScheduling).toHaveBeenCalledOnce();
    const [schedulingInput] = runtime.scheduling.peekScheduling.mock.calls[0];
    expect(schedulingInput.targets[0]).toMatchObject({
      capability: 'image.generate',
      targetId: 'local-main-image',
      profileId: 'local-main-image',
    });
    const [request, options] = runtime.ai.submitScenarioJob.mock.calls[0];
    expect(request.head.modelId).toBe('local-import/z-image-turbo-Q4_K_M');
    expect(request.labels).toMatchObject({
      aiConfigBindingModel: 'local-main-image',
      aiConfigRuntimeModelAssetId: 'local-import/z-image-turbo-Q4_K_M',
      aiConfigRuntimeModelLocalAssetId: 'local-main-image',
    });
    expect(options.metadata).toMatchObject({
      aiConfigBindingModel: 'local-main-image',
      aiConfigRuntimeModelAssetId: 'local-import/z-image-turbo-Q4_K_M',
      aiConfigRuntimeModelLocalAssetId: 'local-main-image',
    });
    const imageExtension = request.extensions.find((extension: { namespace: string }) => (
      extension.namespace === 'nimi.scenario.image.request'
    ));
    expect(fromNimiRuntimeProtoStruct(imageExtension.payload)).toMatchObject({
      profile_entries: [{
        entry_id: 'main-image',
        asset_id: 'local-import/z-image-turbo-Q4_K_M',
      }],
      entry_overrides: [{
        entry_id: 'main-image',
        local_asset_id: 'local-main-image',
      }],
    });
  });

  it('fails closed when required local image companions are missing', async () => {
    const runtime = createRuntimeHarness();

    const result = await runRuntimeImageGenerate({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'image.generate': {
            kind: 'local-runtime',
            version: 'v2',
            profileBindingId: 'local-runtime:image-main',
          },
        },
        selectedParams: {
          'image.generate': {
            modelFamily: 'ideogram4',
          },
        },
      }),
      prompt: 'paint a mountain',
      scenarioId: 'image-missing-companion',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.image-studio',
    });

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'image.generate',
      reason: 'local-companion-missing',
    });
    expect(result.message).toContain('uncond_diffusion_model');
    expect(runtime.scheduling.peekScheduling).not.toHaveBeenCalled();
    expect(runtime.ai.submitScenarioJob).not.toHaveBeenCalled();
  });

  it('fails closed when selected image params are invalid', async () => {
    const runtime = createRuntimeHarness();

    const result = await runRuntimeImageGenerate({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'image.generate': {
            kind: 'cloud-connector',
            connectorId: 'runtime-connector',
            remoteModelCatalogId: 'remote-catalog:runtime-connector:image-model',
            providerModelId: 'image-model',
          },
        },
        selectedParams: {
          'image.generate': {
            size: 'wide',
          },
        },
      }),
      prompt: 'paint a mountain',
      scenarioId: 'image-invalid-params',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.image-studio',
    });

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'image.generate',
      reason: 'input-invalid',
    });
    expect(result.message).toContain('selectedParams.size');
    expect(runtime.ai.submitScenarioJob).not.toHaveBeenCalled();
  });

  it('fails closed when Runtime completes without typed image artifacts', async () => {
    const runtime = createRuntimeHarness();
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    runtime.ai.submitScenarioJob.mockResolvedValue({
      job: {
        jobId: 'job-image-malformed',
        status: ScenarioJobStatus.SUBMITTED,
        scenarioType: ScenarioType.IMAGE_GENERATE,
        artifacts: [],
      },
    });
    runtime.ai.subscribeScenarioJobEvents.mockImplementation(async function* () {
      yield {
        eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
        sequence: '1',
        traceId: 'trace-image-malformed',
        job: {
          jobId: 'job-image-malformed',
          status: ScenarioJobStatus.COMPLETED,
          scenarioType: ScenarioType.IMAGE_GENERATE,
          artifacts: [],
        },
      };
    });
    runtime.ai.getScenarioArtifacts.mockResolvedValue({
      traceId: 'trace-image-malformed',
      artifacts: [],
      output: {
        output: {
          oneofKind: 'textGenerate',
          textGenerate: { text: 'not image output' },
        },
      },
    });

    const result = await runRuntimeImageGenerate({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'image.generate': {
            kind: 'cloud-connector',
            connectorId: 'runtime-connector',
            remoteModelCatalogId: 'remote-catalog:runtime-connector:image-model',
            providerModelId: 'image-model',
          },
        },
      }),
      prompt: 'paint a mountain',
      scenarioId: 'image-malformed-runtime-output',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.image-studio',
    });

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'image.generate',
      reason: 'runtime-call-failed',
    });
    expect(result.message).toContain('typed imageGenerate result');
  });

  it('preserves provider detail on image.generate Runtime failures', async () => {
    const runtime = createRuntimeHarness();
    runtime.scheduling.peekScheduling.mockResolvedValue(runnableSchedulingResponse());
    const error = new Error('provider request failed') as Error & {
      reasonCode: string;
      details: { provider_message: string };
    };
    error.reasonCode = ReasonCode.AI_INPUT_INVALID;
    error.details = { provider_message: 'image provider rejected model local/image' };
    runtime.ai.submitScenarioJob.mockRejectedValue(error);

    const result = await runRuntimeImageGenerate({
      runtime,
      appId: 'nimi.zhiyu',
      config: createAIConfig({
        targetRefs: {
          'image.generate': {
            kind: 'cloud-connector',
            connectorId: 'runtime-connector',
            remoteModelCatalogId: 'remote-catalog:runtime-connector:image-model',
            providerModelId: 'image-model',
          },
        },
      }),
      prompt: 'paint a mountain',
      scenarioId: 'image-provider-detail',
      subjectUserId: 'subject-user-1',
      surfaceId: 'zhiyu.image-studio',
    });

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'image.generate',
      reason: 'runtime-call-failed',
    });
    expect(result.message).toContain('AI_INPUT_INVALID: provider request failed');
    expect(result.message).toContain('Provider detail: image provider rejected model local/image');
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
          traceId: 'trace-image-default',
          job: {
            jobId: 'job-image-default',
            status: ScenarioJobStatus.COMPLETED,
            scenarioType: ScenarioType.IMAGE_GENERATE,
            artifacts: [imageArtifact({ artifactId: 'artifact-default', bytes: new Uint8Array([1]) })],
          },
        };
      }),
      getScenarioJob: vi.fn(),
      cancelScenarioJob: vi.fn(),
      getScenarioArtifacts: vi.fn(async () => ({
        traceId: 'trace-image-default',
        artifacts: [imageArtifact({ artifactId: 'artifact-default', bytes: new Uint8Array([1]) })],
        output: {
          output: {
            oneofKind: 'imageGenerate',
            imageGenerate: {
              artifacts: [imageArtifact({ artifactId: 'artifact-default', bytes: new Uint8Array([1]) })],
            },
          },
        },
      })),
    },
    artifacts: {
      readArtifactBytes: vi.fn(),
    },
    local: {
      listLocalAssets: vi.fn(async () => ({
        nextPageToken: '',
        assets: [
          localAsset({
            localAssetId: 'image-main',
            assetId: 'image-main',
            kind: 'image',
            engine: 'media',
          }),
          localAsset({
            localAssetId: 'z-image-llm',
            assetId: 'z-image-llm',
            kind: 'chat',
            engine: 'llama',
          }),
          localAsset({
            localAssetId: 'z-image-ae',
            assetId: 'z-image-ae',
            kind: 'vae',
            engine: 'media',
          }),
        ],
      })),
      resolveLocalEnvironmentPlan: vi.fn(async () => ({
        plan: readyLocalImageEnvironmentPlan(),
      })),
      listLocalEnvironmentDependencyJobs: vi.fn(async () => ({ jobs: [] })),
      startLocalEnvironmentDependencyJob: vi.fn(),
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

function imageArtifact(input: {
  artifactId?: string;
  mimeType?: string;
  bytes?: Uint8Array;
  uri?: string;
  width?: number;
  height?: number;
}) {
  return {
    artifactId: input.artifactId ?? '',
    mimeType: input.mimeType ?? 'image/png',
    bytes: input.bytes ?? new Uint8Array(),
    uri: input.uri ?? '',
    sizeBytes: input.bytes ? String(input.bytes.byteLength) : '0',
    width: input.width ?? 0,
    height: input.height ?? 0,
    metadata: undefined,
  };
}

function localAsset(input: {
  localAssetId: string;
  assetId: string;
  kind: string;
  engine: string;
}) {
  return {
    localAssetId: input.localAssetId,
    assetId: input.assetId,
    kind: input.kind,
    engine: input.engine,
    status: 'active',
  };
}

function readyLocalImageEnvironmentPlan() {
  return {
    planId: 'local-image-native-ready',
    packId: 'local-image-native',
    productLabel: 'Local image native',
    hostProfileId: 'tester-host',
    platformTuple: 'darwin-arm64',
    runtimeDataRoot: 'tester-data-root',
    consumerScope: 'local-image-native',
    cloudOnlyImpact: 'none',
    state: 'ready_managed',
    reasonCode: 'LOCAL_ENVIRONMENT_PLAN_READY',
    dependencies: [],
  };
}
