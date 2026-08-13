import type {
  ConversationRuntimeTrace,
  ConversationRuntimeUsage,
  ConversationTurnError,
} from '@nimiplatform/kit/features/chat';
import type { JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { NimiRuntimeAgentResolvedMessageActionEnvelope } from '@nimiplatform/sdk/runtime';

export const AGENT_RUNTIME_CHAT_PROVIDER_CAPABILITIES = {
  reasoning: true,
  continuity: true,
  firstBeat: false,
  voiceInput: true,
  voiceOutput: false,
  imageGeneration: false,
  videoGeneration: false,
} as const;

export type AgentChatUserAttachment = {
  kind: 'image';
  artifactId: string;
  mimeType: string | null;
  name: string;
};

export type AgentRuntimeChatTurnRequest = {
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  conversationAnchorId: string;
  threadId: string;
  userMessageId: string;
  userText: string;
  userAttachments?: readonly AgentChatUserAttachment[];
  maxOutputTokensRequested?: number | null;
  reasoningPreference: import('./chat-shared-thinking').ChatThinkingPreference;
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
    envelope: NimiRuntimeAgentResolvedMessageActionEnvelope;
    trace?: ConversationRuntimeTrace;
    metadataJson?: JsonObject | null;
    diagnostics?: Record<string, unknown>;
  }
  | {
    type: 'beat-planned';
    beatId: string;
    turnId: string;
    projectionMessageId?: string;
  }
  | {
    type: 'beat-delivery-started';
    beatId: string;
    turnId: string;
    projectionMessageId?: string;
  }
  | {
    type: 'artifact-ready';
    beatId: string;
    turnId: string;
    artifactId: string;
    mimeType: string;
    uri?: string;
    projectionMessageId?: string;
  }
  | {
    type: 'beat-delivered';
    beatId: string;
    turnId: string;
    projectionMessageId?: string;
  }
  | {
    type: 'beat-delivery-failed';
    beatId: string;
    turnId: string;
    operation: string;
    modality: string;
    reasonCode: string;
    reason: string;
    message: string;
    projectionMessageId?: string;
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
