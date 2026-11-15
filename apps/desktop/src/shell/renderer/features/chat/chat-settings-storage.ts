import {
  readStorageTextFrom,
  resolveBrowserStorage,
  writeStorageTextTo,
} from '@nimiplatform/kit/core/storage-json';
import { normalizeChatThinkingPreference, type ChatThinkingPreference } from './chat-shared-thinking';

export const CHAT_THINKING_PREFERENCE_STORAGE_KEY = 'nimi.chat.settings.thinking.v1';

export function loadStoredChatThinkingPreference(): ChatThinkingPreference {
  const result = readStorageTextFrom(resolveBrowserStorage('local'), CHAT_THINKING_PREFERENCE_STORAGE_KEY);
  return normalizeChatThinkingPreference(result.state === 'ready' ? result.value : null);
}

export function persistStoredChatThinkingPreference(preference: ChatThinkingPreference): void {
  writeStorageTextTo(
    resolveBrowserStorage('local'),
    CHAT_THINKING_PREFERENCE_STORAGE_KEY,
    normalizeChatThinkingPreference(preference),
  );
}
