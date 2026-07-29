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
          async *[Symbol.asyncIterator]() {},
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
    snapshot: { messages: [] },
  });
  assert.deepEqual(calls.map(([operation]) => operation), ['open', 'subscribe', 'send', 'snapshot', 'cancel']);
  for (const [, input] of calls.slice(0, 4)) assert.equal(input.agentHandle, handle);
  assert.equal(JSON.stringify(calls).includes('localAgentId'), false);
});

test('journey cancels subscription when a later operation returns typed denial', async () => {
  const { runTesterConversationJourney } = await importBehaviorModule('tester/local-app-conversation-journey.js');
  let cancelled = 0;
  const denied = Object.assign(new Error('permission revoked'), { reasonCode: 'local-app-permission-revoked' });
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
  }), (error) => error.reasonCode === 'local-app-permission-revoked');
  assert.equal(cancelled, 1);
});
