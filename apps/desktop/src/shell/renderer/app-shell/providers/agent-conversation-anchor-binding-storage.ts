import { projectRuntimeLocalAgentIdentity } from '@nimiplatform/sdk/runtime';

export type AgentConversationAnchorBinding = {
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  conversationAnchorId: string;
  threadId: string;
  updatedAtMs: number;
};

const anchorBindingsByLocalAgentRef = new Map<string, AgentConversationAnchorBinding>();
let anchorBindingVersion = 0;
const anchorBindingListeners = new Set<() => void>();

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
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    conversationAnchorId,
    threadId,
    updatedAtMs: normalizeUpdatedAtMs(record.updatedAtMs),
  };
}

function notifyAnchorBindingListeners(): void {
  anchorBindingVersion += 1;
  for (const listener of anchorBindingListeners) {
    listener();
  }
}

export function getAgentConversationAnchorBinding(
  localAgentRef: string | null | undefined,
): AgentConversationAnchorBinding | null {
  const normalizedLocalAgentRef = normalizeText(localAgentRef);
  if (!normalizedLocalAgentRef) {
    return null;
  }
  return anchorBindingsByLocalAgentRef.get(normalizedLocalAgentRef) || null;
}

export function persistAgentConversationAnchorBinding(
  binding: AgentConversationAnchorBinding,
): AgentConversationAnchorBinding {
  const normalizedBinding = normalizeBinding(binding);
  if (!normalizedBinding) {
    throw new Error('agent conversation anchor binding is invalid');
  }
  anchorBindingsByLocalAgentRef.set(normalizedBinding.localAgentRef, normalizedBinding);
  notifyAnchorBindingListeners();
  return normalizedBinding;
}

export function clearAgentConversationAnchorBinding(
  localAgentRef: string | null | undefined,
): void {
  const normalizedLocalAgentRef = normalizeText(localAgentRef);
  if (!normalizedLocalAgentRef) {
    return;
  }
  anchorBindingsByLocalAgentRef.delete(normalizedLocalAgentRef);
  notifyAnchorBindingListeners();
}

export function clearAllAgentConversationAnchorBindings(): void {
  if (anchorBindingsByLocalAgentRef.size === 0) {
    return;
  }
  anchorBindingsByLocalAgentRef.clear();
  notifyAnchorBindingListeners();
}

export function getAgentConversationAnchorBindingVersion(): number {
  return anchorBindingVersion;
}

export function subscribeAgentConversationAnchorBindings(listener: () => void): () => void {
  anchorBindingListeners.add(listener);
  return () => {
    anchorBindingListeners.delete(listener);
  };
}
