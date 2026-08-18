import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ReasonCode,
  ScenarioJobStatus,
  createNimiError,
  isNimiError,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  copyArtifactBytesToArrayBuffer,
  scenarioJobStatusLabel,
  scenarioJobStatusToGenerationStatus,
  runtimeScenarioJobUnavailableReasonFromError,
  useRuntimeGenerationPanel,
  type RuntimeGenerationPanelErrorContext,
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

type RuntimeGenerationPanelOnError = (
  error: unknown,
  context: RuntimeGenerationPanelErrorContext<{ prompt: string }>,
) => void;

function RuntimeHarness({ onError }: { onError: RuntimeGenerationPanelOnError }) {
  const runtimeState = useRuntimeGenerationPanel({
    capabilityContract: 'image.generate',
    input: { prompt: 'test prompt' },
    onError,
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
  it('maps Runtime statuses without owning submission', () => {
    expect(scenarioJobStatusToGenerationStatus(ScenarioJobStatus.SUBMITTED)).toBe('pending');
    expect(scenarioJobStatusToGenerationStatus(ScenarioJobStatus.RUNNING)).toBe('running');
    expect(scenarioJobStatusToGenerationStatus(ScenarioJobStatus.COMPLETED)).toBe('completed');
    expect(scenarioJobStatusToGenerationStatus(ScenarioJobStatus.TIMEOUT)).toBe('timeout');
    expect(scenarioJobStatusToGenerationStatus(ScenarioJobStatus.CANCELED)).toBe('canceled');
    expect(scenarioJobStatusToGenerationStatus(999 as ScenarioJobStatus)).toBe('failed');
  });

  it('returns readable Runtime labels', () => {
    expect(scenarioJobStatusLabel(ScenarioJobStatus.SUBMITTED)).toBe('Submitted to Runtime');
    expect(scenarioJobStatusLabel(ScenarioJobStatus.RUNNING)).toBe('Generating output');
    expect(scenarioJobStatusLabel(999 as ScenarioJobStatus)).toBe('Failed');
  });

  it.each([
    ['FAILED', 'runtime-call-failed'],
    ['CANCELED', 'runtime-canceled'],
    ['TIMEOUT', 'runtime-timeout'],
  ] as const)('maps Scenario job %s errors through shared typed diagnostics', (status, expected) => {
    const error = createNimiError({
      message: `Runtime job ${status.toLowerCase()}`,
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'inspect_runtime_scenario_job',
      source: 'runtime',
      details: { scenarioJobStatus: status },
    });
    expect(runtimeScenarioJobUnavailableReasonFromError(error)).toBe(expected);
  });

  it('copies artifact bytes into a detached ArrayBuffer', () => {
    const buffer = copyArtifactBytesToArrayBuffer(new Uint8Array([1, 2, 3]));
    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(buffer!))).toEqual([1, 2, 3]);
  });

  it('keeps the shared panel but fails submission closed with a typed error', async () => {
    const onError = vi.fn<RuntimeGenerationPanelOnError>();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<RuntimeHarness onError={onError} />);
      await flush();
    });

    await act(async () => {
      container?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(container.textContent).toContain('Runtime Generation');
    expect(container.textContent).toContain('current Scenario API');
    expect(onError).toHaveBeenCalledOnce();
    const error = onError.mock.calls[0]?.[0];
    expect(isNimiError(error)).toBe(true);
    if (!isNimiError(error)) throw new Error('expected NimiError');
    expect(error.reasonCode).toBe(ReasonCode.AI_ROUTE_UNSUPPORTED);
  });
});
