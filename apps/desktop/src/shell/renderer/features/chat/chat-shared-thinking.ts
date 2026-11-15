import type { NimiRuntimeAIReasoningOptions } from '@nimiplatform/sdk/ai';

export type ChatThinkingPreference = 'off' | 'on';

export type ChatThinkingSupportReason = 'thinking_unsupported';

export type ChatThinkingSupport = {
  supported: boolean;
  reason: ChatThinkingSupportReason | null;
};

export function normalizeChatThinkingPreference(value: unknown): ChatThinkingPreference {
  return value === 'on' ? 'on' : 'off';
}

export function resolveChatThinkingConfig(
  preference: ChatThinkingPreference,
  support: ChatThinkingSupport,
): NimiRuntimeAIReasoningOptions {
  if (preference === 'on' && support.supported) {
    return {
      activation: 'required',
      presentation: 'summary',
      effort: 'medium',
    };
  }
  return {
    activation: 'disabled',
    presentation: 'hidden',
  };
}

export function getChatThinkingUnsupportedCopy(): { key: string; defaultValue: string } {
  return {
    key: 'Chat.settingsThinkingUnsupportedCapability',
    defaultValue: 'Thinking is unavailable for this capability intent.',
  };
}
