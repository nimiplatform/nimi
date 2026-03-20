import type { RealmModel } from '../generated/type-helpers.js';
import type { Realm } from '../client.js';
import { createNimiError } from '../../runtime/errors.js';
import { normalizeText } from '../../internal/utils.js';
import { ReasonCode } from '../../types/index.js';

export type SendAgentChannelMessageInput = {
  agentId: string;
  text: string;
};

export type SendAgentChannelMessageOutput = RealmModel<'MessageViewDto'>;

export async function sendAgentChannelMessage(
  realm: Realm,
  input: SendAgentChannelMessageInput,
): Promise<SendAgentChannelMessageOutput> {
  const agentId = normalizeText(input.agentId);
  const text = normalizeText(input.text);
  if (!agentId) {
    throw createNimiError({
      message: 'agent channel message requires agentId',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_agent_id',
      source: 'sdk',
    });
  }
  if (!text) {
    throw createNimiError({
      message: 'agent channel message requires text',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_message_text',
      source: 'sdk',
    });
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
