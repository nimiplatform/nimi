import type {
  ConversationTurnHistoryMessage,
  ConversationRuntimeTrace,
  ConversationRuntimeTextMessage,
  ConversationRuntimeTextStreamPart,
  ConversationRuntimeUsage,
  ConversationTurnError,
} from '@nimiplatform/nimi-kit/features/chat';
import type { JsonObject } from '@renderer/bridge/runtime-bridge/shared';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import type {
  AgentLocalTargetSnapshot,
} from '@renderer/bridge/runtime-bridge/types';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { ChatThinkingPreference } from './chat-thinking';
import type {
  AgentResolvedBehavior,
  AgentResolvedMessageActionEnvelope,
} from './chat-agent-behavior';
import type {
  AgentEffectiveCapabilityResolution,
  AgentVoiceWorkflowCapability,
  AISnapshot,
} from './conversation-capability';
import type { AgentVoicePlaybackCueEnvelope } from './chat-agent-voice-playback-envelope';
import type {
  ChatAgentVoiceWorkflowReferenceAudio,
  ChatAgentVoiceWorkflowSubmitInput,
} from './chat-agent-runtime';

export const AGENT_LOCAL_CHAT_PROVIDER_CAPABILITIES = {
  reasoning: true,
  continuity: true,
  firstBeat: false,
  voiceInput: false,
  voiceOutput: true,
  imageGeneration: true,
  videoGeneration: false,
} as const;

export type AgentFollowUpChainContext = {
  chainId: string;
  followUpDepth: number;
  maxFollowUpTurns: number;
  followUpSourceActionId: string;
  sourceTurnId: string;
  canceledByUser: boolean;
};

export type AgentPendingFollowUpEntry = {
  chainId: string;
  followUpDepth: number;
  maxFollowUpTurns: number;
  timerId: ReturnType<typeof setTimeout> | null;
  canceledByUser: boolean;
};

export type AgentLocalChatRuntimeRequest = {
  agentId: string;
  conversationAnchorId: string;
  prompt?: string;
  history?: readonly ConversationTurnHistoryMessage[];
  messages?: readonly ConversationRuntimeTextMessage[];
  systemPrompt?: string | null;
  maxOutputTokensRequested?: number | null;
  threadId: string;
  agentResolution: AgentEffectiveCapabilityResolution | null;
  textExecutionSnapshot: AISnapshot | null;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  reasoningPreference: ChatThinkingPreference;
  signal?: AbortSignal;
};

export type AgentLocalChatImageRequest = {
  prompt: string;
  imageExecutionSnapshot: AISnapshot | null;
  imageCapabilityParams?: Record<string, unknown> | null;
  signal?: AbortSignal;
};

export type AgentLocalChatVoiceRequest = {
  prompt: string;
  voiceExecutionSnapshot: AISnapshot | null;
  signal?: AbortSignal;
};

export type AgentLocalChatVoiceWorkflowRequest = ChatAgentVoiceWorkflowSubmitInput;

export type AgentLocalChatTurnStreamPart =
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

export interface AgentLocalChatRuntimeAdapter {
  streamAgentTurn?: (
    request: AgentLocalChatRuntimeRequest,
  ) => Promise<{ stream: AsyncIterable<AgentLocalChatTurnStreamPart> }>;
  streamText: (
    request: AgentLocalChatRuntimeRequest,
  ) => Promise<{ stream: AsyncIterable<ConversationRuntimeTextStreamPart> }>;
  invokeText: (
    request: AgentLocalChatRuntimeRequest,
  ) => Promise<{ text: string; traceId: string; promptTraceId: string }>;
  generateImage: (
    request: AgentLocalChatImageRequest,
  ) => Promise<{
    mediaUrl: string;
    mimeType: string;
    artifactId: string | null;
    traceId: string;
    diagnostics?: import('./chat-agent-runtime').AgentImageExecutionRuntimeDiagnostics | null;
  }>;
  synthesizeVoice: (
    request: AgentLocalChatVoiceRequest,
  ) => Promise<{
    mediaUrl: string;
    mimeType: string;
    artifactId: string | null;
    traceId: string;
    playbackCueEnvelope: AgentVoicePlaybackCueEnvelope | null;
  }>;
  submitVoiceWorkflow: (
    request: AgentLocalChatVoiceWorkflowRequest,
  ) => Promise<{
    jobId: string;
    traceId: string;
    workflowStatus: 'submitted' | 'queued' | 'running';
    voiceReference: import('./chat-agent-voice-workflow').AgentChatVoiceReferenceMeaning | null;
    voiceAssetId: string | null;
    providerVoiceRef: string | null;
  }>;
}

export type AgentLocalChatProviderMetadata = {
  agentId: string;
  conversationAnchorId: string;
  targetSnapshot: AgentLocalTargetSnapshot;
  agentResolution: AgentEffectiveCapabilityResolution | null;
  textExecutionSnapshot: AISnapshot | null;
  imageExecutionSnapshot: AISnapshot | null;
  voiceExecutionSnapshot: AISnapshot | null;
  voiceWorkflowExecutionSnapshotByCapability: Partial<Record<AgentVoiceWorkflowCapability, AISnapshot | null>>;
  latestVoiceCapture: ChatAgentVoiceWorkflowReferenceAudio | null;
  imageCapabilityParams?: Record<string, unknown> | null;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  reasoningPreference: ChatThinkingPreference;
  textModelContextTokens: number | null;
  textMaxOutputTokensRequested: number | null;
  resolvedBehavior?: AgentResolvedBehavior | null;
};

export type AgentLocalChatProviderOptions = {
  runtimeAdapter?: AgentLocalChatRuntimeAdapter;
  continuityAdapter?: import('./chat-agent-continuity').AgentLocalChatContinuityAdapter;
  followUpAssistantRuntimeFollowUp?: (input: {
    agentId: string;
    displayName: string;
    worldId: string | null;
    assistantText: string;
    turnId: string;
    threadId: string;
    history: readonly import('@nimiplatform/nimi-kit/features/chat').ConversationTurnHistoryMessage[];
  }) => Promise<void>;
};
