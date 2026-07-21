import { createContext, useContext, useSyncExternalStore, type PropsWithChildren } from 'react';
import type {
  ChatUploadPlaceholder,
  ChatUploadPlaceholderStore,
} from './chat-upload-placeholder-store.js';

const ChatUploadPlaceholderContext = createContext<ChatUploadPlaceholderStore | null>(null);

export function ChatUploadPlaceholderProvider(
  props: PropsWithChildren<{ readonly store: ChatUploadPlaceholderStore }>,
) {
  return (
    <ChatUploadPlaceholderContext.Provider value={props.store}>
      {props.children}
    </ChatUploadPlaceholderContext.Provider>
  );
}

export function useChatUploadPlaceholderStore(): ChatUploadPlaceholderStore {
  const store = useContext(ChatUploadPlaceholderContext);
  if (!store) throw new Error('CHAT_UPLOAD_PLACEHOLDER_STORE_MISSING');
  return store;
}

export function useChatUploadPlaceholders(chatId: string | null): ChatUploadPlaceholder[] {
  const store = useChatUploadPlaceholderStore();
  return useSyncExternalStore(
    store.subscribe,
    () => store.get(chatId),
    () => store.get(null),
  );
}
