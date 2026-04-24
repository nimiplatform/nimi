import { normalizeChatThinkingPreference, type ChatThinkingPreference } from './chat-shared-thinking';

export const CHAT_THINKING_PREFERENCE_STORAGE_KEY = 'nimi.chat.settings.thinking.v1';

export type AgentChatExperienceSettings = {
  thinkingPreference: ChatThinkingPreference;
  maxOutputTokensOverride: number | null;
};

const DEFAULT_AGENT_CHAT_EXPERIENCE_SETTINGS: AgentChatExperienceSettings = {
  thinkingPreference: 'off',
  maxOutputTokensOverride: null,
};

function normalizeMaxOutputTokensOverride(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

export function normalizeAgentChatExperienceSettings(value: unknown): AgentChatExperienceSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_AGENT_CHAT_EXPERIENCE_SETTINGS };
  }
  const record = value as Record<string, unknown>;
  return {
    thinkingPreference: normalizeChatThinkingPreference(record.thinkingPreference),
    maxOutputTokensOverride: normalizeMaxOutputTokensOverride(record.maxOutputTokensOverride),
  };
}

export function createDefaultAgentChatExperienceSettings(): AgentChatExperienceSettings {
  return { ...DEFAULT_AGENT_CHAT_EXPERIENCE_SETTINGS };
}

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
