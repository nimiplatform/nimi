import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScenarioJobStatus, type Runtime } from '@nimiplatform/sdk/runtime';
import {
  copyArtifactBytesToArrayBuffer,
  type RuntimeScenarioArtifact,
  type RuntimeScenarioJob,
  scenarioJobStatusLabel,
  scenarioJobStatusToGenerationStatus,
  submitRuntimeGenerationJobAndWait,
  useRuntimeGenerationPanel,
} from '../src/runtime.js';
import { RuntimeGenerationPanel } from '../src/ui.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await flush();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

function makeJob(status: ScenarioJobStatus, jobId = 'job-1'): RuntimeScenarioJob {
  return { jobId, status } as RuntimeScenarioJob;
}

function makeMockRuntime(options: {
  submitJob?: RuntimeScenarioJob;
  subscribeEvents?: Array<{ job?: RuntimeScenarioJob }>;
  getJob?: RuntimeScenarioJob;
  artifacts?: RuntimeScenarioArtifact[];
}) {
  return {
    media: {
      jobs: {
        submit: vi.fn().mockResolvedValue(options.submitJob ?? makeJob(ScenarioJobStatus.SUBMITTED)),
        subscribe: vi.fn().mockResolvedValue(
          (async function* () {
            for (const event of options.subscribeEvents ?? []) {
              yield event;
            }
          })(),
        ),
        get: vi.fn().mockResolvedValue(options.getJob ?? makeJob(ScenarioJobStatus.COMPLETED)),
        getArtifacts: vi.fn().mockResolvedValue({ artifacts: options.artifacts ?? [] }),
      },
    },
  } as unknown as Runtime;
}

function RuntimeHarness({ runtime }: { runtime: Runtime }) {
  const runtimeState = useRuntimeGenerationPanel({
    runtime,
    input: { prompt: 'test prompt' },
    resolveRequest: () => ({
      modal: 'music',
      input: {
        model: 'music-model',
        prompt: 'test prompt',
      },
    }),
  });

  return (
    <RuntimeGenerationPanel
      runtimeState={runtimeState}
      title="Runtime Generation"
      submitLabel="Run"
    />
  );
}

describe('generation runtime helpers', () => {
  it('maps runtime statuses to generation statuses', () => {
    expect(scenarioJobStatusToGenerationStatus(ScenarioJobStatus.SUBMITTED)).toBe('pending');
    expect(scenarioJobStatusToGenerationStatus(ScenarioJobStatus.RUNNING)).toBe('running');
    expect(scenarioJobStatusToGenerationStatus(ScenarioJobStatus.COMPLETED)).toBe('completed');
    expect(scenarioJobStatusToGenerationStatus(ScenarioJobStatus.TIMEOUT)).toBe('timeout');
    expect(scenarioJobStatusToGenerationStatus(ScenarioJobStatus.CANCELED)).toBe('canceled');
    expect(scenarioJobStatusToGenerationStatus(999 as ScenarioJobStatus)).toBe('failed');
  });

  it('returns readable runtime labels', () => {
    expect(scenarioJobStatusLabel(ScenarioJobStatus.SUBMITTED)).toBe('Submitted to runtime');
    expect(scenarioJobStatusLabel(ScenarioJobStatus.RUNNING)).toBe('Generating output');
    expect(scenarioJobStatusLabel(999 as ScenarioJobStatus)).toBe('Failed');
  });

  it('copies artifact bytes into a detached ArrayBuffer', () => {
    const buffer = copyArtifactBytesToArrayBuffer(new Uint8Array([1, 2, 3]));
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(buffer!))).toEqual([1, 2, 3]);
  });

  it('submits, subscribes, polls if needed, and resolves artifacts', async () => {
    const completedJob = makeJob(ScenarioJobStatus.COMPLETED);
    const artifact = { artifactId: 'artifact-1' } as RuntimeScenarioArtifact;
    const runtime = makeMockRuntime({
      subscribeEvents: [{ job: makeJob(ScenarioJobStatus.RUNNING) }, { job: completedJob }],
      artifacts: [artifact],
    });
    const onUpdate = vi.fn();

    const result = await submitRuntimeGenerationJobAndWait(runtime, { modal: 'music', input: { model: 'music-model', prompt: 'test' } }, onUpdate);

    expect(runtime.media.jobs.submit).toHaveBeenCalledOnce();
    expect(runtime.media.jobs.subscribe).toHaveBeenCalledWith('job-1');
    expect(runtime.media.jobs.getArtifacts).toHaveBeenCalledWith('job-1');
    expect(result.job.status).toBe(ScenarioJobStatus.COMPLETED);
    expect(result.artifacts).toEqual([artifact]);
    expect(onUpdate).toHaveBeenCalledTimes(3);
  });

  it('falls back to polling when stream does not reach terminal state', async () => {
    const runtime = makeMockRuntime({
      subscribeEvents: [{ job: makeJob(ScenarioJobStatus.RUNNING) }],
      getJob: makeJob(ScenarioJobStatus.COMPLETED),
    });

    const result = await submitRuntimeGenerationJobAndWait(runtime, { modal: 'music', input: { model: 'music-model', prompt: 'test' } }, vi.fn());

    expect(runtime.media.jobs.get).toHaveBeenCalledWith('job-1');
    expect(result.job.status).toBe(ScenarioJobStatus.COMPLETED);
  });

  it('binds runtime job updates into the default runtime generation panel', async () => {
    const runtime = makeMockRuntime({
      subscribeEvents: [
        { job: makeJob(ScenarioJobStatus.RUNNING) },
        { job: makeJob(ScenarioJobStatus.COMPLETED) },
      ],
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<RuntimeHarness runtime={runtime} />);
      await flush();
    });

    await act(async () => {
      container?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
      await flush();
    });

    expect(container.textContent).toContain('Runtime Generation');
    expect(container.textContent).toContain('Completed');
    expect(runtime.media.jobs.submit).toHaveBeenCalledOnce();
  });
});
