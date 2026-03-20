import type { RealmModel } from '../generated/type-helpers.js';
import type { Realm } from '../client.js';

export type SendAgentChannelMessageInput = {
  agentId: string;
  text: string;
};

export type SendAgentChannelMessageOutput = RealmModel<'MessageViewDto'>;

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

export async function sendAgentChannelMessage(
  realm: Realm,
  input: SendAgentChannelMessageInput,
): Promise<SendAgentChannelMessageOutput> {
  const agentId = normalizeText(input.agentId);
  const text = normalizeText(input.text);
  if (!agentId) {
    throw new Error('AGENT_CHANNEL_AGENT_ID_REQUIRED');
  }
  if (!text) {
    throw new Error('AGENT_CHANNEL_TEXT_REQUIRED');
  }
  const started = await realm.services.HumanChatService.startChat({
    targetAccountId: agentId,
  });
  return realm.services.HumanChatService.sendMessage(started.chatId, {
    clientMessageId: `sdk-agent-channel:${agentId}:${Date.now()}`,
    type: 'TEXT',
    text,
  });
}
