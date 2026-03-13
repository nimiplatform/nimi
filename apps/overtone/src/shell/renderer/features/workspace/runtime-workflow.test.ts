import { describe, it, expect, vi } from 'vitest';
import { ScenarioJobStatus } from '@nimiplatform/sdk/runtime';
import type { TextStreamPart } from '@nimiplatform/sdk/runtime/types-media.js';
import type { Runtime } from '@nimiplatform/sdk/runtime';
import type { ScenarioJob, ScenarioArtifact } from '@nimiplatform/sdk/runtime/generated/runtime/v1/ai.js';
import {
  scenarioJobStatusToGenerationStatus,
  scenarioJobStatusLabel,
  copyArtifactBytesToArrayBuffer,
  collectTextStream,
  submitMusicJobAndWait,
} from './runtime-workflow.js';

describe('scenarioJobStatusToGenerationStatus', () => {
  it('maps SUBMITTED to pending', () => {
    expect(scenarioJobStatusToGenerationStatus(ScenarioJobStatus.SUBMITTED)).toBe('pending');
  });

  it('maps QUEUED to pending', () => {
    expect(scenarioJobStatusToGenerationStatus(ScenarioJobStatus.QUEUED)).toBe('pending');
  });

  it('maps RUNNING to running', () => {
    expect(scenarioJobStatusToGenerationStatus(ScenarioJobStatus.RUNNING)).toBe('running');
  });

  it('maps COMPLETED to completed', () => {
    expect(scenarioJobStatusToGenerationStatus(ScenarioJobStatus.COMPLETED)).toBe('completed');
  });

  it('maps TIMEOUT to timeout', () => {
    expect(scenarioJobStatusToGenerationStatus(ScenarioJobStatus.TIMEOUT)).toBe('timeout');
  });

  it('maps CANCELED to canceled', () => {
    expect(scenarioJobStatusToGenerationStatus(ScenarioJobStatus.CANCELED)).toBe('canceled');
  });

  it('maps FAILED to failed', () => {
    expect(scenarioJobStatusToGenerationStatus(ScenarioJobStatus.FAILED)).toBe('failed');
  });

  it('maps unknown status to failed', () => {
    expect(scenarioJobStatusToGenerationStatus(999 as ScenarioJobStatus)).toBe('failed');
  });
});

describe('scenarioJobStatusLabel', () => {
  it('returns readable label for SUBMITTED', () => {
    expect(scenarioJobStatusLabel(ScenarioJobStatus.SUBMITTED)).toBe('Submitted to runtime');
  });

  it('returns readable label for RUNNING', () => {
    expect(scenarioJobStatusLabel(ScenarioJobStatus.RUNNING)).toBe('Generating audio');
  });

  it('returns readable label for COMPLETED', () => {
    expect(scenarioJobStatusLabel(ScenarioJobStatus.COMPLETED)).toBe('Completed');
  });

  it('returns Failed for unknown status', () => {
    expect(scenarioJobStatusLabel(999 as ScenarioJobStatus)).toBe('Failed');
  });
});

describe('copyArtifactBytesToArrayBuffer', () => {
  it('returns null for undefined bytes', () => {
    expect(copyArtifactBytesToArrayBuffer(undefined)).toBeNull();
  });

  it('returns null for empty Uint8Array', () => {
    expect(copyArtifactBytesToArrayBuffer(new Uint8Array(0))).toBeNull();
  });

  it('copies valid bytes into a new ArrayBuffer', () => {
    const source = new Uint8Array([1, 2, 3, 4, 5]);
    const result = copyArtifactBytesToArrayBuffer(source);
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(result!.byteLength).toBe(5);
    const view = new Uint8Array(result!);
    expect(Array.from(view)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns an independent copy', () => {
    const source = new Uint8Array([10, 20, 30]);
    const result = copyArtifactBytesToArrayBuffer(source);
    const view = new Uint8Array(result!);
    view[0] = 99;
    expect(source[0]).toBe(10);
  });
});

describe('collectTextStream', () => {
  it('accumulates delta parts into a string', async () => {
    const parts: TextStreamPart[] = [
      { type: 'start' },
      { type: 'delta', text: 'Hello' },
      { type: 'delta', text: ' world' },
      { type: 'finish', finishReason: 'stop', usage: { inputTokens: 0, outputTokens: 0 }, trace: { traceId: '' } },
    ];
    const stream = (async function* () { for (const p of parts) yield p; })();
    const result = await collectTextStream({ stream });
    expect(result).toBe('Hello world');
  });

  it('throws on error part', async () => {
    const error = new Error('stream error');
    const parts: TextStreamPart[] = [
      { type: 'delta', text: 'partial' },
      { type: 'error', error: error as never },
    ];
    const stream = (async function* () { for (const p of parts) yield p; })();
    await expect(collectTextStream({ stream })).rejects.toThrow('stream error');
  });

  it('returns empty string for empty stream', async () => {
    const parts: TextStreamPart[] = [
      { type: 'start' },
      { type: 'finish', finishReason: 'stop', usage: { inputTokens: 0, outputTokens: 0 }, trace: { traceId: '' } },
    ];
    const stream = (async function* () { for (const p of parts) yield p; })();
    const result = await collectTextStream({ stream });
    expect(result).toBe('');
  });
});

function makeJob(status: ScenarioJobStatus, jobId = 'job-1'): ScenarioJob {
  return { jobId, status } as ScenarioJob;
}

function makeMockRuntime(options: {
  submitJob?: ScenarioJob;
  subscribeEvents?: Array<{ job?: ScenarioJob }>;
  getJob?: ScenarioJob;
  artifacts?: ScenarioArtifact[];
}) {
  return {
    media: {
      jobs: {
        submit: vi.fn().mockResolvedValue(options.submitJob ?? makeJob(ScenarioJobStatus.SUBMITTED)),
        subscribe: vi.fn().mockResolvedValue(
          (async function* () {
            for (const event of options.subscribeEvents ?? []) yield event;
          })(),
        ),
        get: vi.fn().mockResolvedValue(options.getJob ?? makeJob(ScenarioJobStatus.COMPLETED)),
        getArtifacts: vi.fn().mockResolvedValue({ artifacts: options.artifacts ?? [] }),
      },
    },
  } as unknown as Runtime;
}

describe('submitMusicJobAndWait', () => {
  const input = { model: 'music-model', prompt: 'test' } as Parameters<typeof submitMusicJobAndWait>[1];

  it('happy path: submit → subscribe → completed → artifacts', async () => {
    const completedJob = makeJob(ScenarioJobStatus.COMPLETED);
    const artifact = { artifactId: 'a-1' } as ScenarioArtifact;
    const runtime = makeMockRuntime({
      subscribeEvents: [
        { job: makeJob(ScenarioJobStatus.RUNNING) },
        { job: completedJob },
      ],
      artifacts: [artifact],
    });
    const onUpdate = vi.fn();

    const result = await submitMusicJobAndWait(runtime, input, onUpdate);

    expect(runtime.media.jobs.submit).toHaveBeenCalledOnce();
    expect(runtime.media.jobs.subscribe).toHaveBeenCalledWith('job-1');
    expect(runtime.media.jobs.getArtifacts).toHaveBeenCalledWith('job-1');
    expect(result.job.status).toBe(ScenarioJobStatus.COMPLETED);
    expect(result.artifacts).toEqual([artifact]);
    expect(onUpdate).toHaveBeenCalledTimes(3);
  });

  it('calls onUpdate for each event', async () => {
    const runtime = makeMockRuntime({
      subscribeEvents: [
        { job: makeJob(ScenarioJobStatus.RUNNING) },
        { job: makeJob(ScenarioJobStatus.COMPLETED) },
      ],
    });
    const onUpdate = vi.fn();

    await submitMusicJobAndWait(runtime, input, onUpdate);

    expect(onUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: ScenarioJobStatus.SUBMITTED }));
    expect(onUpdate).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: ScenarioJobStatus.RUNNING }));
    expect(onUpdate).toHaveBeenNthCalledWith(3, expect.objectContaining({ status: ScenarioJobStatus.COMPLETED }));
  });

  it('handles FAILED job from subscribe', async () => {
    const failedJob = makeJob(ScenarioJobStatus.FAILED);
    const runtime = makeMockRuntime({
      subscribeEvents: [{ job: failedJob }],
    });
    const onUpdate = vi.fn();

    const result = await submitMusicJobAndWait(runtime, input, onUpdate);

    expect(result.job.status).toBe(ScenarioJobStatus.FAILED);
    expect(runtime.media.jobs.get).not.toHaveBeenCalled();
  });

  it('falls back to polling when subscribe does not reach terminal', async () => {
    const runtime = makeMockRuntime({
      subscribeEvents: [{ job: makeJob(ScenarioJobStatus.RUNNING) }],
      getJob: makeJob(ScenarioJobStatus.COMPLETED),
    });
    const onUpdate = vi.fn();

    const result = await submitMusicJobAndWait(runtime, input, onUpdate);

    expect(runtime.media.jobs.get).toHaveBeenCalledWith('job-1');
    expect(result.job.status).toBe(ScenarioJobStatus.COMPLETED);
  });

  it('skips events without job field', async () => {
    const runtime = makeMockRuntime({
      subscribeEvents: [
        { job: undefined },
        { job: makeJob(ScenarioJobStatus.COMPLETED) },
      ],
    });
    const onUpdate = vi.fn();

    const result = await submitMusicJobAndWait(runtime, input, onUpdate);

    expect(result.job.status).toBe(ScenarioJobStatus.COMPLETED);
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it('propagates submit error', async () => {
    const runtime = makeMockRuntime({});
    (runtime.media.jobs.submit as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('submit failed'));
    const onUpdate = vi.fn();

    await expect(submitMusicJobAndWait(runtime, input, onUpdate)).rejects.toThrow('submit failed');
  });
});
