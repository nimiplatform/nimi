import assert from 'node:assert/strict';
import test from 'node:test';
import { createZhiyuConversationDelivery } from '../src-electron/zhiyu-conversation-delivery.js';

test('a conversation handoff completes only after the matching destination acknowledgement', async () => {
  let emitted = 0;
  const delivery = createZhiyuConversationDelivery(() => emitted++);
  const pending = delivery.deliver({ conversationAnchorId: 'anchor-a', text: 'Unsent' });
  const request = delivery.read()!;
  assert.equal(request.text, 'Unsent');
  delivery.acknowledge({ requestId: 'wrong', status: 'opened' });
  assert.equal(delivery.read(), request);
  delivery.acknowledge({ requestId: request.requestId, status: 'opened', extra: true });
  assert.equal(delivery.read(), request);
  delivery.acknowledge({ requestId: request.requestId, status: 'opened' });
  await pending;
  assert.equal(delivery.read(), null);
  assert.equal(emitted, 2);
});

test('supersession, closing and timeout reject undelivered work without a replay queue', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const delivery = createZhiyuConversationDelivery(() => {});
  const first = assert.rejects(delivery.deliver({ conversationAnchorId: 'a' }), /did not reach/);
  const oldRequest = delivery.read()!;
  const second = assert.rejects(delivery.deliver({ conversationAnchorId: 'b' }), /did not reach/);
  await first;
  delivery.acknowledge({ requestId: oldRequest.requestId, status: 'opened' });
  assert.equal(delivery.read()?.conversationAnchorId, 'b');
  delivery.close();
  await second;
  assert.equal(delivery.read(), null);
  const timedOut = assert.rejects(delivery.deliver({ conversationAnchorId: 'c' }), /did not reach/);
  context.mock.timers.tick(30_000);
  await timedOut;
  assert.equal(delivery.read(), null);
});
