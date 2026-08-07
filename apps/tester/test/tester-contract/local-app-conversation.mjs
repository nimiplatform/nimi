import assert from 'node:assert/strict';
import test from 'node:test';
import { importBehaviorModule } from './helpers.mjs';

test('agents.interact journey uses one current Agent handle as the operation target and cancels', async () => {
  const { runTesterConversationJourney } = await importBehaviorModule('tester/local-app-conversation-journey.js');
  const calls = [];
  const handle = 'opaque-current-agent';
  const result = await runTesterConversationJourney({
    agentHandle: handle,
    requestId: 'request-1',
    text: 'hello',
    conversation: {
      async open(input) { calls.push(['open', input]); return { conversationAnchorId: 'anchor-1' }; },
      async send(input) { calls.push(['send', input]); return { messageId: 'message-1' }; },
      async subscribe(input) {
        calls.push(['subscribe', input]);
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              messageType: 'runtime.agent.turn.accepted',
              reasonCode: '',
              payload: {
                turn_id: 'turn-1',
                detail: { request_id: 'request-1' },
              },
            };
            yield {
              messageType: 'runtime.agent.turn.message_committed',
              reasonCode: '',
              payload: {
                turn_id: 'turn-1',
                detail: { text: 'terminal reply' },
              },
            };
            yield {
              messageType: 'runtime.agent.turn.completed',
              reasonCode: '',
              payload: {
                turn_id: 'turn-1',
                detail: { terminal_reason: 'stop' },
              },
            };
          },
          async cancel() { calls.push(['cancel']); },
        };
      },
      async snapshot(input) { calls.push(['snapshot', input]); return { messages: [] }; },
    },
  });
  assert.deepEqual(result, {
    conversationAnchorId: 'anchor-1',
    messageId: 'message-1',
    subscribed: true,
    terminalMessageType: 'runtime.agent.turn.completed',
    terminalReason: 'stop',
    assistantText: 'terminal reply',
    snapshot: { messages: [] },
  });
  assert.deepEqual(calls.map(([operation]) => operation), ['open', 'subscribe', 'send', 'snapshot', 'cancel']);
  assert.deepEqual(calls[0], ['open', { agentHandle: handle }]);
  for (const [, input] of calls.slice(0, 4)) assert.equal(input.agentHandle, handle);
  assert.equal(JSON.stringify(calls).includes('localAgentId'), false);
});

test('journey cancels subscription when a later operation returns typed denial', async () => {
  const { runTesterConversationJourney } = await importBehaviorModule('tester/local-app-conversation-journey.js');
  let cancelled = 0;
  const denied = Object.assign(new Error('App operation unavailable'), { reasonCode: 'local-app-operation-unavailable' });
  await assert.rejects(() => runTesterConversationJourney({
    agentHandle: 'opaque-revoked-handle',
    requestId: 'request-2',
    text: 'hello',
    conversation: {
      async open() { return { conversationAnchorId: 'anchor-2' }; },
      async subscribe() { return { async *[Symbol.asyncIterator]() {}, async cancel() { cancelled += 1; } }; },
      async send() { throw denied; },
      async snapshot() { return {}; },
    },
  }), (error) => error.reasonCode === 'local-app-operation-unavailable');
  assert.equal(cancelled, 1);
});

test('journey fails closed when the matching turn stream ends without terminal evidence', async () => {
  const { runTesterConversationJourney } = await importBehaviorModule('tester/local-app-conversation-journey.js');
  let cancelled = 0;
  await assert.rejects(() => runTesterConversationJourney({
    agentHandle: 'opaque-current-agent',
    requestId: 'request-3',
    text: 'hello',
    conversation: {
      async open() { return { conversationAnchorId: 'anchor-3' }; },
      async subscribe() {
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              messageType: 'runtime.agent.turn.accepted',
              reasonCode: '',
              payload: {
                turnId: 'turn-3',
                detail: { requestId: 'request-3' },
              },
            };
          },
          async cancel() { cancelled += 1; },
        };
      },
      async send() { return { messageId: 'message-3' }; },
      async snapshot() { return { messages: [] }; },
    },
  }), (error) => error.reasonCode === 'tester-conversation-terminal-missing');
  assert.equal(cancelled, 1);
});

test('journey preserves the Runtime-owned terminal failure detail over the generic event envelope reason', async () => {
  const { runTesterConversationJourney } = await importBehaviorModule('tester/local-app-conversation-journey.js');
  const terminalCases = [
    {
      messageType: 'runtime.agent.turn.failed',
      detail: { reason_code: 'AI_OUTPUT_INVALID', message: 'structured output invalid' },
      expectedReasonCode: 'AI_OUTPUT_INVALID',
      expectedMessage: 'structured output invalid',
    },
    {
      messageType: 'runtime.agent.turn.interrupted',
      detail: { reason: 'timeout' },
      expectedReasonCode: 'timeout',
      expectedMessage: 'Runtime Agent turn was interrupted before completion.',
    },
  ];
  for (const terminal of terminalCases) {
    await assert.rejects(() => runTesterConversationJourney({
      agentHandle: 'opaque-current-agent',
      requestId: 'request-terminal-detail',
      text: 'hello',
      conversation: {
        async open() { return { conversationAnchorId: 'anchor-terminal-detail' }; },
        async subscribe() {
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                messageType: 'runtime.agent.turn.accepted',
                reasonCode: 'action-executed',
                payload: {
                  turn_id: 'turn-terminal-detail',
                  detail: { request_id: 'request-terminal-detail' },
                },
              };
              yield {
                messageType: terminal.messageType,
                reasonCode: 'action-executed',
                payload: {
                  turn_id: 'turn-terminal-detail',
                  detail: terminal.detail,
                },
              };
            },
            async cancel() {},
          };
        },
        async send() { return { messageId: 'message-terminal-detail' }; },
        async snapshot() { return {}; },
      },
    }), (error) => (
      error.reasonCode === terminal.expectedReasonCode
      && error.message === terminal.expectedMessage
    ));
  }
});
