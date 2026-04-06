import {
  createDefaultConversationCapabilitySelectionStore,
  normalizeConversationCapabilitySelectionStore,
  type ConversationCapabilitySelectionStore,
} from '@renderer/features/chat/conversation-capability';

const CONVERSATION_CAPABILITY_SELECTION_STORAGE_KEY = 'nimi.conversation-capability.selection.v1';

function getStorage(): Storage | undefined {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    return globalThis.localStorage as Storage | undefined;
  } catch {
    return undefined;
  }
}

export function loadConversationCapabilitySelectionStore(): ConversationCapabilitySelectionStore {
  const storage = getStorage();
  if (!storage) {
    return createDefaultConversationCapabilitySelectionStore();
  }
  try {
    const raw = storage.getItem(CONVERSATION_CAPABILITY_SELECTION_STORAGE_KEY);
    if (!raw) {
      return createDefaultConversationCapabilitySelectionStore();
    }
    return normalizeConversationCapabilitySelectionStore(JSON.parse(raw));
  } catch {
    return createDefaultConversationCapabilitySelectionStore();
  }
}

export function persistConversationCapabilitySelectionStore(state: ConversationCapabilitySelectionStore): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(
      CONVERSATION_CAPABILITY_SELECTION_STORAGE_KEY,
      JSON.stringify(state),
    );
  } catch {
    // Ignore storage write failures; in-memory store remains authoritative for the session.
  }
}
