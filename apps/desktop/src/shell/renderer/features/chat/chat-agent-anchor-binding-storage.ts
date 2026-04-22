export const AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY = 'nimi.chat.agent.anchor-bindings.v1';

export type AgentConversationAnchorBinding = {
  threadId: string;
  agentId: string;
  conversationAnchorId: string;
  updatedAtMs: number;
};

type AnchorBindingsRecord = Record<string, AgentConversationAnchorBinding>;

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

function getLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return globalThis.localStorage as Storage;
    }
  } catch {
    return null;
  }
  return null;
}

function loadAnchorBindingsRecord(): AnchorBindingsRecord {
  const storage = getLocalStorage();
  if (!storage) {
    return {};
  }
  try {
    const raw = storage.getItem(AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalized: AnchorBindingsRecord = {};
    for (const [threadId, value] of Object.entries(parsed)) {
      const binding = normalizeBinding(value);
      if (!binding || binding.threadId !== threadId) {
        continue;
      }
      normalized[threadId] = binding;
    }
    return normalized;
  } catch {
    return {};
  }
}

function persistAnchorBindingsRecord(record: AnchorBindingsRecord): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(
      AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY,
      JSON.stringify(record),
    );
  } catch {
    // ignore persistence failures
  }
}

export function getAgentConversationAnchorBinding(
  threadId: string | null | undefined,
): AgentConversationAnchorBinding | null {
  const normalizedThreadId = normalizeText(threadId);
  if (!normalizedThreadId) {
    return null;
  }
  return loadAnchorBindingsRecord()[normalizedThreadId] || null;
}

export function persistAgentConversationAnchorBinding(
  binding: AgentConversationAnchorBinding,
): AgentConversationAnchorBinding {
  const normalizedBinding = normalizeBinding(binding);
  if (!normalizedBinding) {
    throw new Error('agent conversation anchor binding is invalid');
  }
  const current = loadAnchorBindingsRecord();
  current[normalizedBinding.threadId] = normalizedBinding;
  persistAnchorBindingsRecord(current);
  return normalizedBinding;
}

export function clearAgentConversationAnchorBinding(
  threadId: string | null | undefined,
): void {
  const normalizedThreadId = normalizeText(threadId);
  if (!normalizedThreadId) {
    return;
  }
  const current = loadAnchorBindingsRecord();
  if (!(normalizedThreadId in current)) {
    return;
  }
  delete current[normalizedThreadId];
  persistAnchorBindingsRecord(current);
}
