import { useSyncExternalStore } from 'react';

export type ChatUploadPlaceholder = {
  id: string;
  chatId: string;
  previewUrl: string;
  kind: 'image' | 'video';
  createdAt: string;
  senderId: string;
};

type UploadPlaceholderInput = {
  chatId: string;
  previewUrl: string;
  kind: 'image' | 'video';
  senderId: string;
  createdAt?: string;
};

let chatUploadPlaceholders: ChatUploadPlaceholder[] = [];
const listeners = new Set<() => void>();
const EMPTY_PLACEHOLDERS: ChatUploadPlaceholder[] = [];
const snapshotCache = new Map<string, {
  source: ChatUploadPlaceholder[];
  snapshot: ChatUploadPlaceholder[];
}>();

function emitChange() {
  snapshotCache.clear();
  for (const listener of listeners) {
    listener();
  }
}

function buildPlaceholderId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createChatUploadPlaceholder(input: UploadPlaceholderInput): ChatUploadPlaceholder {
  return {
    id: buildPlaceholderId(),
    chatId: input.chatId,
    previewUrl: input.previewUrl,
    kind: input.kind,
    createdAt: input.createdAt || new Date().toISOString(),
    senderId: input.senderId,
  };
}

export function addChatUploadPlaceholder(placeholder: ChatUploadPlaceholder) {
  chatUploadPlaceholders = [...chatUploadPlaceholders, placeholder];
  emitChange();
}

export function removeChatUploadPlaceholder(placeholderId: string) {
  const next = chatUploadPlaceholders.filter((placeholder) => placeholder.id !== placeholderId);
  if (next.length === chatUploadPlaceholders.length) {
    return;
  }
  chatUploadPlaceholders = next;
  emitChange();
}

export function getChatUploadPlaceholders(chatId: string | null): ChatUploadPlaceholder[] {
  if (!chatId) {
    return EMPTY_PLACEHOLDERS;
  }
  const normalizedChatId = String(chatId).trim();
  if (!normalizedChatId) {
    return EMPTY_PLACEHOLDERS;
  }

  const cached = snapshotCache.get(normalizedChatId);
  if (cached && cached.source === chatUploadPlaceholders) {
    return cached.snapshot;
  }

  const nextSnapshot = chatUploadPlaceholders.filter((placeholder) => placeholder.chatId === normalizedChatId);
  const stableSnapshot = nextSnapshot.length > 0 ? nextSnapshot : EMPTY_PLACEHOLDERS;
  snapshotCache.set(normalizedChatId, {
    source: chatUploadPlaceholders,
    snapshot: stableSnapshot,
  });
  return stableSnapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useChatUploadPlaceholders(chatId: string | null): ChatUploadPlaceholder[] {
  return useSyncExternalStore(
    subscribe,
    () => getChatUploadPlaceholders(chatId),
    () => EMPTY_PLACEHOLDERS,
  );
}
