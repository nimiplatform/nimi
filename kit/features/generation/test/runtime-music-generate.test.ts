import { describe, expect, it, vi } from 'vitest';
import {
  ExecutionMode,
  ScenarioJobEventType,
  ScenarioJobStatus,
  ScenarioType,
  type NimiProtectedLocalScenarioJobClient,
  type ScenarioJob,
} from '@nimiplatform/kit/core/sdk-contract';
import { runRuntimeMusicGenerate } from '../src/runtime-music-generate.js';

function musicJob(status: ScenarioJobStatus): ScenarioJob {
  return { jobId: 'job-music-1', scenarioType: ScenarioType.MUSIC_GENERATE, executionMode: ExecutionMode.ASYNC_JOB, routeDecision: 1, modelResolved: 'MiniMax-Music3', status, providerJobId: '', reasonCode: 0, reasonDetail: '', retryCount: 0, artifacts: [], traceId: 'trace-music-1', ignoredExtensions: [], progressPercent: 0, progressCurrentStep: 0, progressTotalSteps: 0, transcriptionText: '' };
}

function protectedMusicClient() {
  const submitScenarioJob = vi.fn<NimiProtectedLocalScenarioJobClient['submitScenarioJob']>(async () => ({ job: musicJob(ScenarioJobStatus.SUBMITTED) }));
  const getScenarioJob = vi.fn<NimiProtectedLocalScenarioJobClient['getScenarioJob']>(async () => ({ job: musicJob(ScenarioJobStatus.COMPLETED) }));
  const cancelScenarioJob = vi.fn<NimiProtectedLocalScenarioJobClient['cancelScenarioJob']>(async () => ({}));
  const subscribeScenarioJobEvents = vi.fn<NimiProtectedLocalScenarioJobClient['subscribeScenarioJobEvents']>(() => ({ async *[Symbol.asyncIterator]() { yield { eventType: ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED, sequence: '1', traceId: 'trace-music-1', job: musicJob(ScenarioJobStatus.COMPLETED) }; } }));
  const artifact = { artifactId: 'artifact-music-1', mimeType: 'audio/wav', bytes: new Uint8Array(), uri: '', sha256: 'abc', sizeBytes: '3530796', durationMs: '20015', fps: 0, width: 0, height: 0, sampleRateHz: 44100, channels: 2 };
  const getScenarioArtifacts = vi.fn<NimiProtectedLocalScenarioJobClient['getScenarioArtifacts']>(async () => ({ jobId: 'job-music-1', artifacts: [artifact], traceId: 'trace-music-1', output: { output: { oneofKind: 'musicGenerate', musicGenerate: { artifacts: [artifact] } } } }));
  const client: NimiProtectedLocalScenarioJobClient = { terminalVoiceAssetProjection: 'protected-local', submitScenarioJob, getScenarioJob, cancelScenarioJob, subscribeScenarioJobEvents, getScenarioArtifacts };
  return { client, submitScenarioJob };
}

describe('runRuntimeMusicGenerate', () => {
  it('uses the protected async Music carrier and returns a real audio artifact reference', async () => {
    const { client, submitScenarioJob } = protectedMusicClient();
    const result = await runRuntimeMusicGenerate({ runtime: { ai: client }, appId: 'app.test', subjectUserId: 'user.test', prompt: 'bright synth-pop', lyrics: '[Verse]\nCity lights are waking.', scenarioId: 'music-1', surfaceId: 'lab' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.firstArtifact).toMatchObject({ artifactId: 'artifact-music-1', mimeType: 'audio/wav', sampleRateHz: 44100, channels: 2 });
    expect(result.output.jobStatus).toBe('COMPLETED');
    const request = submitScenarioJob.mock.calls[0]?.[0];
    expect(request?.scenarioType).toBe(ScenarioType.MUSIC_GENERATE);
    expect(request?.executionMode).toBe(ExecutionMode.ASYNC_JOB);
    expect(request?.extensions).toEqual([]);
    expect(request?.spec?.spec).toEqual({ oneofKind: 'musicGenerate', musicGenerate: { prompt: 'bright synth-pop', negativePrompt: '', lyrics: '[Verse]\nCity lights are waking.', style: '', title: '', durationSeconds: 0, instrumental: false } });
  });

  it('returns typed input-invalid before contacting Runtime for empty music input', async () => {
    const { client, submitScenarioJob } = protectedMusicClient();
    const result = await runRuntimeMusicGenerate({ runtime: { ai: client }, appId: 'app.test', prompt: '', lyrics: '[Verse]\nLyrics', scenarioId: 'music-invalid', surfaceId: 'lab' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('input-invalid');
    expect(result.error.reasonCode).toBe('SDK_AI_INPUT_INVALID');
    expect(submitScenarioJob).not.toHaveBeenCalled();
  });
});
