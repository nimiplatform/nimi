import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runRuntimeAgentTurn,
  type RuntimeAgentConsumeEvent,
  type RuntimeAgentTurnsModule,
} from '../src/runtime/index.js';

function createRuntimeAgentTurns(eventsForRequest: (requestIds: string[]) => AsyncIterable<RuntimeAgentConsumeEvent>): {
  turns: RuntimeAgentTurnsModule;
  requestIds: string[];
  snapshotQueries: number;
} {
  const requestIds: string[] = [];
  let snapshotQueries = 0;
  return {
    requestIds,
    get snapshotQueries() {
      return snapshotQueries;
    },
    turns: {
      async subscribe() {
        return eventsForRequest(requestIds);
      },
      async request(request) {
        requestIds.push(request.requestId || '');
        return { messageId: 'runtime-request-message', accepted: true, reasonCode: 0 as never };
      },
      async interrupt() {
        return { messageId: 'runtime-interrupt-message', accepted: true, reasonCode: 0 as never };
      },
      async getSessionSnapshot() {
        snapshotQueries += 1;
        return {};
      },
    },
  };
}

function createRequest() {
  return {
    ownerUserId: 'owner-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:owner-1:agent-1',
    conversationAnchorId: 'anchor-1',
    threadId: 'thread-1',
    requestId: 'runtime-agent-turn-request-test',
    messages: [{
      role: 'user' as const,
      content: 'hello runtime agent',
    }],
  };
}

test('Runtime Agent turn runner ignores backlog turns and seals the current committed message', async () => {
  const harness = createRuntimeAgentTurns((requestIds) => (async function* stream() {
    yield {
      eventName: 'runtime.agent.turn.accepted',
      localAgentRef: 'local-agent:owner-1:agent-1',
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-old',
      streamId: 'stream-old',
      detail: { requestId: 'request-old' },
    } as RuntimeAgentConsumeEvent;
    yield {
      eventName: 'runtime.agent.turn.text_delta',
      localAgentRef: 'local-agent:owner-1:agent-1',
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-old',
      streamId: 'stream-old',
      detail: { text: 'old backlog' },
    } as RuntimeAgentConsumeEvent;
    while (!requestIds[0]) {
      await Promise.resolve();
    }
    yield {
      eventName: 'runtime.agent.turn.accepted',
      localAgentRef: 'local-agent:owner-1:agent-1',
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-new',
      streamId: 'stream-new',
      detail: { requestId: requestIds[0] },
    } as RuntimeAgentConsumeEvent;
    yield {
      eventName: 'runtime.agent.turn.structured',
      localAgentRef: 'local-agent:owner-1:agent-1',
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-new',
      streamId: 'stream-new',
      detail: {
        kind: 'agent_resolved_message_action_envelope',
        payload: {
          message: {
            message_id: 'assistant-1',
            text: 'hello from runtime',
          },
          actions: [],
        },
      },
    } as RuntimeAgentConsumeEvent;
    yield {
      eventName: 'runtime.agent.turn.message_committed',
      localAgentRef: 'local-agent:owner-1:agent-1',
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-new',
      streamId: 'stream-new',
      messageId: 'assistant-1',
      detail: {
        messageId: 'assistant-1',
        text: 'hello from runtime',
      },
    } as RuntimeAgentConsumeEvent;
    yield {
      eventName: 'runtime.agent.turn.completed',
      localAgentRef: 'local-agent:owner-1:agent-1',
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-new',
      streamId: 'stream-new',
      detail: { terminalReason: 'stop' },
    } as RuntimeAgentConsumeEvent;
  })());

  const result = await runRuntimeAgentTurn({
    turns: harness.turns,
    request: createRequest(),
  });
  const parts = [];
  for await (const part of result.stream) {
    parts.push(part);
  }

  assert.deepEqual(parts.map((part) => part.type), ['message-sealed', 'turn-completed']);
  assert.equal(parts[0]?.type === 'message-sealed' ? parts[0].envelope.message.messageId : '', 'assistant-1');
  assert.equal(parts[1]?.type === 'turn-completed' ? parts[1].outputText : '', 'hello from runtime');
  assert.equal(parts.some((part) => part.type === 'text-delta' && part.textDelta === 'old backlog'), false);
  assert.equal(harness.snapshotQueries, 0);
});

test('Runtime Agent turn runner fails closed when completed arrives without committed structured output', async () => {
  const harness = createRuntimeAgentTurns((requestIds) => (async function* stream() {
    while (!requestIds[0]) {
      await Promise.resolve();
    }
    yield {
      eventName: 'runtime.agent.turn.accepted',
      localAgentRef: 'local-agent:owner-1:agent-1',
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-missing-structured',
      streamId: 'stream-missing-structured',
      detail: { requestId: requestIds[0] },
    } as RuntimeAgentConsumeEvent;
    yield {
      eventName: 'runtime.agent.turn.completed',
      localAgentRef: 'local-agent:owner-1:agent-1',
      conversationAnchorId: 'anchor-1',
      turnId: 'turn-missing-structured',
      streamId: 'stream-missing-structured',
      detail: { terminalReason: 'stop' },
    } as RuntimeAgentConsumeEvent;
  })());

  const result = await runRuntimeAgentTurn({
    turns: harness.turns,
    request: createRequest(),
  });
  const parts = [];
  for await (const part of result.stream) {
    parts.push(part);
  }

  assert.deepEqual(parts.map((part) => part.type), ['turn-failed']);
  assert.equal(parts[0]?.type === 'turn-failed' ? parts[0].error.code : '', 'RUNTIME_AGENT_TURNS_INVALID');
  assert.equal(parts[0]?.type === 'turn-failed' ? parts[0].diagnostics?.missingStructuredProjection : undefined, true);
});
