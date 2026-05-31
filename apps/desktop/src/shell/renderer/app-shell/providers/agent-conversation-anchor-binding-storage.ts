import {
  readStorageTextFrom,
  removeStorageKeyFrom,
  resolveBrowserStorage,
  writeStorageTextTo,
} from '@nimiplatform/kit/core/storage-json';
import { projectRuntimeLocalAgentIdentity } from '@nimiplatform/sdk/runtime';

export const AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY = 'nimi.chat.agent.anchor-bindings.v2';

export type AgentConversationAnchorBinding = {
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  conversationAnchorId: string;
  updatedAtMs: number;
};

const anchorBindingsByLocalAgentRef = new Map<string, AgentConversationAnchorBinding>();
let storageSnapshot = '';
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
  const realmAgentId = normalizeText(record.realmAgentId);
  const localAgentRef = normalizeText(record.localAgentRef);
  const conversationAnchorId = normalizeText(record.conversationAnchorId);
  if (!ownerUserId || !realmAgentId || !localAgentRef || !conversationAnchorId) {
    return null;
  }
  try {
    projectRuntimeLocalAgentIdentity({ ownerUserId, realmAgentId, localAgentRef });
  } catch {
    return null;
  }
  return {
    ownerUserId,
    realmAgentId,
    localAgentRef,
    conversationAnchorId,
    updatedAtMs: normalizeUpdatedAtMs(record.updatedAtMs),
  };
}

function notifyAnchorBindingListeners(): void {
  anchorBindingVersion += 1;
  for (const listener of anchorBindingListeners) {
    listener();
  }
}

function handleExternalAnchorBindingStorageChange(event: StorageEvent): void {
  if (event.key !== AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY) {
    return;
  }
  storageSnapshot = '';
  hydrateBindingsFromStorage();
  notifyAnchorBindingListeners();
}

function serializeBindings(): string {
  return JSON.stringify([...anchorBindingsByLocalAgentRef.values()]);
}

function hydrateBindingsFromStorage(): void {
  const result = readStorageTextFrom(resolveBrowserStorage('local'), AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY);
  if (result.state !== 'ready' && result.state !== 'missing') {
    return;
  }
  const raw = result.state === 'ready' ? result.value : '';
  if (raw === storageSnapshot) {
    return;
  }
  storageSnapshot = raw;
  anchorBindingsByLocalAgentRef.clear();
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
      const current = anchorBindingsByLocalAgentRef.get(binding.localAgentRef);
      if (!current || binding.updatedAtMs >= current.updatedAtMs) {
        anchorBindingsByLocalAgentRef.set(binding.localAgentRef, binding);
      }
    }
  }
}

function persistBindingsToStorage(): void {
  const storage = resolveBrowserStorage('local');
  if (!storage) {
    return;
  }
  const serialized = serializeBindings();
  if (anchorBindingsByLocalAgentRef.size === 0) {
    const result = removeStorageKeyFrom(storage, AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY);
    if (result.state === 'removed') {
      storageSnapshot = '';
    }
    return;
  }
  const result = writeStorageTextTo(storage, AGENT_CHAT_ANCHOR_BINDINGS_STORAGE_KEY, serialized);
  if (result.state === 'saved') {
    storageSnapshot = serialized;
  }
}

export function getAgentConversationAnchorBinding(
  localAgentRef: string | null | undefined,
): AgentConversationAnchorBinding | null {
  const normalizedLocalAgentRef = normalizeText(localAgentRef);
  if (!normalizedLocalAgentRef) {
    return null;
  }
  hydrateBindingsFromStorage();
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
  persistBindingsToStorage();
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
  hydrateBindingsFromStorage();
  anchorBindingsByLocalAgentRef.delete(normalizedLocalAgentRef);
  persistBindingsToStorage();
  notifyAnchorBindingListeners();
}

export function clearAllAgentConversationAnchorBindings(): void {
  hydrateBindingsFromStorage();
  if (anchorBindingsByLocalAgentRef.size === 0) {
    return;
  }
  anchorBindingsByLocalAgentRef.clear();
  persistBindingsToStorage();
  notifyAnchorBindingListeners();
}

export function getAgentConversationAnchorBindingVersion(): number {
  hydrateBindingsFromStorage();
  return anchorBindingVersion;
}

export function subscribeAgentConversationAnchorBindings(listener: () => void): () => void {
  anchorBindingListeners.add(listener);
  const windowLike = typeof window !== 'undefined' ? window : null;
  if (windowLike && anchorBindingListeners.size === 1) {
    windowLike.addEventListener('storage', handleExternalAnchorBindingStorageChange);
  }
  return () => {
    anchorBindingListeners.delete(listener);
    if (windowLike && anchorBindingListeners.size === 0) {
      windowLike.removeEventListener('storage', handleExternalAnchorBindingStorageChange);
    }
  };
}
