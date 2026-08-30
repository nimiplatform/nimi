import { describe, expect, it, vi } from 'vitest';
import {
  ExecutionMode,
  ReasonCode,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
  VoiceReferenceKind,
  createNimiError,
  type NimiRuntimeScenarioArtifact,
  type NimiRuntimeScenarioJobClient,
  type ScenarioJob,
} from '@nimiplatform/kit/core/sdk-contract';
import { runRuntimeSpeechSynthesize, type RuntimeSpeechSynthesizeInput } from '../src/runtime-speech-synthesize.js';

function speechJob(status: ScenarioJobStatus): ScenarioJob {
  return {
    jobId: 'job-speech-1', scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
    executionMode: ExecutionMode.ASYNC_JOB, routeDecision: 2, modelResolved: 'tts-runtime', status,
    providerJobId: '', reasonCode: 0, reasonDetail: '', retryCount: 0, artifacts: [], traceId: 'trace-speech-1',
    ignoredExtensions: [], progressPercent: 0, progressCurrentStep: 0, progressTotalSteps: 0,
    transcriptionText: '',
  };
}

function audioArtifact(overrides: Partial<NimiRuntimeScenarioArtifact> = {}): NimiRuntimeScenarioArtifact {
  return {
    artifactId: 'artifact-audio-1', mimeType: 'audio/mpeg', bytes: new Uint8Array(), uri: '', sha256: '',
    sizeBytes: '0', durationMs: '1000', fps: 0, width: 0, height: 0, sampleRateHz: 24000, channels: 1,
    ...overrides,
  };
}

function fakeClient(config: {
  artifacts?: readonly NimiRuntimeScenarioArtifact[];
  submitError?: unknown;
  neverEndingEvents?: boolean;
  lookupJob?: ScenarioJob;
  cancelJob?: ScenarioJob;
}) {
  const submitScenarioJob = vi.fn<NimiRuntimeScenarioJobClient['submitScenarioJob']>(async () => {
    if (config.submitError) throw config.submitError;
    return { job: speechJob(ScenarioJobStatus.RUNNING) };
  });
  const getScenarioJob = vi.fn<NimiRuntimeScenarioJobClient['getScenarioJob']>(async () => ({
    job: config.lookupJob ?? speechJob(ScenarioJobStatus.COMPLETED),
  }));
  const cancelScenarioJob = vi.fn<NimiRuntimeScenarioJobClient['cancelScenarioJob']>(async () => ({
    ...(config.cancelJob ? { job: config.cancelJob } : {}),
  }));
  const subscribeScenarioJobEvents = vi.fn<NimiRuntimeScenarioJobClient['subscribeScenarioJobEvents']>(() => ({
    [Symbol.asyncIterator]() {
      let emitted = false;
      return { async next() {
        if (config.neverEndingEvents) return new Promise<never>(() => {});
        if (emitted) return { done: true as const, value: undefined };
        emitted = true;
        return { done: false as const, value: {
          eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED, sequence: '1', traceId: '',
          job: speechJob(ScenarioJobStatus.COMPLETED),
        } };
      } };
    },
  }));
  const artifacts = [...(config.artifacts ?? [audioArtifact()])];
  const getScenarioArtifacts = vi.fn<NimiRuntimeScenarioJobClient['getScenarioArtifacts']>(async () => ({
    jobId: 'job-speech-1', artifacts, traceId: 'trace-speech-1',
    output: { output: { oneofKind: 'speechSynthesize' as const, speechSynthesize: { artifacts } } },
  }));
  return {
    client: { submitScenarioJob, getScenarioJob, cancelScenarioJob, subscribeScenarioJobEvents, getScenarioArtifacts },
    submitScenarioJob, cancelScenarioJob,
  };
}

function input(client: NimiRuntimeScenarioJobClient, overrides: Partial<RuntimeSpeechSynthesizeInput> = {}): RuntimeSpeechSynthesizeInput {
  return {
    runtime: { ai: client }, appId: 'app.test', text: 'hello', scenarioId: 'speech-1',
    subjectUserId: 'user.test', surfaceId: 'test', ...overrides,
  };
}

describe('runRuntimeSpeechSynthesize', () => {
  it('submits owner-driven synthesis, converts voice references, and projects hosted audio', async () => {
    const hosted = audioArtifact({ uri: 'https://cdn.example.test/speech.mp3', sizeBytes: '2048' });
    const fake = fakeClient({ artifacts: [hosted] });
    const result = await runRuntimeSpeechSynthesize(input(fake.client, {
      voiceRef: { kind: 'voice_asset_id', voiceAssetId: 'voice-1' },
      language: 'en',
      audioFormat: 'mp3',
      sampleRateHz: 0,
      speed: 0,
      pitch: 0,
      volume: 0,
      timingMode: 'word',
    }));

    const [request] = fake.submitScenarioJob.mock.calls[0]!;
    expect(request).toMatchObject({ scenarioType: ScenarioType.SPEECH_SYNTHESIZE, executionMode: ExecutionMode.ASYNC_JOB });
    const spec = request.spec?.spec;
    if (spec?.oneofKind !== 'speechSynthesize') throw new Error('expected speechSynthesize spec');
    expect(spec.speechSynthesize.voiceRef).toEqual({
      kind: VoiceReferenceKind.VOICE_ASSET,
      reference: { oneofKind: 'voiceAssetId', voiceAssetId: 'voice-1' },
    });
    expect(spec.speechSynthesize).toMatchObject({
      sampleRateHz: 0,
      speed: 0,
      pitch: 0,
      volume: 0,
      timingMode: 2,
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.output.firstArtifact).toEqual({
      artifactId: 'artifact-audio-1', mimeType: 'audio/mpeg', uri: hosted.uri,
      previewUrl: hosted.uri, previewSource: 'hosted-uri', sizeBytes: 2048,
    });
    expect(result.trace).toEqual({ traceId: 'trace-speech-1', modelResolved: 'tts-runtime', routeDecision: 'CLOUD' });
  });

  it('projects inline bytes and metadata-only audio', async () => {
    const inline = audioArtifact({ artifactId: '', bytes: new Uint8Array([4, 5, 6]) });
    const metadata = audioArtifact();
    const result = await runRuntimeSpeechSynthesize(input(fakeClient({ artifacts: [inline, metadata] }).client));
    if (!result.ok) throw new Error(result.message);
    expect(result.output.artifacts[0]).toMatchObject({ previewSource: 'inline-bytes', sizeBytes: 3 });
    expect(result.output.artifacts[0]?.previewUrl).toBe(`data:audio/mpeg;base64,${btoa(String.fromCharCode(4, 5, 6))}`);
    expect(result.output.artifacts[1]).toMatchObject({ previewSource: 'metadata-only' });
    expect(result.output.artifacts[1]?.previewUrl).toBeUndefined();
  });

  it('maps typed principal and invalid-input failures', async () => {
    const principal = fakeClient({ submitError: createNimiError({
      message: 'denied', reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED, actionHint: 'reauthenticate', source: 'runtime',
    }) });
    expect(await runRuntimeSpeechSynthesize(input(principal.client))).toMatchObject({ ok: false, reason: 'principal-unauthorized' });

    const invalid = fakeClient({});
    expect(await runRuntimeSpeechSynthesize(input(invalid.client, { text: ' ' }))).toMatchObject({ ok: false, reason: 'input-invalid' });
    expect(await runRuntimeSpeechSynthesize(input(invalid.client, {
      voiceRef: { kind: 'voice_asset_id', voiceAssetId: ' ' },
    }))).toMatchObject({ ok: false, reason: 'input-invalid' });
    expect(invalid.submitScenarioJob).not.toHaveBeenCalled();
  });

  it('aborts and cancels the runtime job', async () => {
    const fake = fakeClient({
      neverEndingEvents: true,
      lookupJob: speechJob(ScenarioJobStatus.RUNNING),
      cancelJob: speechJob(ScenarioJobStatus.CANCELED),
    });
    const controller = new AbortController();
    const pending = runRuntimeSpeechSynthesize(input(fake.client, { signal: controller.signal, abortReason: 'stop speech' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, reason: 'runtime-canceled' });
    expect(fake.cancelScenarioJob).toHaveBeenCalledTimes(1);
    expect(fake.cancelScenarioJob.mock.calls[0]?.[0]).toMatchObject({ jobId: 'job-speech-1', reason: 'stop speech' });
  });
});
