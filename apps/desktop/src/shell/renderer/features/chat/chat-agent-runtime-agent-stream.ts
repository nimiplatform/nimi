import type { RuntimeAgentConsumeEvent, RuntimeAgentSessionTurnSnapshot } from '@nimiplatform/sdk/runtime';

import { normalizeText } from './chat-agent-orchestration-shared';
import type { AgentLocalChatRuntimeRequest } from './chat-agent-orchestration-types';

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

export function readStructuredMessageField(
  structured: Record<string, unknown> | undefined,
  field: 'message_id' | 'text',
): string {
  const message = structured && typeof structured.message === 'object' && structured.message !== null
    ? structured.message as Record<string, unknown>
    : {};
  const value = message[field];
  return typeof value === 'string' ? normalizeText(value) : '';
}

export function snapshotTurnIsCompleted(turn: RuntimeAgentSessionTurnSnapshot): boolean {
  const status = normalizeText(turn.status).toLowerCase();
  return status === 'completed' || Boolean(normalizeText(turn.finishReason));
}

export function snapshotTurnIsFailed(turn: RuntimeAgentSessionTurnSnapshot): boolean {
  const status = normalizeText(turn.status).toLowerCase();
  return status === 'failed' || Boolean(normalizeText(turn.reasonCode));
}

export function snapshotTurnIsTerminal(turn: RuntimeAgentSessionTurnSnapshot | undefined): turn is RuntimeAgentSessionTurnSnapshot {
  return Boolean(turn && (snapshotTurnIsCompleted(turn) || snapshotTurnIsFailed(turn)));
}

export function snapshotCompletedTurnHasRecoverableContent(turn: RuntimeAgentSessionTurnSnapshot): boolean {
  if (!snapshotTurnIsCompleted(turn)) {
    return true;
  }
  return Boolean(
    turn.structured
      && (normalizeText(turn.text) || readStructuredMessageField(turn.structured, 'text')),
  );
}

export function buildRuntimeAgentSnapshotRecoveryEvents(options: {
  turn: RuntimeAgentSessionTurnSnapshot;
  agentId: string;
  conversationAnchorId: string;
  requestId: string;
  requestMessageId: string;
  currentTurnAccepted: boolean;
  currentRuntimeTurnId: string;
  currentRuntimeStreamId: string;
  hasStructuredEnvelope: boolean;
  hasCommittedMessage: boolean;
}): RuntimeAgentConsumeEvent[] {
  const runtimeTurnId = normalizeText(options.turn.turnId);
  if (!runtimeTurnId) {
    return [];
  }
  const streamId = options.currentRuntimeStreamId || `snapshot:${runtimeTurnId}`;
  const structured = options.turn.structured && Object.keys(options.turn.structured).length > 0
    ? options.turn.structured
    : undefined;
  const text = normalizeText(options.turn.text) || readStructuredMessageField(structured, 'text');
  const messageId = normalizeText(options.turn.messageId)
    || readStructuredMessageField(structured, 'message_id')
    || options.requestMessageId
    || 'message-0';
  const events: RuntimeAgentConsumeEvent[] = [];
  if (!options.currentTurnAccepted || options.currentRuntimeTurnId !== runtimeTurnId) {
    events.push({
      eventName: 'runtime.agent.turn.accepted',
      agentId: options.agentId,
      conversationAnchorId: options.conversationAnchorId,
      turnId: runtimeTurnId,
      streamId,
      detail: { requestId: options.requestId },
    } as RuntimeAgentConsumeEvent);
  }
  if (!options.hasStructuredEnvelope && structured) {
    events.push({
      eventName: 'runtime.agent.turn.structured',
      agentId: options.agentId,
      conversationAnchorId: options.conversationAnchorId,
      turnId: runtimeTurnId,
      streamId,
      detail: {
        kind: normalizeText(String(structured.schema_id || '')) || 'agent_resolved_message_action_envelope',
        payload: structured,
      },
    } as RuntimeAgentConsumeEvent);
  }
  if (!options.hasCommittedMessage && text) {
    events.push({
      eventName: 'runtime.agent.turn.message_committed',
      agentId: options.agentId,
      conversationAnchorId: options.conversationAnchorId,
      turnId: runtimeTurnId,
      streamId,
      messageId,
      detail: { messageId, text },
    } as RuntimeAgentConsumeEvent);
  }
  if (snapshotTurnIsCompleted(options.turn)) {
    events.push({
      eventName: 'runtime.agent.turn.completed',
      agentId: options.agentId,
      conversationAnchorId: options.conversationAnchorId,
      turnId: runtimeTurnId,
      streamId,
      detail: {
        terminalReason: normalizeText(options.turn.finishReason) || 'stop',
      },
    } as RuntimeAgentConsumeEvent);
    return events;
  }
  if (snapshotTurnIsFailed(options.turn)) {
    events.push({
      eventName: 'runtime.agent.turn.failed',
      agentId: options.agentId,
      conversationAnchorId: options.conversationAnchorId,
      turnId: runtimeTurnId,
      streamId,
      detail: {
        reasonCode: normalizeText(options.turn.reasonCode) || 'RUNTIME_AGENT_TURN_FAILED',
        message: normalizeText(options.turn.message) || undefined,
      },
    } as RuntimeAgentConsumeEvent);
  }
  return events;
}

export async function recoverRuntimeAgentTerminalSnapshot(options: {
  reason: string;
  request: AgentLocalChatRuntimeRequest;
  requestId: string;
  requestMessageId: string;
  currentTurnAccepted: boolean;
  currentRuntimeTurnId: string;
  currentRuntimeStreamId: string;
  hasStructuredEnvelope: boolean;
  hasCommittedMessage: boolean;
  querySnapshot: () => Promise<{ lastTurn?: RuntimeAgentSessionTurnSnapshot }>;
  enqueue: (event: RuntimeAgentConsumeEvent) => void;
  logEvent: (event: {
    level: 'warn';
    area: string;
    message: `action:${string}` | `phase:${string}`;
    details: Record<string, unknown>;
  }) => void;
}): Promise<boolean> {
  let turn: RuntimeAgentSessionTurnSnapshot | undefined;
  try {
    const snapshot = await options.querySnapshot();
    turn = snapshot.lastTurn;
  } catch (error) {
    options.logEvent({
      level: 'warn',
      area: 'agent-chat-runtime',
      message: 'action:runtime-agent-turn:snapshot-recovery-query-failed',
      details: {
        agentId: options.request.agentId,
        conversationAnchorId: options.request.conversationAnchorId,
        threadId: options.request.threadId,
        requestId: options.requestId,
        reason: options.reason,
        error: String(error instanceof Error ? error.message : error),
      },
    });
    return false;
  }
  if (!snapshotTurnIsTerminal(turn)) {
    return false;
  }
  if (!options.currentTurnAccepted || normalizeText(turn.turnId) !== options.currentRuntimeTurnId) {
    return false;
  }
  if (!snapshotCompletedTurnHasRecoverableContent(turn)) {
    return false;
  }
  const events = buildRuntimeAgentSnapshotRecoveryEvents({
    turn,
    agentId: options.request.agentId,
    conversationAnchorId: options.request.conversationAnchorId,
    requestId: options.requestId,
    requestMessageId: options.requestMessageId,
    currentTurnAccepted: options.currentTurnAccepted,
    currentRuntimeTurnId: options.currentRuntimeTurnId,
    currentRuntimeStreamId: options.currentRuntimeStreamId,
    hasStructuredEnvelope: options.hasStructuredEnvelope,
    hasCommittedMessage: options.hasCommittedMessage,
  });
  if (events.length === 0) {
    return false;
  }
  options.logEvent({
    level: 'warn',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:snapshot-recovered',
    details: {
      agentId: options.request.agentId,
      conversationAnchorId: options.request.conversationAnchorId,
      threadId: options.request.threadId,
      requestId: options.requestId,
      reason: options.reason,
      runtimeTurnId: turn.turnId,
      status: normalizeText(turn.status) || null,
      finishReason: normalizeText(turn.finishReason) || null,
      reasonCode: normalizeText(turn.reasonCode) || null,
      hasStructured: Boolean(turn.structured),
      hasText: Boolean(normalizeText(turn.text) || readStructuredMessageField(turn.structured, 'text')),
      eventCount: events.length,
    },
  });
  for (const event of events) {
    options.enqueue(event);
  }
  return true;
}
