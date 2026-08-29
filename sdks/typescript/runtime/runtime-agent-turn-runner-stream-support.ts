import type { JsonObject } from '../types';
import type {
  NimiRuntimeAgentConsumeEvent,
} from './runtime-agent-consume-types';
import type {
  NimiRuntimeAgentTurnRunnerDiagnosticsInput,
  NimiRuntimeAgentTurnRequest,
  NimiRuntimeAgentConsumeRequest,
} from './runtime-agent-turn-runner-types';

type NimiRuntimeAgentQueuedEvent =
  | { readonly type: 'event'; readonly event: NimiRuntimeAgentConsumeEvent }
  | { readonly type: 'done' }
  | { readonly type: 'timeout' }
  | { readonly type: 'error'; readonly error: unknown };

export const TERMINAL_GRACE_WAIT_MS = 25;
export const TERMINAL_GRACE_MAX_EVENTS = 64;

export function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function detailText(event: NimiRuntimeAgentConsumeEvent, field: string): string {
  return normalizeText(event.detail[field]);
}

function runtimeEventTimelineSequence(event: NimiRuntimeAgentConsumeEvent): number {
  const sequence = event.timeline?.sequence;
  return typeof sequence === 'number' && Number.isFinite(sequence) ? sequence : Number.POSITIVE_INFINITY;
}

export function sortedRuntimeTerminalGraceEvents(
  events: readonly NimiRuntimeAgentConsumeEvent[],
): NimiRuntimeAgentConsumeEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const leftSequence = runtimeEventTimelineSequence(left.event);
      const rightSequence = runtimeEventTimelineSequence(right.event);
      if (leftSequence !== rightSequence) return leftSequence - rightSequence;
      return left.index - right.index;
    })
    .map((item) => item.event);
}

export function createNimiRuntimeAgentEventQueue(
  source: AsyncIterable<NimiRuntimeAgentConsumeEvent>,
): {
  readonly next: (timeoutMs?: number) => Promise<NimiRuntimeAgentQueuedEvent>;
  readonly enqueue: (event: NimiRuntimeAgentConsumeEvent) => void;
  readonly stop: () => void;
} {
  const iterator = source[Symbol.asyncIterator]();
  const queue: NimiRuntimeAgentQueuedEvent[] = [];
  const waiters: Array<() => void> = [];
  let stopped = false;

  const notify = () => {
    const pending = waiters.splice(0);
    for (const wake of pending) wake();
  };
  const push = (item: NimiRuntimeAgentQueuedEvent) => {
    if (stopped) return;
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
    next: async (timeoutMs?: number) => {
      while (queue.length === 0) {
        if (stopped) return { type: 'done' };
        if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs >= 0) {
          let timeout: ReturnType<typeof setTimeout> | null = null;
          const timedOut = await Promise.race([
            waitForEvent().then(() => false),
            new Promise<boolean>((resolve) => {
              timeout = globalThis.setTimeout(() => resolve(true), Math.floor(timeoutMs));
            }),
          ]);
          if (timeout) globalThis.clearTimeout(timeout);
          if (timedOut && queue.length === 0) return { type: 'timeout' };
          continue;
        }
        await waitForEvent();
      }
      return queue.shift() || { type: 'done' };
    },
    enqueue: (event) => {
      push({ type: 'event', event });
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      notify();
      void iterator.return?.();
    },
  };
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timeout = globalThis.setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export function defaultNimiRuntimeAgentNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export function buildRunnerDiagnostics(input: NimiRuntimeAgentTurnRunnerDiagnosticsInput): JsonObject {
  return {
    transport: 'runtime.agent.turns',
    conversationAnchorId: input.conversationAnchorId,
    runtimeTurnId: input.runtimeTurnId,
    runtimeStreamId: input.runtimeStreamId,
    traceId: input.trace?.traceId || null,
    ...(input.runtimeTurnTimelines.length > 0 ? { runtimeTurnTimelines: [...input.runtimeTurnTimelines] } : {}),
    ...(input.runtimeProjectionEvents.length > 0 ? { runtimeProjectionEvents: [...input.runtimeProjectionEvents] } : {}),
    ...(input.extra || {}),
  };
}

export function nimiRuntimeAgentLocalIdentityFromRequest(request: NimiRuntimeAgentTurnRequest) {
  return {
    ownerUserId: request.ownerUserId,
    runtimeSourceRef: request.runtimeSourceRef,
    localAgentRef: request.localAgentRef,
  };
}

export function buildNimiRuntimeAgentSubscribeRequest(
  request: NimiRuntimeAgentTurnRequest,
  subscribe?: NimiRuntimeAgentConsumeRequest,
): NimiRuntimeAgentConsumeRequest {
  return subscribe || {
    ...nimiRuntimeAgentLocalIdentityFromRequest(request),
    conversationAnchorId: request.conversationAnchorId,
  };
}

export function nimiRuntimeAgentContextDetails(input: {
  readonly request: NimiRuntimeAgentTurnRequest;
  readonly requestId: string;
  readonly requestMessageId?: string;
  readonly runtimeTurnId?: string;
  readonly runtimeStreamId?: string;
}): JsonObject {
  return {
    localAgentRef: normalizeText(input.request.localAgentRef),
    conversationAnchorId: input.request.conversationAnchorId,
    threadId: input.request.threadId || null,
    requestId: input.requestId,
    ...(input.requestMessageId !== undefined ? { requestMessageId: input.requestMessageId } : {}),
    ...(input.runtimeTurnId !== undefined ? { runtimeTurnId: input.runtimeTurnId } : {}),
    ...(input.runtimeStreamId !== undefined ? { runtimeStreamId: input.runtimeStreamId } : {}),
  };
}
