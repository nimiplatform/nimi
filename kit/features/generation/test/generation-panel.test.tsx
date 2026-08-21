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
  dismissErrorLabel,
}: {
  statusItems: readonly GenerationRunItem[];
  submit: () => Promise<void> | void;
  dismissErrorLabel?: string;
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
      runtimeValue="Owner-driven execution unavailable"
      controls={<div>Controls</div>}
      submitLabel="Run"
      statusItems={statusItems}
      dismissErrorLabel={dismissErrorLabel}
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
    expect(container.textContent).toContain('Owner-driven execution unavailable');
    expect(container.textContent).toContain('Queued');
    expect(container.textContent).toContain('running');

    const progress = container.querySelector('[role="progressbar"]') as HTMLElement;
    expect(progress).toBeTruthy();
    expect(progress.getAttribute('aria-valuenow')).toBe('50');
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

  it('renders the error dismiss button with the kit focus ring and clears the error', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <Harness
          submit={async () => { throw new Error('boom'); }}
          statusItems={[]}
        />,
      );
      await flush();
    });

    await act(async () => {
      window.dispatchEvent(new Event('test-generation-trigger'));
      await flush();
    });

    const dismiss = container.querySelector('button[aria-label="Dismiss generation error"]') as HTMLButtonElement;
    expect(dismiss).toBeTruthy();
    expect(dismiss.className).toContain('focus-visible:ring');

    await act(async () => {
      dismiss.click();
      await flush();
    });
    expect(container.querySelector('button[aria-label="Dismiss generation error"]')).toBeNull();
  });

  it('accepts a host-injected dismiss error label', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <Harness
          submit={async () => { throw new Error('boom'); }}
          statusItems={[]}
          dismissErrorLabel="关闭错误"
        />,
      );
      await flush();
    });

    await act(async () => {
      window.dispatchEvent(new Event('test-generation-trigger'));
      await flush();
    });

    expect(container.querySelector('button[aria-label="关闭错误"]')).toBeTruthy();
  });

  it('uses semantic tones for submitted and queued host statuses', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <GenerationStatusToast
          items={[
            { runId: 'submitted', status: 'submitted', label: 'Job A' },
            { runId: 'queued', status: 'queued', label: 'Job B' },
          ]}
        />,
      );
      await flush();
    });

    expect(Array.from(container.querySelectorAll('span')).find((node) => node.textContent === 'submitted')?.className).toContain('status-info');
    expect(Array.from(container.querySelectorAll('span')).find((node) => node.textContent === 'queued')?.className).toContain('status-warning');
  });

  it('maps status labels through the host-injected getStatusLabel', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <GenerationStatusToast
          items={[{ runId: 'job-3', status: 'running', label: 'Job' }]}
          getStatusLabel={(status) => `status:${status}`}
        />,
      );
      await flush();
    });

    expect(container.textContent).toContain('status:running');
  });
});
