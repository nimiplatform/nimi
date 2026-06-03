import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRuntimeAgentEventQueue,
  createRuntimeAgentTurnStream,
} from '../../src/runtime/runtime-agent-turn-runner-stream.js';
import type {
  RuntimeAgentConsumeEvent,
  RuntimeAgentTurnRequest,
} from '../../src/runtime/types-runtime-agent.js';
import type { RuntimeAgentTurnRunnerPart } from '../../src/runtime/runtime-agent-turn-runner-types.js';

async function collectParts(stream: AsyncIterable<RuntimeAgentTurnRunnerPart>): Promise<RuntimeAgentTurnRunnerPart[]> {
  const parts: RuntimeAgentTurnRunnerPart[] = [];
  for await (const part of stream) {
    parts.push(part);
  }
  return parts;
}

function createRequest(): RuntimeAgentTurnRequest {
  return {
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    conversationAnchorId: 'anchor-1',
    threadId: 'thread-1',
    requestId: 'request-1',
    messages: [
      {
        role: 'user',
        content: 'hello',
      },
    ],
  };
}

test('runtime agent turn stream retries terminal snapshot recovery after subscription done', async () => {
  async function* completedSubscription(): AsyncIterable<RuntimeAgentConsumeEvent> {}

  let cleanupCalled = false;
  let snapshotCalls = 0;
  const logs: string[] = [];
  const eventQueue = createRuntimeAgentEventQueue(completedSubscription());
  const stream = createRuntimeAgentTurnStream({
    acceptedRequestIds: new Set(['request-1']),
    cleanupSubscription: () => {
      cleanupCalled = true;
    },
    connectorId: undefined,
    eventQueue,
    logEvent: (event) => {
      logs.push(`${event.message}:${String(event.details.reason || '')}`);
    },
    modelId: 'runtime-owned',
    nowMs: () => Date.parse('2026-05-17T04:16:50.000Z'),
    async querySnapshot() {
      snapshotCalls += 1;
      if (snapshotCalls === 1) {
        return {};
      }
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
            actions: [],
          },
          finishReason: 'stop',
        },
      };
    },
    request: createRequest(),
    requestId: 'request-1',
    requestMessageId: '',
    route: 'runtime-owned',
    runtimeTurnRef: { turnId: '', streamId: '' },
  });

  const parts = await collectParts(stream);

  assert.equal(snapshotCalls, 2);
  assert.equal(cleanupCalled, true);
  assert.deepEqual(parts.map((part) => part.type), [
    'message-sealed',
    'turn-completed',
  ]);
  assert.equal(parts[1]?.type, 'turn-completed');
  if (parts[1]?.type === 'turn-completed') {
    assert.equal(parts[1].outputText, 'done');
    assert.equal(parts[1].finishReason, 'stop');
  }
  assert.equal(logs.includes('action:runtime-agent-turn:snapshot-recovered:subscription_done_retry'), true);
});
