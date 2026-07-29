import type { JsonValue } from '@nimiplatform/kit/shell/renderer/bridge';
import { zhiyuLocalAppStorage } from '../app/local-app-storage';

export type ZhiyuAgentConversationAnchorBinding = {
  agentHandle: string;
  conversationAnchorId: string;
  threadId: string;
  updatedAtMs: number;
};

const anchorBindingsByAgentHandle = new Map<string, ZhiyuAgentConversationAnchorBinding>();
let anchorBindingVersion = 0;
const anchorBindingListeners = new Set<() => void>();
let storageHydrated = false;
let storageHydration: Promise<void> | null = null;

const STORAGE_PATH = 'agent-chat/conversation-anchor-bindings.json';
const STORAGE_VERSION = 3;

export function getZhiyuAgentConversationAnchorBinding(
  agentHandle: string | null | undefined,
): ZhiyuAgentConversationAnchorBinding | null {
  const normalizedAgentHandle = normalizeText(agentHandle);
  if (!normalizedAgentHandle) {
    return null;
  }
  return anchorBindingsByAgentHandle.get(normalizedAgentHandle) || null;
}

export function persistZhiyuAgentConversationAnchorBinding(
  binding: ZhiyuAgentConversationAnchorBinding,
): ZhiyuAgentConversationAnchorBinding {
  const normalizedBinding = normalizeBinding(binding);
  if (!normalizedBinding) {
    throw new Error('zhiyu agent conversation anchor binding is invalid');
  }
  anchorBindingsByAgentHandle.set(normalizedBinding.agentHandle, normalizedBinding);
  notifyAnchorBindingListeners();
  return normalizedBinding;
}

export async function hydrateZhiyuAgentConversationAnchorBindingsFromStorage(): Promise<void> {
  if (storageHydrated) {
    return;
  }
  if (storageHydration) {
    return storageHydration;
  }
  storageHydration = (async () => {
    let stored: unknown;
    try {
      stored = (await zhiyuLocalAppStorage.readJson(STORAGE_PATH)).value;
    } catch (error) {
      if (isShellStorageNotFound(error)) {
        storageHydrated = true;
        return;
      }
      throw error;
    }
    const bindings = parseStoredBindings(stored);
    for (const binding of bindings) {
      anchorBindingsByAgentHandle.set(binding.agentHandle, binding);
    }
    if (bindings.length > 0) {
      notifyAnchorBindingListeners();
    }
    storageHydrated = true;
  })().finally(() => {
    storageHydration = null;
  });
  return storageHydration;
}

export async function persistZhiyuAgentConversationAnchorBindingsToStorage(): Promise<void> {
  await zhiyuLocalAppStorage.writeJson(STORAGE_PATH, encodeStoredBindings());
}

export function clearZhiyuAgentConversationAnchorBinding(
  agentHandle: string | null | undefined,
): void {
  const normalizedAgentHandle = normalizeText(agentHandle);
  if (!normalizedAgentHandle) {
    return;
  }
  if (!anchorBindingsByAgentHandle.delete(normalizedAgentHandle)) {
    return;
  }
  notifyAnchorBindingListeners();
}

export function clearAllZhiyuAgentConversationAnchorBindings(): void {
  if (anchorBindingsByAgentHandle.size === 0) {
    return;
  }
  anchorBindingsByAgentHandle.clear();
  notifyAnchorBindingListeners();
}

export function getZhiyuAgentConversationAnchorBindingVersion(): number {
  return anchorBindingVersion;
}

export function subscribeZhiyuAgentConversationAnchorBindings(listener: () => void): () => void {
  anchorBindingListeners.add(listener);
  return () => {
    anchorBindingListeners.delete(listener);
  };
}

function normalizeBinding(
  value: unknown,
): ZhiyuAgentConversationAnchorBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const agentHandle = normalizeText(record.agentHandle);
  const conversationAnchorId = normalizeText(record.conversationAnchorId);
  const threadId = normalizeText(record.threadId);
  if (!agentHandle || !conversationAnchorId || !threadId) {
    return null;
  }
  return {
    agentHandle,
    conversationAnchorId,
    threadId,
    updatedAtMs: normalizeUpdatedAtMs(record.updatedAtMs),
  };
}

function encodeStoredBindings(): JsonValue {
  return {
    version: STORAGE_VERSION,
    bindings: [...anchorBindingsByAgentHandle.values()].map((binding) => ({
      agentHandle: binding.agentHandle,
      conversationAnchorId: binding.conversationAnchorId,
      threadId: binding.threadId,
      updatedAtMs: binding.updatedAtMs,
    })),
  };
}

function parseStoredBindings(value: unknown): ZhiyuAgentConversationAnchorBinding[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  const record = value as Record<string, unknown>;
  if (Number(record.version) !== STORAGE_VERSION || !Array.isArray(record.bindings)) {
    return [];
  }
  return record.bindings.flatMap((entry) => {
    const binding = normalizeBinding(entry);
    return binding ? [binding] : [];
  });
}

function isShellStorageNotFound(error: unknown): boolean {
  return shellErrorField(error, 'code') === 'not-found'
    || shellErrorField(error, 'reasonCode').includes('not-found');
}

function shellErrorField(error: unknown, field: 'code' | 'reasonCode'): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
}

function notifyAnchorBindingListeners(): void {
  anchorBindingVersion += 1;
  for (const listener of anchorBindingListeners) {
    listener();
  }
}

function normalizeUpdatedAtMs(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0
    ? Math.floor(numeric)
    : Date.now();
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
