import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { hasShellHostInvoke, invokeChecked } from '@nimiplatform/kit/shell/renderer/bridge';
import type { JsonValue } from '@nimiplatform/kit/shell/renderer/bridge';
import { projectRuntimeLocalAgentIdentity } from '@nimiplatform/sdk/runtime';

export type ZhiyuAgentConversationAnchorBinding = {
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  conversationAnchorId: string;
  threadId: string;
  updatedAtMs: number;
};

const anchorBindingsByLocalAgentRef = new Map<string, ZhiyuAgentConversationAnchorBinding>();
let anchorBindingVersion = 0;
const anchorBindingListeners = new Set<() => void>();
let storageHydrated = false;
let storageHydration: Promise<void> | null = null;

const STORAGE_PATH = 'agent-chat/conversation-anchor-bindings.json';
const STORAGE_VERSION = 2;

export function getZhiyuAgentConversationAnchorBinding(
  localAgentRef: string | null | undefined,
): ZhiyuAgentConversationAnchorBinding | null {
  const normalizedLocalAgentRef = normalizeText(localAgentRef);
  if (!normalizedLocalAgentRef) {
    return null;
  }
  return anchorBindingsByLocalAgentRef.get(normalizedLocalAgentRef) || null;
}

export function persistZhiyuAgentConversationAnchorBinding(
  binding: ZhiyuAgentConversationAnchorBinding,
): ZhiyuAgentConversationAnchorBinding {
  const normalizedBinding = normalizeBinding(binding);
  if (!normalizedBinding) {
    throw new Error('zhiyu agent conversation anchor binding is invalid');
  }
  anchorBindingsByLocalAgentRef.set(normalizedBinding.localAgentRef, normalizedBinding);
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
    if (!hasShellHostInvoke()) {
      storageHydrated = true;
      return;
    }
    let stored: unknown;
    try {
      stored = await invokeChecked(
        NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'],
        { relativePath: STORAGE_PATH },
        (value) => parseStorageReadResult(value, NIMI_STANDARD_SHELL_COMMANDS['storage.readJson']),
      );
    } catch (error) {
      if (isShellStorageNotFound(error) || isShellCapabilityUnavailable(error)) {
        storageHydrated = true;
        return;
      }
      throw error;
    }
    const bindings = parseStoredBindings(stored);
    for (const binding of bindings) {
      anchorBindingsByLocalAgentRef.set(binding.localAgentRef, binding);
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
  if (!hasShellHostInvoke()) {
    return;
  }
  await invokeChecked(
    NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'],
    {
      relativePath: STORAGE_PATH,
      value: encodeStoredBindings(),
    },
    (value) => parseStorageWriteResult(value, NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson']),
  );
}

export function clearZhiyuAgentConversationAnchorBinding(
  localAgentRef: string | null | undefined,
): void {
  const normalizedLocalAgentRef = normalizeText(localAgentRef);
  if (!normalizedLocalAgentRef) {
    return;
  }
  if (!anchorBindingsByLocalAgentRef.delete(normalizedLocalAgentRef)) {
    return;
  }
  notifyAnchorBindingListeners();
}

export function clearAllZhiyuAgentConversationAnchorBindings(): void {
  if (anchorBindingsByLocalAgentRef.size === 0) {
    return;
  }
  anchorBindingsByLocalAgentRef.clear();
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

function encodeStoredBindings(): JsonValue {
  return {
    version: STORAGE_VERSION,
    bindings: [...anchorBindingsByLocalAgentRef.values()].map((binding) => ({
      ownerUserId: binding.ownerUserId,
      runtimeSourceRef: binding.runtimeSourceRef,
      localAgentRef: binding.localAgentRef,
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

function parseStorageReadResult(value: unknown, command: string): unknown {
  const record = asRecord(value, `${command} returned invalid storage payload`);
  return record.value;
}

function parseStorageWriteResult(value: unknown, command: string): unknown {
  const record = asRecord(value, `${command} returned invalid storage payload`);
  return record.value;
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function isShellStorageNotFound(error: unknown): boolean {
  return shellErrorField(error, 'code') === 'not-found'
    || shellErrorField(error, 'reasonCode').includes('not-found');
}

function isShellCapabilityUnavailable(error: unknown): boolean {
  return shellErrorField(error, 'code') === 'capability-unavailable'
    || shellErrorField(error, 'reasonCode') === 'electron-standard-capability-unavailable'
    || shellErrorField(error, 'reasonCode') === 'renderer-standard-shell-host-unavailable';
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
