import type { ConversationRuntimeTextMessage } from '@nimiplatform/nimi-kit/features/chat/headless';
import type { ConversationTurnHistoryMessage } from '@nimiplatform/nimi-kit/features/chat/headless';
import type {
  buildRuntimeCallOptions,
  buildRuntimeRequestMetadata,
  buildRuntimeStreamOptions,
  ensureRuntimeLocalModelWarm,
  getRuntimeClient,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import type { AgentVoiceWorkflowIntent } from './chat-agent-turn-plan';
import type { AgentChatVoiceReferenceMeaning } from './chat-agent-voice-workflow';
import type {
  AgentEffectiveCapabilityResolution,
  AISnapshot,
  ConversationExecutionSnapshot,
} from './conversation-capability';
import type {
  ChatThinkingPreference,
} from './chat-thinking';
import type { AgentVoicePlaybackCueEnvelope } from './chat-agent-voice-playback-envelope';

export type ChatAgentRuntimeInvokeInput = {
  agentId: string;
  prompt?: string;
  history?: readonly ConversationTurnHistoryMessage[];
  messages?: readonly ConversationRuntimeTextMessage[];
  systemPrompt?: string | null;
  maxOutputTokensRequested?: number | null;
  threadId: string;
  reasoningPreference: ChatThinkingPreference;
  agentResolution: AgentEffectiveCapabilityResolution | null;
  executionSnapshot: AISnapshot | null;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  signal?: AbortSignal;
};

export type ChatAgentRuntimeInvokeResult = {
  text: string;
  traceId: string;
  promptTraceId: string;
};

export type ChatAgentRuntimeStreamResult = {
  stream: import('@nimiplatform/sdk/runtime').TextStreamOutput['stream'];
  promptTraceId: string;
};

export type ChatAgentImageRuntimeInvokeInput = {
  prompt: string;
  imageExecutionSnapshot: AISnapshot | null;
  imageCapabilityParams?: Record<string, unknown> | null;
  signal?: AbortSignal;
};

export type ChatAgentImageRuntimeInvokeResult = {
  mediaUrl: string;
  mimeType: string;
  artifactId: string | null;
  traceId: string;
  diagnostics?: AgentImageExecutionRuntimeDiagnostics | null;
};

export type AgentImageExecutionRuntimeDiagnostics = {
  imageJobSubmitMs: number | null;
  imageLoadMs: number | null;
  imageGenerateMs: number | null;
  artifactHydrateMs: number | null;
  queueWaitMs: number | null;
  loadCacheHit: boolean | null;
  residentReused: boolean | null;
  residentRestarted: boolean | null;
  queueSerialized: boolean | null;
  profileOverrideStep: number | null;
  profileOverrideCfgScale: number | null;
  profileOverrideSampler: string | null;
  profileOverrideScheduler: string | null;
};

export type ChatAgentVoiceRuntimeInvokeInput = {
  prompt: string;
  voiceExecutionSnapshot: AISnapshot | null;
  signal?: AbortSignal;
};

export type ChatAgentVoiceRuntimeInvokeResult = {
  mediaUrl: string;
  mimeType: string;
  artifactId: string | null;
  traceId: string;
  playbackCueEnvelope: AgentVoicePlaybackCueEnvelope | null;
};

export type ChatAgentVoiceWorkflowReferenceAudio = {
  bytes: Uint8Array;
  mimeType: string;
  transcriptText: string;
};

export type ChatAgentVoiceWorkflowSubmitInput = {
  threadId: string;
  turnId: string;
  beatId: string;
  workflowIntent: AgentVoiceWorkflowIntent;
  prompt: string;
  voiceWorkflowExecutionSnapshot: AISnapshot | null;
  referenceAudio?: ChatAgentVoiceWorkflowReferenceAudio | null;
  signal?: AbortSignal;
};

export type ChatAgentVoiceWorkflowSubmitResult = {
  jobId: string;
  traceId: string;
  workflowStatus: 'submitted' | 'queued' | 'running';
  voiceReference: AgentChatVoiceReferenceMeaning | null;
  voiceAssetId: string | null;
  providerVoiceRef: string | null;
};

export type ChatAgentVoiceWorkflowPollResult = {
  workflowStatus: 'submitted' | 'queued' | 'running' | 'complete' | 'failed' | 'canceled';
  traceId: string | null;
  message: string | null;
};

export type ChatAgentVoiceReferenceSynthesisInput = {
  prompt: string;
  voiceReference: AgentChatVoiceReferenceMeaning;
  voiceExecutionSnapshot: AISnapshot | null;
  signal?: AbortSignal;
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

export type ChatAgentImageRuntimeInvokeDeps = {
  buildRuntimeRequestMetadataImpl?: typeof buildRuntimeRequestMetadata;
  buildRuntimeCallOptionsImpl?: typeof buildRuntimeCallOptions;
  getRuntimeClientImpl?: typeof getRuntimeClient;
};

export type ChatAgentVoiceRuntimeInvokeDeps = {
  buildRuntimeRequestMetadataImpl?: typeof buildRuntimeRequestMetadata;
  getRuntimeClientImpl?: typeof getRuntimeClient;
};

export type ChatAgentVoiceWorkflowRuntimeDeps = {
  buildRuntimeCallOptionsImpl?: typeof buildRuntimeCallOptions;
  getRuntimeClientImpl?: typeof getRuntimeClient;
};

export type ChatAgentTranscribeRuntimeInvokeDeps = {
  buildRuntimeRequestMetadataImpl?: typeof buildRuntimeRequestMetadata;
  getRuntimeClientImpl?: typeof getRuntimeClient;
};

export type ChatAgentRuntimeInvokeDeps = {
  resolveRouteInputImpl?: (input: ChatAgentRuntimeInvokeInput) => Promise<ResolvedAgentRuntimeRouteInput>;
  buildRuntimeCallOptionsImpl?: typeof buildRuntimeCallOptions;
  ensureRuntimeLocalModelWarmImpl?: typeof ensureRuntimeLocalModelWarm;
  getRuntimeClientImpl?: typeof getRuntimeClient;
};

export type ResolvedAgentRuntimeRouteInput = {
  modId: string;
  provider: string;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
};

export type ChatAgentRuntimeStreamDeps = {
  resolveRouteInputImpl?: (input: ChatAgentRuntimeInvokeInput) => Promise<ResolvedAgentRuntimeRouteInput>;
  buildRuntimeStreamOptionsImpl?: typeof buildRuntimeStreamOptions;
  ensureRuntimeLocalModelWarmImpl?: typeof ensureRuntimeLocalModelWarm;
  getRuntimeClientImpl?: typeof getRuntimeClient;
};

export const CORE_CHAT_AGENT_MOD_ID = 'core.chat-agent';

export type AgentRuntimeResolvedBinding = NonNullable<ConversationExecutionSnapshot['resolvedBinding']>;
