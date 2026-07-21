import { projectRuntimeLocalAgentIdentity } from '@nimiplatform/sdk/runtime';

export type AgentConversationAnchorBinding = {
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  conversationAnchorId: string;
  threadId: string;
  updatedAtMs: number;
};

export type AgentConversationAnchorBindingStore = {
  get(localAgentRef: string | null | undefined): AgentConversationAnchorBinding | null;
  persist(binding: AgentConversationAnchorBinding): AgentConversationAnchorBinding;
  clear(localAgentRef: string | null | undefined): void;
  clearAll(): void;
  getVersion(): number;
  subscribe(listener: () => void): () => void;
  dispose(): void;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBinding(
  value: unknown,
  now: () => number,
): AgentConversationAnchorBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const ownerUserId = normalizeText(record.ownerUserId);
  const runtimeSourceRef = normalizeText(record.runtimeSourceRef);
  const localAgentRef = normalizeText(record.localAgentRef);
  const conversationAnchorId = normalizeText(record.conversationAnchorId);
  const threadId = normalizeText(record.threadId);
  if (!ownerUserId || !runtimeSourceRef || !localAgentRef || !conversationAnchorId || !threadId) {
    return null;
  }
  try {
    projectRuntimeLocalAgentIdentity({ ownerUserId, runtimeSourceRef, localAgentRef });
  } catch {
    return null;
  }
  const updatedAtCandidate = Number(record.updatedAtMs);
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    conversationAnchorId,
    threadId,
    updatedAtMs: Number.isFinite(updatedAtCandidate) && updatedAtCandidate >= 0
      ? Math.floor(updatedAtCandidate)
      : now(),
  };
}

export function createAgentConversationAnchorBindingStore(
  now: () => number,
): AgentConversationAnchorBindingStore {
  const bindings = new Map<string, AgentConversationAnchorBinding>();
  const listeners = new Set<() => void>();
  let version = 0;
  let disposed = false;
  const notify = () => {
    version += 1;
    for (const listener of listeners) listener();
  };
  const assertActive = () => {
    if (disposed) throw new Error('AGENT_CONVERSATION_ANCHOR_BINDING_STORE_DISPOSED');
  };
  return Object.freeze({
    get(localAgentRef: string | null | undefined) {
      assertActive();
      const normalized = normalizeText(localAgentRef);
      return normalized ? bindings.get(normalized) ?? null : null;
    },
    persist(binding: AgentConversationAnchorBinding) {
      assertActive();
      const normalized = normalizeBinding(binding, now);
      if (!normalized) throw new Error('agent conversation anchor binding is invalid');
      bindings.set(normalized.localAgentRef, normalized);
      notify();
      return normalized;
    },
    clear(localAgentRef: string | null | undefined) {
      assertActive();
      const normalized = normalizeText(localAgentRef);
      if (normalized && bindings.delete(normalized)) notify();
    },
    clearAll() {
      assertActive();
      if (bindings.size === 0) return;
      bindings.clear();
      notify();
    },
    getVersion() {
      return version;
    },
    subscribe(listener: () => void) {
      assertActive();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      bindings.clear();
      listeners.clear();
    },
  });
}
