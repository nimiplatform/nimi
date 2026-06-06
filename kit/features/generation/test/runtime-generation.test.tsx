import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ExecutionMode,
  ScenarioJobStatus,
  ScenarioType,
  type NimiRuntimeScenarioArtifact,
  type NimiRuntimeScenarioJob,
  type Runtime,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  copyArtifactBytesToArrayBuffer,
  scenarioJobStatusLabel,
  scenarioJobStatusToGenerationStatus,
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

function makeJob(status: ScenarioJobStatus, jobId = 'job-1'): NimiRuntimeScenarioJob {
  return { jobId, status } as NimiRuntimeScenarioJob;
}

function makeMockRuntime(options: {
  submitJob?: NimiRuntimeScenarioJob;
  subscribeEvents?: Array<{ job?: NimiRuntimeScenarioJob }>;
  getJob?: NimiRuntimeScenarioJob;
  artifacts?: NimiRuntimeScenarioArtifact[];
}) {
  return {
    ai: {
      submitScenarioJob: vi.fn().mockResolvedValue({
        job: options.submitJob ?? makeJob(ScenarioJobStatus.SUBMITTED),
      }),
      subscribeScenarioJobEvents: vi.fn(() => (
        async function* () {
          for (const event of options.subscribeEvents ?? []) {
            yield event;
          }
        }
      )()),
      getScenarioJob: vi.fn().mockResolvedValue({
        job: options.getJob ?? makeJob(ScenarioJobStatus.COMPLETED),
      }),
      cancelScenarioJob: vi.fn().mockResolvedValue({}),
      getScenarioArtifacts: vi.fn().mockResolvedValue({
        jobId: 'job-1',
        artifacts: options.artifacts ?? [],
      }),
    },
  } as unknown as Runtime;
}

function RuntimeHarness({ runtime }: { runtime: Runtime }) {
  const runtimeState = useRuntimeGenerationPanel({
    runtime,
    input: { prompt: 'test prompt' },
    resolveRequest: () => ({
      scenarioType: ScenarioType.TEXT_GENERATE,
      executionMode: ExecutionMode.ASYNC_JOB,
      requestId: 'request-1',
      idempotencyKey: 'idem-1',
      labels: {},
      extensions: [],
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
    expect(runtime.ai.submitScenarioJob).toHaveBeenCalledOnce();
  });
});
