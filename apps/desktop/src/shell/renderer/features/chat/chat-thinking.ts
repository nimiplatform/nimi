import type { NimiReasoningConfig } from '@nimiplatform/sdk/runtime';
import type { AiConversationRouteSnapshot } from './chat-shell-types';

export type ChatThinkingPreference = 'off' | 'on';

export type ChatThinkingSupportReason =
  | 'missing_route'
  | 'local_managed_unsupported'
  | 'provider_unsupported'
  | 'agent_route_unsupported';

export type ChatThinkingSupport = {
  supported: boolean;
  reason: ChatThinkingSupportReason | null;
};

const THINKING_OFF_CONFIG: NimiReasoningConfig = {
  mode: 'off',
  traceMode: 'hide',
};

const THINKING_ON_CONFIG: NimiReasoningConfig = {
  mode: 'on',
  traceMode: 'separate',
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeChatThinkingPreference(value: unknown): ChatThinkingPreference {
  return value === 'on' ? 'on' : 'off';
}

export function resolveAiChatThinkingSupport(
  routeSnapshot: AiConversationRouteSnapshot | null | undefined,
): ChatThinkingSupport {
  if (!routeSnapshot) {
    return {
      supported: false,
      reason: 'missing_route',
    };
  }
  if (routeSnapshot.routeKind === 'local') {
    return {
      supported: false,
      reason: 'local_managed_unsupported',
    };
  }
  if (normalizeText(routeSnapshot.provider).toLowerCase() === 'ollama') {
    return {
      supported: true,
      reason: null,
    };
  }
  return {
    supported: false,
    reason: 'provider_unsupported',
  };
}

export function resolveAgentChatThinkingSupport(): ChatThinkingSupport {
  return {
    supported: false,
    reason: 'agent_route_unsupported',
  };
}

export function resolveChatThinkingConfig(
  preference: ChatThinkingPreference,
  support: ChatThinkingSupport,
): NimiReasoningConfig {
  if (preference === 'on' && support.supported) {
    return { ...THINKING_ON_CONFIG };
  }
  return { ...THINKING_OFF_CONFIG };
}

export function getChatThinkingUnsupportedCopy(
  reason: ChatThinkingSupportReason | null,
): { key: string; defaultValue: string } {
  switch (reason) {
  case 'missing_route':
    return {
      key: 'Chat.settingsThinkingUnsupportedNoRoute',
      defaultValue: 'Choose a ready route before enabling thinking.',
    };
  case 'local_managed_unsupported':
    return {
      key: 'Chat.settingsThinkingUnsupportedLocalRoute',
      defaultValue: 'Managed local llama routes do not support thinking yet.',
    };
  case 'agent_route_unsupported':
    return {
      key: 'Chat.settingsThinkingUnsupportedAgentRoute',
      defaultValue: 'Agent chat uses the managed local runtime, which does not support thinking yet.',
    };
  case 'provider_unsupported':
  default:
    return {
      key: 'Chat.settingsThinkingUnsupportedProvider',
      defaultValue: 'Only Ollama routes support thinking right now.',
    };
  }
}
