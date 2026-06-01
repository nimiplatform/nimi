import type {
  RuntimeRouteHostAccessSurface,
} from '@nimiplatform/sdk/runtime';
import type {
  getDesktopRuntimeClient,
} from '@renderer/infra/runtime-route-host-access';
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
  buildRuntimeRequestMetadataImpl?: RuntimeRouteHostAccessSurface['buildRequestMetadata'];
  getRuntimeClientImpl?: typeof getDesktopRuntimeClient;
};

export const CORE_CHAT_AGENT_TARGET_ID = 'core.chat-agent';

export type AgentRuntimeResolvedBinding = NonNullable<ConversationExecutionSnapshot['resolvedBinding']>;
