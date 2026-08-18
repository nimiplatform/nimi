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
  runRuntimeVideoGenerate,
  type RuntimeVideoGenerateInput,
} from '../src/runtime-video-generate.js';

function videoJobForTest(status: ScenarioJobStatus, overrides: Partial<ScenarioJob> = {}): ScenarioJob {
  return {
    jobId: 'job-video-1',
    scenarioType: ScenarioType.VIDEO_GENERATE,
    executionMode: ExecutionMode.ASYNC_JOB,
    routeDecision: 1,
    modelResolved: 'minimax-h3-local',
    status,
    providerJobId: '',
    reasonCode: 0,
    reasonDetail: '',
    retryCount: 0,
    artifacts: [],
    traceId: 'trace-video-1',
    ignoredExtensions: [],
    progressPercent: 0,
    progressCurrentStep: 0,
    progressTotalSteps: 0,
    transcriptionText: '',
    ...overrides,
  };
}

function videoArtifactForTest(overrides: Partial<NimiRuntimeScenarioArtifact> = {}): NimiRuntimeScenarioArtifact {
  return {
    artifactId: 'artifact-video-1',
    mimeType: 'video/mp4',
    bytes: new Uint8Array(),
    uri: '',
    sha256: '',
    sizeBytes: '0',
    durationMs: '0',
    fps: 24,
    width: 512,
    height: 288,
    sampleRateHz: 0,
    channels: 0,
    ...overrides,
  };
}

function videoEventType(status: ScenarioJobStatus): ScenarioJobEventType {
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

type FakeClientConfig = {
  readonly submitJob?: ScenarioJob;
  readonly events?: readonly ScenarioJob[];
  readonly artifacts?: readonly NimiRuntimeScenarioArtifact[];
  readonly submitError?: unknown;
  readonly neverEndingEvents?: boolean;
};

function fakeScenarioJobClient(config: FakeClientConfig) {
  const submitScenarioJob = vi.fn<NimiRuntimeScenarioJobClient['submitScenarioJob']>(async () => {
    if (config.submitError) throw config.submitError;
    return { job: config.submitJob ?? videoJobForTest(ScenarioJobStatus.RUNNING) };
  });
  const getScenarioJob = vi.fn<NimiRuntimeScenarioJobClient['getScenarioJob']>(async () => ({
    job: config.events?.[config.events.length - 1] ?? config.submitJob ?? videoJobForTest(ScenarioJobStatus.COMPLETED),
  }));
  const cancelScenarioJob = vi.fn<NimiRuntimeScenarioJobClient['cancelScenarioJob']>(async () => ({}));
  const subscribeScenarioJobEvents = vi.fn<NimiRuntimeScenarioJobClient['subscribeScenarioJobEvents']>((_) => ({
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next(): Promise<IteratorResult<{ eventType: ScenarioJobEventType; sequence: string; traceId: string; job: ScenarioJob }>> {
          if (config.neverEndingEvents) {
            return new Promise(() => {});
          }
          const job = config.events?.[index];
          index += 1;
          if (!job) {
            return { done: true, value: undefined };
          }
          return {
            done: false,
            value: { eventType: videoEventType(job.status), sequence: String(index), traceId: '', job },
          };
        },
      };
    },
  }));
  const getScenarioArtifacts = vi.fn<NimiRuntimeScenarioJobClient['getScenarioArtifacts']>(async () => ({
    jobId: 'job-video-1',
    artifacts: [...(config.artifacts ?? [videoArtifactForTest()])],
    traceId: 'trace-video-1',
    output: {
      output: {
        oneofKind: 'videoGenerate' as const,
        videoGenerate: { artifacts: [...(config.artifacts ?? [videoArtifactForTest()])] },
      },
    },
  }));
  const client: NimiRuntimeScenarioJobClient = {
    submitScenarioJob,
    getScenarioJob,
    cancelScenarioJob,
    subscribeScenarioJobEvents,
    getScenarioArtifacts,
  };
  return { client, submitScenarioJob, getScenarioJob, cancelScenarioJob, subscribeScenarioJobEvents, getScenarioArtifacts };
}

function videoInputForTest(
  client: NimiRuntimeScenarioJobClient,
  overrides: Partial<RuntimeVideoGenerateInput> = {},
): RuntimeVideoGenerateInput {
  return {
    runtime: { ai: client },
    appId: 'app.test',
    mode: 't2v',
    prompt: 'waves at dusk',
    scenarioId: 'video-1',
    subjectUserId: 'user.test',
    surfaceId: 'test',
    ...overrides,
  };
}

describe('runRuntimeVideoGenerate', () => {
  it('submits an owner-driven video scenario job and projects the completed artifacts', async () => {
    const events = [
      videoJobForTest(ScenarioJobStatus.RUNNING, { progressPercent: 40 }),
      videoJobForTest(ScenarioJobStatus.COMPLETED, { progressPercent: 100 }),
    ];
    const hosted = videoArtifactForTest({ uri: 'nimi-artifact://video/artifact-video-1', sizeBytes: '1024' });
    const fake = fakeScenarioJobClient({ events, artifacts: [hosted] });
    const onJobUpdate = vi.fn();
    const input = videoInputForTest(fake.client, {
      options: { durationSec: 4, ratio: '16:9' },
      onJobUpdate,
    });

    const result = await runRuntimeVideoGenerate(input);

    expect(Object.keys(input)).not.toEqual(expect.arrayContaining([
      'config',
      'binding',
      'model',
      'route',
      'targetRef',
    ]));
    expect(fake.submitScenarioJob).toHaveBeenCalledTimes(1);
    const [request] = fake.submitScenarioJob.mock.calls[0]!;
    expect(request.scenarioType).toBe(ScenarioType.VIDEO_GENERATE);
    expect(request.executionMode).toBe(ExecutionMode.ASYNC_JOB);
    expect(request.head).toMatchObject({ appId: 'app.test', subjectUserId: 'user.test' });
    expect(request.labels).toEqual({ scenarioId: 'video-1', surfaceId: 'test' });
    expect(request.requestId).toContain('app.test:video.generate:video-1:');
    expect(request.idempotencyKey).toBe(request.requestId);
    const spec = request.spec?.spec;
    if (spec?.oneofKind !== 'videoGenerate') throw new Error('expected videoGenerate spec');
    expect(spec.videoGenerate.mode).toBe(1); // VideoMode.T2V
    expect(spec.videoGenerate.prompt).toBe('waves at dusk');
    const options = spec.videoGenerate.options;
    if (!options) throw new Error('expected video options');
    expect(options.durationSec).toBe(4);
    expect(options.ratio).toBe('16:9');
    // Absent generateAudio receives the first-party default; H3 requires audio.
    expect(options.generateAudio).toBe(true);
    expect(onJobUpdate).toHaveBeenCalled();

    if (!result.ok) throw new Error(`expected success, got ${result.reason}: ${result.message}`);
    expect(result.capabilityId).toBe('video.generate');
    expect(result.output).toMatchObject({
      kind: 'video-artifacts',
      jobId: 'job-video-1',
      jobStatus: 'COMPLETED',
      artifactCount: 1,
    });
    expect(result.output.firstArtifact).toEqual({
      artifactId: 'artifact-video-1',
      mimeType: 'video/mp4',
      uri: 'nimi-artifact://video/artifact-video-1',
      previewUrl: 'nimi-artifact://video/artifact-video-1',
      previewSource: 'hosted-uri',
      sizeBytes: 1024,
      width: 512,
      height: 288,
    });
    expect(result.trace).toEqual({
      traceId: 'trace-video-1',
      modelResolved: 'minimax-h3-local',
      routeDecision: 'LOCAL',
    });
  });

  it('projects inline bytes as a data-url preview and artifactId-only as metadata-only', async () => {
    const inline = videoArtifactForTest({ artifactId: '', bytes: new Uint8Array([1, 2, 3, 4]) });
    const metadataOnly = videoArtifactForTest({ uri: '', width: 0, height: 0 });
    const fake = fakeScenarioJobClient({
      events: [videoJobForTest(ScenarioJobStatus.COMPLETED)],
      artifacts: [inline, metadataOnly],
    });

    const result = await runRuntimeVideoGenerate(videoInputForTest(fake.client));

    if (!result.ok) throw new Error('expected success');
    expect(result.output.artifacts).toHaveLength(2);
    const [first, second] = result.output.artifacts;
    expect(first?.previewSource).toBe('inline-bytes');
    expect(first?.previewUrl).toBe(`data:video/mp4;base64,${btoa(String.fromCharCode(1, 2, 3, 4))}`);
    expect(first?.sizeBytes).toBe(4);
    expect(second).toMatchObject({
      artifactId: 'artifact-video-1',
      previewSource: 'metadata-only',
    });
    expect(second?.previewUrl).toBeUndefined();
  });

  it('preserves an explicit generateAudio false instead of overriding it', async () => {
    const fake = fakeScenarioJobClient({ events: [videoJobForTest(ScenarioJobStatus.COMPLETED)] });

    const result = await runRuntimeVideoGenerate(videoInputForTest(fake.client, {
      options: { generateAudio: false },
    }));

    if (!result.ok) throw new Error('expected success');
    const [request] = fake.submitScenarioJob.mock.calls[0]!;
    const spec = request.spec?.spec;
    if (spec?.oneofKind !== 'videoGenerate') throw new Error('expected videoGenerate spec');
    expect(spec.videoGenerate.options?.generateAudio).toBe(false);
  });

  it('maps typed principal failures to principal-unauthorized', async () => {
    const fake = fakeScenarioJobClient({
      submitError: createNimiError({
        message: 'principal rejected',
        code: ReasonCode.PRINCIPAL_UNAUTHORIZED,
        reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
        actionHint: 'reauthenticate',
        source: 'runtime',
      }),
    });

    const result = await runRuntimeVideoGenerate(videoInputForTest(fake.client));

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'video.generate',
      reason: 'principal-unauthorized',
    });
    if (result.ok) throw new Error('expected non-success result');
    expect(isNimiError(result.error)).toBe(true);
    expect(result.error.reasonCode).toBe(ReasonCode.PRINCIPAL_UNAUTHORIZED);
  });

  it('maps missing t2v prompt to input-invalid before any submit', async () => {
    const fake = fakeScenarioJobClient({});

    const result = await runRuntimeVideoGenerate(videoInputForTest(fake.client, { prompt: '  ' }));

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'video.generate',
      reason: 'input-invalid',
    });
    if (result.ok) throw new Error('expected non-success result');
    expect(isNimiError(result.error)).toBe(true);
    expect(fake.submitScenarioJob).not.toHaveBeenCalled();
  });

  it('maps a failed terminal job to runtime-call-failed with the runtime detail', async () => {
    const fake = fakeScenarioJobClient({
      events: [videoJobForTest(ScenarioJobStatus.FAILED, { reasonDetail: 'engine incompatible' })],
    });

    const result = await runRuntimeVideoGenerate(videoInputForTest(fake.client));

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'video.generate',
      reason: 'runtime-call-failed',
    });
    if (result.ok) throw new Error('expected non-success result');
    expect(result.message).toContain('engine incompatible');
  });

  it('preserves a canceled terminal job as runtime-canceled', async () => {
    const fake = fakeScenarioJobClient({
      events: [videoJobForTest(ScenarioJobStatus.CANCELED, {
        reasonCode: 1,
        reasonDetail: 'acceptance cancellation',
      })],
    });

    const result = await runRuntimeVideoGenerate(videoInputForTest(fake.client));

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'video.generate',
      reason: 'runtime-canceled',
      message: 'acceptance cancellation',
    });
  });

  it('aborts through the signal, cancels the runtime job, and fails closed', async () => {
    const fake = fakeScenarioJobClient({ neverEndingEvents: true });
    const controller = new AbortController();
    const pending = runRuntimeVideoGenerate(videoInputForTest(fake.client, {
      signal: controller.signal,
      abortReason: 'tester abort',
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    const result = await pending;

    expect(result).toMatchObject({
      ok: false,
      capabilityId: 'video.generate',
      reason: 'runtime-canceled',
    });
    if (result.ok) throw new Error('expected non-success result');
    expect(result.message).toContain('canceled by the caller');
    expect(fake.cancelScenarioJob).toHaveBeenCalledTimes(1);
    expect(fake.cancelScenarioJob.mock.calls[0]?.[0]).toMatchObject({
      jobId: 'job-video-1',
      reason: 'tester abort',
    });
  });
});
