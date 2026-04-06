import type { NimiReasoningConfig } from '@nimiplatform/sdk/runtime';
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

const THINKING_OFF_CONFIG: NimiReasoningConfig = {
  mode: 'off',
  traceMode: 'hide',
};

const THINKING_ON_CONFIG: NimiReasoningConfig = {
  mode: 'on',
  traceMode: 'separate',
};

export function normalizeChatThinkingPreference(value: unknown): ChatThinkingPreference {
  return value === 'on' ? 'on' : 'off';
}

export function resolveTextProjectionThinkingSupport(
  projection: ConversationCapabilityProjection | null | undefined,
): ChatThinkingSupport {
  if (!projection?.resolvedBinding) {
    return {
      supported: false,
      reason: 'missing_route',
    };
  }
  if (projection.metadata?.metadataKind !== 'text.generate') {
    return {
      supported: false,
      reason: 'metadata_missing',
    };
  }
  if (!projection.metadata.metadata.supportsThinking) {
    return {
      supported: false,
      reason: 'thinking_unsupported',
    };
  }
  if (projection.metadata.metadata.traceModeSupport !== 'separate') {
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

export function resolveAiThinkingSupportFromProjection(
  projection: ConversationCapabilityProjection | null | undefined,
): ChatThinkingSupport {
  return resolveTextProjectionThinkingSupport(projection);
}

export function resolveTextExecutionSnapshotThinkingSupport(
  snapshot: Pick<ConversationExecutionSnapshot, 'resolvedBinding' | 'metadata'> | null | undefined,
): ChatThinkingSupport {
  if (!snapshot?.resolvedBinding) {
    return {
      supported: false,
      reason: 'missing_route',
    };
  }
  if (snapshot.metadata?.metadataKind !== 'text.generate') {
    return {
      supported: false,
      reason: 'metadata_missing',
    };
  }
  if (!snapshot.metadata.metadata.supportsThinking) {
    return {
      supported: false,
      reason: 'thinking_unsupported',
    };
  }
  if (snapshot.metadata.metadata.traceModeSupport !== 'separate') {
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

export function resolveAgentThinkingSupportFromProjection(
  projection: ConversationCapabilityProjection | null | undefined,
): ChatThinkingSupport {
  if (!projection?.resolvedBinding) {
    return resolveAgentChatThinkingSupport();
  }
  if (projection.metadata?.metadataKind !== 'text.generate') {
    return resolveAgentChatThinkingSupport();
  }
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
