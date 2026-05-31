import type { RuntimeAgentConsumeEvent } from '@nimiplatform/sdk/runtime';

export type RuntimeAgentQueuedEvent =
  | { type: 'event'; event: RuntimeAgentConsumeEvent }
  | { type: 'done' }
  | { type: 'error'; error: unknown };

export function createRuntimeAgentEventQueue(
  source: AsyncIterable<RuntimeAgentConsumeEvent>,
): {
    next: () => Promise<RuntimeAgentQueuedEvent>;
    enqueue: (event: RuntimeAgentConsumeEvent) => void;
    stop: () => void;
  } {
  const iterator = source[Symbol.asyncIterator]();
  const queue: RuntimeAgentQueuedEvent[] = [];
  const waiters: Array<() => void> = [];
  let stopped = false;

  const notify = () => {
    const pending = waiters.splice(0);
    for (const wake of pending) {
      wake();
    }
  };
  const push = (item: RuntimeAgentQueuedEvent) => {
    if (stopped) {
      return;
    }
    queue.push(item);
    notify();
  };
  const waitForEvent = () => new Promise<void>((resolve) => {
    waiters.push(resolve);
  });

  void (async () => {
    try {
      while (!stopped) {
        const next = await iterator.next();
        if (next.done) {
          push({ type: 'done' });
          return;
        }
        push({ type: 'event', event: next.value });
      }
    } catch (error) {
      push({ type: 'error', error });
    }
  })();

  return {
    next: async () => {
      while (queue.length === 0) {
        if (stopped) {
          return { type: 'done' };
        }
        await waitForEvent();
      }
      return queue.shift() || { type: 'done' };
    },
    enqueue: (event) => {
      push({ type: 'event', event });
    },
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      notify();
      void iterator.return?.();
    },
  };
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = globalThis.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      globalThis.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}
