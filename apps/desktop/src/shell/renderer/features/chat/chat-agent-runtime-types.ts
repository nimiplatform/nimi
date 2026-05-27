import type {
  buildRuntimeRequestMetadata,
  getRuntimeClient,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import type {
  AISnapshot,
  ConversationExecutionSnapshot,
} from './conversation-capability';

export type ChatAgentVoiceWorkflowReferenceAudio = {
  bytes: Uint8Array;
  mimeType: string;
  transcriptText: string;
};

export type ChatAgentTranscribeRuntimeInvokeInput = {
  audioBytes: Uint8Array;
  mimeType: string;
  transcribeExecutionSnapshot: AISnapshot | null;
  language?: string;
  signal?: AbortSignal;
};

export type ChatAgentTranscribeRuntimeInvokeResult = {
  text: string;
  traceId: string;
};

export type ChatAgentTranscribeRuntimeInvokeDeps = {
  buildRuntimeRequestMetadataImpl?: typeof buildRuntimeRequestMetadata;
  getRuntimeClientImpl?: typeof getRuntimeClient;
};

export const CORE_CHAT_AGENT_TARGET_ID = 'core.chat-agent';

export type AgentRuntimeResolvedBinding = NonNullable<ConversationExecutionSnapshot['resolvedBinding']>;
