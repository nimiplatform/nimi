export const AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY = 'nimi.chat.agent.anchor-bindings.v1';

export type AgentConversationAnchorBinding = {
  threadId: string;
  agentId: string;
  conversationAnchorId: string;
  updatedAtMs: number;
};

const anchorBindingsByThreadId = new Map<string, AgentConversationAnchorBinding>();

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeUpdatedAtMs(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0
    ? Math.floor(numeric)
    : Date.now();
}

function normalizeBinding(
  value: unknown,
): AgentConversationAnchorBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const threadId = normalizeText(record.threadId);
  const agentId = normalizeText(record.agentId);
  const conversationAnchorId = normalizeText(record.conversationAnchorId);
  if (!threadId || !agentId || !conversationAnchorId) {
    return null;
  }
  return {
    threadId,
    agentId,
    conversationAnchorId,
    updatedAtMs: normalizeUpdatedAtMs(record.updatedAtMs),
  };
}

export function getAgentConversationAnchorBinding(
  threadId: string | null | undefined,
): AgentConversationAnchorBinding | null {
  const normalizedThreadId = normalizeText(threadId);
  if (!normalizedThreadId) {
    return null;
  }
  return anchorBindingsByThreadId.get(normalizedThreadId) || null;
}

export function persistAgentConversationAnchorBinding(
  binding: AgentConversationAnchorBinding,
): AgentConversationAnchorBinding {
  const normalizedBinding = normalizeBinding(binding);
  if (!normalizedBinding) {
    throw new Error('agent conversation anchor binding is invalid');
  }
  anchorBindingsByThreadId.set(normalizedBinding.threadId, normalizedBinding);
  return normalizedBinding;
}

export function clearAgentConversationAnchorBinding(
  threadId: string | null | undefined,
): void {
  const normalizedThreadId = normalizeText(threadId);
  if (!normalizedThreadId) {
    return;
  }
  anchorBindingsByThreadId.delete(normalizedThreadId);
}
