import type {
  ConversationTurnEvent,
  ConversationTurnInput,
  ConversationOrchestrationProvider,
} from '@nimiplatform/nimi-kit/features/chat';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import {
  randomIdV11,
} from '@renderer/features/runtime-config/runtime-config-state-types';
import {
  toChatAgentRuntimeError,
} from './chat-agent-runtime';
import {
  buildAgentLocalChatExecutionTextRequest,
  type AgentChatUserAttachment,
} from './chat-ai-execution-engine';
import type {
  AgentResolvedMessageActionEnvelope,
} from './chat-agent-behavior';
import {
  buildAgentPreflightDiagnosticsFromError,
  buildAgentResolvedOutputText,
  resolveAgentModelOutputEnvelope,
  toAgentModelOutputTurnError,
  type AgentModelOutputDiagnostics,
} from './chat-agent-behavior-resolver';
import { buildAgentTextTurnDebugMetadata } from './chat-agent-debug-metadata';
import {
  createAgentLocalChatContinuityAdapter,
  commitProviderOutcome,
} from './chat-agent-continuity';
import { resolveCompletedTextMessageStateFromEnvelope, type AgentLocalTextMessageState } from './chat-agent-turn-plan';
import {
  isAbortLikeError,
  mergeAgentImageDiagnostics,
  normalizeText,
  requireProviderMetadata,
  toAbortLikeErrorMessage,
} from './chat-agent-orchestration-shared';
import { createAgentLocalChatConversationRuntimeAdapter } from './chat-agent-orchestration-runtime';
import { runResolvedEnvelopeActions } from './chat-agent-orchestration-actions';
import { runScheduledFollowUpTurn } from './chat-agent-orchestration-follow-up';
import { runDesktopAgentAssistantTurnRuntimeFollowUp } from './chat-agent-runtime-memory';
import {
  AGENT_LOCAL_CHAT_PROVIDER_CAPABILITIES,
  type AgentLocalChatProviderMetadata,
  type AgentLocalChatProviderOptions,
  type AgentLocalChatRuntimeAdapter,
  type AgentLocalChatRuntimeRequest,
} from './chat-agent-orchestration-types';

export { buildAgentLocalChatPrompt } from './chat-ai-execution-engine';
export { createAgentLocalChatContinuityAdapter } from './chat-agent-continuity';
export { createAgentTailAbortSignal } from './chat-agent-orchestration-shared';
export { createAgentLocalChatConversationRuntimeAdapter } from './chat-agent-orchestration-runtime';
export { cancelPendingAgentFollowUpChain } from './chat-agent-orchestration-follow-up';
export type {
  AgentFollowUpChainContext,
  AgentPendingFollowUpEntry,
  AgentLocalChatRuntimeRequest,
  AgentLocalChatImageRequest,
  AgentLocalChatVoiceRequest,
  AgentLocalChatVoiceWorkflowRequest,
  AgentLocalChatRuntimeAdapter,
  AgentLocalChatProviderMetadata,
  AgentLocalChatProviderOptions,
} from './chat-agent-orchestration-types';

const MAX_AGENT_FOLLOW_UP_TURNS = 8;

async function* runRuntimeAgentTurn(input: {
  baseInput: ConversationTurnInput;
  metadata: AgentLocalChatProviderMetadata;
  runtimeAdapter: AgentLocalChatRuntimeAdapter;
  continuityAdapter: ReturnType<typeof createAgentLocalChatContinuityAdapter>;
  emittedEvents: ConversationTurnEvent[];
  reasoningText: string;
  executionRequest: {
    prompt: string;
    messages: AgentLocalChatRuntimeRequest['messages'];
    systemPrompt: string | null;
    diagnostics: {
      maxOutputTokensRequested: number | null;
    };
  };
}): AsyncIterable<ConversationTurnEvent> {
  let reasoningText = input.reasoningText;
  let outputText = '';
  let outputDiagnostics: Record<string, unknown> | null = null;
  let textMessageState: AgentLocalTextMessageState | null = null;
  let actionResult: Awaited<ReturnType<typeof runResolvedEnvelopeActions>> | null = null;

  const runtimeResult = await input.runtimeAdapter.streamAgentTurn?.({
    agentId: input.metadata.agentId,
    conversationAnchorId: input.metadata.conversationAnchorId,
    prompt: input.executionRequest.prompt,
    history: input.baseInput.history,
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
  if (!runtimeResult) {
    throw new Error('agent-local-chat-v1 runtime.agent stream adapter unavailable');
  }

  for await (const part of runtimeResult.stream) {
    switch (part.type) {
      case 'reasoning-delta': {
        reasoningText += part.textDelta;
        const reasoningEvent: ConversationTurnEvent = {
          type: 'reasoning-delta',
          turnId: input.baseInput.turnId,
          textDelta: part.textDelta,
        };
        input.emittedEvents.push(reasoningEvent);
        yield reasoningEvent;
        break;
      }
      case 'text-delta': {
        const textDelta = typeof part.textDelta === 'string' ? part.textDelta : '';
        if (!textDelta) {
          break;
        }
        outputText += textDelta;
        const textDeltaEvent: ConversationTurnEvent = {
          type: 'text-delta',
          turnId: input.baseInput.turnId,
          textDelta,
        };
        input.emittedEvents.push(textDeltaEvent);
        yield textDeltaEvent;
        break;
      }
      case 'message-sealed': {
        textMessageState = resolveCompletedTextMessageStateFromEnvelope({
          turnId: input.baseInput.turnId,
          envelope: part.envelope,
          metadataJson: part.metadataJson ?? {
            debugType: 'agent-text-turn',
            prompt: input.executionRequest.prompt,
            systemPrompt: input.executionRequest.systemPrompt,
            rawModelOutput: null,
            normalizedModelOutput: null,
            statusCue: part.envelope.statusCue || null,
            followUpInstruction: null,
            followUpTurn: false,
            chainId: null,
            followUpDepth: null,
            maxFollowUpTurns: null,
            followUpCanceledByUser: false,
            followUpSourceActionId: null,
            followUpDelayMs: null,
            runtimeAgentTurns: {
              transport: 'runtime.agent.turns',
              conversationAnchorId: String(part.diagnostics?.conversationAnchorId || ''),
              runtimeTurnId: String(part.diagnostics?.runtimeTurnId || ''),
              runtimeStreamId: String(part.diagnostics?.runtimeStreamId || ''),
              traceId: String(part.trace?.traceId || ''),
              modelResolved: String(part.trace?.modelResolved || ''),
              routeDecision: String(part.trace?.routeDecision || ''),
            },
          },
        });
        outputText = buildAgentResolvedOutputText(part.envelope);
        const sealedEvent: ConversationTurnEvent = {
          type: 'message-sealed',
          turnId: input.baseInput.turnId,
          messageId: textMessageState.messageId,
          beatId: `${input.baseInput.turnId}:beat:0`,
          text: outputText,
        };
        input.emittedEvents.push(sealedEvent);
        yield sealedEvent;
        const actionEvents: ConversationTurnEvent[] = [];
        actionResult = await runResolvedEnvelopeActions({
          threadId: input.baseInput.threadId,
          turnId: input.baseInput.turnId,
          signal: input.baseInput.signal,
          metadata: input.metadata,
          runtimeAdapter: input.runtimeAdapter,
          envelope: part.envelope,
          outputDiagnostics: null,
          onEvent: (event) => {
            input.emittedEvents.push(event);
            actionEvents.push(event);
          },
        });
        outputDiagnostics = {
          ...(part.diagnostics || {}),
          ...(actionResult.outputDiagnostics || {}),
        };
        for (const actionEvent of actionEvents) {
          yield actionEvent;
        }
        break;
      }
      case 'turn-completed': {
        outputText = part.outputText || outputText;
        outputDiagnostics = {
          ...(outputDiagnostics || {}),
          ...(part.diagnostics || {}),
        };
        if (!textMessageState) {
          const terminalEvent: ConversationTurnEvent = {
            type: 'turn-failed',
            turnId: input.baseInput.turnId,
            error: {
              code: 'RUNTIME_AGENT_CHAT_INVALID',
              message: 'runtime.agent completed without structured message-sealed event',
            },
            outputText: outputText || undefined,
            reasoningText: reasoningText || undefined,
            finishReason: part.finishReason,
            usage: part.usage,
            trace: part.trace,
            diagnostics: {
              ...(outputDiagnostics || {}),
              missingStructuredProjection: true,
            },
          };
          const commitResult = await commitProviderOutcome({
            continuityAdapter: input.continuityAdapter,
            baseInput: input.baseInput,
            emittedEvents: input.emittedEvents,
            terminalEvent,
            outcome: 'failed',
            outputText,
            reasoningText,
            error: terminalEvent.error,
            textMessageState: undefined,
          });
          yield {
            type: 'projection-rebuilt',
            threadId: input.baseInput.threadId,
            projectionVersion: commitResult.projectionVersion,
            bundle: commitResult.bundle,
          };
          yield terminalEvent;
          return;
        }
        const terminalEvent: ConversationTurnEvent = {
          type: 'turn-completed',
          turnId: input.baseInput.turnId,
          outputText,
          reasoningText: reasoningText || undefined,
          finishReason: part.finishReason,
          usage: part.usage,
          trace: part.trace,
          diagnostics: outputDiagnostics || undefined,
        };
        const commitResult = await commitProviderOutcome({
          continuityAdapter: input.continuityAdapter,
          baseInput: input.baseInput,
          emittedEvents: input.emittedEvents,
          terminalEvent,
          outcome: 'completed',
          outputText,
          reasoningText,
          imageState: actionResult?.imageState,
          voiceState: actionResult?.voiceState,
          textMessageState: textMessageState || undefined,
        });
        yield {
          type: 'projection-rebuilt',
          threadId: input.baseInput.threadId,
          projectionVersion: commitResult.projectionVersion,
          bundle: commitResult.bundle,
        };
        yield terminalEvent;
        return;
      }
      case 'turn-failed': {
        outputText = part.outputText || outputText;
        outputDiagnostics = {
          ...(outputDiagnostics || {}),
          ...(part.diagnostics || {}),
        };
        const terminalEvent: ConversationTurnEvent = {
          type: 'turn-failed',
          turnId: input.baseInput.turnId,
          error: part.error,
          outputText: outputText || undefined,
          reasoningText: part.reasoningText || reasoningText || undefined,
          finishReason: part.finishReason,
          usage: part.usage,
          trace: part.trace,
          diagnostics: outputDiagnostics || undefined,
        };
        const commitResult = await commitProviderOutcome({
          continuityAdapter: input.continuityAdapter,
          baseInput: input.baseInput,
          emittedEvents: input.emittedEvents,
          terminalEvent,
          outcome: 'failed',
          outputText,
          reasoningText,
          error: part.error,
          textMessageState: textMessageState || undefined,
        });
        yield {
          type: 'projection-rebuilt',
          threadId: input.baseInput.threadId,
          projectionVersion: commitResult.projectionVersion,
          bundle: commitResult.bundle,
        };
        yield terminalEvent;
        return;
      }
      case 'turn-canceled': {
        outputText = part.outputText || outputText;
        outputDiagnostics = {
          ...(outputDiagnostics || {}),
          ...(part.diagnostics || {}),
        };
        const terminalEvent: ConversationTurnEvent = {
          type: 'turn-canceled',
          turnId: input.baseInput.turnId,
          scope: part.scope,
          outputText: outputText || undefined,
          reasoningText: part.reasoningText || reasoningText || undefined,
          trace: part.trace,
          diagnostics: outputDiagnostics || undefined,
        };
        const commitResult = await commitProviderOutcome({
          continuityAdapter: input.continuityAdapter,
          baseInput: input.baseInput,
          emittedEvents: input.emittedEvents,
          terminalEvent,
          outcome: 'canceled',
          outputText,
          reasoningText,
          error: {
            code: 'OPERATION_ABORTED',
            message: 'Generation stopped.',
          },
          textMessageState: textMessageState || undefined,
        });
        yield {
          type: 'projection-rebuilt',
          threadId: input.baseInput.threadId,
          projectionVersion: commitResult.projectionVersion,
          bundle: commitResult.bundle,
        };
        yield terminalEvent;
        return;
      }
      default:
        throw new Error(`Unsupported agent-local-chat-v1 runtime.agent part: ${JSON.stringify(part)}`);
    }
  }
  throw new Error('agent-local-chat-v1 runtime.agent stream ended without a terminal event');
}


export function createAgentLocalChatConversationProvider(
  options: AgentLocalChatProviderOptions = {},
): ConversationOrchestrationProvider {
  const runtimeAdapter = options.runtimeAdapter ?? createAgentLocalChatConversationRuntimeAdapter();
  const continuityAdapter = options.continuityAdapter ?? createAgentLocalChatContinuityAdapter();
  const followUpAssistantRuntimeFollowUp = options.followUpAssistantRuntimeFollowUp ?? runDesktopAgentAssistantTurnRuntimeFollowUp;
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
          currentUserMessageId: input.userMessage.id,
          userAttachments,
          context: turnContext,
          resolvedBehavior: metadata.resolvedBehavior,
          modelContextTokens: metadata.textModelContextTokens,
          maxOutputTokensRequested: metadata.textMaxOutputTokensRequested,
        });
        if (runtimeAdapter.streamAgentTurn) {
          for await (const event of runRuntimeAgentTurn({
            baseInput: input,
            metadata,
            runtimeAdapter,
            continuityAdapter,
            emittedEvents,
            reasoningText,
            executionRequest,
          })) {
            if (event.type === 'reasoning-delta') {
              reasoningText += event.textDelta;
            }
            yield event;
          }
          return;
        }
        const runtimeResult = await runtimeAdapter.streamText({
          agentId: metadata.agentId,
          conversationAnchorId: metadata.conversationAnchorId,
          prompt: executionRequest.prompt,
          history: input.history,
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
              if (!rawModelOutput && !normalizeText(reasoningText)) {
                const firstPacketEvent: ConversationTurnEvent = {
                  type: 'text-delta',
                  turnId: input.turnId,
                  textDelta: '',
                };
                emittedEvents.push(firstPacketEvent);
                yield firstPacketEvent;
              }
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
                metadataJson: buildAgentTextTurnDebugMetadata(resolvedOutput.diagnostics, {
                  statusCue: resolvedEnvelope.statusCue || null,
                }),
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
                  followUpAssistantRuntimeFollowUp,
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
        outputDiagnostics = outputDiagnostics || buildAgentPreflightDiagnosticsFromError(error);
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
