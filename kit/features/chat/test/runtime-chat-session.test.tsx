import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Runtime, TextStreamPart } from '@nimiplatform/sdk/runtime';
import {
  useRuntimeChatSession,
  type RuntimeChatSessionMessage,
} from '../src/runtime.js';

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

function makeStreamRuntime(parts: TextStreamPart[]): Runtime {
  return {
    ai: {
      text: {
        generate: vi.fn(),
        stream: vi.fn().mockResolvedValue({
          stream: (async function* () {
            for (const part of parts) {
              yield part;
            }
          })(),
        }),
      },
    },
  } as unknown as Runtime;
}

type HarnessProps = {
  runtime: Runtime;
  onReady: (api: {
    sendPrompt: (input: string) => Promise<void>;
    resetMessages: (messages?: readonly RuntimeChatSessionMessage[]) => void;
    cancelCurrent: () => void;
  }) => void;
};

function Harness({ runtime, onReady }: HarnessProps) {
  const session = useRuntimeChatSession({
    runtime,
    resolveRequest: ({ messages }) => ({
      model: 'auto',
      input: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      route: 'cloud',
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

describe('useRuntimeChatSession', () => {
  it('appends user and assistant messages and resolves streamed text', async () => {
    const runtime = makeStreamRuntime([
      { type: 'start' },
      { type: 'delta', text: 'Hello ' },
      { type: 'delta', text: 'world' },
      { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 2 }, trace: { traceId: 'trace-1' } },
    ]);
    let api: HarnessProps['onReady'] extends (input: infer T) => void ? T : never;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness runtime={runtime} onReady={(value) => { api = value; }} />);
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
    const runtime = {
      ai: {
        text: {
          generate: vi.fn(),
          stream: vi.fn().mockResolvedValue({
            stream: (async function* () {
              yield { type: 'delta', text: 'Partial' } as TextStreamPart;
              yield { type: 'error', error: new Error('overloaded') } as TextStreamPart;
            })(),
          }),
        },
      },
    } as unknown as Runtime;
    let api: HarnessProps['onReady'] extends (input: infer T) => void ? T : never;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness runtime={runtime} onReady={(value) => { api = value; }} />);
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
    const runtime = {
      ai: {
        text: {
          generate: vi.fn(),
          stream: vi.fn().mockResolvedValue({
            stream: (async function* () {
              yield { type: 'delta', text: 'Partial' } as TextStreamPart;
              await new Promise<void>((resolve, reject) => {
                release = () => reject(new DOMException('Aborted', 'AbortError'));
              });
            })(),
          }),
        },
      },
    } as unknown as Runtime;
    let api: {
      sendPrompt: (input: string) => Promise<void>;
      resetMessages: (messages?: readonly RuntimeChatSessionMessage[]) => void;
      cancelCurrent: () => void;
    } | undefined;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness runtime={runtime} onReady={(value) => { api = value as typeof api; }} />);
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
    const stream = vi.fn().mockResolvedValue({
      stream: (async function* () {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        yield { type: 'delta', text: 'Only once' } as TextStreamPart;
        yield { type: 'finish', finishReason: 'stop' } as TextStreamPart;
      })(),
    });
    const runtime = {
      ai: {
        text: {
          generate: vi.fn(),
          stream,
        },
      },
    } as unknown as Runtime;
    let api: {
      sendPrompt: (input: string) => Promise<void>;
      resetMessages: (messages?: readonly RuntimeChatSessionMessage[]) => void;
      cancelCurrent: () => void;
    } | undefined;

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness runtime={runtime} onReady={(value) => { api = value as typeof api; }} />);
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

    expect(stream).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
      await Promise.all([first, second]);
      await flush();
    });

    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('2');
    expect(container.querySelector('[data-testid="last"]')?.textContent).toBe('Only once');
  });
});
