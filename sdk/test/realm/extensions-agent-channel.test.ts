import assert from 'node:assert/strict';
import test from 'node:test';

import type { Realm } from '../../src/realm/client.js';
import { sendAgentChannelMessage } from '../../src/realm/extensions/agent-channel.js';
import { ReasonCode } from '../../src/types/index.js';

function createRealmMock(overrides?: {
  startChat?: (input: { targetAccountId: string }) => Promise<{ chatId: string }>;
  sendMessage?: (
    chatId: string,
    input: { clientMessageId: string; type: string; text: string },
  ) => Promise<{ id: string; text: string }>;
}): Realm {
  return {
    services: {
      HumanChatService: {
        startChat: overrides?.startChat ?? (async () => ({ chatId: 'chat-1' })),
        sendMessage: overrides?.sendMessage ?? (async (_chatId: string, input: { text: string }) => ({ id: 'msg-1', text: input.text })),
      },
    },
  } as unknown as Realm;
}

test('sendAgentChannelMessage throws when agentId is empty', async () => {
  await assert.rejects(
    () => sendAgentChannelMessage(createRealmMock(), { agentId: '', text: 'hello' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      assert.equal((error as { actionHint?: string }).actionHint, 'provide_agent_id');
      return true;
    },
  );
});

test('sendAgentChannelMessage throws when text is empty', async () => {
  await assert.rejects(
    () => sendAgentChannelMessage(createRealmMock(), { agentId: 'agent-1', text: '' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      assert.equal((error as { actionHint?: string }).actionHint, 'provide_message_text');
      return true;
    },
  );
});

test('sendAgentChannelMessage chains startChat then sendMessage', async () => {
  let capturedTarget = '';
  let capturedChatId = '';

  const result = await sendAgentChannelMessage(createRealmMock({
    startChat: async (input) => {
      capturedTarget = input.targetAccountId;
      return { chatId: 'chat-abc' };
    },
    sendMessage: async (chatId, input) => {
      capturedChatId = chatId;
      return { id: 'msg-1', text: input.text };
    },
  }), { agentId: 'agent-1', text: 'hello' });

  assert.equal(capturedTarget, 'agent-1');
  assert.equal(capturedChatId, 'chat-abc');
  assert.ok(result);
  assert.equal((result as { id: string }).id, 'msg-1');
});
