import type {
  ConversationRuntimeTextMessage,
  ConversationRuntimeTextStreamPart,
  ConversationTurnEvent,
  ConversationTurnInput,
  ConversationOrchestrationProvider,
} from '@nimiplatform/nimi-kit/features/chat';
import { normalizeConversationRuntimeTextStreamPart } from '@nimiplatform/nimi-kit/features/chat/runtime';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import { feedStreamEvent } from '../turns/stream-controller';
import type {
  AgentLocalTargetSnapshot,
} from '@renderer/bridge/runtime-bridge/types';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import {
  generateChatAgentImageRuntime,
  invokeChatAgentRuntime,
  streamChatAgentRuntime,
  toChatAgentRuntimeError,
} from './chat-agent-runtime';
import type { ChatThinkingPreference } from './chat-thinking';
import type {
  AgentEffectiveCapabilityResolution,
  AISnapshot,
} from './conversation-capability';
import { getStreamState } from '../turns/stream-controller';
import { buildAgentLocalChatExecutionTextRequest } from './chat-ai-execution-engine';
import type {
  AgentResolvedBehavior,
} from './chat-agent-behavior';
import {
  buildAgentResolvedOutputText,
  parseAgentResolvedBeatActionEnvelope,
} from './chat-agent-behavior-resolver';
import {
  createAgentLocalChatContinuityAdapter,
  commitProviderOutcome,
  type AgentLocalChatContinuityAdapter,
} from './chat-agent-continuity';
import {
  findSingleExecutableImageAction,
  resolveCompletedTextBeatStatesFromEnvelope,
  resolveImageStateFromResolvedAction,
  resolvePlannedTextBeatsFromEnvelope,
  waitForResolvedDelay,
  type AgentLocalChatImageState,
  type AgentLocalTextBeatState,
  type AgentLocalPlannedTextBeat,
} from './chat-agent-turn-plan';

export { buildAgentLocalChatPrompt } from './chat-ai-execution-engine';
export { createAgentLocalChatContinuityAdapter } from './chat-agent-continuity';

const AGENT_LOCAL_CHAT_PROVIDER_CAPABILITIES = {
  reasoning: true,
  continuity: true,
  firstBeat: true,
  voiceInput: false,
  voiceOutput: false,
  imageGeneration: true,
  videoGeneration: false,
} as const;

export type AgentLocalChatRuntimeRequest = {
  agentId: string;
  prompt?: string;
  messages?: readonly ConversationRuntimeTextMessage[];
  systemPrompt?: string | null;
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

export interface AgentLocalChatRuntimeAdapter {
  streamText: (
    request: AgentLocalChatRuntimeRequest,
  ) => Promise<{ stream: AsyncIterable<ConversationRuntimeTextStreamPart> }>;
  invokeText: (
    request: AgentLocalChatRuntimeRequest,
  ) => Promise<{ text: string; traceId: string; promptTraceId: string }>;
  generateImage: (
    request: AgentLocalChatImageRequest,
  ) => Promise<{ mediaUrl: string; mimeType: string; artifactId: string | null; traceId: string }>;
}

export type AgentLocalChatProviderMetadata = {
  agentId: string;
  targetSnapshot: AgentLocalTargetSnapshot;
  agentResolution: AgentEffectiveCapabilityResolution | null;
  textExecutionSnapshot: AISnapshot | null;
  imageExecutionSnapshot: AISnapshot | null;
  imageCapabilityParams?: Record<string, unknown> | null;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  reasoningPreference: ChatThinkingPreference;
  resolvedBehavior?: AgentResolvedBehavior | null;
};

export type AgentLocalChatProviderOptions = {
  runtimeAdapter?: AgentLocalChatRuntimeAdapter;
  continuityAdapter?: AgentLocalChatContinuityAdapter;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
    imageCapabilityParams: (nextRecord.imageCapabilityParams ?? null) as Record<string, unknown> | null,
    runtimeConfigState: (nextRecord.runtimeConfigState ?? null) as RuntimeConfigStateV11 | null,
    runtimeFields: (nextRecord.runtimeFields ?? {}) as RuntimeFieldMap,
    reasoningPreference,
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

export function createAgentLocalChatConversationRuntimeAdapter(): AgentLocalChatRuntimeAdapter {
  return {
    async streamText(request) {
      const result = await streamChatAgentRuntime({
        agentId: request.agentId,
        prompt: request.prompt,
        messages: request.messages,
        systemPrompt: request.systemPrompt,
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
      if (!userText) {
        throw new Error('agent-local-chat-v1 requires a non-empty user message');
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
        context: turnContext,
        resolvedBehavior: metadata.resolvedBehavior,
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
      let firstBeatText = '';
      let reasoningText = '';
      let textBeatEmitted = false;
      let terminalEventEmitted = false;
      let completedTextBeatStates: AgentLocalTextBeatState[] | undefined;
      let primaryTextBeat: AgentLocalPlannedTextBeat | null = null;

      const emitFirstBeat = async function* () {
        if (textBeatEmitted || !firstBeatText || !primaryTextBeat) {
          return;
        }

        const sealedEvent: ConversationTurnEvent = {
          type: 'first-beat-sealed',
          turnId: input.turnId,
          beatId: primaryTextBeat.beatId,
          text: firstBeatText,
        };
        emittedEvents.push(sealedEvent);
        yield sealedEvent;
        textBeatEmitted = true;
      };

      try {
        const runtimeResult = await runtimeAdapter.streamText({
          agentId: metadata.agentId,
          prompt: executionRequest.prompt,
          messages: executionRequest.messages,
          systemPrompt: executionRequest.systemPrompt,
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
              const resolvedEnvelope = parseAgentResolvedBeatActionEnvelope(rawModelOutput);
              const plannedTextBeats = resolvePlannedTextBeatsFromEnvelope({
                turnId: input.turnId,
                envelope: resolvedEnvelope,
              });
              primaryTextBeat = plannedTextBeats[0] || null;
              completedTextBeatStates = resolveCompletedTextBeatStatesFromEnvelope({
                turnId: input.turnId,
                envelope: resolvedEnvelope,
              });
              outputText = buildAgentResolvedOutputText(resolvedEnvelope);
              firstBeatText = completedTextBeatStates[0]?.text || outputText;

              for (const plannedTextBeat of plannedTextBeats) {
                const plannedEvent: ConversationTurnEvent = {
                  type: 'beat-planned',
                  turnId: input.turnId,
                  beatId: plannedTextBeat.beatId,
                  beatIndex: plannedTextBeat.beatIndex,
                  modality: 'text',
                };
                emittedEvents.push(plannedEvent);
                yield plannedEvent;
              }
              for await (const beatEvent of emitFirstBeat()) {
                yield beatEvent;
              }
              if (textBeatEmitted && primaryTextBeat) {
                const deliveredEvent: ConversationTurnEvent = {
                  type: 'beat-delivered',
                  turnId: input.turnId,
                  beatId: primaryTextBeat.beatId,
                  projectionMessageId: primaryTextBeat.projectionMessageId,
                };
                emittedEvents.push(deliveredEvent);
                yield deliveredEvent;
              }
              if (completedTextBeatStates && completedTextBeatStates.length > 1) {
                for (const textBeatState of completedTextBeatStates.slice(1)) {
                  const resolvedBeat = resolvedEnvelope.beats[textBeatState.beatIndex];
                  if (!resolvedBeat || resolvedBeat.deliveryPhase !== 'tail' || resolvedBeat.delayMs === undefined) {
                    throw new Error(`Delayed tail beat ${textBeatState.beatId} is missing resolved wait fields`);
                  }
                  await waitForResolvedDelay({
                    delayMs: resolvedBeat.delayMs,
                    signal: input.signal,
                    threadId: input.threadId,
                  });
                  const deliveryStartedEvent: ConversationTurnEvent = {
                    type: 'beat-delivery-started',
                    turnId: input.turnId,
                    beatId: textBeatState.beatId,
                  };
                  emittedEvents.push(deliveryStartedEvent);
                  yield deliveryStartedEvent;
                  const deliveredEvent: ConversationTurnEvent = {
                    type: 'beat-delivered',
                    turnId: input.turnId,
                    beatId: textBeatState.beatId,
                    projectionMessageId: textBeatState.projectionMessageId,
                  };
                  emittedEvents.push(deliveredEvent);
                  yield deliveredEvent;
                }
              }
              let imageState: AgentLocalChatImageState = { status: 'none' };
              const imageAction = findSingleExecutableImageAction(resolvedEnvelope);
              const imageDecision = imageAction
                ? resolveImageStateFromResolvedAction({
                  turnId: input.turnId,
                  action: imageAction,
                  textBeatCount: resolvedEnvelope.beats.length,
                  agentResolution: metadata.agentResolution,
                  imageExecutionSnapshot: metadata.imageExecutionSnapshot,
                })
                : { status: 'none' as const };
              if (imageDecision.status !== 'none') {
                const imagePlannedEvent: ConversationTurnEvent = {
                  type: 'beat-planned',
                  turnId: input.turnId,
                  beatId: imageDecision.beatId,
                  beatIndex: imageDecision.beatIndex,
                  modality: 'image',
                };
                emittedEvents.push(imagePlannedEvent);
                yield imagePlannedEvent;

                if (imageDecision.status === 'generate') {
                  const imageDeliveryStarted: ConversationTurnEvent = {
                    type: 'beat-delivery-started',
                    turnId: input.turnId,
                    beatId: imageDecision.beatId,
                  };
                  emittedEvents.push(imageDeliveryStarted);
                  yield imageDeliveryStarted;
                  try {
                    // Keep stream alive during long image generation
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
                    const artifactReadyEvent: ConversationTurnEvent = {
                      type: 'artifact-ready',
                      turnId: input.turnId,
                      beatId: imageState.beatId,
                      artifactId: imageState.artifactId || imageState.projectionMessageId,
                      mimeType: imageState.mimeType,
                      projectionMessageId: imageState.projectionMessageId,
                    };
                    emittedEvents.push(artifactReadyEvent);
                    yield artifactReadyEvent;
                    const imageDeliveredEvent: ConversationTurnEvent = {
                      type: 'beat-delivered',
                      turnId: input.turnId,
                      beatId: imageState.beatId,
                      projectionMessageId: imageState.projectionMessageId,
                    };
                    emittedEvents.push(imageDeliveredEvent);
                    yield imageDeliveredEvent;
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
                } else {
                  imageState = imageDecision;
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
                textBeatStates: completedTextBeatStates,
              });
              yield {
                type: 'projection-rebuilt',
                threadId: input.threadId,
                projectionVersion: commitResult.projectionVersion,
              };
              yield terminalEvent;
              return;
            }
            case 'error': {
              const terminalEvent: ConversationTurnEvent = {
                type: 'turn-failed',
                turnId: input.turnId,
                error: part.error,
                outputText: outputText || undefined,
                reasoningText: reasoningText || undefined,
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
                textBeatStates: textBeatEmitted ? completedTextBeatStates : undefined,
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
            scope: textBeatEmitted ? 'tail' : 'turn',
            outputText: outputText || undefined,
            reasoningText: reasoningText || undefined,
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
            textBeatStates: textBeatEmitted ? completedTextBeatStates : undefined,
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
          textBeatStates: textBeatEmitted ? completedTextBeatStates : undefined,
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
