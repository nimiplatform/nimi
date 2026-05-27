import type {
  ConversationRuntimeTrace,
  ConversationRuntimeUsage,
  ConversationTurnError,
} from '@nimiplatform/kit/features/chat';
import type { JsonObject } from '@renderer/bridge/runtime-bridge/shared';
import type { AgentResolvedMessageActionEnvelope } from '@nimiplatform/sdk/runtime';

export const AGENT_RUNTIME_CHAT_PROVIDER_CAPABILITIES = {
  reasoning: true,
  continuity: true,
  firstBeat: false,
  voiceInput: false,
  voiceOutput: false,
  imageGeneration: false,
  videoGeneration: false,
} as const;

export type AgentChatUserAttachment = {
  kind: 'image';
  url: string;
  mimeType: string | null;
  name: string;
  resourceId: string | null;
};

export type AgentRuntimeChatTurnRequest = {
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  conversationAnchorId: string;
  threadId: string;
  userMessageId: string;
  userText: string;
  userAttachments?: readonly AgentChatUserAttachment[];
  maxOutputTokensRequested?: number | null;
  reasoningPreference: import('./chat-shared-thinking').ChatThinkingPreference;
  textExecutionSnapshot: import('./conversation-capability').AISnapshot | null;
  signal?: AbortSignal;
};

export type AgentRuntimeChatTurnStreamPart =
  | {
    type: 'reasoning-delta';
    textDelta: string;
  }
  | {
    type: 'text-delta';
    textDelta: string;
  }
  | {
    type: 'message-sealed';
    envelope: AgentResolvedMessageActionEnvelope;
    trace?: ConversationRuntimeTrace;
    metadataJson?: JsonObject | null;
    diagnostics?: Record<string, unknown>;
  }
  | {
    type: 'turn-completed';
    outputText: string;
    finishReason?: string;
    usage?: ConversationRuntimeUsage;
    trace?: ConversationRuntimeTrace;
    diagnostics?: Record<string, unknown>;
  }
  | {
    type: 'turn-failed';
    error: ConversationTurnError;
    outputText?: string;
    reasoningText?: string;
    finishReason?: string;
    usage?: ConversationRuntimeUsage;
    trace?: ConversationRuntimeTrace;
    diagnostics?: Record<string, unknown>;
  }
  | {
    type: 'turn-canceled';
    scope: 'turn';
    outputText?: string;
    reasoningText?: string;
    trace?: ConversationRuntimeTrace;
    diagnostics?: Record<string, unknown>;
  };

export interface AgentRuntimeChatTurnAdapter {
  streamAgentTurn: (
    request: AgentRuntimeChatTurnRequest,
  ) => Promise<{ stream: AsyncIterable<AgentRuntimeChatTurnStreamPart> }>;
}

export type AgentLocalTextMessageState = {
  messageId: string;
  projectionMessageId: string;
  text: string;
  metadataJson: JsonObject | null;
};
