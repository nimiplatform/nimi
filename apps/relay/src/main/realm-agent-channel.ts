import type { Realm } from '@nimiplatform/sdk/realm';

export type SendAgentChannelMessageInput = {
  agentId: string;
  text: string;
};

export type SendAgentChannelMessageOutput = Record<string, unknown>;

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

// Explicit spec-gap adapter for relay only. This stays local until the backend contract lands in OpenAPI.
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

  const payload = await realm.raw.request<SendAgentChannelMessageOutput>({
    method: 'POST',
    path: '/api/messages',
    body: {
      agentId,
      text,
    },
  });

  return payload;
}
