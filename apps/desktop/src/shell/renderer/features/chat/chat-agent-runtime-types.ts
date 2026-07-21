import type {
  NimiRuntimeRouteHostAccessSurface,
} from '@nimiplatform/sdk/runtime';
import type { Runtime } from '@nimiplatform/sdk/runtime';
import type {
  NimiAISnapshot,
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
  transcribeExecutionSnapshot: NimiAISnapshot | null;
  language?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type ChatAgentTranscribeRuntimeInvokeResult = {
  text: string;
  traceId: string;
};

export type ChatAgentTranscribeRuntimeInvokeDeps = {
  buildRuntimeCallOptionsImpl: NimiRuntimeRouteHostAccessSurface['buildCallOptions'];
  getRuntimeImpl: () => Runtime;
  getAppIdImpl: () => string;
  createRequestIdImpl?: () => string;
};

export const CORE_CHAT_AGENT_TARGET_ID = 'core.chat-agent';

export type AgentRuntimeResolvedBinding = NonNullable<ConversationExecutionSnapshot['resolvedBinding']>;
