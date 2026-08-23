import assert from 'node:assert/strict';
import test from 'node:test';
import { importBehaviorModule } from './helpers.mjs';

const snapshot = {
  conversationAnchorId: 'anchor-1',
  throughSequence: '3',
  turns: [],
  messages: [],
  actions: [],
  voices: [],
  truncatedBefore: false,
};

function event(type, fields = {}) {
  return {
    type,
    conversationAnchorId: 'anchor-1',
    sequence: '1',
    turnId: 'turn-1',
    ...fields,
  };
}

test('agent.local journey uses one listed session handle and cancels', async () => {
  const { runLabConversationJourney } = await importBehaviorModule('lab/local-app-conversation-journey.js');
  const calls = [];
  const handle = 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const result = await runLabConversationJourney({
    agentHandle: handle,
    requestId: 'request-1',
    text: 'hello',
    conversation: {
      async open(input) { calls.push(['open', input]); return { conversationAnchorId: 'anchor-1' }; },
      async send(input) { calls.push(['send', input]); return { turnId: 'turn-1' }; },
      async subscribe(input) {
        calls.push(['subscribe', input]);
        return {
          async *[Symbol.asyncIterator]() {
            yield event('turn-accepted');
            yield event('message-committed', {
              sequence: '4',
              message: {
                messageId: 'message-1', turnId: 'turn-1', role: 'assistant',
                parts: [{ kind: 'text', text: 'terminal reply' }],
              },
            });
            yield event('turn-completed', { sequence: '6', terminalReason: 'stop' });
          },
          async cancel() { calls.push(['cancel']); },
        };
      },
      async snapshot(input) { calls.push(['snapshot', input]); return snapshot; },
    },
  });
  assert.deepEqual(result, {
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    subscribed: true,
    terminalType: 'turn-completed',
    terminalReason: 'stop',
    assistantText: 'terminal reply',
    snapshot,
  });
  assert.deepEqual(calls.map(([operation]) => operation), ['open', 'subscribe', 'send', 'snapshot', 'cancel']);
  assert.deepEqual(calls[0], ['open', { agentHandle: handle }]);
  assert.deepEqual(calls.find(([operation]) => operation === 'send')[1].parts, [{ kind: 'text', text: 'hello' }]);
  for (const [, input] of calls.slice(0, 4)) assert.equal(input.agentHandle, handle);
  assert.equal(JSON.stringify(calls).includes('localAgentId'), false);
  assert.equal(JSON.stringify(calls).includes('attachments'), false);
});

test('typed interrupt journey waits for acceptance and observes the owner terminal event', async () => {
  const { runLabConversationInterruptJourney } = await importBehaviorModule('lab/local-app-conversation-journey.js');
  const calls = [];
  const handle = 'agent_ref_IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII';
  const result = await runLabConversationInterruptJourney({
    agentHandle: handle,
    requestId: 'request-interrupt',
    text: 'begin a long response',
    conversation: {
      async open(input) { calls.push(['open', input]); return { conversationAnchorId: 'anchor-1' }; },
      async send(input) { calls.push(['send', input]); return { turnId: 'turn-1' }; },
      async interruptTurn(input) { calls.push(['interrupt', input]); return { turnId: 'turn-1' }; },
      async subscribe(input) {
        calls.push(['subscribe', input]);
        return {
          async *[Symbol.asyncIterator]() {
            yield event('turn-accepted');
            yield event('turn-started', { sequence: '2' });
            yield event('turn-interrupted', { sequence: '3', reason: 'user_cancel' });
          },
          async cancel() { calls.push(['cancel']); },
        };
      },
      async snapshot() { return snapshot; },
    },
  });
  assert.deepEqual(result, {
    conversationAnchorId: 'anchor-1',
    turnId: 'turn-1',
    subscribed: true,
    terminalType: 'turn-interrupted',
    terminalReason: 'user_cancel',
  });
  assert.deepEqual(calls.map(([operation]) => operation), ['open', 'subscribe', 'send', 'interrupt', 'cancel']);
  assert.equal(JSON.stringify(calls).includes('localAgentId'), false);
  assert.equal(JSON.stringify(calls).includes('attachments'), false);
});

test('typed interrupt journey cancels and fails closed on a mismatched owner turn', async () => {
  const { runLabConversationInterruptJourney } = await importBehaviorModule('lab/local-app-conversation-journey.js');
  let cancelled = 0;
  await assert.rejects(() => runLabConversationInterruptJourney({
    agentHandle: 'agent_ref_MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
    requestId: 'request-mismatch',
    text: 'begin a long response',
    conversation: {
      async open() { return { conversationAnchorId: 'anchor-1' }; },
      async send() { return { turnId: 'turn-1' }; },
      async interruptTurn() { return { turnId: 'turn-foreign' }; },
      async subscribe() {
        return {
          async *[Symbol.asyncIterator]() {
            yield event('turn-accepted');
          },
          async cancel() { cancelled += 1; },
        };
      },
      async snapshot() { return snapshot; },
    },
  }), (error) => error.reasonCode === 'lab-conversation-interrupt-turn-mismatch');
  assert.equal(cancelled, 1);
});

test('journey cancels subscription when a later operation returns typed denial', async () => {
  const { runLabConversationJourney } = await importBehaviorModule('lab/local-app-conversation-journey.js');
  let cancelled = 0;
  const denied = Object.assign(new Error('App operation unavailable'), { reasonCode: 'local-app-operation-unavailable' });
  await assert.rejects(() => runLabConversationJourney({
    agentHandle: 'agent_ref_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    requestId: 'request-2',
    text: 'hello',
    conversation: {
      async open() { return { conversationAnchorId: 'anchor-1' }; },
      async subscribe() { return { async *[Symbol.asyncIterator]() {}, async cancel() { cancelled += 1; } }; },
      async send() { throw denied; },
      async snapshot() { return snapshot; },
    },
  }), (error) => error.reasonCode === 'local-app-operation-unavailable');
  assert.equal(cancelled, 1);
});

test('journey fails closed when the matching typed stream ends without terminal evidence', async () => {
  const { runLabConversationJourney } = await importBehaviorModule('lab/local-app-conversation-journey.js');
  let cancelled = 0;
  await assert.rejects(() => runLabConversationJourney({
    agentHandle: 'agent_ref_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    requestId: 'request-3',
    text: 'hello',
    conversation: {
      async open() { return { conversationAnchorId: 'anchor-1' }; },
      async subscribe() {
        return {
          async *[Symbol.asyncIterator]() {
            yield event('turn-accepted');
          },
          async cancel() { cancelled += 1; },
        };
      },
      async send() { return { turnId: 'turn-1' }; },
      async snapshot() { return snapshot; },
    },
  }), (error) => error.reasonCode === 'lab-conversation-terminal-missing');
  assert.equal(cancelled, 1);
});

test('journey preserves owner-specific terminal failure fields', async () => {
  const { runLabConversationJourney } = await importBehaviorModule('lab/local-app-conversation-journey.js');
  const terminalCases = [
    {
      terminal: event('turn-failed', { reasonCode: 'AI_OUTPUT_INVALID', message: 'structured output invalid' }),
      expectedReasonCode: 'AI_OUTPUT_INVALID',
      expectedMessage: 'structured output invalid',
    },
    {
      terminal: event('turn-interrupted', { reason: 'timeout' }),
      expectedReasonCode: 'timeout',
      expectedMessage: 'Runtime Agent turn was interrupted before completion.',
    },
  ];
  for (const terminal of terminalCases) {
    await assert.rejects(() => runLabConversationJourney({
      agentHandle: 'agent_ref_DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
      requestId: 'request-terminal-detail',
      text: 'hello',
      conversation: {
        async open() { return { conversationAnchorId: 'anchor-1' }; },
        async subscribe() {
          return {
            async *[Symbol.asyncIterator]() {
              yield event('turn-accepted');
              yield terminal.terminal;
            },
            async cancel() {},
          };
        },
        async send() { return { turnId: 'turn-1' }; },
        async snapshot() { return snapshot; },
      },
    }), (error) => (
      error.reasonCode === terminal.expectedReasonCode
      && error.message === terminal.expectedMessage
    ));
  }
});
