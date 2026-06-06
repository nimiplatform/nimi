import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runNimiRuntimeAgentTurn,
  type NimiRuntimeAgentConsumeEvent,
  type NimiRuntimeAgentTurnsModule,
} from './index';

function structuredPayload(messageId: string, text: string): Record<string, unknown> {
  return {
    message: {
      message_id: messageId,
      text,
    },
    actions: [],
  };
}

test('Runtime Agent turn runner filters backlog and seals committed message', async () => {
  const requestIds: string[] = [];
  let snapshotQueryCount = 0;
  const turns: NimiRuntimeAgentTurnsModule = {
    async subscribe() {
      return (async function* stream(): AsyncIterable<NimiRuntimeAgentConsumeEvent> {
        yield {
          eventName: 'runtime.agent.turn.accepted',
          localAgentRef: 'local-agent:owner:agent',
          conversationAnchorId: 'anchor',
          turnId: 'backlog-turn',
          streamId: 'backlog-stream',
          detail: { requestId: 'backlog-request' },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.text_delta',
          localAgentRef: 'local-agent:owner:agent',
          conversationAnchorId: 'anchor',
          turnId: 'backlog-turn',
          streamId: 'backlog-stream',
          detail: { text: 'backlog' },
        } as NimiRuntimeAgentConsumeEvent;
        while (!requestIds[0]) {
          await Promise.resolve();
        }
        yield {
          eventName: 'runtime.agent.turn.accepted',
          localAgentRef: 'local-agent:owner:agent',
          conversationAnchorId: 'anchor',
          turnId: 'turn',
          streamId: 'stream',
          detail: { requestId: requestIds[0] },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.structured',
          localAgentRef: 'local-agent:owner:agent',
          conversationAnchorId: 'anchor',
          turnId: 'turn',
          streamId: 'stream',
          detail: {
            payload: structuredPayload('assistant-message', 'runner complete'),
          },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.message_committed',
          localAgentRef: 'local-agent:owner:agent',
          conversationAnchorId: 'anchor',
          turnId: 'turn',
          streamId: 'stream',
          detail: {
            messageId: 'assistant-message',
            text: 'runner complete',
          },
        } as NimiRuntimeAgentConsumeEvent;
        yield {
          eventName: 'runtime.agent.turn.completed',
          localAgentRef: 'local-agent:owner:agent',
          conversationAnchorId: 'anchor',
          turnId: 'turn',
          streamId: 'stream',
          detail: { terminalReason: 'stop' },
        } as NimiRuntimeAgentConsumeEvent;
      })();
    },
    async request(request) {
      requestIds.push(request.requestId || '');
      return { messageId: 'request-message', accepted: true, reasonCode: 0 as never };
    },
    async interrupt() {
      return { messageId: 'interrupt-message', accepted: true, reasonCode: 0 as never };
    },
    async getSessionSnapshot() {
      snapshotQueryCount += 1;
      return {};
    },
  };

  const result = await runNimiRuntimeAgentTurn({
    turns,
    request: {
      ownerUserId: 'owner',
      realmAgentId: 'agent',
      localAgentRef: 'local-agent:owner:agent',
      conversationAnchorId: 'anchor',
      threadId: 'thread',
      requestId: 'request',
      messages: [{ role: 'user', content: 'hello' }],
    },
    route: 'runtime-owned',
    modelId: 'runtime-owned',
  });

  const parts = [];
  for await (const part of result.stream) {
    parts.push(part);
  }
  assert.deepEqual(parts.map((part) => part.type), ['message-sealed', 'turn-completed']);
  assert.equal(parts.some((part) => part.type === 'text-delta' && part.textDelta === 'backlog'), false);
  assert.equal(parts.find((part) => part.type === 'message-sealed')?.envelope.message.messageId, 'assistant-message');
  assert.equal(parts.find((part) => part.type === 'turn-completed')?.outputText, 'runner complete');
  assert.equal(snapshotQueryCount, 0);
});

test('Runtime Agent turn runner recovers terminal snapshot after subscription closes', async () => {
  const turns: NimiRuntimeAgentTurnsModule = {
    async subscribe() {
      return (async function* stream(): AsyncIterable<NimiRuntimeAgentConsumeEvent> {})();
    },
    async request() {
      return { messageId: 'request-message', accepted: true, reasonCode: 0 as never };
    },
    async interrupt() {
      return { messageId: 'interrupt-message', accepted: true, reasonCode: 0 as never };
    },
    async getSessionSnapshot() {
      return {
        requestId: 'request',
        lastTurn: {
          turnId: 'turn',
          streamId: 'stream',
          status: 'completed',
          messageId: 'assistant-message',
          text: 'recovered',
          finishReason: 'stop',
          updatedAt: new Date(Date.now() + 1000).toISOString(),
          structured: structuredPayload('assistant-message', 'recovered'),
        },
      };
    },
  };

  const result = await runNimiRuntimeAgentTurn({
    turns,
    request: {
      ownerUserId: 'owner',
      realmAgentId: 'agent',
      localAgentRef: 'local-agent:owner:agent',
      conversationAnchorId: 'anchor',
      threadId: 'thread',
      requestId: 'request',
      messages: [{ role: 'user', content: 'hello' }],
    },
  });

  const parts = [];
  for await (const part of result.stream) {
    parts.push(part);
  }
  assert.deepEqual(parts.map((part) => part.type), ['message-sealed', 'turn-completed']);
  assert.equal(parts.find((part) => part.type === 'turn-completed')?.outputText, 'recovered');
});
