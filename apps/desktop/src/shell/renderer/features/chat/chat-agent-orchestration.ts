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
  waitForResolvedDelay,
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

async function runScheduledFollowUpTurn(input: {
  baseInput: ConversationTurnInput;
  metadata: AgentLocalChatProviderMetadata;
  runtimeAdapter: AgentLocalChatRuntimeAdapter;
  continuityAdapter: AgentLocalChatContinuityAdapter;
  followUpAction: AgentResolvedMessageActionEnvelope['actions'][number];
  priorAssistantText: string;
}): Promise<ConversationProjectionRebuildResult | null> {
  if (
    input.followUpAction.modality !== 'follow-up-turn'
    || input.followUpAction.promptPayload.kind !== 'follow-up-turn'
  ) {
    throw new Error(`follow-up-turn action ${input.followUpAction.actionId} requires a follow-up-turn payload`);
  }
  await waitForResolvedDelay({
    delayMs: input.followUpAction.promptPayload.delayMs,
    signal: input.baseInput.signal,
    threadId: input.baseInput.threadId,
  });

  const followUpTurnId = randomIdV11('agent-turn');
  const followUpUserMessageId = randomIdV11('agent-turn-followup');
  const followUpHistory = [
    ...input.baseInput.history,
    {
      id: input.baseInput.userMessage.id,
      role: 'user' as const,
      text: input.baseInput.userMessage.text,
    },
    {
      id: `${input.baseInput.turnId}:message:0`,
      role: 'assistant' as const,
      text: input.priorAssistantText,
    },
  ];
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
    userText: input.followUpAction.promptPayload.promptText,
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
    logRendererEvent({
      level: 'warn',
      area: 'agent-chat-output',
      message: 'action:agent-local-chat-v1-follow-up-parse-failed',
      details: {
        classification: resolvedOutput.diagnostics.classification,
        recoveryPath: resolvedOutput.diagnostics.recoveryPath,
        suspectedTruncation: resolvedOutput.diagnostics.suspectedTruncation,
        parseErrorDetail: resolvedOutput.diagnostics.parseErrorDetail,
        traceId: resolvedOutput.diagnostics.traceId,
        promptTraceId: resolvedOutput.diagnostics.promptTraceId,
      },
    });
    return null;
  }

  const followUpEnvelope = resolvedOutput.envelope;
  const followUpOutputText = buildAgentResolvedOutputText(followUpEnvelope);
  const textMessageState = resolveCompletedTextMessageStateFromEnvelope({
    turnId: followUpTurnId,
    envelope: followUpEnvelope,
    metadataJson: buildAgentTextTurnDebugMetadata(resolvedOutput.diagnostics, {
      followUpTurn: true,
      followUpSourceActionId: input.followUpAction.actionId,
      followUpDelayMs: input.followUpAction.promptPayload.delayMs,
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
  const terminalEvent: ConversationTurnEvent = {
    type: 'turn-completed',
    turnId: followUpTurnId,
    outputText: followUpOutputText,
    trace: {
      traceId: invokeResult.traceId,
      promptTraceId: invokeResult.promptTraceId,
    },
    diagnostics: resolvedOutput.diagnostics as Record<string, unknown>,
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
    textMessageState,
  });
  return {
    threadId: input.baseInput.threadId,
    projectionVersion: commitResult.projectionVersion,
  };
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
              let voiceState: AgentLocalChatVoiceState = { status: 'none' };
              let imageState: AgentLocalChatImageState = { status: 'none' };
              const followUpAction = findSingleExecutableFollowUpAction(resolvedEnvelope);
              const voiceAction = findSingleExecutableVoiceAction(resolvedEnvelope);
              const voiceDecision = voiceAction
                ? resolveVoiceStateFromResolvedAction({
                  turnId: input.turnId,
                  action: voiceAction,
                  textMessageCount: 1,
                  transcriptText: resolvedEnvelope.message.text,
                  agentResolution: metadata.agentResolution,
                  voiceExecutionSnapshot: metadata.voiceExecutionSnapshot,
                  voiceWorkflowExecutionSnapshotByCapability: metadata.voiceWorkflowExecutionSnapshotByCapability,
                })
                : { status: 'none' as const };
              const imageAction = findSingleExecutableImageAction(resolvedEnvelope);
              const imageDecision = imageAction
                ? resolveImageStateFromResolvedAction({
                  turnId: input.turnId,
                  action: imageAction,
                  textMessageCount: 1,
                  agentResolution: metadata.agentResolution,
                  imageExecutionSnapshot: metadata.imageExecutionSnapshot,
                })
                : { status: 'none' as const };
              const actionExecutions = [
                ...(voiceDecision.status === 'none'
                  ? []
                  : [{
                    beatId: voiceDecision.beatId,
                    beatIndex: voiceDecision.beatIndex,
                    modality: 'voice' as const,
                    run: async function* (): AsyncIterable<ConversationTurnEvent> {
                      if (voiceDecision.status === 'pending') {
                        try {
                          const submittedWorkflow = await runtimeAdapter.submitVoiceWorkflow({
                            threadId: input.threadId,
                            turnId: input.turnId,
                            beatId: voiceDecision.beatId,
                            workflowIntent: voiceDecision.workflowIntent,
                            prompt: voiceDecision.prompt,
                            voiceWorkflowExecutionSnapshot: metadata.voiceWorkflowExecutionSnapshotByCapability[
                              voiceDecision.workflowIntent.capability
                            ] || null,
                            referenceAudio: voiceDecision.workflowIntent.workflowType === 'tts_v2v'
                              ? metadata.latestVoiceCapture
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
                      const voiceDeliveryStarted: ConversationTurnEvent = {
                        type: 'beat-delivery-started',
                        turnId: input.turnId,
                        beatId: voiceDecision.beatId,
                      };
                      yield voiceDeliveryStarted;
                      try {
                        const keepaliveInterval = setInterval(() => {
                          feedStreamEvent(input.threadId, { type: 'keepalive' });
                        }, 10_000);
                        let generatedVoice: Awaited<ReturnType<typeof runtimeAdapter.synthesizeVoice>>;
                        try {
                          generatedVoice = await runtimeAdapter.synthesizeVoice({
                            prompt: voiceDecision.prompt,
                            voiceExecutionSnapshot: metadata.voiceExecutionSnapshot,
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
                        yield {
                          type: 'artifact-ready',
                          turnId: input.turnId,
                          beatId: voiceState.beatId,
                          artifactId: voiceState.artifactId || voiceState.projectionMessageId,
                          mimeType: voiceState.mimeType,
                          projectionMessageId: voiceState.projectionMessageId,
                        };
                        yield {
                          type: 'beat-delivered',
                          turnId: input.turnId,
                          beatId: voiceState.beatId,
                          projectionMessageId: voiceState.projectionMessageId,
                        };
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
                    run: async function* (): AsyncIterable<ConversationTurnEvent> {
                      if (imageDecision.status !== 'generate') {
                        imageState = imageDecision;
                        return;
                      }
                      const imageDeliveryStarted: ConversationTurnEvent = {
                        type: 'beat-delivery-started',
                        turnId: input.turnId,
                        beatId: imageDecision.beatId,
                      };
                      yield imageDeliveryStarted;
                      try {
                        // Keep stream alive during long artifact generation.
                        const keepaliveInterval = setInterval(() => {
                          feedStreamEvent(input.threadId, { type: 'keepalive' });
                        }, 10_000);
                        let generatedImage: Awaited<ReturnType<typeof runtimeAdapter.generateImage>>;
                        try {
                          generatedImage = await runtimeAdapter.generateImage({
                            prompt: imageDecision.prompt,
                            imageExecutionSnapshot: metadata.imageExecutionSnapshot,
                            imageCapabilityParams: metadata.imageCapabilityParams,
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
                        yield {
                          type: 'artifact-ready',
                          turnId: input.turnId,
                          beatId: imageState.beatId,
                          artifactId: imageState.artifactId || imageState.projectionMessageId,
                          mimeType: imageState.mimeType,
                          projectionMessageId: imageState.projectionMessageId,
                        };
                        yield {
                          type: 'beat-delivered',
                          turnId: input.turnId,
                          beatId: imageState.beatId,
                          projectionMessageId: imageState.projectionMessageId,
                        };
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
                const plannedEvent: ConversationTurnEvent = {
                  type: 'beat-planned',
                  turnId: input.turnId,
                  beatId: actionExecution.beatId,
                  beatIndex: actionExecution.beatIndex,
                  modality: actionExecution.modality,
                };
                emittedEvents.push(plannedEvent);
                yield plannedEvent;
                for await (const actionEvent of actionExecution.run()) {
                  emittedEvents.push(actionEvent);
                  yield actionEvent;
                }
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
                imageState,
                voiceState,
                textMessageState: textMessageState || undefined,
              });
              yield {
                type: 'projection-rebuilt',
                threadId: input.threadId,
                projectionVersion: commitResult.projectionVersion,
              };
              terminalEventEmitted = true;
              yield terminalEvent;
              if (followUpAction && followUpAction.modality === 'follow-up-turn') {
                const followUpProjection = await runScheduledFollowUpTurn({
                  baseInput: input,
                  metadata,
                  runtimeAdapter,
                  continuityAdapter,
                  followUpAction,
                  priorAssistantText: outputText,
                });
                if (followUpProjection) {
                  yield {
                    type: 'projection-rebuilt',
                    threadId: followUpProjection.threadId,
                    projectionVersion: followUpProjection.projectionVersion,
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
        };
        yield terminalEvent;
      }
    },
  };
}
