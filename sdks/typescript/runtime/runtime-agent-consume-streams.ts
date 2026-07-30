import type {
  AgentEvent,
  AppMessageEvent,
} from '../core-generated/runtime-typed-client';
import {
  normalizeText,
  runtimeAgentError,
} from './runtime-agent-consume-internal';
import {
  projectNimiRuntimeAgentAppMessageEvent,
  projectNimiRuntimeAgentServiceEvent,
} from './runtime-agent-consume-projection';
import type { NimiRuntimeAgentConsumeEvent } from './runtime-agent-consume-types';
import { toNimiRuntimeIsoFromTimestamp } from './runtime-agent-values';

export function normalizeCursor(value: unknown): string {
  const cursor = normalizeText(value);
  if (!cursor) return '';
  if (!/^\d+$/u.test(cursor)) {
    runtimeAgentError(
      'Runtime Agent stream cursor must be a non-negative integer string',
      'SDK_RUNTIME_AGENT_INPUT_INVALID',
      'use_runtime_agent_returned_cursor',
    );
  }
  return cursor;
}

export function projectAppMessageStream(
  stream: AsyncIterable<AppMessageEvent>,
  request: { readonly conversationAnchorId?: unknown; readonly localAgentRef?: unknown },
  liveStartedAtMs?: number,
): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
  return projectRuntimeAgentConsumeEventStream(stream, (event) => {
    if (!eventIsAtOrAfterLiveBoundary(event, liveStartedAtMs)) return null;
    const projected = projectNimiRuntimeAgentAppMessageEvent(event, request.localAgentRef);
    if (!projected) return null;
    const expectedAnchorId = normalizeText(request.conversationAnchorId);
    if (expectedAnchorId && projected.conversationAnchorId !== expectedAnchorId) {
      return null;
    }
    return projected;
  });
}

export function projectAgentEventStream(
  stream: AsyncIterable<AgentEvent>,
  conversationAnchorId: string,
  liveStartedAtMs?: number,
): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
  return projectRuntimeAgentConsumeEventStream(stream, (event) => {
    if (!eventIsAtOrAfterLiveBoundary(event, liveStartedAtMs)) return null;
    const projected = projectNimiRuntimeAgentServiceEvent(event);
    if (conversationAnchorId && projected.conversationAnchorId && projected.conversationAnchorId !== conversationAnchorId) {
      return null;
    }
    return projected;
  });
}

function eventIsAtOrAfterLiveBoundary(event: unknown, liveStartedAtMs?: number): boolean {
  if (liveStartedAtMs === undefined) {
    return true;
  }
  const timestamp = (event as { readonly timestamp?: Parameters<typeof toNimiRuntimeIsoFromTimestamp>[0] } | null)?.timestamp;
  const iso = toNimiRuntimeIsoFromTimestamp(timestamp);
  if (!iso) {
    return true;
  }
  const eventMs = Date.parse(iso);
  if (!Number.isFinite(eventMs) || eventMs <= 0) {
    return true;
  }
  return eventMs >= liveStartedAtMs;
}

function projectRuntimeAgentConsumeEventStream<Input>(
  stream: AsyncIterable<Input>,
  project: (event: Input) => NimiRuntimeAgentConsumeEvent | null,
): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<NimiRuntimeAgentConsumeEvent> {
      const iterator = stream[Symbol.asyncIterator]();
      let closed = false;
      return {
        next: async () => {
          while (!closed) {
            const next = await iterator.next();
            if (next.done) {
              return { done: true, value: undefined };
            }
            const projected = project(next.value);
            if (projected) {
              return { done: false, value: projected };
            }
          }
          return { done: true, value: undefined };
        },
        return: async () => {
          closed = true;
          await Promise.resolve(iterator.return?.()).catch(() => undefined);
          return { done: true, value: undefined };
        },
      };
    },
  };
}

export function mergeNimiRuntimeAgentStreams(
  sources: readonly AsyncIterable<NimiRuntimeAgentConsumeEvent>[],
): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
  type NextState = {
    readonly index: number;
    readonly result?: IteratorResult<NimiRuntimeAgentConsumeEvent>;
    readonly error?: unknown;
  };
  const entries = sources.map((source, index) => ({
    index,
    iterator: source[Symbol.asyncIterator](),
    next: undefined as Promise<NextState> | undefined,
  }));
  const pull = (
    iterator: AsyncIterator<NimiRuntimeAgentConsumeEvent>,
    index: number,
  ): Promise<NextState> =>
    iterator.next().then(
      (result) => ({ index, result }),
      (error) => ({ index, error }),
    );
  for (const entry of entries) {
    entry.next = pull(entry.iterator, entry.index);
  }
  let closed = false;
  return {
    [Symbol.asyncIterator](): AsyncIterator<NimiRuntimeAgentConsumeEvent> {
      return {
        next: async () => {
          while (!closed && entries.length > 0) {
            const next = await Promise.race(entries.map((entry) => entry.next!));
            if (next.error) {
              throw next.error;
            }
            const result = next.result;
            if (!result) {
              continue;
            }
            const entryIndex = entries.findIndex((entry) => entry.index === next.index);
            if (entryIndex < 0) continue;
            if (result.done) {
              entries.splice(entryIndex, 1);
              continue;
            }
            const entry = entries[entryIndex];
            if (!entry) {
              continue;
            }
            entry.next = pull(entry.iterator, entry.index);
            return { done: false, value: result.value };
          }
          return { done: true, value: undefined };
        },
        return: async () => {
          closed = true;
          await Promise.allSettled(entries.map((entry) => entry.iterator.return?.()));
          entries.splice(0, entries.length);
          return { done: true, value: undefined };
        },
      };
    },
  };
}
