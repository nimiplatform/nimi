import { describe, expect, it, vi } from 'vitest';
import {
  ExecutionMode,
  ReasonCode,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
  createNimiError,
  type NimiRuntimeScenarioArtifact,
  type NimiRuntimeScenarioJobClient,
  type ScenarioJob,
} from '@nimiplatform/kit/core/sdk-contract';
import { runRuntimeSpeechTranscribe, type RuntimeSpeechTranscribeInput } from '../src/runtime-speech-transcribe.js';

function transcriptionJob(status: ScenarioJobStatus): ScenarioJob {
  return {
    jobId: 'job-transcribe-1', scenarioType: ScenarioType.SPEECH_TRANSCRIBE,
    executionMode: ExecutionMode.ASYNC_JOB, routeDecision: 2, modelResolved: 'stt-runtime', status,
    providerJobId: '', reasonCode: 0, reasonDetail: '', retryCount: 0, artifacts: [], traceId: 'trace-stt-1',
    ignoredExtensions: [], progressPercent: 0, progressCurrentStep: 0, progressTotalSteps: 0,
    transcriptionText: '',
  };
}

const transcriptArtifact: NimiRuntimeScenarioArtifact = {
  artifactId: 'artifact-transcript-1', mimeType: 'text/plain', bytes: new Uint8Array(), uri: '', sha256: '',
  sizeBytes: '12', durationMs: '0', fps: 0, width: 0, height: 0, sampleRateHz: 0, channels: 0,
};

function fakeClient(config: { submitError?: unknown; neverEndingEvents?: boolean } = {}) {
  const submitScenarioJob = vi.fn<NimiRuntimeScenarioJobClient['submitScenarioJob']>(async () => {
    if (config.submitError) throw config.submitError;
    return { job: transcriptionJob(ScenarioJobStatus.RUNNING) };
  });
  const getScenarioJob = vi.fn<NimiRuntimeScenarioJobClient['getScenarioJob']>(async () => ({ job: transcriptionJob(ScenarioJobStatus.COMPLETED) }));
  const cancelScenarioJob = vi.fn<NimiRuntimeScenarioJobClient['cancelScenarioJob']>(async () => ({}));
  const subscribeScenarioJobEvents = vi.fn<NimiRuntimeScenarioJobClient['subscribeScenarioJobEvents']>(() => ({
    [Symbol.asyncIterator]() {
      let emitted = false;
      return { async next() {
        if (config.neverEndingEvents) return new Promise<never>(() => {});
        if (emitted) return { done: true as const, value: undefined };
        emitted = true;
        return { done: false as const, value: {
          eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED, sequence: '1', traceId: '',
          job: transcriptionJob(ScenarioJobStatus.COMPLETED),
        } };
      } };
    },
  }));
  const getScenarioArtifacts = vi.fn<NimiRuntimeScenarioJobClient['getScenarioArtifacts']>(async () => ({
    jobId: 'job-transcribe-1', artifacts: [transcriptArtifact], traceId: 'trace-stt-1',
    output: { output: { oneofKind: 'speechTranscribe' as const, speechTranscribe: {
      text: 'hello transcript', segments: [], language: 'en', artifacts: [transcriptArtifact],
    } } },
  }));
  return {
    client: { submitScenarioJob, getScenarioJob, cancelScenarioJob, subscribeScenarioJobEvents, getScenarioArtifacts },
    submitScenarioJob, cancelScenarioJob,
  };
}

function input(client: NimiRuntimeScenarioJobClient, overrides: Partial<RuntimeSpeechTranscribeInput> = {}): RuntimeSpeechTranscribeInput {
  return {
    runtime: { ai: client }, appId: 'app.test',
    audio: { type: 'bytes', bytes: new Uint8Array([1, 2, 3]), mimeType: 'audio/wav' },
    scenarioId: 'transcribe-1', subjectUserId: 'user.test', surfaceId: 'test', ...overrides,
  };
}

describe('runRuntimeSpeechTranscribe', () => {
  it('submits owner-driven transcription and projects transcript text', async () => {
    const fake = fakeClient();
    const onJobUpdate = vi.fn();
    const request = input(fake.client, { language: 'en', timestamps: true, onJobUpdate });

    const result = await runRuntimeSpeechTranscribe(request);

    expect(Object.keys(request)).not.toEqual(expect.arrayContaining(['config', 'binding', 'model', 'route', 'targetRef']));
    const [runtimeRequest] = fake.submitScenarioJob.mock.calls[0]!;
    expect(runtimeRequest).toMatchObject({ scenarioType: ScenarioType.SPEECH_TRANSCRIBE, executionMode: ExecutionMode.ASYNC_JOB });
    const spec = runtimeRequest.spec?.spec;
    if (spec?.oneofKind !== 'speechTranscribe') throw new Error('expected speechTranscribe spec');
    expect(spec.speechTranscribe.mimeType).toBe('audio/wav');
    expect(spec.speechTranscribe.audioSource?.source).toEqual({ oneofKind: 'audioBytes', audioBytes: new Uint8Array([1, 2, 3]) });
    expect(onJobUpdate).toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true, capabilityId: 'audio.transcribe', message: 'hello transcript',
      output: { kind: 'transcript', text: 'hello transcript', jobId: 'job-transcribe-1', jobStatus: 'COMPLETED', artifactCount: 1 },
      trace: { traceId: 'trace-stt-1', modelResolved: 'stt-runtime', routeDecision: 'CLOUD' },
    });
  });

  it('passes URL audio to Runtime without fetching it in Kit', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const fake = fakeClient();
    const result = await runRuntimeSpeechTranscribe(input(fake.client, {
      audio: undefined, audioUrl: 'https://cdn.example.test/audio.wav', mimeType: 'audio/wav',
    }));
    expect(result.ok).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it('maps typed principal and invalid-input failures', async () => {
    const principal = fakeClient({ submitError: createNimiError({
      message: 'denied', reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED, actionHint: 'reauthenticate', source: 'runtime',
    }) });
    expect(await runRuntimeSpeechTranscribe(input(principal.client))).toMatchObject({ ok: false, reason: 'principal-unauthorized' });

    const invalid = fakeClient();
    expect(await runRuntimeSpeechTranscribe(input(invalid.client, { audio: undefined, audioUrl: undefined }))).toMatchObject({
      ok: false, reason: 'input-invalid',
    });
    expect(invalid.submitScenarioJob).not.toHaveBeenCalled();
  });

  it('aborts and cancels the runtime job', async () => {
    const fake = fakeClient({ neverEndingEvents: true });
    const controller = new AbortController();
    const pending = runRuntimeSpeechTranscribe(input(fake.client, {
      signal: controller.signal, abortReason: 'stop transcription',
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, reason: 'operation-aborted' });
    expect(fake.cancelScenarioJob).toHaveBeenCalledTimes(1);
    expect(fake.cancelScenarioJob.mock.calls[0]?.[0]).toMatchObject({ jobId: 'job-transcribe-1', reason: 'stop transcription' });
  });
});
