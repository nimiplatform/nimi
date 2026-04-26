export const AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY = 'nimi.chat.agent.anchor-bindings.v1';

export type AgentConversationAnchorBinding = {
  threadId: string;
  agentId: string;
  conversationAnchorId: string;
  updatedAtMs: number;
};

const anchorBindingsByThreadId = new Map<string, AgentConversationAnchorBinding>();
let storageSnapshot = '';

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

function readBrowserStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage;
    return storage && typeof storage.getItem === 'function' ? storage : null;
  } catch {
    return null;
  }
}

function serializeBindings(): string {
  return JSON.stringify([...anchorBindingsByThreadId.values()]);
}

function hydrateBindingsFromStorage(): void {
  const storage = readBrowserStorage();
  if (!storage) {
    return;
  }
  let raw: string;
  try {
    raw = storage.getItem(AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY) || '';
  } catch {
    return;
  }
  if (raw === storageSnapshot) {
    return;
  }
  storageSnapshot = raw;
  anchorBindingsByThreadId.clear();
  if (!raw) {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) {
    return;
  }
  for (const entry of parsed) {
    const binding = normalizeBinding(entry);
    if (binding) {
      anchorBindingsByThreadId.set(binding.threadId, binding);
    }
  }
}

function persistBindingsToStorage(): void {
  const storage = readBrowserStorage();
  if (!storage) {
    return;
  }
  const serialized = serializeBindings();
  try {
    if (anchorBindingsByThreadId.size === 0) {
      storage.removeItem(AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY);
      storageSnapshot = '';
      return;
    }
    storage.setItem(AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY, serialized);
    storageSnapshot = serialized;
  } catch {
    // Persistence is a reload hint only; Runtime snapshot validation remains authoritative.
  }
}

export function getAgentConversationAnchorBinding(
  threadId: string | null | undefined,
): AgentConversationAnchorBinding | null {
  const normalizedThreadId = normalizeText(threadId);
  if (!normalizedThreadId) {
    return null;
  }
  hydrateBindingsFromStorage();
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
  persistBindingsToStorage();
  return normalizedBinding;
}

export function clearAgentConversationAnchorBinding(
  threadId: string | null | undefined,
): void {
  const normalizedThreadId = normalizeText(threadId);
  if (!normalizedThreadId) {
    return;
  }
  hydrateBindingsFromStorage();
  anchorBindingsByThreadId.delete(normalizedThreadId);
  persistBindingsToStorage();
}
