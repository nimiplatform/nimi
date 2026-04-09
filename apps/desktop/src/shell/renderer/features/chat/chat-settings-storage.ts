import { normalizeChatThinkingPreference, type ChatThinkingPreference } from './chat-thinking';

export const CHAT_THINKING_PREFERENCE_STORAGE_KEY = 'nimi.chat.settings.thinking.v1';
export const AGENT_CHAT_BEHAVIOR_SETTINGS_STORAGE_KEY = 'nimi.chat.settings.agent.behavior.v1';

export type AgentChatExperienceSettings = {
  thinkingPreference: ChatThinkingPreference;
};

const DEFAULT_AGENT_CHAT_EXPERIENCE_SETTINGS: AgentChatExperienceSettings = {
  thinkingPreference: 'off',
};

export function normalizeAgentChatExperienceSettings(value: unknown): AgentChatExperienceSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_AGENT_CHAT_EXPERIENCE_SETTINGS };
  }
  const record = value as Record<string, unknown>;
  return {
    thinkingPreference: normalizeChatThinkingPreference(record.thinkingPreference),
  };
}

export function loadStoredAgentChatExperienceSettings(): AgentChatExperienceSettings {
  try {
    const storedSettings = localStorage.getItem(AGENT_CHAT_BEHAVIOR_SETTINGS_STORAGE_KEY);
    if (storedSettings) {
      return normalizeAgentChatExperienceSettings(JSON.parse(storedSettings));
    }
  } catch {
    // fall through to legacy thinking-only migration
  }
  return {
    ...DEFAULT_AGENT_CHAT_EXPERIENCE_SETTINGS,
    thinkingPreference: loadStoredChatThinkingPreference(),
  };
}

export function persistStoredAgentChatExperienceSettings(settings: AgentChatExperienceSettings): void {
  const normalizedSettings = normalizeAgentChatExperienceSettings(settings);
  try {
    localStorage.setItem(
      AGENT_CHAT_BEHAVIOR_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizedSettings),
    );
    localStorage.setItem(
      CHAT_THINKING_PREFERENCE_STORAGE_KEY,
      normalizedSettings.thinkingPreference,
    );
  } catch {
    // ignore
  }
}

export function loadStoredChatThinkingPreference(): ChatThinkingPreference {
  try {
    return normalizeChatThinkingPreference(localStorage.getItem(CHAT_THINKING_PREFERENCE_STORAGE_KEY));
  } catch {
    return 'off';
  }
}

export function persistStoredChatThinkingPreference(preference: ChatThinkingPreference): void {
  const currentSettings = loadStoredAgentChatExperienceSettings();
  persistStoredAgentChatExperienceSettings({
    ...currentSettings,
    thinkingPreference: normalizeChatThinkingPreference(preference),
  });
}
