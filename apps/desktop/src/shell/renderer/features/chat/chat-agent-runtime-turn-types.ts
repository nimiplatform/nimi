import type {
  ConversationRuntimeTrace,
  ConversationRuntimeUsage,
  ConversationTurnError,
} from '@nimiplatform/kit/features/chat';
import type { JsonObject } from '@renderer/bridge/runtime-bridge/shared';
import type { AgentResolvedMessageActionEnvelope } from './chat-agent-behavior';
import type {
  AgentVoiceWorkflowCapability,
} from './conversation-capability';
import type { AgentVoicePlaybackCueEnvelope } from './chat-agent-voice-playback-envelope';
import type { AgentChatVoiceWorkflowMessageMetadata } from './chat-agent-voice-workflow';

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

export type AgentVoiceWorkflowIntent = {
  capability: AgentVoiceWorkflowCapability;
  workflowType: 'voice_clone' | 'voice_design';
  operation: string;
};

export type AgentLocalChatImageState =
  | {
    status: 'none';
  }
  | {
    status: 'error';
    beatId: string;
    beatIndex: number;
    projectionMessageId: string;
    prompt: string;
    message: string;
  }
  | {
    status: 'complete';
    beatId: string;
    beatIndex: number;
    projectionMessageId: string;
    prompt: string;
    mediaUrl: string;
    mimeType: string;
    artifactId: string | null;
  };

export type AgentLocalChatVoiceState =
  | {
    status: 'none';
  }
  | {
    status: 'pending';
    beatId: string;
    beatIndex: number;
    projectionMessageId: string;
    prompt: string;
    transcriptText: string;
    message: string;
    sourceMessageId: string;
    workflowIntent: AgentVoiceWorkflowIntent;
    sourceActionId: string;
    metadata?: AgentChatVoiceWorkflowMessageMetadata | null;
  }
  | {
    status: 'complete';
    beatId: string;
    beatIndex: number;
    projectionMessageId: string;
    prompt: string;
    transcriptText: string;
    mediaUrl: string;
    mimeType: string;
    artifactId: string | null;
    sourceMessageId: string;
    sourceActionId: string;
    metadata?: AgentChatVoiceWorkflowMessageMetadata | null;
    playbackCueEnvelope?: AgentVoicePlaybackCueEnvelope | null;
  };

export type AgentLocalTextMessageState = {
  messageId: string;
  projectionMessageId: string;
  text: string;
  metadataJson: JsonObject | null;
};
