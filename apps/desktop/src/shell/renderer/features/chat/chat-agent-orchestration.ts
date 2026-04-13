import type {
  ConversationProjectionRebuildResult,
  ConversationRuntimeTextMessage,
  ConversationRuntimeTextStreamPart,
  ConversationTurnEvent,
  ConversationTurnInput,
  ConversationOrchestrationProvider,
} from '@nimiplatform/nimi-kit/features/chat';
import { normalizeConversationRuntimeTextStreamPart } from '@nimiplatform/nimi-kit/features/chat/runtime';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import { feedStreamEvent } from '../turns/stream-controller';
import type {
  AgentLocalTargetSnapshot,
} from '@renderer/bridge/runtime-bridge/types';
import {
  randomIdV11,
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/runtime-config-state-types';
import {
  generateChatAgentImageRuntime,
  invokeChatAgentRuntime,
  submitChatAgentVoiceWorkflowRuntime,
  type ChatAgentVoiceWorkflowReferenceAudio,
  type ChatAgentVoiceWorkflowSubmitInput,
  streamChatAgentRuntime,
  synthesizeChatAgentVoiceRuntime,
  toChatAgentRuntimeError,
} from './chat-agent-runtime';
import type { ChatThinkingPreference } from './chat-thinking';
import type {
  AgentEffectiveCapabilityResolution,
  AgentVoiceWorkflowCapability,
  AISnapshot,
} from './conversation-capability';
import { getStreamState } from '../turns/stream-controller';
import {
  buildAgentLocalChatExecutionTextRequest,
  type AgentChatUserAttachment,
} from './chat-ai-execution-engine';
import type {
  AgentResolvedMessageActionEnvelope,
  AgentResolvedBehavior,
} from './chat-agent-behavior';
import {
  buildAgentResolvedOutputText,
  resolveAgentModelOutputEnvelope,
  toAgentModelOutputTurnError,
  type AgentModelOutputDiagnostics,
} from './chat-agent-behavior-resolver';
import { buildAgentTextTurnDebugMetadata } from './chat-agent-debug-metadata';
import {
  createAgentLocalChatContinuityAdapter,
  commitProviderOutcome,
  type AgentLocalChatContinuityAdapter,
} from './chat-agent-continuity';
import {
  type AgentChatVoiceWorkflowMessageMetadata,
  type AgentChatVoiceWorkflowStatus,
} from './chat-agent-voice-workflow';
import {
  findSingleExecutableFollowUpAction,
  findSingleExecutableImageAction,
  findSingleExecutableVoiceAction,
  resolveCompletedTextMessageStateFromEnvelope,
  resolveImageStateFromResolvedAction,
  resolveVoiceStateFromResolvedAction,
  type AgentLocalChatImageState,
  type AgentLocalChatVoiceState,
  type AgentLocalTextMessageState,
} from './chat-agent-turn-plan';

export { buildAgentLocalChatPrompt } from './chat-ai-execution-engine';
export { createAgentLocalChatContinuityAdapter } from './chat-agent-continuity';

const AGENT_LOCAL_CHAT_PROVIDER_CAPABILITIES = {
  reasoning: true,
  continuity: true,
  firstBeat: false,
  voiceInput: false,
  voiceOutput: true,
  imageGeneration: true,
  videoGeneration: false,
} as const;

const MAX_AGENT_FOLLOW_UP_TURNS = 8;

type AgentFollowUpChainContext = {
  chainId: string;
  followUpDepth: number;
  maxFollowUpTurns: number;
  followUpSourceActionId: string;
  sourceTurnId: string;
  canceledByUser: boolean;
};

type AgentPendingFollowUpEntry = {
  chainId: string;
  followUpDepth: number;
  maxFollowUpTurns: number;
  timerId: ReturnType<typeof setTimeout> | null;
  canceledByUser: boolean;
};

const pendingAgentFollowUpByThread = new Map<string, AgentPendingFollowUpEntry>();

export type AgentLocalChatRuntimeRequest = {
  agentId: string;
  prompt?: string;
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

export interface AgentLocalChatRuntimeAdapter {
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
  ) => Promise<{ mediaUrl: string; mimeType: string; artifactId: string | null; traceId: string }>;
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
  continuityAdapter?: AgentLocalChatContinuityAdapter;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePositiveInteger(value: unknown): number | null {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return null;
  }
  return normalized;
}

function mergeAgentImageDiagnostics(
  diagnostics: AgentModelOutputDiagnostics | null,
  imageDiagnostics: Partial<NonNullable<AgentModelOutputDiagnostics['image']>> | null | undefined,
): AgentModelOutputDiagnostics | null {
  if (!diagnostics || !imageDiagnostics) {
    return diagnostics;
  }
  const mergedImage = {
    ...(diagnostics.image || {
      textPlanningMs: null,
      imageJobSubmitMs: null,
      imageLoadMs: null,
      imageGenerateMs: null,
      artifactHydrateMs: null,
      queueWaitMs: null,
      loadCacheHit: null,
      residentReused: null,
      residentRestarted: null,
      queueSerialized: null,
      profileOverrideStep: null,
      profileOverrideCfgScale: null,
      profileOverrideSampler: null,
      profileOverrideScheduler: null,
    }),
    ...imageDiagnostics,
  };
  return {
    ...diagnostics,
    image: mergedImage,
  };
}

function isTextStreamIdleTimeoutState(threadId: string): boolean {
  const streamState = getStreamState(threadId);
  return streamState.cancelSource === 'timeout'
    && normalizeText(streamState.errorMessage).startsWith('No stream activity within ');
}

export function createAgentTailAbortSignal(
  threadId: string,
  signal: AbortSignal | undefined,
): AbortSignal | undefined {
  if (!signal) {
    return undefined;
  }
  if (signal.aborted) {
    return isTextStreamIdleTimeoutState(threadId) ? undefined : signal;
  }
  const controller = new AbortController();
  const propagateAbort = () => {
    if (isTextStreamIdleTimeoutState(threadId)) {
      return;
    }
    controller.abort();
  };
  signal.addEventListener('abort', propagateAbort, { once: true });
  return controller.signal;
}

function clearPendingAgentFollowUp(threadId: string): void {
  const entry = pendingAgentFollowUpByThread.get(threadId);
  if (!entry) {
    return;
  }
  if (entry.timerId !== null) {
    clearTimeout(entry.timerId);
  }
  pendingAgentFollowUpByThread.delete(threadId);
}

export function cancelPendingAgentFollowUpChain(threadId: string): void {
  const normalizedThreadId = normalizeText(threadId);
  if (!normalizedThreadId) {
    return;
  }
  const entry = pendingAgentFollowUpByThread.get(normalizedThreadId);
  if (!entry) {
    return;
  }
  entry.canceledByUser = true;
  clearPendingAgentFollowUp(normalizedThreadId);
}

function requireProviderMetadata(metadata: Record<string, unknown> | undefined): AgentLocalChatProviderMetadata {
  const record = metadata?.agentLocalChat;
  if (!record || typeof record !== 'object') {
    throw new Error('agent-local-chat-v1 requires metadata.agentLocalChat');
  }
  const nextRecord = record as Record<string, unknown>;
  const agentId = normalizeText(nextRecord.agentId);
  if (!agentId) {
    throw new Error('agent-local-chat-v1 metadata.agentId is required');
  }
  const targetSnapshot = nextRecord.targetSnapshot;
  if (!targetSnapshot || typeof targetSnapshot !== 'object') {
    throw new Error('agent-local-chat-v1 metadata.targetSnapshot is required');
  }
  const reasoningPreference = nextRecord.reasoningPreference === 'on' ? 'on' : 'off';
  return {
    agentId,
    targetSnapshot: targetSnapshot as AgentLocalTargetSnapshot,
    agentResolution: (nextRecord.agentResolution ?? null) as AgentEffectiveCapabilityResolution | null,
    textExecutionSnapshot: (nextRecord.textExecutionSnapshot ?? null) as AISnapshot | null,
    imageExecutionSnapshot: (nextRecord.imageExecutionSnapshot ?? null) as AISnapshot | null,
    voiceExecutionSnapshot: (nextRecord.voiceExecutionSnapshot ?? null) as AISnapshot | null,
    voiceWorkflowExecutionSnapshotByCapability: (nextRecord.voiceWorkflowExecutionSnapshotByCapability ?? {}) as Partial<Record<AgentVoiceWorkflowCapability, AISnapshot | null>>,
    latestVoiceCapture: (nextRecord.latestVoiceCapture ?? null) as ChatAgentVoiceWorkflowReferenceAudio | null,
    imageCapabilityParams: (nextRecord.imageCapabilityParams ?? null) as Record<string, unknown> | null,
    runtimeConfigState: (nextRecord.runtimeConfigState ?? null) as RuntimeConfigStateV11 | null,
    runtimeFields: (nextRecord.runtimeFields ?? {}) as RuntimeFieldMap,
    reasoningPreference,
    textModelContextTokens: normalizePositiveInteger(nextRecord.textModelContextTokens),
    textMaxOutputTokensRequested: normalizePositiveInteger(nextRecord.textMaxOutputTokensRequested),
    resolvedBehavior: (nextRecord.resolvedBehavior ?? null) as AgentResolvedBehavior | null,
  };
}

function toAbortLikeErrorMessage(error: unknown): string {
  const message = normalizeText(error instanceof Error ? error.message : String(error || ''));
  return message || 'Generation stopped.';
}

function isAbortLikeError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const name = normalizeText((error as { name?: unknown }).name).toLowerCase();
  const code = normalizeText((error as { code?: unknown }).code).toLowerCase();
  const message = normalizeText(error instanceof Error ? error.message : String(error)).toLowerCase();
  return name === 'aborterror'
    || code === 'aborterror'
    || code === 'aborted'
    || message.includes('aborted')
    || message.includes('cancelled')
    || message.includes('canceled');
}

function resolveVoiceWorkflowProgressMessage(workflowType: AgentChatVoiceWorkflowMessageMetadata['workflowType']): string {
  return workflowType === 'tts_v2v'
    ? 'Creating a custom voice from current-thread reference audio…'
    : 'Designing a custom voice for this thread…';
}

function buildVoiceWorkflowMetadata(input: {
  turnId: string;
  voiceDecision: Extract<AgentLocalChatVoiceState, { status: 'pending' }>;
  workflowStatus: AgentChatVoiceWorkflowStatus;
  jobId: string;
  traceId: string;
  voiceReference: import('./chat-agent-voice-workflow').AgentChatVoiceReferenceMeaning | null;
  voiceAssetId: string | null;
  providerVoiceRef: string | null;
  message: string;
}): AgentChatVoiceWorkflowMessageMetadata {
  return {
    kind: 'voice-workflow',
    version: 'v1',
    sourceTurnId: input.turnId,
    sourceMessageId: input.voiceDecision.sourceMessageId,
    sourceActionId: input.voiceDecision.sourceActionId,
    beatId: input.voiceDecision.beatId,
    workflowCapability: input.voiceDecision.workflowIntent.capability,
    workflowType: input.voiceDecision.workflowIntent.workflowType,
    workflowStatus: input.workflowStatus,
    jobId: input.jobId,
    playbackPrompt: input.voiceDecision.prompt,
    transcriptText: input.voiceDecision.transcriptText,
    traceId: input.traceId,
    message: input.message,
    voiceReference: input.voiceReference,
    voiceAssetId: input.voiceAssetId,
    providerVoiceRef: input.providerVoiceRef,
  };
}

export function createAgentLocalChatConversationRuntimeAdapter(): AgentLocalChatRuntimeAdapter {
  return {
    async streamText(request) {
      const result = await streamChatAgentRuntime({
        agentId: request.agentId,
        prompt: request.prompt,
        messages: request.messages,
        systemPrompt: request.systemPrompt,
        maxOutputTokensRequested: request.maxOutputTokensRequested,
        threadId: request.threadId,
        reasoningPreference: request.reasoningPreference,
        agentResolution: request.agentResolution,
        executionSnapshot: request.textExecutionSnapshot,
        runtimeConfigState: request.runtimeConfigState,
        runtimeFields: request.runtimeFields,
        signal: request.signal,
      });
      return {
        stream: normalizeAgentLocalRuntimeStream(result.stream, result.promptTraceId),
      };
    },
    async invokeText(request) {
      return invokeChatAgentRuntime({
        agentId: request.agentId,
        prompt: request.prompt,
        messages: request.messages,
        systemPrompt: request.systemPrompt,
        maxOutputTokensRequested: request.maxOutputTokensRequested,
        threadId: request.threadId,
        reasoningPreference: request.reasoningPreference,
        agentResolution: request.agentResolution,
        executionSnapshot: request.textExecutionSnapshot,
        runtimeConfigState: request.runtimeConfigState,
        runtimeFields: request.runtimeFields,
        signal: request.signal,
      });
    },
    async generateImage(request) {
      return generateChatAgentImageRuntime(request);
    },
    async synthesizeVoice(request) {
      return synthesizeChatAgentVoiceRuntime(request);
    },
    async submitVoiceWorkflow(request) {
      return submitChatAgentVoiceWorkflowRuntime(request);
    },
  };
}

async function* normalizeAgentLocalRuntimeStream(
  stream: AsyncIterable<Awaited<ReturnType<typeof streamChatAgentRuntime>>['stream'] extends AsyncIterable<infer T> ? T : never>,
  promptTraceId: string,
): AsyncIterable<ConversationRuntimeTextStreamPart> {
  for await (const part of stream) {
    const normalizedPart = normalizeConversationRuntimeTextStreamPart(part);
    switch (normalizedPart.type) {
      case 'finish':
        yield {
          ...normalizedPart,
          trace: {
            ...normalizedPart.trace,
            promptTraceId: normalizeText(normalizedPart.trace?.promptTraceId)
              || normalizeText(promptTraceId)
              || null,
          },
        };
        break;
      case 'error':
        yield {
          ...normalizedPart,
          trace: {
            ...normalizedPart.trace,
            promptTraceId: normalizeText(normalizedPart.trace?.promptTraceId)
              || normalizeText(promptTraceId)
              || null,
          },
        };
        break;
      default:
        yield normalizedPart;
    }
  }
}

function applyFollowUpChainDiagnostics(
  diagnostics: AgentModelOutputDiagnostics,
  chainContext: AgentFollowUpChainContext | null,
): AgentModelOutputDiagnostics {
  if (!chainContext) {
    return diagnostics;
  }
  return {
    ...diagnostics,
    chainId: chainContext.chainId,
    followUpDepth: chainContext.followUpDepth,
    maxFollowUpTurns: chainContext.maxFollowUpTurns,
    followUpCanceledByUser: chainContext.canceledByUser,
    followUpSourceActionId: chainContext.followUpSourceActionId,
  };
}

function buildNextFollowUpHistory(input: {
  history: ConversationTurnInput['history'];
  userMessage: ConversationTurnInput['userMessage'];
  turnId: string;
  assistantText: string;
}): ConversationTurnInput['history'] {
  return [
    ...input.history,
    {
      id: input.userMessage.id,
      role: 'user',
      text: input.userMessage.text,
    },
    {
      id: `${input.turnId}:message:0`,
      role: 'assistant',
      text: input.assistantText,
    },
  ];
}

async function runResolvedEnvelopeActions(input: {
  threadId: string;
  turnId: string;
  signal: AbortSignal | undefined;
  metadata: AgentLocalChatProviderMetadata;
  runtimeAdapter: AgentLocalChatRuntimeAdapter;
  envelope: AgentResolvedMessageActionEnvelope;
  outputDiagnostics: AgentModelOutputDiagnostics | null;
  onEvent: (event: ConversationTurnEvent) => Promise<void> | void;
}): Promise<{
  imageState: AgentLocalChatImageState;
  voiceState: AgentLocalChatVoiceState;
  outputDiagnostics: AgentModelOutputDiagnostics | null;
  followUpAction: AgentResolvedMessageActionEnvelope['actions'][number] | null;
}> {
  let voiceState: AgentLocalChatVoiceState = { status: 'none' };
  let imageState: AgentLocalChatImageState = { status: 'none' };
  let outputDiagnostics = input.outputDiagnostics;
  const followUpAction = findSingleExecutableFollowUpAction(input.envelope);
  const voiceAction = findSingleExecutableVoiceAction(input.envelope);
  const voiceDecision = voiceAction
    ? resolveVoiceStateFromResolvedAction({
      turnId: input.turnId,
      action: voiceAction,
      textMessageCount: 1,
      transcriptText: input.envelope.message.text,
      agentResolution: input.metadata.agentResolution,
      voiceExecutionSnapshot: input.metadata.voiceExecutionSnapshot,
      voiceWorkflowExecutionSnapshotByCapability: input.metadata.voiceWorkflowExecutionSnapshotByCapability,
    })
    : { status: 'none' as const };
  const imageAction = findSingleExecutableImageAction(input.envelope);
  const imageDecision = imageAction
    ? resolveImageStateFromResolvedAction({
      turnId: input.turnId,
      action: imageAction,
      textMessageCount: 1,
      agentResolution: input.metadata.agentResolution,
      imageExecutionSnapshot: input.metadata.imageExecutionSnapshot,
    })
    : { status: 'none' as const };
  const actionExecutions = [
    ...(voiceDecision.status === 'none'
      ? []
      : [{
        beatId: voiceDecision.beatId,
        beatIndex: voiceDecision.beatIndex,
        modality: 'voice' as const,
        run: async () => {
          if (voiceDecision.status === 'pending') {
            try {
              const submittedWorkflow = await input.runtimeAdapter.submitVoiceWorkflow({
                threadId: input.threadId,
                turnId: input.turnId,
                beatId: voiceDecision.beatId,
                workflowIntent: voiceDecision.workflowIntent,
                prompt: voiceDecision.prompt,
                voiceWorkflowExecutionSnapshot: input.metadata.voiceWorkflowExecutionSnapshotByCapability[
                  voiceDecision.workflowIntent.capability
                ] || null,
                referenceAudio: voiceDecision.workflowIntent.workflowType === 'tts_v2v'
                  ? input.metadata.latestVoiceCapture
                  : null,
                signal: createAgentTailAbortSignal(input.threadId, input.signal),
              });
              const progressMessage = resolveVoiceWorkflowProgressMessage(
                voiceDecision.workflowIntent.workflowType,
              );
              const workflowMetadata = buildVoiceWorkflowMetadata({
                turnId: input.turnId,
                voiceDecision,
                workflowStatus: submittedWorkflow.workflowStatus,
                jobId: submittedWorkflow.jobId,
                traceId: submittedWorkflow.traceId,
                voiceReference: submittedWorkflow.voiceReference,
                voiceAssetId: submittedWorkflow.voiceAssetId,
                providerVoiceRef: submittedWorkflow.providerVoiceRef,
                message: progressMessage,
              });
              voiceState = {
                ...voiceDecision,
                message: progressMessage,
                metadata: workflowMetadata,
              };
            } catch (voiceError) {
              voiceState = {
                status: 'error',
                beatId: voiceDecision.beatId,
                beatIndex: voiceDecision.beatIndex,
                projectionMessageId: voiceDecision.projectionMessageId,
                prompt: voiceDecision.prompt,
                transcriptText: voiceDecision.transcriptText,
                sourceMessageId: voiceDecision.sourceMessageId,
                sourceActionId: voiceDecision.sourceActionId,
                workflowIntent: voiceDecision.workflowIntent,
                message: toChatAgentRuntimeError(voiceError).message,
              };
            }
            return;
          }
          if (voiceDecision.status !== 'synthesize') {
            voiceState = voiceDecision;
            return;
          }
          await input.onEvent({
            type: 'beat-delivery-started',
            turnId: input.turnId,
            beatId: voiceDecision.beatId,
          });
          try {
            const keepaliveInterval = setInterval(() => {
              feedStreamEvent(input.threadId, { type: 'keepalive' });
            }, 10_000);
            let generatedVoice: Awaited<ReturnType<typeof input.runtimeAdapter.synthesizeVoice>>;
            try {
              generatedVoice = await input.runtimeAdapter.synthesizeVoice({
                prompt: voiceDecision.prompt,
                voiceExecutionSnapshot: input.metadata.voiceExecutionSnapshot,
                signal: createAgentTailAbortSignal(input.threadId, input.signal),
              });
            } finally {
              clearInterval(keepaliveInterval);
            }
            voiceState = {
              status: 'complete',
              beatId: voiceDecision.beatId,
              beatIndex: voiceDecision.beatIndex,
              projectionMessageId: voiceDecision.projectionMessageId,
              prompt: voiceDecision.prompt,
              transcriptText: voiceDecision.prompt,
              sourceMessageId: voiceDecision.sourceMessageId,
              sourceActionId: voiceDecision.sourceActionId,
              mediaUrl: generatedVoice.mediaUrl,
              mimeType: generatedVoice.mimeType,
              artifactId: generatedVoice.artifactId,
            };
            await input.onEvent({
              type: 'artifact-ready',
              turnId: input.turnId,
              beatId: voiceState.beatId,
              artifactId: voiceState.artifactId || voiceState.projectionMessageId,
              mimeType: voiceState.mimeType,
              projectionMessageId: voiceState.projectionMessageId,
            });
            await input.onEvent({
              type: 'beat-delivered',
              turnId: input.turnId,
              beatId: voiceState.beatId,
              projectionMessageId: voiceState.projectionMessageId,
            });
          } catch (voiceError) {
            voiceState = {
              status: 'error',
              beatId: voiceDecision.beatId,
              beatIndex: voiceDecision.beatIndex,
              projectionMessageId: voiceDecision.projectionMessageId,
              prompt: voiceDecision.prompt,
              transcriptText: voiceDecision.prompt,
              sourceMessageId: voiceDecision.sourceMessageId,
              sourceActionId: voiceDecision.sourceActionId,
              message: toChatAgentRuntimeError(voiceError).message,
            };
          }
        },
      }]),
    ...(imageDecision.status === 'none'
      ? []
      : [{
        beatId: imageDecision.beatId,
        beatIndex: imageDecision.beatIndex,
        modality: 'image' as const,
        run: async () => {
          if (imageDecision.status !== 'generate') {
            imageState = imageDecision;
            return;
          }
          await input.onEvent({
            type: 'beat-delivery-started',
            turnId: input.turnId,
            beatId: imageDecision.beatId,
          });
          try {
            const keepaliveInterval = setInterval(() => {
              feedStreamEvent(input.threadId, { type: 'keepalive' });
            }, 10_000);
            let generatedImage: Awaited<ReturnType<typeof input.runtimeAdapter.generateImage>>;
            try {
              generatedImage = await input.runtimeAdapter.generateImage({
                prompt: imageDecision.prompt,
                imageExecutionSnapshot: input.metadata.imageExecutionSnapshot,
                imageCapabilityParams: input.metadata.imageCapabilityParams,
                signal: createAgentTailAbortSignal(input.threadId, input.signal),
              });
            } finally {
              clearInterval(keepaliveInterval);
            }
            outputDiagnostics = mergeAgentImageDiagnostics(outputDiagnostics, generatedImage.diagnostics || null);
            imageState = {
              status: 'complete',
              beatId: imageDecision.beatId,
              beatIndex: imageDecision.beatIndex,
              projectionMessageId: imageDecision.projectionMessageId,
              prompt: imageDecision.prompt,
              mediaUrl: generatedImage.mediaUrl,
              mimeType: generatedImage.mimeType,
              artifactId: generatedImage.artifactId,
            };
            await input.onEvent({
              type: 'artifact-ready',
              turnId: input.turnId,
              beatId: imageState.beatId,
              artifactId: imageState.artifactId || imageState.projectionMessageId,
              mimeType: imageState.mimeType,
              projectionMessageId: imageState.projectionMessageId,
            });
            await input.onEvent({
              type: 'beat-delivered',
              turnId: input.turnId,
              beatId: imageState.beatId,
              projectionMessageId: imageState.projectionMessageId,
            });
          } catch (imageError) {
            imageState = {
              status: 'error',
              beatId: imageDecision.beatId,
              beatIndex: imageDecision.beatIndex,
              projectionMessageId: imageDecision.projectionMessageId,
              prompt: imageDecision.prompt,
              message: toChatAgentRuntimeError(imageError).message,
            };
          }
        },
      }]),
  ].sort((left, right) => left.beatIndex - right.beatIndex);
  for (const actionExecution of actionExecutions) {
    await input.onEvent({
      type: 'beat-planned',
      turnId: input.turnId,
      beatId: actionExecution.beatId,
      beatIndex: actionExecution.beatIndex,
      modality: actionExecution.modality,
    });
    await actionExecution.run();
  }
  return {
    imageState,
    voiceState,
    outputDiagnostics,
    followUpAction,
  };
}

async function* runScheduledFollowUpTurn(input: {
  baseInput: ConversationTurnInput;
  metadata: AgentLocalChatProviderMetadata;
  runtimeAdapter: AgentLocalChatRuntimeAdapter;
  continuityAdapter: AgentLocalChatContinuityAdapter;
  followUpAction: AgentResolvedMessageActionEnvelope['actions'][number];
  priorAssistantText: string;
  chainContext: AgentFollowUpChainContext;
}): AsyncIterable<ConversationProjectionRebuildResult> {
  if (
    input.followUpAction.modality !== 'follow-up-turn'
    || input.followUpAction.promptPayload.kind !== 'follow-up-turn'
  ) {
    throw new Error(`follow-up-turn action ${input.followUpAction.actionId} requires a follow-up-turn payload`);
  }
  const followUpPromptPayload = input.followUpAction.promptPayload;
  const pendingEntry: AgentPendingFollowUpEntry = {
    chainId: input.chainContext.chainId,
    followUpDepth: input.chainContext.followUpDepth,
    maxFollowUpTurns: input.chainContext.maxFollowUpTurns,
    timerId: null,
    canceledByUser: false,
  };
  clearPendingAgentFollowUp(input.baseInput.threadId);
  try {
    await new Promise<void>((resolve, reject) => {
      const abortWithError = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      const timerId = setTimeout(() => {
        if (pendingAgentFollowUpByThread.get(input.baseInput.threadId) === pendingEntry) {
          pendingAgentFollowUpByThread.delete(input.baseInput.threadId);
        }
        input.baseInput.signal?.removeEventListener('abort', abortWithError);
        resolve();
      }, followUpPromptPayload.delayMs);
      pendingEntry.timerId = timerId;
      pendingAgentFollowUpByThread.set(input.baseInput.threadId, pendingEntry);
      if (input.baseInput.signal?.aborted) {
        clearTimeout(timerId);
        pendingAgentFollowUpByThread.delete(input.baseInput.threadId);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        return;
      }
      input.baseInput.signal?.addEventListener('abort', () => {
        clearTimeout(timerId);
        if (pendingAgentFollowUpByThread.get(input.baseInput.threadId) === pendingEntry) {
          pendingAgentFollowUpByThread.delete(input.baseInput.threadId);
        }
        abortWithError();
      }, { once: true });
    });
  } catch (error) {
    if (isAbortLikeError(error) || input.baseInput.signal?.aborted) {
      return;
    }
    throw error;
  }

  const followUpTurnId = randomIdV11('agent-turn');
  const followUpUserMessageId = randomIdV11('agent-turn-followup');
  const followUpHistory = buildNextFollowUpHistory({
    history: input.baseInput.history,
    userMessage: input.baseInput.userMessage,
    turnId: input.baseInput.turnId,
    assistantText: input.priorAssistantText,
  });
  const turnContext = await input.continuityAdapter.loadTurnContext({
    modeId: 'agent-local-chat-v1',
    threadId: input.baseInput.threadId,
    turnId: followUpTurnId,
    signal: input.baseInput.signal,
  });
  const executionRequest = buildAgentLocalChatExecutionTextRequest({
    systemPrompt: normalizeText(input.baseInput.systemPrompt) || null,
    targetSnapshot: input.metadata.targetSnapshot,
    history: followUpHistory,
    userText: followUpPromptPayload.promptText,
    userAttachments: [],
    context: turnContext,
    resolvedBehavior: null,
    modelContextTokens: input.metadata.textModelContextTokens,
    maxOutputTokensRequested: input.metadata.textMaxOutputTokensRequested,
  });
  const invokeResult = await input.runtimeAdapter.invokeText({
    agentId: input.metadata.agentId,
    prompt: executionRequest.prompt,
    messages: executionRequest.messages,
    systemPrompt: executionRequest.systemPrompt,
    maxOutputTokensRequested: executionRequest.diagnostics.maxOutputTokensRequested,
    threadId: input.baseInput.threadId,
    agentResolution: input.metadata.agentResolution,
    textExecutionSnapshot: input.metadata.textExecutionSnapshot,
    runtimeConfigState: input.metadata.runtimeConfigState,
    runtimeFields: input.metadata.runtimeFields,
    reasoningPreference: input.metadata.reasoningPreference,
    signal: input.baseInput.signal,
  });
  const resolvedOutput = resolveAgentModelOutputEnvelope({
    modelOutput: invokeResult.text,
    requestPrompt: executionRequest.prompt,
    requestSystemPrompt: executionRequest.systemPrompt,
    trace: {
      traceId: invokeResult.traceId,
      promptTraceId: invokeResult.promptTraceId,
    },
    contextWindowSource: executionRequest.diagnostics.contextWindowSource,
    maxOutputTokensRequested: executionRequest.diagnostics.maxOutputTokensRequested,
    promptOverflow: executionRequest.diagnostics.promptOverflow,
  });
  if (!resolvedOutput.ok) {
    const diagnostics = applyFollowUpChainDiagnostics(resolvedOutput.diagnostics, input.chainContext);
    logRendererEvent({
      level: 'warn',
      area: 'agent-chat-output',
      message: 'action:agent-local-chat-v1-follow-up-parse-failed',
      details: {
        classification: diagnostics.classification,
        recoveryPath: diagnostics.recoveryPath,
        suspectedTruncation: diagnostics.suspectedTruncation,
        parseErrorDetail: diagnostics.parseErrorDetail,
        traceId: diagnostics.traceId,
        promptTraceId: diagnostics.promptTraceId,
        chainId: diagnostics.chainId,
        followUpDepth: diagnostics.followUpDepth,
      },
    });
    return;
  }

  const followUpEnvelope = resolvedOutput.envelope;
  let followUpDiagnostics = applyFollowUpChainDiagnostics(resolvedOutput.diagnostics, input.chainContext);
  const followUpOutputText = buildAgentResolvedOutputText(followUpEnvelope);
  const textMessageState = resolveCompletedTextMessageStateFromEnvelope({
    turnId: followUpTurnId,
    envelope: followUpEnvelope,
    metadataJson: buildAgentTextTurnDebugMetadata(followUpDiagnostics, {
      followUpTurn: true,
      chainId: input.chainContext.chainId,
      followUpDepth: input.chainContext.followUpDepth,
      maxFollowUpTurns: input.chainContext.maxFollowUpTurns,
      followUpCanceledByUser: input.chainContext.canceledByUser,
      followUpSourceActionId: input.followUpAction.actionId,
      followUpDelayMs: followUpPromptPayload.delayMs,
    }),
  });
  const emittedEvents: ConversationTurnEvent[] = [
    {
      type: 'turn-started',
      modeId: 'agent-local-chat-v1',
      threadId: input.baseInput.threadId,
      turnId: followUpTurnId,
    },
    {
      type: 'message-sealed',
      turnId: followUpTurnId,
      messageId: textMessageState.messageId,
      beatId: `${followUpTurnId}:beat:0`,
      text: followUpOutputText,
    },
  ];
  const actionResult = await runResolvedEnvelopeActions({
    threadId: input.baseInput.threadId,
    turnId: followUpTurnId,
    signal: input.baseInput.signal,
    metadata: input.metadata,
    runtimeAdapter: input.runtimeAdapter,
    envelope: followUpEnvelope,
    outputDiagnostics: followUpDiagnostics,
    onEvent: (event) => {
      emittedEvents.push(event);
    },
  });
  followUpDiagnostics = actionResult.outputDiagnostics || followUpDiagnostics;
  const terminalEvent: ConversationTurnEvent = {
    type: 'turn-completed',
    turnId: followUpTurnId,
    outputText: followUpOutputText,
    finishReason: 'stop',
    trace: {
      traceId: invokeResult.traceId,
      promptTraceId: invokeResult.promptTraceId,
    },
    diagnostics: followUpDiagnostics as Record<string, unknown>,
  };
  const commitResult = await commitProviderOutcome({
    continuityAdapter: input.continuityAdapter,
    baseInput: {
      ...input.baseInput,
      turnId: followUpTurnId,
      userMessage: {
        id: followUpUserMessageId,
        text: input.followUpAction.promptPayload.promptText,
        attachments: [],
      },
      history: followUpHistory,
    },
    emittedEvents,
    terminalEvent,
    outcome: 'completed',
    outputText: followUpOutputText,
    reasoningText: '',
    imageState: actionResult.imageState,
    voiceState: actionResult.voiceState,
    textMessageState,
  });
  yield {
    threadId: input.baseInput.threadId,
    projectionVersion: commitResult.projectionVersion,
    bundle: commitResult.bundle,
  };
  const nextFollowUpAction = actionResult.followUpAction;
  if (
    nextFollowUpAction
    && nextFollowUpAction.modality === 'follow-up-turn'
    && input.chainContext.followUpDepth < input.chainContext.maxFollowUpTurns
  ) {
    yield* runScheduledFollowUpTurn({
      baseInput: {
        ...input.baseInput,
        turnId: followUpTurnId,
        userMessage: {
          id: followUpUserMessageId,
          text: followUpPromptPayload.promptText,
          attachments: [],
        },
        history: followUpHistory,
      },
      metadata: input.metadata,
      runtimeAdapter: input.runtimeAdapter,
      continuityAdapter: input.continuityAdapter,
      followUpAction: nextFollowUpAction,
      priorAssistantText: followUpOutputText,
      chainContext: {
        chainId: input.chainContext.chainId,
        followUpDepth: input.chainContext.followUpDepth + 1,
        maxFollowUpTurns: input.chainContext.maxFollowUpTurns,
        followUpSourceActionId: nextFollowUpAction.actionId,
        sourceTurnId: followUpTurnId,
        canceledByUser: input.chainContext.canceledByUser,
      },
    });
  }
}

export function createAgentLocalChatConversationProvider(
  options: AgentLocalChatProviderOptions = {},
): ConversationOrchestrationProvider {
  const runtimeAdapter = options.runtimeAdapter ?? createAgentLocalChatConversationRuntimeAdapter();
  const continuityAdapter = options.continuityAdapter ?? createAgentLocalChatContinuityAdapter();
  return {
    modeId: 'agent-local-chat-v1',
    capabilities: AGENT_LOCAL_CHAT_PROVIDER_CAPABILITIES,
    async *runTurn(input: ConversationTurnInput): AsyncIterable<ConversationTurnEvent> {
      const metadata = requireProviderMetadata(input.metadata);
      const userText = normalizeText(input.userMessage.text);
      const userAttachments = Array.isArray(input.userMessage.attachments)
        ? input.userMessage.attachments as readonly AgentChatUserAttachment[]
        : [];
      if (!userText && userAttachments.length === 0) {
        throw new Error('agent-local-chat-v1 requires a non-empty user message or image attachment');
      }

      const turnContext = await continuityAdapter.loadTurnContext({
        modeId: 'agent-local-chat-v1',
        threadId: input.threadId,
        turnId: input.turnId,
        signal: input.signal,
      });
      const executionRequest = buildAgentLocalChatExecutionTextRequest({
        systemPrompt: normalizeText(input.systemPrompt) || null,
        targetSnapshot: metadata.targetSnapshot,
        history: input.history,
        userText,
        userAttachments,
        context: turnContext,
        resolvedBehavior: metadata.resolvedBehavior,
        modelContextTokens: metadata.textModelContextTokens,
        maxOutputTokensRequested: metadata.textMaxOutputTokensRequested,
      });

      const emittedEvents: ConversationTurnEvent[] = [];
      const turnStarted: ConversationTurnEvent = {
        type: 'turn-started',
        modeId: 'agent-local-chat-v1',
        threadId: input.threadId,
        turnId: input.turnId,
      };
      emittedEvents.push(turnStarted);
      yield turnStarted;

      let rawModelOutput = '';
      let outputText = '';
      let reasoningText = '';
      let terminalEventEmitted = false;
      let textMessageState: AgentLocalTextMessageState | null = null;
      let outputDiagnostics: AgentModelOutputDiagnostics | null = null;
      const textPlanningStartedAt = Date.now();

      try {
        const runtimeResult = await runtimeAdapter.streamText({
          agentId: metadata.agentId,
          prompt: executionRequest.prompt,
          messages: executionRequest.messages,
          systemPrompt: executionRequest.systemPrompt,
          maxOutputTokensRequested: executionRequest.diagnostics.maxOutputTokensRequested,
          threadId: input.threadId,
          agentResolution: metadata.agentResolution,
          textExecutionSnapshot: metadata.textExecutionSnapshot,
          runtimeConfigState: metadata.runtimeConfigState,
          runtimeFields: metadata.runtimeFields,
          reasoningPreference: metadata.reasoningPreference,
          signal: input.signal,
        });

        for await (const part of runtimeResult.stream) {
          switch (part.type) {
            case 'start':
              break;
            case 'reasoning-delta': {
              reasoningText += part.textDelta;
              const reasoningEvent: ConversationTurnEvent = {
                type: 'reasoning-delta',
                turnId: input.turnId,
                textDelta: part.textDelta,
              };
              emittedEvents.push(reasoningEvent);
              yield reasoningEvent;
              break;
            }
            case 'text-delta': {
              rawModelOutput += part.textDelta;
              break;
            }
            case 'finish': {
              if (!normalizeText(rawModelOutput)) {
                throw new Error('agent-local-chat-v1 runtime stream completed without output text');
              }
              const resolvedOutput = resolveAgentModelOutputEnvelope({
                modelOutput: rawModelOutput,
                requestPrompt: executionRequest.prompt,
                requestSystemPrompt: executionRequest.systemPrompt,
                finishReason: part.finishReason,
                trace: part.trace,
                usage: part.usage,
                contextWindowSource: executionRequest.diagnostics.contextWindowSource,
                maxOutputTokensRequested: executionRequest.diagnostics.maxOutputTokensRequested,
                promptOverflow: executionRequest.diagnostics.promptOverflow,
              });
              outputDiagnostics = resolvedOutput.diagnostics;
              outputDiagnostics = mergeAgentImageDiagnostics(outputDiagnostics, {
                textPlanningMs: Date.now() - textPlanningStartedAt,
              });
              if (!resolvedOutput.ok) {
                const resolvedDiagnostics = outputDiagnostics || resolvedOutput.diagnostics;
                const outputError = toAgentModelOutputTurnError(resolvedDiagnostics);
                logRendererEvent({
                  level: 'warn',
                  area: 'agent-chat-output',
                  message: 'action:agent-local-chat-v1-output-parse-failed',
                  details: {
                    classification: resolvedDiagnostics.classification,
                    recoveryPath: resolvedDiagnostics.recoveryPath,
                    suspectedTruncation: resolvedDiagnostics.suspectedTruncation,
                    parseErrorDetail: resolvedDiagnostics.parseErrorDetail,
                    rawOutputChars: resolvedDiagnostics.rawOutputChars,
                    normalizedOutputChars: resolvedDiagnostics.normalizedOutputChars,
                    finishReason: resolvedDiagnostics.finishReason,
                    traceId: resolvedDiagnostics.traceId,
                    promptTraceId: resolvedDiagnostics.promptTraceId,
                  },
                });
                const terminalEvent: ConversationTurnEvent = {
                  type: 'turn-failed',
                  turnId: input.turnId,
                  error: outputError,
                  outputText: outputText || undefined,
                  reasoningText: reasoningText || undefined,
                  finishReason: part.finishReason,
                  usage: part.usage,
                  trace: part.trace,
                  diagnostics: outputDiagnostics as Record<string, unknown>,
                };
                const commitResult = await commitProviderOutcome({
                  continuityAdapter,
                  baseInput: input,
                  emittedEvents,
                  terminalEvent,
                  outcome: 'failed',
                  outputText,
                  reasoningText,
                  error: outputError,
                  textMessageState: textMessageState || undefined,
                });
                yield {
                  type: 'projection-rebuilt',
                  threadId: input.threadId,
                  projectionVersion: commitResult.projectionVersion,
                  bundle: commitResult.bundle,
                };
                terminalEventEmitted = true;
                yield terminalEvent;
                return;
              }
              const resolvedEnvelope: AgentResolvedMessageActionEnvelope = resolvedOutput.envelope;
              textMessageState = resolveCompletedTextMessageStateFromEnvelope({
                turnId: input.turnId,
                envelope: resolvedEnvelope,
                metadataJson: buildAgentTextTurnDebugMetadata(resolvedOutput.diagnostics),
              });
              outputText = buildAgentResolvedOutputText(resolvedEnvelope);
              const sealedEvent: ConversationTurnEvent = {
                type: 'message-sealed',
                turnId: input.turnId,
                messageId: textMessageState.messageId,
                beatId: `${input.turnId}:beat:0`,
                text: outputText,
              };
              emittedEvents.push(sealedEvent);
              yield sealedEvent;
              const actionEvents: ConversationTurnEvent[] = [];
              const actionResult = await runResolvedEnvelopeActions({
                threadId: input.threadId,
                turnId: input.turnId,
                signal: input.signal,
                metadata,
                runtimeAdapter,
                envelope: resolvedEnvelope,
                outputDiagnostics,
                onEvent: (event) => {
                  emittedEvents.push(event);
                  actionEvents.push(event);
                },
              });
              outputDiagnostics = actionResult.outputDiagnostics;
              for (const actionEvent of actionEvents) {
                yield actionEvent;
              }
              const terminalEvent: ConversationTurnEvent = {
                type: 'turn-completed',
                turnId: input.turnId,
                outputText,
                reasoningText: reasoningText || undefined,
                finishReason: part.finishReason,
                usage: part.usage,
                trace: part.trace,
                diagnostics: outputDiagnostics
                  ? outputDiagnostics as Record<string, unknown>
                  : undefined,
              };
              const commitResult = await commitProviderOutcome({
                continuityAdapter,
                baseInput: input,
                emittedEvents,
                terminalEvent,
                outcome: 'completed',
                outputText,
                reasoningText,
                imageState: actionResult.imageState,
                voiceState: actionResult.voiceState,
                textMessageState: textMessageState || undefined,
              });
              yield {
                type: 'projection-rebuilt',
                threadId: input.threadId,
                projectionVersion: commitResult.projectionVersion,
                bundle: commitResult.bundle,
              };
              terminalEventEmitted = true;
              yield terminalEvent;
              if (actionResult.followUpAction && actionResult.followUpAction.modality === 'follow-up-turn') {
                for await (const followUpProjection of runScheduledFollowUpTurn({
                  baseInput: input,
                  metadata,
                  runtimeAdapter,
                  continuityAdapter,
                  followUpAction: actionResult.followUpAction,
                  priorAssistantText: outputText,
                  chainContext: {
                    chainId: randomIdV11('agent-followup-chain'),
                    followUpDepth: 1,
                    maxFollowUpTurns: MAX_AGENT_FOLLOW_UP_TURNS,
                    followUpSourceActionId: actionResult.followUpAction.actionId,
                    sourceTurnId: input.turnId,
                    canceledByUser: false,
                  },
                })) {
                  yield {
                    type: 'projection-rebuilt',
                    threadId: followUpProjection.threadId,
                    projectionVersion: followUpProjection.projectionVersion,
                    bundle: followUpProjection.bundle,
                  };
                }
              }
              return;
            }
            case 'error': {
              const terminalEvent: ConversationTurnEvent = {
                type: 'turn-failed',
                turnId: input.turnId,
                error: part.error,
                outputText: outputText || undefined,
                reasoningText: reasoningText || undefined,
                diagnostics: outputDiagnostics
                  ? outputDiagnostics as Record<string, unknown>
                  : undefined,
                trace: part.trace,
              };
              const commitResult = await commitProviderOutcome({
                continuityAdapter,
                baseInput: input,
                emittedEvents,
                terminalEvent,
                outcome: 'failed',
                outputText,
                reasoningText,
                error: part.error,
                textMessageState: textMessageState || undefined,
              });
              yield {
                type: 'projection-rebuilt',
                threadId: input.threadId,
                projectionVersion: commitResult.projectionVersion,
                bundle: commitResult.bundle,
              };
              terminalEventEmitted = true;
              yield terminalEvent;
              return;
            }
            default:
              throw new Error(`Unsupported agent-local-chat-v1 runtime part: ${JSON.stringify(part)}`);
          }
        }
        if (!terminalEventEmitted) {
          throw new Error('agent-local-chat-v1 runtime stream ended without a terminal event');
        }
      } catch (error) {
        if (isAbortLikeError(error) || input.signal?.aborted) {
          const terminalEvent: ConversationTurnEvent = {
            type: 'turn-canceled',
            turnId: input.turnId,
            scope: 'turn',
            outputText: outputText || undefined,
            reasoningText: reasoningText || undefined,
            diagnostics: outputDiagnostics
              ? outputDiagnostics as Record<string, unknown>
              : undefined,
          };
          const commitResult = await commitProviderOutcome({
            continuityAdapter,
            baseInput: input,
            emittedEvents,
            terminalEvent,
            outcome: 'canceled',
            outputText,
            reasoningText,
            error: {
              code: 'OPERATION_ABORTED',
              message: toAbortLikeErrorMessage(error),
            },
            textMessageState: textMessageState || undefined,
          });
          yield {
            type: 'projection-rebuilt',
            threadId: input.threadId,
            projectionVersion: commitResult.projectionVersion,
            bundle: commitResult.bundle,
          };
          yield terminalEvent;
          return;
        }
        const runtimeError = toChatAgentRuntimeError(error);
        const terminalEvent: ConversationTurnEvent = {
          type: 'turn-failed',
          turnId: input.turnId,
          error: runtimeError,
          outputText: outputText || undefined,
          reasoningText: reasoningText || undefined,
          diagnostics: outputDiagnostics
            ? outputDiagnostics as Record<string, unknown>
            : undefined,
        };
        const commitResult = await commitProviderOutcome({
          continuityAdapter,
          baseInput: input,
          emittedEvents,
          terminalEvent,
          outcome: 'failed',
          outputText,
          reasoningText,
          error: runtimeError,
          textMessageState: textMessageState || undefined,
        });
        yield {
          type: 'projection-rebuilt',
          threadId: input.threadId,
          projectionVersion: commitResult.projectionVersion,
          bundle: commitResult.bundle,
        };
        yield terminalEvent;
      }
    },
  };
}
