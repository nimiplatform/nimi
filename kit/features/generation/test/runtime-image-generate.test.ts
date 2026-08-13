import { describe, expect, it, vi } from 'vitest';
import {
  ExecutionMode,
  ReasonCode,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
  createNimiError,
  isNimiError,
  type NimiRuntimeScenarioArtifact,
  type NimiRuntimeScenarioJobClient,
  type ScenarioJob,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  runRuntimeImageGenerate,
  type RuntimeImageGenerateInput,
} from '../src/runtime-image-generate.js';

function imageJob(status: ScenarioJobStatus, overrides: Partial<ScenarioJob> = {}): ScenarioJob {
  return {
    jobId: 'job-image-1', scenarioType: ScenarioType.IMAGE_GENERATE,
    executionMode: ExecutionMode.ASYNC_JOB, routeDecision: 1, modelResolved: 'image-runtime',
    status, providerJobId: '', reasonCode: 0, reasonDetail: '', retryCount: 0, artifacts: [],
    traceId: 'trace-image-1', ignoredExtensions: [], progressPercent: 0, progressCurrentStep: 0,
    progressTotalSteps: 0, transcriptionText: '', ...overrides,
  };
}

function imageArtifact(overrides: Partial<NimiRuntimeScenarioArtifact> = {}): NimiRuntimeScenarioArtifact {
  return {
    artifactId: 'artifact-image-1', mimeType: 'image/png', bytes: new Uint8Array(), uri: '',
    sha256: '', sizeBytes: '0', durationMs: '0', fps: 0, width: 512, height: 512,
    sampleRateHz: 0, channels: 0, ...overrides,
  };
}

function imageEventType(status: ScenarioJobStatus): ScenarioJobEventType {
  switch (status) {
    case ScenarioJobStatus.SUBMITTED: return ScenarioJobEventType.SCENARIO_JOB_EVENT_SUBMITTED;
    case ScenarioJobStatus.QUEUED: return ScenarioJobEventType.SCENARIO_JOB_EVENT_QUEUED;
    case ScenarioJobStatus.RUNNING: return ScenarioJobEventType.SCENARIO_JOB_EVENT_RUNNING;
    case ScenarioJobStatus.COMPLETED: return ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED;
    case ScenarioJobStatus.FAILED: return ScenarioJobEventType.SCENARIO_JOB_EVENT_FAILED;
    case ScenarioJobStatus.CANCELED: return ScenarioJobEventType.SCENARIO_JOB_EVENT_CANCELED;
    case ScenarioJobStatus.TIMEOUT: return ScenarioJobEventType.SCENARIO_JOB_EVENT_TIMEOUT;
    default: return ScenarioJobEventType.SCENARIO_JOB_EVENT_TYPE_UNSPECIFIED;
  }
}

function fakeClient(config: {
  events?: readonly ScenarioJob[];
  artifacts?: readonly NimiRuntimeScenarioArtifact[];
  submitError?: unknown;
  neverEndingEvents?: boolean;
}) {
  const submitScenarioJob = vi.fn<NimiRuntimeScenarioJobClient['submitScenarioJob']>(async () => {
    if (config.submitError) throw config.submitError;
    return { job: imageJob(ScenarioJobStatus.RUNNING) };
  });
  const getScenarioJob = vi.fn<NimiRuntimeScenarioJobClient['getScenarioJob']>(async () => ({
    job: config.events?.at(-1) ?? imageJob(ScenarioJobStatus.COMPLETED),
  }));
  const cancelScenarioJob = vi.fn<NimiRuntimeScenarioJobClient['cancelScenarioJob']>(async () => ({}));
  const subscribeScenarioJobEvents = vi.fn<NimiRuntimeScenarioJobClient['subscribeScenarioJobEvents']>(() => ({
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (config.neverEndingEvents) return new Promise<never>(() => {});
          const job = config.events?.[index++];
          return job
            ? { done: false as const, value: { eventType: imageEventType(job.status), sequence: String(index), traceId: '', job } }
            : { done: true as const, value: undefined };
        },
      };
    },
  }));
  const artifacts = [...(config.artifacts ?? [imageArtifact()])];
  const getScenarioArtifacts = vi.fn<NimiRuntimeScenarioJobClient['getScenarioArtifacts']>(async () => ({
    jobId: 'job-image-1', artifacts, traceId: 'trace-image-1',
    output: { output: { oneofKind: 'imageGenerate' as const, imageGenerate: { artifacts } } },
  }));
  return {
    client: { submitScenarioJob, getScenarioJob, cancelScenarioJob, subscribeScenarioJobEvents, getScenarioArtifacts },
    submitScenarioJob, cancelScenarioJob,
  };
}

function input(client: NimiRuntimeScenarioJobClient, overrides: Partial<RuntimeImageGenerateInput> = {}): RuntimeImageGenerateInput {
  return {
    runtime: { ai: client }, appId: 'app.test', prompt: 'a blue sphere', scenarioId: 'image-1',
    subjectUserId: 'user.test', surfaceId: 'test', ...overrides,
  };
}

describe('runRuntimeImageGenerate', () => {
  it('submits an owner-driven image job and projects a hosted artifact', async () => {
    const hosted = imageArtifact({ uri: 'https://cdn.example.test/image.png', sizeBytes: '1024' });
    const fake = fakeClient({ events: [imageJob(ScenarioJobStatus.COMPLETED)], artifacts: [hosted] });
    const onJobUpdate = vi.fn();
    const request = input(fake.client, { count: 1, aspectRatio: '1:1', metadata: { source: 'tester' }, onJobUpdate });

    const result = await runRuntimeImageGenerate(request);

    expect(Object.keys(request)).not.toEqual(expect.arrayContaining(['config', 'binding', 'model', 'route', 'targetRef']));
    const [runtimeRequest] = fake.submitScenarioJob.mock.calls[0]!;
    expect(runtimeRequest).toMatchObject({ scenarioType: ScenarioType.IMAGE_GENERATE, executionMode: ExecutionMode.ASYNC_JOB });
    expect(runtimeRequest.labels).toEqual({ scenarioId: 'image-1', surfaceId: 'test', source: 'tester' });
    expect(onJobUpdate).toHaveBeenCalled();
    if (!result.ok) throw new Error(result.message);
    expect(result.output).toMatchObject({ kind: 'image-artifacts', jobId: 'job-image-1', jobStatus: 'COMPLETED', artifactCount: 1 });
    expect(result.output.firstArtifact).toEqual({
      artifactId: 'artifact-image-1', mimeType: 'image/png', uri: hosted.uri,
      previewUrl: hosted.uri, previewSource: 'hosted-uri', sizeBytes: 1024, width: 512, height: 512,
    });
    expect(result.trace).toEqual({ traceId: 'trace-image-1', modelResolved: 'image-runtime', routeDecision: 'LOCAL' });
  });

  it('projects inline bytes and metadata-only artifacts without out-of-band reads', async () => {
    const inline = imageArtifact({ artifactId: '', bytes: new Uint8Array([1, 2, 3]) });
    const metadata = imageArtifact({ width: 0, height: 0 });
    const fake = fakeClient({ events: [imageJob(ScenarioJobStatus.COMPLETED)], artifacts: [inline, metadata] });

    const result = await runRuntimeImageGenerate(input(fake.client));

    if (!result.ok) throw new Error(result.message);
    expect(result.output.artifacts[0]).toMatchObject({ previewSource: 'inline-bytes', sizeBytes: 3 });
    expect(result.output.artifacts[0]?.previewUrl).toBe(`data:image/png;base64,${btoa(String.fromCharCode(1, 2, 3))}`);
    expect(result.output.artifacts[1]).toMatchObject({ artifactId: 'artifact-image-1', previewSource: 'metadata-only' });
    expect(result.output.artifacts[1]?.previewUrl).toBeUndefined();
  });

  it('maps typed principal failures', async () => {
    const fake = fakeClient({ submitError: createNimiError({
      message: 'principal rejected', reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
      actionHint: 'reauthenticate', source: 'runtime',
    }) });

    const result = await runRuntimeImageGenerate(input(fake.client));

    expect(result).toMatchObject({ ok: false, capabilityId: 'image.generate', reason: 'principal-unauthorized' });
    if (result.ok) throw new Error('expected failure');
    expect(isNimiError(result.error)).toBe(true);
  });

  it('maps invalid image input before submit', async () => {
    const fake = fakeClient({});
    const result = await runRuntimeImageGenerate(input(fake.client, { prompt: ' ' }));
    expect(result).toMatchObject({ ok: false, reason: 'input-invalid' });
    expect(fake.submitScenarioJob).not.toHaveBeenCalled();
  });

  it('aborts, cancels the job, and fails closed', async () => {
    const fake = fakeClient({ neverEndingEvents: true });
    const controller = new AbortController();
    const pending = runRuntimeImageGenerate(input(fake.client, { signal: controller.signal, abortReason: 'tester abort' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    const result = await pending;
    expect(result).toMatchObject({ ok: false, reason: 'runtime-call-failed' });
    expect(fake.cancelScenarioJob).toHaveBeenCalledTimes(1);
    expect(fake.cancelScenarioJob.mock.calls[0]?.[0]).toMatchObject({ jobId: 'job-image-1', reason: 'tester abort' });
  });
});
