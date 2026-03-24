import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GenerationPanel,
  GenerationStatusToast,
  useGenerationPanel,
  type GenerationRunItem,
} from '../src/index.js';

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

function Harness({
  statusItems,
  submit,
}: {
  statusItems: readonly GenerationRunItem[];
  submit: () => Promise<void> | void;
}) {
  const state = useGenerationPanel({
    adapter: { submit },
    input: {},
    triggerEventName: 'test-generation-trigger',
  });
  return (
    <GenerationPanel
      state={state}
      title="Test Generation"
      runtimeValue="connector -> model"
      controls={<div>Controls</div>}
      submitLabel="Run"
      statusItems={statusItems}
    />
  );
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

describe('GenerationPanel', () => {
  it('renders controls and status items', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <Harness
          submit={async () => {}}
          statusItems={[{ runId: 'job-1', status: 'running', label: 'Queued', progressValue: 50 }]}
        />,
      );
      await flush();
    });

    expect(container.textContent).toContain('Test Generation');
    expect(container.textContent).toContain('connector -> model');
    expect(container.textContent).toContain('Queued');
    expect(container.textContent).toContain('running');
  });

  it('submits when trigger event fires', async () => {
    const submit = vi.fn(async () => {});
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness submit={submit} statusItems={[]} />);
      await flush();
    });

    await act(async () => {
      window.dispatchEvent(new Event('test-generation-trigger'));
      await flush();
    });

    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('renders status toast', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <GenerationStatusToast
          items={[{ runId: 'job-2', status: 'failed', label: 'Failed', error: 'boom' }]}
        />,
      );
      await flush();
    });

    expect(container.textContent).toContain('Failed');
    expect(container.textContent).toContain('failed');
    expect(container.textContent).toContain('boom');
  });
});
