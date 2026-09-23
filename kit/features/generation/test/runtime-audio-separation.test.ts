import { describe, expect, it, vi } from 'vitest';
import { AudioInstrumentPartKind, ExecutionMode, ScenarioType, ScenarioJobStatus, ReasonCode, createNimiError,
  type ScenarioJob, type NimiProtectedLocalScenarioJobClient } from '@nimiplatform/kit/core/sdk-contract';
import { runRuntimeAudioSeparation, observeRuntimeAudioSeparation } from '../src/runtime-audio-separation.js';

function setup() {
  const separation = { vocalsArtifactId: 'vocals-1', backgroundArtifactId: 'background-1',
    instrumentParts: [{ part: AudioInstrumentPartKind.DRUMS, artifactId: 'drums-1' }] };
  const job = { jobId: 'separate-job-1', scenarioType: ScenarioType.AUDIO_SEPARATE, executionMode: ExecutionMode.ASYNC_JOB,
    status: ScenarioJobStatus.COMPLETED, audioSeparation: separation, traceId: 'trace-1' } as ScenarioJob;
  const shared = { mimeType: 'audio/wav', bytes: new Uint8Array(), uri: '',
    durationMs: '10034', frameCount: '240828', fps: 0, width: 0, height: 0, sampleRateHz: 24000, channels: 1 };
  const artifacts = [
    { artifactId: 'vocals-1', sizeBytes: '963400', sha256: 'a'.repeat(64), ...shared },
    { artifactId: 'background-1', sizeBytes: '865200', sha256: 'b'.repeat(64), ...shared },
    { artifactId: 'drums-1', sizeBytes: '240000', sha256: 'c'.repeat(64), ...shared },
  ];
  const submitScenarioJob = vi.fn<NimiProtectedLocalScenarioJobClient['submitScenarioJob']>(async () => ({ job }));
  const client: NimiProtectedLocalScenarioJobClient = { terminalVoiceAssetProjection: 'protected-local', submitScenarioJob,
    getScenarioJob: vi.fn(async () => ({ job })), cancelScenarioJob: vi.fn(async () => ({})),
    subscribeScenarioJobEvents: vi.fn(() => ({ async *[Symbol.asyncIterator]() {} })),
    getScenarioArtifacts: vi.fn(async () => ({ jobId: job.jobId, artifacts, traceId: 'trace-1' })),
  };
  return { client, submitScenarioJob, separation, artifacts };
}

describe('protected audio separation runner', () => {
  it('submits one owned source and reports typed vocals, background and stems', async () => {
    const { client, submitScenarioJob } = setup();
    const result = await runRuntimeAudioSeparation({ runtime: { ai: client }, appId: 'test.app', scenarioId: 'test', surfaceId: 'test',
      mimeType: 'audio/wav', sourceAudio: { artifactId: 'source-1', range: { startFrame: 0, endFrame: 480000 } }, includeInstrumentParts: true });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.output.kind).toBe('audio-separation');
    expect(result.output.artifactCount).toBe(3);
    expect(result.output.separation).toMatchObject({ vocalsArtifactId: 'vocals-1', backgroundArtifactId: 'background-1',
      instrumentParts: [{ kind: 'DRUMS', artifactId: 'drums-1' }] });
    expect(submitScenarioJob.mock.calls[0]?.[0]).toMatchObject({ scenarioType: ScenarioType.AUDIO_SEPARATE, executionMode: ExecutionMode.ASYNC_JOB,
      spec: { spec: { oneofKind: 'audioSeparate', audioSeparate: { mimeType: 'audio/wav', includeInstrumentParts: true,
        sourceAudio: { artifactId: 'source-1', range: { startFrame: '0', endFrame: '480000' } } } } } });
  });
  it('recovers only the original job and fails closed when a stem artifact is missing', async () => {
    const { client, submitScenarioJob, artifacts } = setup();
    const saved = await observeRuntimeAudioSeparation({ runtime: { ai: client }, jobId: 'separate-job-1' });
    expect(saved.ok).toBe(true); expect(submitScenarioJob).not.toHaveBeenCalled();
    artifacts.pop();
    const broken = await observeRuntimeAudioSeparation({ runtime: { ai: client }, jobId: 'separate-job-1' });
    expect(broken.ok).toBe(false); expect(submitScenarioJob).not.toHaveBeenCalled();
  });
  it('fails closed with input-invalid when both sources are set', async () => {
    const { client, submitScenarioJob } = setup();
    const result = await runRuntimeAudioSeparation({ runtime: { ai: client }, appId: 'test.app', scenarioId: 'test', surfaceId: 'test',
      mimeType: 'audio/wav', audioSource: { type: 'bytes', bytes: [1, 2] }, sourceAudio: { artifactId: 'source-1' } });
    expect(result).toMatchObject({ ok: false, capabilityId: 'audio.separate', reason: 'input-invalid' });
    expect(submitScenarioJob).not.toHaveBeenCalled();
  });
  it('maps a typed Runtime denial to its non-success reason', async () => {
    const { client, submitScenarioJob } = setup();
    const failure = createNimiError({ message: 'separation denied', reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED, actionHint: 'retry', source: 'runtime' });
    submitScenarioJob.mockImplementationOnce(async () => { throw failure; });
    const result = await runRuntimeAudioSeparation({ runtime: { ai: client }, appId: 'test.app', scenarioId: 'test', surfaceId: 'test',
      mimeType: 'audio/wav', sourceAudio: { artifactId: 'source-1' } });
    expect(result).toMatchObject({ ok: false, capabilityId: 'audio.separate', reason: 'principal-unauthorized' });
    if (result.ok) throw new Error('expected non-success result');
    expect(result.error).toBe(failure);
  });
});
