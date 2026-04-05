import { normalizeChatThinkingPreference, type ChatThinkingPreference } from './chat-thinking';

export const CHAT_THINKING_PREFERENCE_STORAGE_KEY = 'nimi.chat.settings.thinking.v1';

export function loadStoredChatThinkingPreference(): ChatThinkingPreference {
  try {
    return normalizeChatThinkingPreference(localStorage.getItem(CHAT_THINKING_PREFERENCE_STORAGE_KEY));
  } catch {
    return 'off';
  }
}

export function persistStoredChatThinkingPreference(preference: ChatThinkingPreference): void {
  try {
    localStorage.setItem(
      CHAT_THINKING_PREFERENCE_STORAGE_KEY,
      normalizeChatThinkingPreference(preference),
    );
  } catch {
    // ignore
  }
}
