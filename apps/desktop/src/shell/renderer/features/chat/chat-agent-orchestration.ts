import type {
  ConversationContinuityAdapter,
  ConversationProjectionRebuildResult,
  ConversationRuntimeTextStreamPart,
  ConversationTurnError,
  ConversationTurnEvent,
  ConversationTurnHistoryMessage,
  ConversationTurnInput,
  ConversationOrchestrationProvider,
} from '@nimiplatform/nimi-kit/features/chat';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/store-types';
import { chatAgentStoreClient } from '@renderer/bridge/runtime-bridge/chat-agent-store';
import type {
  AgentLocalCommitTurnResult,
  AgentLocalTargetSnapshot,
  AgentLocalThreadRecord,
  AgentLocalTurnContext,
} from '@renderer/bridge/runtime-bridge/types';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import {
  streamChatAgentRuntime,
  toChatAgentRuntimeError,
  type AgentChatRouteResult,
} from './chat-agent-runtime';
import type { ChatThinkingPreference } from './chat-thinking';

const AGENT_LOCAL_CHAT_PROVIDER_CAPABILITIES = {
  reasoning: true,
  continuity: true,
  firstBeat: true,
  voiceInput: false,
  voiceOutput: false,
  imageGeneration: false,
  videoGeneration: false,
} as const;

type AgentLocalChatStoreClient = Pick<
  typeof chatAgentStoreClient,
  'loadTurnContext' | 'commitTurnResult' | 'cancelTurn' | 'rebuildProjection'
>;

export type AgentLocalChatRuntimeRequest = {
  agentId: string;
  prompt: string;
  threadId: string;
  routeResult: AgentChatRouteResult | null;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  reasoningPreference: ChatThinkingPreference;
  signal?: AbortSignal;
};

export interface AgentLocalChatRuntimeAdapter {
  streamText: (
    request: AgentLocalChatRuntimeRequest,
  ) => Promise<{ stream: AsyncIterable<ConversationRuntimeTextStreamPart> }>;
}

export type AgentLocalChatProviderMetadata = {
  agentId: string;
  targetSnapshot: AgentLocalTargetSnapshot;
  routeResult: AgentChatRouteResult | null;
  runtimeConfigState: RuntimeConfigStateV11 | null;
  runtimeFields: RuntimeFieldMap;
  reasoningPreference: ChatThinkingPreference;
};

export type AgentLocalChatProviderOptions = {
  runtimeAdapter?: AgentLocalChatRuntimeAdapter;
  continuityAdapter?: ConversationContinuityAdapter<
    AgentLocalTurnContext,
    AgentLocalCommitTurnResult
  >;
};

type AgentLocalTextBeatState = {
  beatId: string;
  beatIndex: number;
  projectionMessageId: string;
  text: string;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
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
    routeResult: (nextRecord.routeResult ?? null) as AgentChatRouteResult | null,
    runtimeConfigState: (nextRecord.runtimeConfigState ?? null) as RuntimeConfigStateV11 | null,
    runtimeFields: (nextRecord.runtimeFields ?? {}) as RuntimeFieldMap,
    reasoningPreference,
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

function formatHistoryLine(message: ConversationTurnHistoryMessage): string {
  const speaker = message.role === 'assistant'
    ? 'Assistant'
    : message.role === 'user'
      ? 'User'
      : message.role === 'system'
        ? 'Preset'
        : 'Tool';
  return `${speaker}: ${message.text}`;
}

function buildContinuitySummary(context: AgentLocalTurnContext): string {
  return stringifyJson({
    interactionSnapshot: context.interactionSnapshot
      ? {
        version: context.interactionSnapshot.version,
        relationshipState: context.interactionSnapshot.relationshipState,
        emotionalTemperature: context.interactionSnapshot.emotionalTemperature,
        assistantCommitments: context.interactionSnapshot.assistantCommitmentsJson,
        userPrefs: context.interactionSnapshot.userPrefsJson,
        openLoops: context.interactionSnapshot.openLoopsJson,
      }
      : null,
    relationMemorySlots: context.relationMemorySlots.map((slot) => ({
      slotType: slot.slotType,
      summary: slot.summary,
      score: slot.score,
    })),
    recallEntries: context.recallEntries.map((entry) => ({
      summary: entry.summary,
      searchText: entry.searchText,
    })),
    recentTurns: context.recentTurns.map((turn) => ({
      role: turn.role,
      status: turn.status,
      startedAtMs: turn.startedAtMs,
      completedAtMs: turn.completedAtMs,
      abortedAtMs: turn.abortedAtMs,
    })),
    recentBeats: context.recentBeats.map((beat) => ({
      beatIndex: beat.beatIndex,
      modality: beat.modality,
      status: beat.status,
      textShadow: beat.textShadow,
    })),
  });
}

export function buildAgentLocalChatPrompt(input: {
  systemPrompt: string | null;
  targetSnapshot: AgentLocalTargetSnapshot;
  history: readonly ConversationTurnHistoryMessage[];
  userText: string;
  context: AgentLocalTurnContext;
}): string {
  const transcript = input.history
    .filter((message) => message.role !== 'system' && normalizeText(message.text))
    .map((message) => formatHistoryLine(message))
    .join('\n');
  const sections = [
    input.systemPrompt ? `Preset:\n${input.systemPrompt}` : null,
    `Target:\n${stringifyJson({
      agentId: input.targetSnapshot.agentId,
      displayName: input.targetSnapshot.displayName,
      handle: input.targetSnapshot.handle,
      bio: input.targetSnapshot.bio,
      worldId: input.targetSnapshot.worldId,
      worldName: input.targetSnapshot.worldName,
      ownershipType: input.targetSnapshot.ownershipType,
    })}`,
    `Continuity:\n${buildContinuitySummary(input.context)}`,
    transcript ? `Transcript:\n${transcript}` : null,
    `UserMessage:\nUser: ${input.userText}`,
    'Instruction:\nReply as the target agent. Use continuity as background truth. Keep internal planning private.',
  ].filter(Boolean);
  return sections.join('\n\n');
}

export function createAgentLocalChatConversationRuntimeAdapter(): AgentLocalChatRuntimeAdapter {
  return {
    async streamText(request) {
      const result = await streamChatAgentRuntime({
        agentId: request.agentId,
        prompt: request.prompt,
        threadId: request.threadId,
        reasoningPreference: request.reasoningPreference,
        routeResult: request.routeResult,
        runtimeConfigState: request.runtimeConfigState,
        runtimeFields: request.runtimeFields,
        signal: request.signal,
      });
      return {
        stream: normalizeAgentLocalRuntimeStream(result.stream, result.promptTraceId),
      };
    },
  };
}

async function* normalizeAgentLocalRuntimeStream(
  stream: AsyncIterable<Awaited<ReturnType<typeof streamChatAgentRuntime>>['stream'] extends AsyncIterable<infer T> ? T : never>,
  promptTraceId: string,
): AsyncIterable<ConversationRuntimeTextStreamPart> {
  yield { type: 'start' };
  for await (const part of stream) {
    switch (part.type) {
      case 'reasoning-delta':
        yield {
          type: 'reasoning-delta',
          textDelta: part.text,
        };
        break;
      case 'delta':
        yield {
          type: 'text-delta',
          textDelta: part.text,
        };
        break;
      case 'finish':
        yield {
          type: 'finish',
          finishReason: 'stop',
          usage: part.usage,
          trace: {
            traceId: normalizeText(part.trace.traceId) || null,
            promptTraceId: normalizeText(promptTraceId) || null,
          },
        };
        break;
      case 'error':
        yield {
          type: 'error',
          error: {
            code: normalizeText(part.error.reasonCode) || 'RUNTIME_CALL_FAILED',
            message: normalizeText(part.error.message) || 'agent runtime stream failed',
          },
          trace: {
            traceId: normalizeText(part.error.traceId) || null,
            promptTraceId: normalizeText(promptTraceId) || null,
          },
        };
        break;
      default:
        throw new Error(`Unsupported agent runtime stream part: ${JSON.stringify(part)}`);
    }
  }
}

export function createAgentLocalChatContinuityAdapter(
  options: {
    storeClient?: AgentLocalChatStoreClient;
    now?: () => number;
  } = {},
): ConversationContinuityAdapter<AgentLocalTurnContext, AgentLocalCommitTurnResult> {
  const storeClient = options.storeClient ?? chatAgentStoreClient;
  const now = options.now ?? (() => Date.now());
  return {
    loadTurnContext: async (input) => storeClient.loadTurnContext({
      threadId: input.threadId,
    }),
    commitTurnResult: async (input) => {
      const context = await storeClient.loadTurnContext({
        threadId: input.threadId,
      });
      const committedAtMs = now();
      const thread = context.thread;
      const textBeat = resolveTextBeatState(input.events, input.turnId);
      const projectionMessages = textBeat
        ? [buildProjectionMessage(thread, textBeat, input, committedAtMs)]
        : [];
      const result = await storeClient.commitTurnResult({
        threadId: input.threadId,
        turn: {
          id: input.turnId,
          threadId: input.threadId,
          role: 'assistant',
          status: mapOutcomeToTurnStatus(input.outcome),
          providerMode: 'agent-local-chat-v1',
          traceId: resolveTerminalTraceId(input.events),
          promptTraceId: resolveTerminalPromptTraceId(input.events),
          startedAtMs: committedAtMs,
          completedAtMs: input.outcome === 'completed' ? committedAtMs : null,
          abortedAtMs: input.outcome === 'canceled' ? committedAtMs : null,
        },
        beats: textBeat
          ? [{
            id: textBeat.beatId,
            turnId: input.turnId,
            beatIndex: textBeat.beatIndex,
            modality: 'text',
            status: mapOutcomeToBeatStatus(input.outcome),
            textShadow: normalizeText(input.outputText) || textBeat.text || null,
            artifactId: null,
            mimeType: 'text/plain',
            projectionMessageId: textBeat.projectionMessageId,
            createdAtMs: committedAtMs,
            deliveredAtMs: input.outcome === 'completed' ? committedAtMs : null,
          }]
          : [],
        interactionSnapshot: null,
        relationMemorySlots: [],
        recallEntries: [],
        projection: {
          thread: {
            id: thread.id,
            title: thread.title,
            updatedAtMs: committedAtMs,
            lastMessageAtMs: projectionMessages.length > 0 ? committedAtMs : thread.lastMessageAtMs,
            archivedAtMs: thread.archivedAtMs,
            targetSnapshot: thread.targetSnapshot,
          },
          messages: projectionMessages,
          draft: null,
          clearDraft: input.outcome === 'completed',
        },
      });
      return result;
    },
    cancelTurn: async (input) => {
      await storeClient.cancelTurn({
        threadId: input.threadId,
        turnId: input.turnId,
        scope: input.scope,
        abortedAtMs: now(),
      });
    },
    rebuildProjection: async (threadId) => {
      const result = await storeClient.rebuildProjection(threadId);
      return {
        threadId,
        projectionVersion: result.projectionVersion,
      } satisfies ConversationProjectionRebuildResult;
    },
  };
}

function resolveTextBeatState(
  events: readonly ConversationTurnEvent[],
  turnId: string,
): AgentLocalTextBeatState | null {
  const plannedTextBeats = events.filter((
    event,
  ): event is Extract<ConversationTurnEvent, { type: 'beat-planned' }> => (
    event.type === 'beat-planned'
      && event.turnId === turnId
      && event.modality === 'text'
  ));
  if (plannedTextBeats.length === 0) {
    return null;
  }
  if (plannedTextBeats.length !== 1) {
    throw new Error('agent-local-chat-v1 commit only supports one text beat per turn');
  }
  const plannedBeat = plannedTextBeats[0]!;
  const sealedBeat = events.find((
    event,
  ): event is Extract<ConversationTurnEvent, { type: 'first-beat-sealed' }> => (
    event.type === 'first-beat-sealed'
      && event.turnId === turnId
      && event.beatId === plannedBeat.beatId
  ));
  const deliveredBeat = events.find((
    event,
  ): event is Extract<ConversationTurnEvent, { type: 'beat-delivered' }> => (
    event.type === 'beat-delivered'
      && event.turnId === turnId
      && event.beatId === plannedBeat.beatId
  ));
  return {
    beatId: plannedBeat.beatId,
    beatIndex: plannedBeat.beatIndex,
    projectionMessageId: deliveredBeat?.projectionMessageId || `${turnId}:message:${plannedBeat.beatIndex}`,
    text: sealedBeat?.text || '',
  };
}

function mapOutcomeToTurnStatus(outcome: 'completed' | 'failed' | 'canceled') {
  switch (outcome) {
    case 'completed':
      return 'completed' as const;
    case 'failed':
      return 'failed' as const;
    case 'canceled':
      return 'canceled' as const;
    default:
      throw new Error(`Unsupported turn outcome: ${String(outcome)}`);
  }
}

function mapOutcomeToBeatStatus(outcome: 'completed' | 'failed' | 'canceled') {
  switch (outcome) {
    case 'completed':
      return 'delivered' as const;
    case 'failed':
      return 'failed' as const;
    case 'canceled':
      return 'canceled' as const;
    default:
      throw new Error(`Unsupported beat outcome: ${String(outcome)}`);
  }
}

function resolveTerminalTraceId(events: readonly ConversationTurnEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event?.type === 'turn-completed'
      || event?.type === 'turn-failed'
      || event?.type === 'turn-canceled'
    ) {
      return normalizeText(event.trace?.traceId) || null;
    }
  }
  return null;
}

function resolveTerminalPromptTraceId(events: readonly ConversationTurnEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event?.type === 'turn-completed'
      || event?.type === 'turn-failed'
      || event?.type === 'turn-canceled'
    ) {
      return normalizeText(event.trace?.promptTraceId) || null;
    }
  }
  return null;
}

function buildProjectionMessage(
  thread: AgentLocalThreadRecord,
  textBeat: AgentLocalTextBeatState,
  input: {
    outcome: 'completed' | 'failed' | 'canceled';
    outputText?: string;
    reasoningText?: string;
    error?: ConversationTurnError;
    events: readonly ConversationTurnEvent[];
  },
  committedAtMs: number,
) {
  const error = input.outcome === 'completed'
    ? null
    : {
      code: input.outcome === 'canceled'
        ? 'OPERATION_ABORTED'
        : normalizeText(input.error?.code) || 'AGENT_TURN_FAILED',
      message: input.outcome === 'canceled'
        ? 'Generation stopped.'
        : normalizeText(input.error?.message) || 'Agent response failed',
    };
  return {
    id: textBeat.projectionMessageId,
    threadId: thread.id,
    role: 'assistant' as const,
    status: input.outcome === 'completed' ? 'complete' as const : 'error' as const,
    contentText: normalizeText(input.outputText) || textBeat.text,
    reasoningText: null,
    error,
    traceId: resolveTerminalTraceId(input.events),
    parentMessageId: null,
    createdAtMs: committedAtMs,
    updatedAtMs: committedAtMs,
  };
}

async function commitProviderOutcome(input: {
  continuityAdapter: ConversationContinuityAdapter<AgentLocalTurnContext, AgentLocalCommitTurnResult>;
  baseInput: ConversationTurnInput;
  emittedEvents: readonly ConversationTurnEvent[];
  terminalEvent: ConversationTurnEvent;
  outcome: 'completed' | 'failed' | 'canceled';
  outputText: string;
  reasoningText: string;
  error?: ConversationTurnError;
}): Promise<AgentLocalCommitTurnResult> {
  return input.continuityAdapter.commitTurnResult({
    modeId: 'agent-local-chat-v1',
    threadId: input.baseInput.threadId,
    turnId: input.baseInput.turnId,
    outcome: input.outcome,
    outputText: input.outputText || undefined,
    reasoningText: input.reasoningText || undefined,
    error: input.error,
    events: [
      ...input.emittedEvents,
      input.terminalEvent,
    ],
    signal: input.baseInput.signal,
  });
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
      const prompt = buildAgentLocalChatPrompt({
        systemPrompt: normalizeText(input.systemPrompt) || null,
        targetSnapshot: metadata.targetSnapshot,
        history: input.history,
        userText,
        context: turnContext,
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

      let outputText = '';
      let reasoningText = '';
      let textBeatEmitted = false;
      const beatId = `${input.turnId}:beat:0`;
      const projectionMessageId = `${input.turnId}:message:0`;

      const emitFirstBeat = async function* () {
        if (textBeatEmitted || !outputText) {
          return;
        }
        const plannedEvent: ConversationTurnEvent = {
          type: 'beat-planned',
          turnId: input.turnId,
          beatId,
          beatIndex: 0,
          modality: 'text',
        };
        emittedEvents.push(plannedEvent);
        yield plannedEvent;

        const sealedEvent: ConversationTurnEvent = {
          type: 'first-beat-sealed',
          turnId: input.turnId,
          beatId,
          text: outputText,
        };
        emittedEvents.push(sealedEvent);
        yield sealedEvent;
        textBeatEmitted = true;
      };

      try {
        const runtimeResult = await runtimeAdapter.streamText({
          agentId: metadata.agentId,
          prompt,
          threadId: input.threadId,
          routeResult: metadata.routeResult,
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
              outputText += part.textDelta;
              for await (const beatEvent of emitFirstBeat()) {
                yield beatEvent;
              }
              const textEvent: ConversationTurnEvent = {
                type: 'text-delta',
                turnId: input.turnId,
                textDelta: part.textDelta,
              };
              emittedEvents.push(textEvent);
              yield textEvent;
              break;
            }
            case 'finish': {
              for await (const beatEvent of emitFirstBeat()) {
                yield beatEvent;
              }
              if (textBeatEmitted) {
                const deliveredEvent: ConversationTurnEvent = {
                  type: 'beat-delivered',
                  turnId: input.turnId,
                  beatId,
                  projectionMessageId,
                };
                emittedEvents.push(deliveredEvent);
                yield deliveredEvent;
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
              });
              yield {
                type: 'projection-rebuilt',
                threadId: input.threadId,
                projectionVersion: commitResult.projectionVersion,
              };
              yield terminalEvent;
              return;
            }
            default:
              throw new Error(`Unsupported agent-local-chat-v1 runtime part: ${JSON.stringify(part)}`);
          }
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
