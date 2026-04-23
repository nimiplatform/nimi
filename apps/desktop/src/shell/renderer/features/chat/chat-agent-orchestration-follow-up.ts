import type {
  ConversationProjectionRebuildResult,
  ConversationRuntimeTrace,
  ConversationTurnEvent,
  ConversationTurnInput,
} from '@nimiplatform/nimi-kit/features/chat';
import type { JsonObject } from '@renderer/bridge/runtime-bridge/shared';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import { randomIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import {
  buildAgentLocalChatExecutionTextRequest,
  type AgentLocalChatExecutionTextRequest,
} from './chat-nimi-execution-engine';
import {
  buildAgentResolvedOutputText,
  resolveAgentModelOutputEnvelope,
  type AgentModelOutputDiagnostics,
} from './chat-agent-behavior-resolver';
import { buildAgentTextTurnDebugMetadata } from './chat-agent-debug-metadata';
import {
  commitProviderOutcome,
  type AgentLocalChatContinuityAdapter,
} from './chat-agent-continuity';
import {
  resolveCompletedTextMessageStateFromEnvelope,
} from './chat-agent-turn-plan';
import {
  isAbortLikeError,
  normalizeText,
} from './chat-agent-orchestration-shared';
import { runResolvedEnvelopeActions } from './chat-agent-orchestration-actions';
import type {
  AgentFollowUpChainContext,
  AgentLocalChatProviderMetadata,
  AgentLocalChatRuntimeAdapter,
  AgentPendingFollowUpEntry,
} from './chat-agent-orchestration';

const pendingAgentFollowUpByThread = new Map<string, AgentPendingFollowUpEntry>();

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
  assistantText: string;
  assistantTurnId: string;
  includeUserMessage: boolean;
}): ConversationTurnInput['history'] {
  return [
    ...input.history,
    ...(input.includeUserMessage
      ? [{
        id: input.userMessage.id,
        role: 'user' as const,
        text: input.userMessage.text,
      }]
      : []),
    {
      id: `${input.assistantTurnId}:message:0`,
      role: 'assistant',
      text: input.assistantText,
    },
  ];
}

function normalizeComparableText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function buildFollowUpChainDiagnosticsRecord(
  chainContext: AgentFollowUpChainContext,
): Record<string, unknown> {
  return {
    chainId: chainContext.chainId,
    followUpDepth: chainContext.followUpDepth,
    maxFollowUpTurns: chainContext.maxFollowUpTurns,
    followUpCanceledByUser: chainContext.canceledByUser,
    followUpSourceActionId: chainContext.followUpSourceActionId,
  };
}

function buildFollowUpTextMetadata(input: {
  metadataJson?: JsonObject | null;
  diagnostics: AgentModelOutputDiagnostics | null;
  envelope: import('./chat-agent-behavior').AgentResolvedMessageActionEnvelope;
  chainContext: AgentFollowUpChainContext;
  followUpInstruction: string;
  followUpActionId: string;
  followUpDelayMs: number;
}): JsonObject | null {
  const baseRecord = input.metadataJson && typeof input.metadataJson === 'object' && !Array.isArray(input.metadataJson)
    ? input.metadataJson as Record<string, unknown>
    : null;
  if (baseRecord && typeof baseRecord.debugType === 'string' && baseRecord.debugType === 'agent-text-turn') {
    const prompt = normalizeText(baseRecord.prompt);
    if (prompt) {
      return {
        ...baseRecord,
        statusCue: input.envelope.statusCue || baseRecord.statusCue || null,
        followUpInstruction: input.followUpInstruction,
        followUpTurn: true,
        chainId: input.chainContext.chainId,
        followUpDepth: input.chainContext.followUpDepth,
        maxFollowUpTurns: input.chainContext.maxFollowUpTurns,
        followUpCanceledByUser: input.chainContext.canceledByUser,
        followUpSourceActionId: input.followUpActionId,
        followUpDelayMs: input.followUpDelayMs,
      } satisfies JsonObject;
    }
  }
  return buildAgentTextTurnDebugMetadata(input.diagnostics, {
    statusCue: input.envelope.statusCue || null,
    followUpTurn: true,
    followUpInstruction: input.followUpInstruction,
    chainId: input.chainContext.chainId,
    followUpDepth: input.chainContext.followUpDepth,
    maxFollowUpTurns: input.chainContext.maxFollowUpTurns,
    followUpCanceledByUser: input.chainContext.canceledByUser,
    followUpSourceActionId: input.followUpActionId,
    followUpDelayMs: input.followUpDelayMs,
  });
}

type FollowUpRuntimeAgentStreamResult =
  | { status: 'unsupported' }
  | { status: 'aborted' }
  | { status: 'failed'; reason: string }
  | {
    status: 'ok';
    envelope: import('./chat-agent-behavior').AgentResolvedMessageActionEnvelope;
    diagnostics: Record<string, unknown> | null;
    metadataJson: JsonObject | null;
    trace: ConversationRuntimeTrace | undefined;
  };

async function runFollowUpRuntimeAgentStream(input: {
  runtimeAdapter: AgentLocalChatRuntimeAdapter;
  metadata: AgentLocalChatProviderMetadata;
  executionRequest: AgentLocalChatExecutionTextRequest;
  followUpHistory: ConversationTurnInput['history'];
  baseInput: ConversationTurnInput;
}): Promise<FollowUpRuntimeAgentStreamResult> {
  if (!input.runtimeAdapter.streamAgentTurn) {
    return { status: 'unsupported' };
  }
  const runtimeResult = await input.runtimeAdapter.streamAgentTurn({
    agentId: input.metadata.agentId,
    conversationAnchorId: input.metadata.conversationAnchorId,
    prompt: input.executionRequest.prompt,
    history: input.followUpHistory,
    messages: input.executionRequest.messages,
    systemPrompt: input.executionRequest.systemPrompt,
    maxOutputTokensRequested: input.executionRequest.diagnostics.maxOutputTokensRequested,
    threadId: input.baseInput.threadId,
    agentResolution: input.metadata.agentResolution,
    textExecutionSnapshot: input.metadata.textExecutionSnapshot,
    runtimeConfigState: input.metadata.runtimeConfigState,
    runtimeFields: input.metadata.runtimeFields,
    reasoningPreference: input.metadata.reasoningPreference,
    signal: input.baseInput.signal,
  });

  let sealedEnvelope: import('./chat-agent-behavior').AgentResolvedMessageActionEnvelope | null = null;
  let sealedMetadataJson: JsonObject | null = null;
  let sealedDiagnostics: Record<string, unknown> | null = null;
  let sealedTrace: ConversationRuntimeTrace | undefined;

  for await (const part of runtimeResult.stream) {
    switch (part.type) {
      case 'reasoning-delta':
        break;
      case 'message-sealed':
        sealedEnvelope = part.envelope;
        sealedMetadataJson = part.metadataJson || null;
        sealedDiagnostics = part.diagnostics || null;
        sealedTrace = part.trace;
        break;
      case 'turn-completed':
        if (!sealedEnvelope) {
          return {
            status: 'failed',
            reason: 'runtime.agent follow-up stream completed without structured envelope',
          };
        }
        return {
          status: 'ok',
          envelope: sealedEnvelope,
          metadataJson: sealedMetadataJson,
          trace: part.trace || sealedTrace,
          diagnostics: {
            ...(sealedDiagnostics || {}),
            ...(part.diagnostics || {}),
          },
        };
      case 'turn-failed':
        return {
          status: 'failed',
          reason: part.error.message || 'runtime.agent follow-up turn failed',
        };
      case 'turn-canceled':
        return { status: 'aborted' };
      default:
        break;
    }
  }

  return {
    status: 'failed',
    reason: 'runtime.agent follow-up stream ended without terminal event',
  };
}

export async function* runScheduledFollowUpTurn(input: {
  baseInput: ConversationTurnInput;
  metadata: AgentLocalChatProviderMetadata;
  runtimeAdapter: AgentLocalChatRuntimeAdapter;
  continuityAdapter: AgentLocalChatContinuityAdapter;
  followUpAssistantRuntimeFollowUp: NonNullable<import('./chat-agent-orchestration-types').AgentLocalChatProviderOptions['followUpAssistantRuntimeFollowUp']>;
  followUpAction: import('./chat-agent-behavior').AgentResolvedMessageActionEnvelope['actions'][number];
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
  const followUpHistory = buildNextFollowUpHistory({
    history: input.baseInput.history,
    userMessage: input.baseInput.userMessage,
    assistantText: input.priorAssistantText,
    assistantTurnId: input.chainContext.sourceTurnId,
    includeUserMessage: input.chainContext.followUpDepth === 1,
  });
  const turnContext = await input.continuityAdapter.loadTurnContext({
    modeId: 'agent-local-chat-v1',
    threadId: input.baseInput.threadId,
    turnId: followUpTurnId,
    signal: input.baseInput.signal,
  });
  let executionRequest: AgentLocalChatExecutionTextRequest;
  let followUpEnvelope: import('./chat-agent-behavior').AgentResolvedMessageActionEnvelope;
  let followUpDiagnostics: AgentModelOutputDiagnostics | null;
  let followUpTerminalDiagnostics: Record<string, unknown> | null = null;
  let followUpTrace: ConversationRuntimeTrace | undefined;
  let followUpMetadataJson: JsonObject | null = null;
  try {
    executionRequest = buildAgentLocalChatExecutionTextRequest({
      systemPrompt: normalizeText(input.baseInput.systemPrompt) || null,
      targetSnapshot: input.metadata.targetSnapshot,
      history: followUpHistory,
      userText: '',
      omitUserMessageFromMessages: true,
      followUpInstruction: followUpPromptPayload.promptText,
      userAttachments: [],
      context: turnContext,
      resolvedBehavior: null,
      modelContextTokens: input.metadata.textModelContextTokens,
      maxOutputTokensRequested: input.metadata.textMaxOutputTokensRequested,
    });
    const streamedFollowUp = await runFollowUpRuntimeAgentStream({
      runtimeAdapter: input.runtimeAdapter,
      metadata: input.metadata,
      executionRequest,
      followUpHistory,
      baseInput: input.baseInput,
    });
    if (streamedFollowUp.status === 'aborted') {
      return;
    }
    if (streamedFollowUp.status === 'failed') {
      logRendererEvent({
        level: 'warn',
        area: 'agent-chat-followup',
        message: 'action:agent-local-chat-v1-follow-up-preflight-failed',
        details: {
          chainId: input.chainContext.chainId,
          followUpDepth: input.chainContext.followUpDepth,
          sourceActionId: input.chainContext.followUpSourceActionId,
          reason: streamedFollowUp.reason,
        },
      });
      return;
    }
    if (streamedFollowUp.status === 'ok') {
      followUpEnvelope = streamedFollowUp.envelope;
      followUpDiagnostics = null;
      followUpTerminalDiagnostics = streamedFollowUp.diagnostics || null;
      followUpTrace = streamedFollowUp.trace;
      followUpMetadataJson = streamedFollowUp.metadataJson;
    } else {
      const invokeResult = await input.runtimeAdapter.invokeText({
        agentId: input.metadata.agentId,
        conversationAnchorId: input.metadata.conversationAnchorId,
        prompt: executionRequest.prompt,
        history: followUpHistory,
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
      followUpEnvelope = resolvedOutput.envelope;
      followUpDiagnostics = applyFollowUpChainDiagnostics(resolvedOutput.diagnostics, input.chainContext);
      followUpTrace = {
        traceId: invokeResult.traceId,
        promptTraceId: invokeResult.promptTraceId,
      };
    }
  } catch (error) {
    if (isAbortLikeError(error) || input.baseInput.signal?.aborted) {
      return;
    }
    logRendererEvent({
      level: 'warn',
      area: 'agent-chat-followup',
      message: 'action:agent-local-chat-v1-follow-up-preflight-failed',
      details: {
        chainId: input.chainContext.chainId,
        followUpDepth: input.chainContext.followUpDepth,
        sourceActionId: input.chainContext.followUpSourceActionId,
        reason: error instanceof Error ? error.message : String(error || 'follow-up preflight failed'),
      },
    });
    return;
  }
  const followUpOutputText = buildAgentResolvedOutputText(followUpEnvelope);
  if (normalizeComparableText(followUpOutputText) === normalizeComparableText(input.priorAssistantText)) {
    logRendererEvent({
      level: 'info',
      area: 'agent-chat-followup',
      message: 'action:agent-local-chat-v1-follow-up-duplicate-suppressed',
      details: {
        chainId: input.chainContext.chainId,
        followUpDepth: input.chainContext.followUpDepth,
        sourceActionId: input.chainContext.followUpSourceActionId,
        turnId: followUpTurnId,
      },
    });
    return;
  }
  const textMessageState = resolveCompletedTextMessageStateFromEnvelope({
    turnId: followUpTurnId,
    envelope: followUpEnvelope,
    metadataJson: buildFollowUpTextMetadata({
      metadataJson: followUpMetadataJson,
      diagnostics: followUpDiagnostics,
      envelope: followUpEnvelope,
      chainContext: input.chainContext,
      followUpInstruction: followUpPromptPayload.promptText,
      followUpActionId: input.followUpAction.actionId,
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
  const terminalDiagnostics = {
    ...(followUpTerminalDiagnostics || {}),
    ...(followUpDiagnostics || {}),
    ...buildFollowUpChainDiagnosticsRecord(input.chainContext),
  };
  const terminalEvent: ConversationTurnEvent = {
    type: 'turn-completed',
    turnId: followUpTurnId,
    outputText: followUpOutputText,
    finishReason: 'stop',
    trace: followUpTrace,
    diagnostics: terminalDiagnostics,
  };
  const commitResult = await commitProviderOutcome({
    continuityAdapter: input.continuityAdapter,
    baseInput: {
      ...input.baseInput,
      turnId: followUpTurnId,
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
  try {
    await input.followUpAssistantRuntimeFollowUp({
      agentId: input.metadata.agentId,
      displayName: input.metadata.targetSnapshot.displayName,
      worldId: input.metadata.targetSnapshot.worldId,
      assistantText: followUpOutputText,
      turnId: followUpTurnId,
      threadId: input.baseInput.threadId,
      history: followUpHistory,
    });
  } catch (error) {
    logRendererEvent({
      level: 'warn',
      area: 'agent-chat-followup',
      message: 'action:agent-local-chat-v1-follow-up-runtime-writeback-failed',
      details: {
        chainId: input.chainContext.chainId,
        followUpDepth: input.chainContext.followUpDepth,
        turnId: followUpTurnId,
        sourceActionId: input.chainContext.followUpSourceActionId,
        reason: error instanceof Error ? error.message : String(error || 'follow-up runtime write-back failed'),
      },
    });
  }
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
        history: followUpHistory,
      },
      metadata: input.metadata,
      runtimeAdapter: input.runtimeAdapter,
      continuityAdapter: input.continuityAdapter,
      followUpAssistantRuntimeFollowUp: input.followUpAssistantRuntimeFollowUp,
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
