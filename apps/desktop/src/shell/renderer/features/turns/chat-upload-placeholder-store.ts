import { createNimiClientId } from '@nimiplatform/sdk';

export type ChatUploadPlaceholder = {
  id: string;
  chatId: string;
  previewUrl: string;
  kind: 'image' | 'video';
  createdAt: string;
  senderId: string;
};

export type UploadPlaceholderInput = {
  chatId: string;
  previewUrl: string;
  kind: 'image' | 'video';
  senderId: string;
  createdAt?: string;
};

export function createChatUploadPlaceholderStore(now: () => number) {
  let placeholders: ChatUploadPlaceholder[] = [];
  const listeners = new Set<() => void>();
  const empty: ChatUploadPlaceholder[] = [];
  const snapshotCache = new Map<string, {
    source: ChatUploadPlaceholder[];
    snapshot: ChatUploadPlaceholder[];
  }>();
  let disposed = false;

  function emitChange(): void {
    snapshotCache.clear();
    for (const listener of listeners) listener();
  }

  return Object.freeze({
    create(input: UploadPlaceholderInput): ChatUploadPlaceholder {
      if (disposed) throw new Error('CHAT_UPLOAD_PLACEHOLDER_STORE_DISPOSED');
      return {
        id: createNimiClientId('upload'),
        chatId: input.chatId,
        previewUrl: input.previewUrl,
        kind: input.kind,
        createdAt: input.createdAt || new Date(now()).toISOString(),
        senderId: input.senderId,
      };
    },
    add(placeholder: ChatUploadPlaceholder): void {
      if (disposed) throw new Error('CHAT_UPLOAD_PLACEHOLDER_STORE_DISPOSED');
      placeholders = [...placeholders, placeholder];
      emitChange();
    },
    remove(placeholderId: string): void {
      if (disposed) throw new Error('CHAT_UPLOAD_PLACEHOLDER_STORE_DISPOSED');
      const next = placeholders.filter((placeholder) => placeholder.id !== placeholderId);
      if (next.length === placeholders.length) return;
      placeholders = next;
      emitChange();
    },
    get(chatId: string | null): ChatUploadPlaceholder[] {
      if (disposed) throw new Error('CHAT_UPLOAD_PLACEHOLDER_STORE_DISPOSED');
      const normalizedChatId = String(chatId || '').trim();
      if (!normalizedChatId) return empty;
      const cached = snapshotCache.get(normalizedChatId);
      if (cached?.source === placeholders) return cached.snapshot;
      const next = placeholders.filter((placeholder) => placeholder.chatId === normalizedChatId);
      const snapshot = next.length > 0 ? next : empty;
      snapshotCache.set(normalizedChatId, { source: placeholders, snapshot });
      return snapshot;
    },
    subscribe(listener: () => void): () => void {
      if (disposed) throw new Error('CHAT_UPLOAD_PLACEHOLDER_STORE_DISPOSED');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      placeholders = [];
      listeners.clear();
      snapshotCache.clear();
    },
  });
}

export type ChatUploadPlaceholderStore = ReturnType<typeof createChatUploadPlaceholderStore>;
