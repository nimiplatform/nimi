import assert from 'node:assert/strict';
import test from 'node:test';
import { streamChatAgentRuntimeAgentTurn } from '../src/shell/renderer/features/chat/chat-agent-runtime-agent.js';

test('busy before chat admission cancels only the local subscription', async () => {
  let closes = 0;
  let interrupts = 0;
  const conversation = {
    subscribe: async () => ({ async *[Symbol.asyncIterator]() {}, cancel: async () => { closes++; } }),
    send: async () => { throw Object.assign(new Error('busy'), { reasonCode: 'AGENT_BUSY' }); },
    interruptTurn: async () => { interrupts++; },
  };
  const { stream } = await streamChatAgentRuntimeAgentTurn({ agentHandle: 'agent', conversationAnchorId: 'anchor', userText: 'Preserve my message' } as never, { conversation: () => conversation } as never);
  await assert.rejects(async () => { for await (const part of stream) { void part; assert.fail('busy input was not admitted'); } }, { reasonCode: 'AGENT_BUSY' });
  assert.equal(closes, 1);
  assert.equal(interrupts, 0);
});

test('chat abort targets only the turn returned by this send', async () => {
  const abort = new AbortController();
  const cancellations: unknown[] = [];
  const conversation = {
    subscribe: async () => ({ async *[Symbol.asyncIterator]() {
      yield { type: 'turn-interrupted', conversationAnchorId: 'anchor', turnId: 'my-turn', sequence: '1', reason: 'canceled' };
    }, cancel: async () => undefined }),
    send: async () => { abort.abort(); return { turnId: 'my-turn' }; },
    interruptTurn: async (input: unknown) => { cancellations.push(input); },
  };
  const { stream } = await streamChatAgentRuntimeAgentTurn({ agentHandle: 'agent', conversationAnchorId: 'anchor', userText: 'My message', signal: abort.signal } as never, { conversation: () => conversation } as never);
  for await (const part of stream) { void part; /* consume the own terminal event */ }
  assert.deepEqual(cancellations, [{ agentHandle: 'agent', conversationAnchorId: 'anchor', expectedTurnId: 'my-turn' }]);
});
