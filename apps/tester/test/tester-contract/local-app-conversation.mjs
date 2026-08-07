import assert from 'node:assert/strict';
import test from 'node:test';
import { importBehaviorModule } from './helpers.mjs';

const snapshot = {
  conversationAnchorId: 'anchor-1',
  activeTurnId: null,
  messages: [],
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
  const { runTesterConversationJourney } = await importBehaviorModule('tester/local-app-conversation-journey.js');
  const calls = [];
  const handle = 'agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const result = await runTesterConversationJourney({
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
            yield event('turn-accepted', { requestId: 'request-1' });
            yield event('message-committed', { sequence: '4', messageId: 'message-1', text: 'terminal reply' });
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
  for (const [, input] of calls.slice(0, 4)) assert.equal(input.agentHandle, handle);
  assert.equal(JSON.stringify(calls).includes('localAgentId'), false);
  assert.equal(JSON.stringify(calls).includes('attachments'), false);
});

test('typed interrupt journey waits for acceptance and observes the owner terminal event', async () => {
  const { runTesterConversationInterruptJourney } = await importBehaviorModule('tester/local-app-conversation-journey.js');
  const calls = [];
  const handle = 'agent_ref_IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII';
  const result = await runTesterConversationInterruptJourney({
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
            yield event('turn-accepted', { requestId: 'request-interrupt' });
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
  const { runTesterConversationInterruptJourney } = await importBehaviorModule('tester/local-app-conversation-journey.js');
  let cancelled = 0;
  await assert.rejects(() => runTesterConversationInterruptJourney({
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
            yield event('turn-accepted', { requestId: 'request-mismatch' });
          },
          async cancel() { cancelled += 1; },
        };
      },
      async snapshot() { return snapshot; },
    },
  }), (error) => error.reasonCode === 'tester-conversation-interrupt-turn-mismatch');
  assert.equal(cancelled, 1);
});

test('journey cancels subscription when a later operation returns typed denial', async () => {
  const { runTesterConversationJourney } = await importBehaviorModule('tester/local-app-conversation-journey.js');
  let cancelled = 0;
  const denied = Object.assign(new Error('App operation unavailable'), { reasonCode: 'local-app-operation-unavailable' });
  await assert.rejects(() => runTesterConversationJourney({
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
  const { runTesterConversationJourney } = await importBehaviorModule('tester/local-app-conversation-journey.js');
  let cancelled = 0;
  await assert.rejects(() => runTesterConversationJourney({
    agentHandle: 'agent_ref_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    requestId: 'request-3',
    text: 'hello',
    conversation: {
      async open() { return { conversationAnchorId: 'anchor-1' }; },
      async subscribe() {
        return {
          async *[Symbol.asyncIterator]() {
            yield event('turn-accepted', { requestId: 'request-3' });
          },
          async cancel() { cancelled += 1; },
        };
      },
      async send() { return { turnId: 'turn-1' }; },
      async snapshot() { return snapshot; },
    },
  }), (error) => error.reasonCode === 'tester-conversation-terminal-missing');
  assert.equal(cancelled, 1);
});

test('journey preserves owner-specific terminal failure fields', async () => {
  const { runTesterConversationJourney } = await importBehaviorModule('tester/local-app-conversation-journey.js');
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
    await assert.rejects(() => runTesterConversationJourney({
      agentHandle: 'agent_ref_DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
      requestId: 'request-terminal-detail',
      text: 'hello',
      conversation: {
        async open() { return { conversationAnchorId: 'anchor-1' }; },
        async subscribe() {
          return {
            async *[Symbol.asyncIterator]() {
              yield event('turn-accepted', { requestId: 'request-terminal-detail' });
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
