import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { Runtime } from '@nimiplatform/kit/core/sdk-contract';
import {
  useAppAiChatSession,
  type AppAiChatSessionMessage,
} from '../src/runtime.js';
import {
  createRuntimeAiTestRuntime,
  runtimeDoneEvent,
  runtimeTextDeltaEvent,
} from './runtime-ai-test-helpers.js';

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

type HarnessProps = {
  runtime: Runtime;
  onReady: (api: {
    sendPrompt: (input: string) => Promise<void>;
    resetMessages: (messages?: readonly AppAiChatSessionMessage[]) => void;
    cancelCurrent: () => void;
  }) => void;
};

function Harness({ runtime, onReady }: HarnessProps) {
  const session = useAppAiChatSession({
    runtime,
    appId: 'kit-chat-test-app',
    resolveRequest: ({ messages }) => ({
      input: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    }),
  });

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          onReady({
            sendPrompt: (input) => session.sendPrompt(input),
            resetMessages: session.resetMessages,
            cancelCurrent: session.cancelCurrent,
          });
        }}
      >
        bind
      </button>
      <div data-testid="count">{session.messages.length}</div>
      <div data-testid="last">{session.messages[session.messages.length - 1]?.content || ''}</div>
      <div data-testid="status">{session.messages[session.messages.length - 1]?.status || ''}</div>
      <div data-testid="streaming">{String(session.isStreaming)}</div>
      <div data-testid="can-cancel">{String(session.canCancel)}</div>
      <div data-testid="error">{session.error || ''}</div>
    </div>
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

describe('useAppAiChatSession', () => {
  it('appends user and assistant messages and resolves streamed text', async () => {
    const runtimeHarness = createRuntimeAiTestRuntime({
      streamEvents: [
        { type: 'start', traceId: 'trace-1' },
        { type: 'text-delta', text: 'Hello ' },
        { type: 'text-delta', text: 'world' },
        { type: 'done', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } },
      ],
    });
    let api: HarnessProps['onReady'] extends (input: infer T) => void ? T : never;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness runtime={runtimeHarness.runtime} onReady={(value) => { api = value; }} />);
      await flush();
    });

    await act(async () => {
      container?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      await api.sendPrompt('Hi there');
      await flush();
    });

    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('2');
    expect(container.querySelector('[data-testid="last"]')?.textContent).toBe('Hello world');
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe('complete');
    expect(container.querySelector('[data-testid="streaming"]')?.textContent).toBe('false');
  });

  it('marks the assistant message as error when the runtime stream fails', async () => {
    const runtimeHarness = createRuntimeAiTestRuntime({
      streamEvents: [
        { type: 'text-delta', text: 'Partial' },
        { type: 'error', code: 'RUNTIME_OVERLOADED', message: 'overloaded' },
      ],
    });
    let api: HarnessProps['onReady'] extends (input: infer T) => void ? T : never;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness runtime={runtimeHarness.runtime} onReady={(value) => { api = value; }} />);
      await flush();
    });

    await act(async () => {
      container?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    await act(async () => {
      await api.sendPrompt('Hi there');
      await flush();
    });

    expect(container.querySelector('[data-testid="last"]')?.textContent).toContain('Error: overloaded');
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe('error');
    expect(container.querySelector('[data-testid="error"]')?.textContent).toBe('overloaded');
  });

  it('cancels an active stream and marks the assistant message as canceled', async () => {
    let release: (() => void) | null = null;
    const runtimeHarness = createRuntimeAiTestRuntime({
      streamScenario: () => (async function* () {
        yield runtimeTextDeltaEvent('Partial');
        await new Promise<void>((_resolve, reject) => {
          release = () => reject(new DOMException('Aborted', 'AbortError'));
        });
      })(),
    });
    let api: {
      sendPrompt: (input: string) => Promise<void>;
      resetMessages: (messages?: readonly AppAiChatSessionMessage[]) => void;
      cancelCurrent: () => void;
    } | undefined;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness runtime={runtimeHarness.runtime} onReady={(value) => { api = value as typeof api; }} />);
      await flush();
    });

    await act(async () => {
      container?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const pending = api?.sendPrompt('Cancel me');
    await act(async () => {
      await flush();
    });

    expect(container.querySelector('[data-testid="can-cancel"]')?.textContent).toBe('true');

    await act(async () => {
      api?.cancelCurrent();
      release?.();
      await pending;
      await flush();
    });

    expect(container.querySelector('[data-testid="last"]')?.textContent).toBe('Partial');
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe('canceled');
    expect(container.querySelector('[data-testid="streaming"]')?.textContent).toBe('false');
    expect(container.querySelector('[data-testid="error"]')?.textContent).toBe('');
  });

  it('drops overlapping sendPrompt calls while a stream is already starting', async () => {
    let release: (() => void) | null = null;
    const runtimeHarness = createRuntimeAiTestRuntime({
      streamScenario: () => (async function* () {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        yield runtimeTextDeltaEvent('Only once');
        yield runtimeDoneEvent();
      })(),
    });
    let api: {
      sendPrompt: (input: string) => Promise<void>;
      resetMessages: (messages?: readonly AppAiChatSessionMessage[]) => void;
      cancelCurrent: () => void;
    } | undefined;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness runtime={runtimeHarness.runtime} onReady={(value) => { api = value as typeof api; }} />);
      await flush();
    });

    await act(async () => {
      container?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    const first = api?.sendPrompt('First prompt');
    const second = api?.sendPrompt('Second prompt');

    await act(async () => {
      await flush();
    });

    expect(runtimeHarness.streamScenario).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
      await Promise.all([first, second]);
      await flush();
    });

    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('2');
    expect(container.querySelector('[data-testid="last"]')?.textContent).toBe('Only once');
  });
});
