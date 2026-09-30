import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { NimiAiModel, Runtime } from '@nimiplatform/kit/core/sdk-contract';
import { createNimiLocalAppTextModel } from '@nimiplatform/sdk/ai';
import {
  useAppAiChatSession,
  type AppAiChatSessionMessage,
  type AppAiChatStreamRequest,
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
  runtime?: Runtime;
  model?: NimiAiModel;
  requestOptions?: Omit<AppAiChatStreamRequest, 'input'>;
  onReady: (api: {
    sendPrompt: (input: string) => Promise<void>;
    resetMessages: (messages?: readonly AppAiChatSessionMessage[]) => void;
    cancelCurrent: () => void;
  }) => void;
};

function Harness({ runtime, model, requestOptions, onReady }: HarnessProps) {
  const session = useAppAiChatSession({
    ...(model ? { model } : { runtime, appId: 'kit-chat-test-app' }),
    resolveRequest: ({ messages }) => ({
      ...requestOptions,
      input: messages.map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.outputItems ? { outputItems: message.outputItems } : {}),
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

  it('keeps opaque continuity on the assistant message and replays that turn on the next prompt', async () => {
    const payload = new Uint8Array([7, 8, 9]);
    const runtimeHarness = createRuntimeAiTestRuntime({
      streamEvents: [
        { type: 'start', traceId: 'trace-thinking' },
        {
          type: 'reasoning-continuity',
          carrier: { kind: 'openai.responses.reasoning', version: 1, payload },
          itemIndex: 0,
          itemCompleted: true,
        },
        { type: 'text-delta', text: 'Hello world', itemIndex: 1, itemCompleted: true },
        { type: 'done', finishReason: 'stop' },
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
    expect(container.querySelector('[data-testid="last"]')?.textContent).toBe('Hello world');
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe('complete');

    await act(async () => {
      await api.sendPrompt('And then?');
      await flush();
    });

    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe('4');
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe('complete');
    const request = runtimeHarness.streamScenario.mock.calls[1]?.[0];
    const input = request?.spec?.spec.oneofKind === 'textGenerate' ? request.spec.spec.textGenerate.input : [];
    expect(input.map((message) => [message.role, message.content])).toEqual([
      ['user', 'Hi there'],
      ['assistant', ''],
      ['user', 'And then?'],
    ]);
    expect(input[1]?.turnItems.map((item) => item.item.oneofKind === 'output' ? item.item.output.item : null)).toEqual([
      { oneofKind: 'reasoningContinuity', reasoningContinuity: { kind: 'openai.responses.reasoning', version: 1, payload } },
      { oneofKind: 'text', text: { text: 'Hello world' } },
    ]);
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

  describe('with a caller-bound protected App model', () => {
    type LocalAppTextAI = Parameters<typeof createNimiLocalAppTextModel>[0];
    type Api = Parameters<HarnessProps['onReady']>[0];

    // Each turn answers with the next scripted Local App stream; a turn may
    // wait until its stream is canceled.
    function localAppTextAI(turns: readonly ((closed: Promise<void>) => AsyncIterable<unknown>)[]) {
      const inputs: unknown[] = [];
      const cancels: number[] = [];
      const ai = {
        text: {
          async streamTurn(input: unknown) {
            const turn = turns[inputs.length]!;
            const index = inputs.push(input) - 1;
            let close = () => {};
            const closed = new Promise<void>((resolve) => { close = resolve; });
            return Object.assign(turn(closed), {
              cancel: async () => {
                cancels.push(index);
                close();
              },
            });
          },
        },
      } as unknown as LocalAppTextAI;
      return { ai, inputs, cancels };
    }

    async function mount(props: Omit<HarnessProps, 'onReady'>): Promise<Api> {
      let api: Api | undefined;
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root?.render(<Harness {...props} onReady={(value) => { api = value; }} />);
        await flush();
      });
      await act(async () => {
        container?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flush();
      });
      return api!;
    }

    const text = (id: string) => container?.querySelector(`[data-testid="${id}"]`)?.textContent;

    it('sends only admitted fields and replays the recorded continuity on the next prompt', async () => {
      const carrier = { kind: 'anthropic.messages.thinking', version: 1, payload: [0, 1, 2, 253, 254, 255] };
      const { ai, inputs } = localAppTextAI([
        async function* reply() {
          yield { type: 'reasoning-continuity', sequence: '1', traceId: 'trace-1', itemIndex: 0, carrier };
          yield { type: 'delta', sequence: '2', traceId: 'trace-1', text: 'Hello world', itemIndex: 1 };
          yield { type: 'completed', sequence: '3', traceId: 'trace-1', finishReason: 'stop' };
        },
        async function* reply() {
          yield { type: 'delta', sequence: '1', traceId: 'trace-2', text: 'Then more.', itemIndex: 0 };
          yield { type: 'completed', sequence: '2', traceId: 'trace-2', finishReason: 'stop' };
        },
      ]);
      const api = await mount({ model: createNimiLocalAppTextModel(ai) });

      await act(async () => {
        await api.sendPrompt('Hi there');
        await flush();
      });
      expect(text('last')).toBe('Hello world');
      expect(text('status')).toBe('complete');
      await act(async () => {
        await api.sendPrompt('And then?');
        await flush();
      });

      expect(text('count')).toBe('4');
      expect(text('last')).toBe('Then more.');
      expect(inputs[0]).toEqual({ messages: [{ role: 'user', text: 'Hi there' }] });
      expect(inputs[1]).toEqual({
        messages: [
          { role: 'user', text: 'Hi there' },
          {
            role: 'assistant',
            text: '',
            turnItems: [
              { type: 'output', output: { type: 'reasoning-continuity', carrier } },
              { type: 'output', output: { type: 'text', text: 'Hello world' } },
            ],
          },
          { role: 'user', text: 'And then?' },
        ],
      });
    });

    it('fails a prompt that sets a Runtime option the bound model cannot carry', async () => {
      const { ai, inputs } = localAppTextAI([]);
      const api = await mount({ model: createNimiLocalAppTextModel(ai), requestOptions: { metadata: { traceTag: 'x' }, timeoutMs: 5000 } });

      await act(async () => {
        await api.sendPrompt('Hi there');
        await flush();
      });

      expect(inputs).toHaveLength(0);
      expect(text('status')).toBe('error');
      expect(text('error')).toBe('a caller-bound app AI chat model cannot carry timeoutMs, metadata');
    });

    it('cancel closes the protected stream without waiting for another event', async () => {
      const { ai, cancels } = localAppTextAI([
        async function* reply(closed) {
          yield { type: 'delta', sequence: '1', traceId: 'trace-1', text: 'Partial', itemIndex: 0 };
          await closed;
          yield { type: 'delta', sequence: '2', traceId: 'trace-1', text: ' late', itemIndex: 0 };
          yield { type: 'completed', sequence: '3', traceId: 'trace-1', finishReason: 'stop' };
        },
      ]);
      const api = await mount({ model: createNimiLocalAppTextModel(ai) });

      const pending = api.sendPrompt('Cancel me');
      await act(async () => {
        await flush();
      });
      expect(text('last')).toBe('Partial');

      await act(async () => {
        api.cancelCurrent();
        await pending;
        await flush();
      });

      expect(cancels).toEqual([0]);
      expect(text('last')).toBe('Partial');
      expect(text('status')).toBe('canceled');
      expect(text('error')).toBe('');
    });

    it('a turn reset while streaming cannot end, free or report into the next turn', async () => {
      // The first turn ignores its cancellation until the test lets it end, so
      // it finishes only after the next turn has started.
      const releaseFirst = Promise.withResolvers<void>();
      const { ai, inputs, cancels } = localAppTextAI([
        async function* first() {
          yield { type: 'delta', sequence: '1', traceId: 'trace-1', text: 'First', itemIndex: 0 };
          await releaseFirst.promise;
          yield { type: 'completed', sequence: '2', traceId: 'trace-1', finishReason: 'stop' };
        },
        async function* second(closed) {
          yield { type: 'delta', sequence: '1', traceId: 'trace-2', text: 'Second', itemIndex: 0 };
          await closed;
          yield { type: 'completed', sequence: '2', traceId: 'trace-2', finishReason: 'stop' };
        },
      ]);
      const api = await mount({ model: createNimiLocalAppTextModel(ai) });

      const firstTurn = api.sendPrompt('one');
      await act(async () => {
        await flush();
      });
      expect(text('last')).toBe('First');

      let secondTurn: Promise<void> | undefined;
      await act(async () => {
        api.resetMessages([]);
        secondTurn = api.sendPrompt('two');
        await flush();
      });
      expect(text('count')).toBe('2');
      expect(text('last')).toBe('Second');
      // The new conversation's request carries none of the reset one.
      expect(inputs[1]).toEqual({ messages: [{ role: 'user', text: 'two' }] });

      // The reset first turn ends late.
      await act(async () => {
        releaseFirst.resolve();
        await firstTurn;
        await flush();
      });
      expect(text('streaming')).toBe('true');
      expect(text('can-cancel')).toBe('true');
      expect(text('last')).toBe('Second');
      expect(text('error')).toBe('');

      // A third prompt cannot start beside the running second turn.
      await act(async () => {
        await api.sendPrompt('three');
        await flush();
      });
      expect(inputs).toHaveLength(2);

      await act(async () => {
        api.cancelCurrent();
        await secondTurn;
        await flush();
      });
      expect(cancels).toContain(1);
      expect(text('status')).toBe('canceled');
      expect(text('streaming')).toBe('false');
    });

    it('unmounting the session closes the reply it is still streaming', async () => {
      const { ai, cancels } = localAppTextAI([
        async function* reply(closed) {
          yield { type: 'delta', sequence: '1', traceId: 'trace-1', text: 'Partial', itemIndex: 0 };
          await closed;
          yield { type: 'completed', sequence: '2', traceId: 'trace-1', finishReason: 'stop' };
        },
      ]);
      const api = await mount({ model: createNimiLocalAppTextModel(ai) });

      const pending = api.sendPrompt('Keep going');
      await act(async () => {
        await flush();
      });
      await act(async () => {
        root?.unmount();
        await pending;
      });
      root = null;

      expect(cancels).toEqual([0]);
    });
  });
});
