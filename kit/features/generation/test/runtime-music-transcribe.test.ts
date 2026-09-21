import { describe, expect, it, vi } from 'vitest';
import { ExecutionMode, ScenarioType, ScenarioJobStatus, type ScenarioJob, type NimiProtectedLocalScenarioJobClient } from '@nimiplatform/kit/core/sdk-contract';
import { runRuntimeMusicTranscribe, observeRuntimeMusicTranscription } from '../src/runtime-music-transcribe.js';

function setup() {
  const transcription = { sourceArtifactId: 'source-1', sourceInfo: { sampleRateHz: 48000, channels: 2, frameCount: '960000', durationMs: '20000' },
    inputRange: { startFrame: '48000', endFrame: '480000' }, origin: 2, completeness: 1,
    scores: [{ artifactId: 'score-1', format: 1, part: 2 }], timelineArtifactId: 'events-1' };
  const job = { jobId: 'transcription-job-1', scenarioType: ScenarioType.MUSIC_TRANSCRIBE, executionMode: ExecutionMode.ASYNC_JOB,
    status: ScenarioJobStatus.COMPLETED, musicTranscription: transcription, traceId: 'trace-1' } as ScenarioJob;
  const artifact = { artifactId: 'score-1', mimeType: 'text/vnd.abc', sizeBytes: '512', sha256: 'a'.repeat(64), bytes: new Uint8Array(), uri: '',
    durationMs: '0', frameCount: '0', fps: 0, width: 0, height: 0, sampleRateHz: 0, channels: 0 };
  const artifacts = [artifact, { ...artifact, artifactId: 'events-1', mimeType: 'application/vnd.nimi.music-timeline+json' }];
  const submitScenarioJob = vi.fn<NimiProtectedLocalScenarioJobClient['submitScenarioJob']>(async () => ({ job }));
  const client: NimiProtectedLocalScenarioJobClient = { terminalVoiceAssetProjection: 'protected-local', submitScenarioJob,
    getScenarioJob: vi.fn(async () => ({ job })), cancelScenarioJob: vi.fn(async () => ({})),
    subscribeScenarioJobEvents: vi.fn(() => ({ async *[Symbol.asyncIterator]() {} })),
    getScenarioArtifacts: vi.fn(async () => ({ jobId: job.jobId, artifacts, traceId: 'trace-1' })),
  };
  return { client, submitScenarioJob, transcription, artifacts };
}

describe('protected music transcription runner', () => {
  it('preserves the whole score/timeline set and absolute source frame basis', async () => {
    const { client, submitScenarioJob } = setup();
    const result = await runRuntimeMusicTranscribe({ runtime: { ai: client }, appId: 'test.app', scenarioId: 'test', surfaceId: 'test',
      sourceAudio: { artifactId: 'source-1', range: { startFrame: 48000, endFrame: 480000 } }, requestedFormats: ['abc', 'timeline'], requestedParts: ['lead-sheet'] });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.output.artifacts).toHaveLength(2);
    expect(result.output.transcription).toMatchObject({ origin: 'transcribed-estimate', completeness: 'unknown', inputRange: { startFrame: 48000, endFrame: 480000 }, timelineArtifactId: 'events-1' });
    expect(submitScenarioJob.mock.calls[0]?.[0]).toMatchObject({ scenarioType: ScenarioType.MUSIC_TRANSCRIBE, executionMode: ExecutionMode.ASYNC_JOB,
      spec: { spec: { oneofKind: 'musicTranscribe', musicTranscribe: { requestedFormats: [1, 3], requestedParts: [2], sourceAudio: { artifactId: 'source-1', range: { startFrame: '48000', endFrame: '480000' } } } } } });
  });
  it('recovers only the original job and fails closed when an output is missing', async () => {
    const { client, submitScenarioJob, artifacts } = setup();
    const saved = await observeRuntimeMusicTranscription({ runtime: { ai: client }, jobId: 'transcription-job-1' });
    expect(saved.ok).toBe(true); expect(submitScenarioJob).not.toHaveBeenCalled();
    artifacts.pop();
    const broken = await observeRuntimeMusicTranscription({ runtime: { ai: client }, jobId: 'transcription-job-1' });
    expect(broken.ok).toBe(false); expect(submitScenarioJob).not.toHaveBeenCalled();
  });
});
