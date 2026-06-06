import type { NimiRuntimeAIReasoningOptions } from '@nimiplatform/sdk/ai';
import type {
  ConversationCapabilityProjection,
  ConversationExecutionSnapshot,
} from './conversation-capability';

export type ChatThinkingPreference = 'off' | 'on';

export type ChatThinkingSupportReason =
  | 'missing_route'
  | 'metadata_missing'
  | 'trace_mode_unsupported'
  | 'thinking_unsupported'
  | 'agent_route_unsupported';

export type ChatThinkingSupport = {
  supported: boolean;
  reason: ChatThinkingSupportReason | null;
};

export function normalizeChatThinkingPreference(value: unknown): ChatThinkingPreference {
  return value === 'on' ? 'on' : 'off';
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

function resolveRuntimeTextRouteReasoningSupport(
  input: Pick<ConversationExecutionSnapshot, 'resolvedBinding' | 'metadata'> | null | undefined,
): ChatThinkingSupport {
  if (!input?.resolvedBinding) {
    return {
      supported: false,
      reason: 'missing_route',
    };
  }
  if (input.metadata?.metadataKind !== 'text.generate') {
    return {
      supported: false,
      reason: 'metadata_missing',
    };
  }
  if (!input.metadata.metadata.supportsThinking) {
    return {
      supported: false,
      reason: 'thinking_unsupported',
    };
  }
  if (input.metadata.metadata.traceModeSupport !== 'separate') {
    return {
      supported: false,
      reason: 'trace_mode_unsupported',
    };
  }
  return {
    supported: true,
    reason: null,
  };
}
