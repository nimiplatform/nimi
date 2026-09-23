import { describe, expect, it, vi } from 'vitest';
import { ExecutionMode, ScenarioType, ScenarioJobStatus, type ScenarioJob, type NimiProtectedLocalScenarioJobClient } from '@nimiplatform/kit/core/sdk-contract';
import { runRuntimeVoiceConvert, observeRuntimeVoiceConversion } from '../src/runtime-voice-convert.js';

function setup() {
  const conversion = { vocalArtifactId: 'vocal-1', sourceArtifactId: 'source-1',
    sourceInfo: { sampleRateHz: 48000, channels: 2, frameCount: '480000', durationMs: '10000' },
    inputRange: { startFrame: '0', endFrame: '480000' },
    vocalInfo: { sampleRateHz: 24000, channels: 1, frameCount: '240828', durationMs: '10034' },
    lengthRelation: 2, durationDeltaMs: '34' };
  const job = { jobId: 'convert-job-1', scenarioType: ScenarioType.AUDIO_VOICE_CONVERT, executionMode: ExecutionMode.ASYNC_JOB,
    status: ScenarioJobStatus.COMPLETED, voiceConversion: conversion, traceId: 'trace-1' } as ScenarioJob;
  const artifact = { artifactId: 'vocal-1', mimeType: 'audio/wav', sizeBytes: '963400', sha256: 'a'.repeat(64), bytes: new Uint8Array(), uri: '',
    durationMs: '10034', frameCount: '240828', fps: 0, width: 0, height: 0, sampleRateHz: 24000, channels: 1 };
  const artifacts = [artifact];
  const submitScenarioJob = vi.fn<NimiProtectedLocalScenarioJobClient['submitScenarioJob']>(async () => ({ job }));
  const client: NimiProtectedLocalScenarioJobClient = { terminalVoiceAssetProjection: 'protected-local', submitScenarioJob,
    getScenarioJob: vi.fn(async () => ({ job })), cancelScenarioJob: vi.fn(async () => ({})),
    subscribeScenarioJobEvents: vi.fn(() => ({ async *[Symbol.asyncIterator]() {} })),
    getScenarioArtifacts: vi.fn(async () => ({ jobId: job.jobId, artifacts, traceId: 'trace-1' })),
  };
  return { client, submitScenarioJob, conversion, artifacts };
}

describe('protected voice conversion runner', () => {
  it('keeps the three inputs independent and reports the measured tail delta', async () => {
    const { client, submitScenarioJob } = setup();
    const result = await runRuntimeVoiceConvert({ runtime: { ai: client }, appId: 'test.app', scenarioId: 'test', surfaceId: 'test',
      sourceVocal: { artifactId: 'source-1' }, sourceKind: 'singing', targetVoice: { kind: 'reference-audio', artifactId: 'target-1' }, semitoneShift: 3 });
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.output.artifacts).toHaveLength(1);
    expect(result.output.conversion).toMatchObject({ vocalArtifactId: 'vocal-1', sourceArtifactId: 'source-1', lengthRelation: 'MODEL_FRAME_ROUNDING', durationDeltaMs: 34 });
    expect(submitScenarioJob.mock.calls[0]?.[0]).toMatchObject({ scenarioType: ScenarioType.AUDIO_VOICE_CONVERT, executionMode: ExecutionMode.ASYNC_JOB,
      spec: { spec: { oneofKind: 'audioVoiceConvert', audioVoiceConvert: { sourceKind: 1, semitoneShift: 3,
        sourceVocal: { artifactId: 'source-1' },
        targetVoice: { target: { oneofKind: 'referenceAudio', referenceAudio: { artifactId: 'target-1' } } } } } } });
  });
  it('recovers only the original job and fails closed when the converted vocal is missing', async () => {
    const { client, submitScenarioJob, artifacts } = setup();
    const saved = await observeRuntimeVoiceConversion({ runtime: { ai: client }, jobId: 'convert-job-1' });
    expect(saved.ok).toBe(true); expect(submitScenarioJob).not.toHaveBeenCalled();
    artifacts.pop();
    const broken = await observeRuntimeVoiceConversion({ runtime: { ai: client }, jobId: 'convert-job-1' });
    expect(broken.ok).toBe(false); expect(submitScenarioJob).not.toHaveBeenCalled();
  });
});
