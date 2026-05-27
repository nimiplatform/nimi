import test from 'node:test';
import assert from 'node:assert/strict';

import type { RuntimeAgentConsumeEvent } from '@nimiplatform/sdk/runtime';
import {
  recoverRuntimeAgentTerminalSnapshot,
} from '../src/shell/renderer/features/chat/chat-agent-runtime-agent-stream';
import type { AgentRuntimeChatTurnRequest } from '../src/shell/renderer/features/chat/chat-agent-runtime-turn-types';

function createRequest(): AgentRuntimeChatTurnRequest {
  return {
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    conversationAnchorId: 'anchor-1',
    threadId: 'thread-1',
    textExecutionSnapshot: null,
    userMessageId: 'message-1',
    userText: 'Hello from Desktop',
    reasoningPreference: 'off',
  };
}

test('runtime agent snapshot recovery admits terminal lastTurn when accepted event was missed after request start', async () => {
  const enqueued: RuntimeAgentConsumeEvent[] = [];
  const logs: Array<Record<string, unknown>> = [];
  const result = await recoverRuntimeAgentTerminalSnapshot({
    reason: 'subscription_terminal_stall',
    request: createRequest(),
    requestId: 'request-1',
    requestMessageId: '',
    requestStartedAtMs: Date.parse('2026-05-17T04:16:50.000Z'),
    currentTurnAccepted: false,
    currentRuntimeTurnId: '',
    currentRuntimeStreamId: '',
    hasStructuredEnvelope: false,
    hasCommittedMessage: false,
    async querySnapshot() {
      return {
        lastTurn: {
          turnId: 'turn-1',
          status: 'completed',
          updatedAt: '2026-05-17T04:16:54.000Z',
          messageId: 'message-1',
          text: 'done',
          structured: {
            message: {
              message_id: 'message-1',
              text: 'done',
            },
          },
          finishReason: 'stop',
        },
      };
    },
    enqueue(event) {
      enqueued.push(event);
    },
    logEvent(event) {
      logs.push(event);
    },
  });

  assert.equal(result, 'terminal');
  assert.deepEqual(enqueued.map((event) => event.eventName), [
    'runtime.agent.turn.accepted',
    'runtime.agent.turn.structured',
    'runtime.agent.turn.message_committed',
    'runtime.agent.turn.completed',
  ]);
  assert.equal((enqueued[0] as { turnId?: string } | undefined)?.turnId, 'turn-1');
  assert.equal((enqueued[0] as { streamId?: string } | undefined)?.streamId, 'snapshot:turn-1');
  assert.equal(logs[0]?.details && (logs[0].details as Record<string, unknown>).recoveredWithoutAcceptedEvent, true);
});

test('runtime agent snapshot recovery rejects stale terminal lastTurn from before current request', async () => {
  const enqueued: RuntimeAgentConsumeEvent[] = [];
  const result = await recoverRuntimeAgentTerminalSnapshot({
    reason: 'subscription_terminal_stall',
    request: createRequest(),
    requestId: 'request-2',
    requestMessageId: '',
    requestStartedAtMs: Date.parse('2026-05-17T04:16:50.000Z'),
    currentTurnAccepted: false,
    currentRuntimeTurnId: '',
    currentRuntimeStreamId: '',
    hasStructuredEnvelope: false,
    hasCommittedMessage: false,
    async querySnapshot() {
      return {
        lastTurn: {
          turnId: 'turn-old',
          status: 'completed',
          updatedAt: '2026-05-17T04:16:40.000Z',
          messageId: 'message-old',
          text: 'old',
          structured: {
            message: {
              message_id: 'message-old',
              text: 'old',
            },
          },
          finishReason: 'stop',
        },
      };
    },
    enqueue(event) {
      enqueued.push(event);
    },
    logEvent() {},
  });

  assert.equal(result, 'none');
  assert.equal(enqueued.length, 0);
});
