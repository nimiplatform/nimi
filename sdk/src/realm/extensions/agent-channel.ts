import type { JsonObject } from '../../internal/utils.js';
import type { Realm } from '../client.js';

export type SendAgentChannelMessageInput = {
  agentId: string;
  text: string;
};

export type SendAgentChannelMessageOutput = JsonObject;

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
  return realm.raw.request<SendAgentChannelMessageOutput>({
    method: 'POST',
    path: '/api/messages',
    body: {
      agentId,
      text,
    },
  });
}
