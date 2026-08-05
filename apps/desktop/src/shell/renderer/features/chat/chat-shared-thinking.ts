import type { NimiRuntimeAIReasoningOptions } from '@nimiplatform/sdk/ai';

export type ChatThinkingPreference = 'off' | 'on';

export type ChatThinkingSupportReason =
  | 'thinking_unsupported'
  | 'agent_execution_unsupported';

export type ChatThinkingSupport = {
  supported: boolean;
  reason: ChatThinkingSupportReason | null;
};

export function normalizeChatThinkingPreference(value: unknown): ChatThinkingPreference {
  return value === 'on' ? 'on' : 'off';
}

export function resolveAgentChatThinkingSupport(): ChatThinkingSupport {
  return {
    supported: false,
    reason: 'agent_execution_unsupported',
  };
}

export function resolveChatThinkingConfig(
  preference: ChatThinkingPreference,
  support: ChatThinkingSupport,
): NimiRuntimeAIReasoningOptions {
  if (preference === 'on' && support.supported) {
    return {
      mode: 'on',
      traceMode: 'separate',
    };
  }
  return {
    mode: 'off',
    traceMode: 'hide',
  };
}

export function getChatThinkingUnsupportedCopy(
  reason: ChatThinkingSupportReason | null,
): { key: string; defaultValue: string } {
  if (reason === 'agent_execution_unsupported') {
    return {
      key: 'Chat.settingsThinkingUnsupportedAgentExecution',
      defaultValue: 'Agent chat uses Runtime-owned execution, which does not expose thinking controls here.',
    };
  }
  return {
    key: 'Chat.settingsThinkingUnsupportedCapability',
    defaultValue: 'Thinking is unavailable for this capability intent.',
  };
}
