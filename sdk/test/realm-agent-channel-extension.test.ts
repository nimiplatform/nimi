import assert from 'node:assert/strict';
import test from 'node:test';

import type { Realm } from '../src/realm/client.js';
import { sendAgentChannelMessage } from '../src/realm/extensions/agent-channel.js';
import { ReasonCode } from '../src/types/index.js';

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
        sendMessage: overrides?.sendMessage ?? (async (_chatId, input) => ({ id: 'message-1', text: input.text })),
      },
    },
  } as unknown as Realm;
}

test('sendAgentChannelMessage rejects missing agentId with NimiError', async () => {
  await assert.rejects(
    () => sendAgentChannelMessage(createRealmMock(), { agentId: '  ', text: 'hello' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      assert.equal((error as { actionHint?: string }).actionHint, 'provide_agent_id');
      return true;
    },
  );
});

test('sendAgentChannelMessage rejects missing text with NimiError', async () => {
  await assert.rejects(
    () => sendAgentChannelMessage(createRealmMock(), { agentId: 'agent-1', text: '  ' }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, ReasonCode.ACTION_INPUT_INVALID);
      assert.equal((error as { actionHint?: string }).actionHint, 'provide_message_text');
      return true;
    },
  );
});

test('sendAgentChannelMessage propagates service failures', async () => {
  const startFailure = new Error('START_CHAT_FAILED');
  await assert.rejects(
    () => sendAgentChannelMessage(createRealmMock({
      startChat: async () => { throw startFailure; },
    }), { agentId: 'agent-1', text: 'hello' }),
    startFailure,
  );

  const sendFailure = new Error('SEND_MESSAGE_FAILED');
  await assert.rejects(
    () => sendAgentChannelMessage(createRealmMock({
      sendMessage: async () => { throw sendFailure; },
    }), { agentId: 'agent-1', text: 'hello' }),
    sendFailure,
  );
});

test('sendAgentChannelMessage starts a chat and sends the normalized text', async () => {
  let capturedChatTarget = '';
  let capturedSend: { chatId: string; clientMessageId: string; type: string; text: string } | null = null;
  const output = await sendAgentChannelMessage(createRealmMock({
    startChat: async (input) => {
      capturedChatTarget = input.targetAccountId;
      return { chatId: 'chat-42' };
    },
    sendMessage: async (chatId, input) => {
      capturedSend = {
        chatId,
        clientMessageId: input.clientMessageId,
        type: input.type,
        text: input.text,
      };
      return { id: 'message-42', text: input.text };
    },
  }), {
    agentId: '  agent-42  ',
    text: '  hello agent  ',
  });

  assert.equal(capturedChatTarget, 'agent-42');
  assert.equal(capturedSend?.chatId, 'chat-42');
  assert.match(String(capturedSend?.clientMessageId || ''), /^sdk-agent-channel:agent-42:/);
  assert.equal(capturedSend?.type, 'TEXT');
  assert.equal(capturedSend?.text, 'hello agent');
  assert.deepEqual(output, { id: 'message-42', text: 'hello agent' });
});
