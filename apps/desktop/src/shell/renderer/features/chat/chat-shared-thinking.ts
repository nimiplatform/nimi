import {
  normalizeRuntimeRouteReasoningPreference,
  resolveRuntimeRouteReasoningConfig,
  resolveRuntimeTextRouteReasoningSupport,
  type RuntimeRouteReasoningPreference,
  type RuntimeTextRouteReasoningSupportReason,
} from '@nimiplatform/sdk/ai';
import type { NimiReasoningConfig } from '@nimiplatform/sdk/runtime';
import type {
  ConversationCapabilityProjection,
  ConversationExecutionSnapshot,
} from './conversation-capability';

export type ChatThinkingPreference = RuntimeRouteReasoningPreference;

export type ChatThinkingSupportReason =
  | RuntimeTextRouteReasoningSupportReason
  | 'agent_route_unsupported';

export type ChatThinkingSupport = {
  supported: boolean;
  reason: ChatThinkingSupportReason | null;
};

export function normalizeChatThinkingPreference(value: unknown): ChatThinkingPreference {
  return normalizeRuntimeRouteReasoningPreference(value);
}

export function resolveTextProjectionThinkingSupport(
  projection: ConversationCapabilityProjection | null | undefined,
): ChatThinkingSupport {
  return resolveRuntimeTextRouteReasoningSupport(projection);
}

export function resolveAiThinkingSupportFromProjection(
  projection: ConversationCapabilityProjection | null | undefined,
): ChatThinkingSupport {
  return resolveTextProjectionThinkingSupport(projection);
}

export function resolveTextExecutionSnapshotThinkingSupport(
  snapshot: Pick<ConversationExecutionSnapshot, 'resolvedBinding' | 'metadata'> | null | undefined,
): ChatThinkingSupport {
  return resolveRuntimeTextRouteReasoningSupport(snapshot);
}

export function resolveAgentThinkingSupportFromProjection(
  projection: ConversationCapabilityProjection | null | undefined,
): ChatThinkingSupport {
  return resolveTextProjectionThinkingSupport(projection);
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
  return resolveRuntimeRouteReasoningConfig(preference, {
    supported: support.supported,
    reason: support.reason === 'agent_route_unsupported' ? 'thinking_unsupported' : support.reason,
  });
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
  case 'metadata_missing':
    return {
      key: 'Chat.settingsThinkingUnsupportedMetadata',
      defaultValue: 'Route policy metadata is unavailable, so thinking stays off.',
    };
  case 'trace_mode_unsupported':
    return {
      key: 'Chat.settingsThinkingUnsupportedTraceMode',
      defaultValue: 'This route does not expose separate thinking traces.',
    };
  case 'thinking_unsupported':
    return {
      key: 'Chat.settingsThinkingUnsupportedCapability',
      defaultValue: 'This route does not support thinking output.',
    };
  case 'agent_route_unsupported':
    return {
      key: 'Chat.settingsThinkingUnsupportedAgentRoute',
      defaultValue: 'Agent chat uses the managed local runtime, which does not support thinking yet.',
    };
  default:
    return {
      key: 'Chat.settingsThinkingUnsupportedCapability',
      defaultValue: 'Thinking is unavailable for the current route.',
    };
  }
}
