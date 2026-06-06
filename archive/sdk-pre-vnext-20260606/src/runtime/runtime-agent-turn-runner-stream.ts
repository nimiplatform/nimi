import { normalizeText } from './runtime-value-utils.js';
import {
  cloneAgentResolvedMessageActionEnvelopeWithCommittedMessage,
  parseRuntimeAgentStructuredMessageActionEnvelope,
  type AgentResolvedMessageActionEnvelope,
} from './runtime-agent-message-action.js';
import {
  isRuntimeAgentProjectionEvent,
  matchesRuntimeAgentProjectionScope,
  recoverRuntimeAgentTerminalSnapshot,
  summarizeRuntimeAgentProjectionEvent,
  summarizeRuntimeAgentTimeline,
  type RuntimeAgentProjectionSummary,
  type RuntimeAgentTimelineSummary,
} from './runtime-agent-consumer-helpers.js';
import type {
  RuntimeAgentConsumeEvent,
  RuntimeAgentConsumeRequest,
  RuntimeAgentSessionTurnSnapshot,
  RuntimeAgentTurnRequest,
} from './types-runtime-agent.js';
import type {
  RuntimeAgentTurnRunnerCommittedMessage,
  RuntimeAgentTurnRunnerContext,
  RuntimeAgentTurnRunnerDiagnosticsInput,
  RuntimeAgentTurnRunnerLogEvent,
  RuntimeAgentTurnRunnerMetadataInput,
  RuntimeAgentTurnRunnerOptions,
  RuntimeAgentTurnRunnerPart,
  RuntimeAgentTurnRunnerTrace,
} from './runtime-agent-turn-runner-types.js';

type RuntimeAgentQueuedEvent =
  | { type: 'event'; event: RuntimeAgentConsumeEvent }
  | { type: 'done' }
  | { type: 'error'; error: unknown };

export function createRuntimeAgentEventQueue(
  source: AsyncIterable<RuntimeAgentConsumeEvent>,
): {
  next: () => Promise<RuntimeAgentQueuedEvent>;
  enqueue: (event: RuntimeAgentConsumeEvent) => void;
  stop: () => void;
} {
  const iterator = source[Symbol.asyncIterator]();
  const queue: RuntimeAgentQueuedEvent[] = [];
  const waiters: Array<() => void> = [];
  let stopped = false;

  const notify = () => {
    const pending = waiters.splice(0);
    for (const wake of pending) {
      wake();
    }
  };
  const push = (item: RuntimeAgentQueuedEvent) => {
    if (stopped) {
      return;
    }
    queue.push(item);
    notify();
  };
  const waitForEvent = () => new Promise<void>((resolve) => {
    waiters.push(resolve);
  });

  void (async () => {
    try {
      while (!stopped) {
        const next = await iterator.next();
        if (next.done) {
          push({ type: 'done' });
          return;
        }
        push({ type: 'event', event: next.value });
      }
    } catch (error) {
      push({ type: 'error', error });
    }
  })();

  return {
    next: async () => {
      while (queue.length === 0) {
        if (stopped) {
          return { type: 'done' };
        }
        await waitForEvent();
      }
      return queue.shift() || { type: 'done' };
    },
    enqueue: (event) => {
      push({ type: 'event', event });
    },
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      notify();
      void iterator.return?.();
    },
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = globalThis.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      globalThis.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

export function defaultNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function buildRuntimeAgentRunnerDiagnostics(input: RuntimeAgentTurnRunnerDiagnosticsInput): Record<string, unknown> {
  return {
    transport: 'runtime.agent.turns',
    conversationAnchorId: input.conversationAnchorId,
    runtimeTurnId: input.runtimeTurnId,
    runtimeStreamId: input.runtimeStreamId,
    route: input.route,
    modelId: input.modelId,
    connectorId: input.connectorId || null,
    traceId: input.trace?.traceId || null,
    modelResolved: input.trace?.modelResolved || null,
    routeDecision: input.trace?.routeDecision || null,
    ...(input.runtimeTurnTimelines.length > 0 ? { runtimeTurnTimelines: [...input.runtimeTurnTimelines] } : {}),
    ...(input.runtimeProjectionEvents.length > 0 ? { runtimeProjectionEvents: [...input.runtimeProjectionEvents] } : {}),
    ...(input.extra || {}),
  };
}

export function localIdentityFromRequest(request: RuntimeAgentTurnRequest) {
  return {
    ownerUserId: request.ownerUserId,
    realmAgentId: request.realmAgentId,
    localAgentRef: request.localAgentRef,
  };
}

export function buildSubscribeRequest(request: RuntimeAgentTurnRequest, subscribe?: RuntimeAgentConsumeRequest): RuntimeAgentConsumeRequest {
  return subscribe || {
    ...localIdentityFromRequest(request),
    conversationAnchorId: request.conversationAnchorId,
    includeAgentEvents: false,
  };
}

export function contextDetails(input: {
  request: RuntimeAgentTurnRequest;
  requestId: string;
  requestMessageId?: string;
  runtimeTurnId?: string;
  runtimeStreamId?: string;
  route: string;
  modelId: string;
  connectorId?: string;
}): Record<string, unknown> {
  return {
    localAgentRef: input.request.localAgentRef,
    conversationAnchorId: input.request.conversationAnchorId,
    threadId: input.request.threadId || null,
    requestId: input.requestId,
    ...(input.requestMessageId !== undefined ? { requestMessageId: input.requestMessageId } : {}),
    ...(input.runtimeTurnId !== undefined ? { runtimeTurnId: input.runtimeTurnId } : {}),
    ...(input.runtimeStreamId !== undefined ? { runtimeStreamId: input.runtimeStreamId } : {}),
    route: input.route,
    modelId: input.modelId,
    connectorId: input.connectorId || null,
  };
}

export type RuntimeAgentTurnStreamInput = {
  acceptedRequestIds: Set<string>;
  cleanupSubscription: () => void;
  connectorId: string | undefined;
  eventQueue: ReturnType<typeof createRuntimeAgentEventQueue>;
  logEvent?: (event: RuntimeAgentTurnRunnerLogEvent) => void;
  logTiming?: RuntimeAgentTurnRunnerOptions['logTiming'];
  modelId: string;
  nowMs: () => number;
  querySnapshot: () => Promise<{
    activeTurn?: RuntimeAgentSessionTurnSnapshot;
    lastTurn?: RuntimeAgentSessionTurnSnapshot;
  }>;
  request: RuntimeAgentTurnRequest;
  requestId: string;
  requestMessageId: string;
  resolveTrace?: () => RuntimeAgentTurnRunnerTrace | undefined;
  route: string;
  runtimeTurnRef: { turnId: string; streamId: string };
  stallRecoveryIntervalMs?: number;
  buildMetadata?: RuntimeAgentTurnRunnerOptions['buildMetadata'];
  buildDiagnostics?: RuntimeAgentTurnRunnerOptions['buildDiagnostics'];
};

export function createRuntimeAgentTurnStream(input: RuntimeAgentTurnStreamInput): AsyncIterable<RuntimeAgentTurnRunnerPart> {
  return (async function* stream(): AsyncIterable<RuntimeAgentTurnRunnerPart> {
    let structuredEnvelope: AgentResolvedMessageActionEnvelope | null = null;
    let provisionalText = '';
    let committedMessage: RuntimeAgentTurnRunnerCommittedMessage | null = null;
    let messageSealedEmitted = false;
    let currentTurnAccepted = false;
    let acceptedAt = 0;
    let startedAt = 0;
    let firstDeltaObserved = false;
    let messageCommittedAt = 0;
    let terminalProjected = false;
    let snapshotRecoveryProjected = false;
    const requestStartedAtMs = input.nowMs();
    const snapshotRecoveryController = new AbortController();
    const runtimeProjectionEvents: RuntimeAgentProjectionSummary[] = [];
    const runtimeTurnTimelines: RuntimeAgentTimelineSummary[] = [];
    const diagnostics = (extra?: Record<string, unknown>, trace?: RuntimeAgentTurnRunnerTrace) => {
      const runtimeTurnId = input.runtimeTurnRef.turnId || committedMessage?.runtimeTurnId || '';
      const runtimeStreamId = input.runtimeTurnRef.streamId || committedMessage?.runtimeStreamId || '';
      const diagnosticsInput: RuntimeAgentTurnRunnerDiagnosticsInput = {
        request: input.request,
        requestId: input.requestId,
        requestMessageId: input.requestMessageId,
        conversationAnchorId: input.request.conversationAnchorId,
        runtimeTurnId,
        runtimeStreamId,
        route: input.route,
        modelId: input.modelId,
        connectorId: input.connectorId,
        trace,
        runtimeProjectionEvents,
        runtimeTurnTimelines,
        extra,
      };
      return input.buildDiagnostics?.(diagnosticsInput) || buildRuntimeAgentRunnerDiagnostics(diagnosticsInput);
    };
    const recordTurnTimeline = (event: RuntimeAgentConsumeEvent) => {
      const timeline = summarizeRuntimeAgentTimeline(event);
      if (timeline) {
        runtimeTurnTimelines.push(timeline);
      }
    };
    const recoverTerminalSnapshot = async (reason: string): Promise<'none' | 'bound' | 'terminal'> => {
      if (terminalProjected || snapshotRecoveryProjected) {
        return 'none';
      }
      const recovered = await recoverRuntimeAgentTerminalSnapshot({
        reason,
        request: input.request,
        requestId: input.requestId,
        requestMessageId: input.requestMessageId,
        requestStartedAtMs,
        currentTurnAccepted,
        currentRuntimeTurnId: input.runtimeTurnRef.turnId,
        currentRuntimeStreamId: input.runtimeTurnRef.streamId,
        hasStructuredEnvelope: Boolean(structuredEnvelope),
        hasCommittedMessage: Boolean(committedMessage),
        querySnapshot: input.querySnapshot,
        enqueue: input.eventQueue.enqueue,
        logEvent: (event) => input.logEvent?.(event),
      });
      if (recovered === 'terminal') {
        snapshotRecoveryProjected = true;
      }
      return recovered;
    };
    void (async () => {
      while (!terminalProjected && !snapshotRecoveryController.signal.aborted) {
        await delay(input.stallRecoveryIntervalMs ?? 1000, snapshotRecoveryController.signal);
        if (terminalProjected || snapshotRecoveryController.signal.aborted) {
          return;
        }
        const recovered = await recoverTerminalSnapshot('subscription_terminal_stall');
        if (recovered === 'terminal') {
          return;
        }
      }
    })();

    const maybeYieldCommittedMessage = function* (
      trace?: RuntimeAgentTurnRunnerTrace,
    ): Generator<RuntimeAgentTurnRunnerPart> {
      if (messageSealedEmitted || !structuredEnvelope || !committedMessage) {
        return;
      }
      messageSealedEmitted = true;
      if (messageCommittedAt > 0) {
        input.logTiming?.({
          stage: 'message_committed_to_message_sealed',
          startedAt: messageCommittedAt,
          details: contextDetails({
            request: input.request,
            requestId: input.requestId,
            requestMessageId: input.requestMessageId,
            runtimeTurnId: committedMessage.runtimeTurnId,
            runtimeStreamId: committedMessage.runtimeStreamId,
            route: input.route,
            modelId: input.modelId,
            connectorId: input.connectorId,
          }),
        });
      }
      const sealedEnvelope = cloneAgentResolvedMessageActionEnvelopeWithCommittedMessage({
        envelope: structuredEnvelope,
        messageId: committedMessage.messageId,
        text: committedMessage.text,
      });
      const metadataInput: RuntimeAgentTurnRunnerMetadataInput = {
        request: input.request,
        requestId: input.requestId,
        requestMessageId: input.requestMessageId,
        conversationAnchorId: input.request.conversationAnchorId,
        runtimeTurnId: committedMessage.runtimeTurnId,
        runtimeStreamId: committedMessage.runtimeStreamId,
        route: input.route,
        modelId: input.modelId,
        connectorId: input.connectorId,
        trace,
        runtimeProjectionEvents,
        runtimeTurnTimelines,
        envelope: sealedEnvelope,
        committedMessage,
        latestTimeline: runtimeTurnTimelines[runtimeTurnTimelines.length - 1] || null,
      };
      yield {
        type: 'message-sealed',
        envelope: sealedEnvelope,
        trace,
        metadataJson: input.buildMetadata?.(metadataInput) || null,
        diagnostics: diagnostics(undefined, trace),
      };
    };

    try {
      while (true) {
        const nextResult = await input.eventQueue.next();
        if (nextResult.type === 'done') {
          const recovered = await recoverTerminalSnapshot('subscription_done');
          if (recovered !== 'none') {
            continue;
          }
          await Promise.resolve();
          const retryRecovered = await recoverTerminalSnapshot('subscription_done_retry');
          if (retryRecovered !== 'none') {
            continue;
          }
          break;
        }
        if (nextResult.type === 'error') {
          const recovered = await recoverTerminalSnapshot('subscription_error');
          if (recovered !== 'none') {
            continue;
          }
          throw nextResult.error;
        }
        const event = nextResult.event;
        recordTurnTimeline(event);
        const trace = input.resolveTrace?.();
        switch (event.eventName) {
          case 'runtime.agent.turn.accepted':
            if (!input.acceptedRequestIds.has(event.detail.requestId)) {
              break;
            }
            currentTurnAccepted = true;
            acceptedAt = input.nowMs();
            input.runtimeTurnRef.turnId = event.turnId;
            input.runtimeTurnRef.streamId = event.streamId;
            input.logEvent?.({
              level: 'info',
              area: 'agent-chat-runtime',
              message: 'action:runtime-agent-turn:accepted',
              details: {
                ...contextDetails({
                  request: input.request,
                  requestId: input.requestId,
                  requestMessageId: input.requestMessageId,
                  runtimeTurnId: input.runtimeTurnRef.turnId,
                  runtimeStreamId: input.runtimeTurnRef.streamId,
                  route: input.route,
                  modelId: input.modelId,
                  connectorId: input.connectorId,
                }),
                acceptedRequestId: event.detail.requestId,
              },
            });
            break;
          case 'runtime.agent.turn.started':
          case 'runtime.agent.turn.post_turn':
          case 'runtime.agent.turn.interrupt_ack':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) {
              break;
            }
            if (event.eventName === 'runtime.agent.turn.started') {
              startedAt = input.nowMs();
              if (acceptedAt > 0) {
                input.logTiming?.({
                  stage: 'accepted_to_started',
                  startedAt: acceptedAt,
                  details: contextDetails({
                    request: input.request,
                    requestId: input.requestId,
                    requestMessageId: input.requestMessageId,
                    runtimeTurnId: input.runtimeTurnRef.turnId,
                    runtimeStreamId: input.runtimeTurnRef.streamId,
                    route: input.route,
                    modelId: input.modelId,
                    connectorId: input.connectorId,
                  }),
                });
              }
              input.logEvent?.({
                level: 'info',
                area: 'agent-chat-runtime',
                message: 'action:runtime-agent-turn:started',
                details: contextDetails({
                  request: input.request,
                  requestId: input.requestId,
                  requestMessageId: input.requestMessageId,
                  runtimeTurnId: input.runtimeTurnRef.turnId,
                  runtimeStreamId: input.runtimeTurnRef.streamId,
                  route: input.route,
                  modelId: input.modelId,
                  connectorId: input.connectorId,
                }),
              });
            }
            break;
          case 'runtime.agent.state.status_text_changed':
          case 'runtime.agent.state.execution_state_changed':
          case 'runtime.agent.state.emotion_changed':
          case 'runtime.agent.state.posture_changed':
          case 'runtime.agent.hook.intent_proposed':
          case 'runtime.agent.hook.pending':
          case 'runtime.agent.hook.rejected':
          case 'runtime.agent.hook.running':
          case 'runtime.agent.hook.completed':
          case 'runtime.agent.hook.failed':
          case 'runtime.agent.hook.canceled':
          case 'runtime.agent.hook.rescheduled':
          case 'runtime.agent.presentation.activity_requested':
          case 'runtime.agent.presentation.motion_requested':
          case 'runtime.agent.presentation.expression_requested':
          case 'runtime.agent.presentation.pose_requested':
          case 'runtime.agent.presentation.pose_cleared':
          case 'runtime.agent.presentation.lookat_requested':
          case 'runtime.agent.presentation.voice_playback_requested':
          case 'runtime.agent.presentation.lipsync_frame_batch':
            if (!isRuntimeAgentProjectionEvent(event)
              || !matchesRuntimeAgentProjectionScope({
                event,
                conversationAnchorId: input.request.conversationAnchorId,
                currentTurnAccepted,
                currentRuntimeTurnId: input.runtimeTurnRef.turnId,
              })) {
              break;
            }
            runtimeProjectionEvents.push(summarizeRuntimeAgentProjectionEvent(event));
            input.logEvent?.({
              level: 'info',
              area: 'agent-chat-runtime',
              message: 'action:runtime-agent-turn:projection-event',
              details: {
                ...contextDetails({
                  request: input.request,
                  requestId: input.requestId,
                  requestMessageId: input.requestMessageId,
                  runtimeTurnId: input.runtimeTurnRef.turnId || undefined,
                  runtimeStreamId: input.runtimeTurnRef.streamId || undefined,
                  route: input.route,
                  modelId: input.modelId,
                  connectorId: input.connectorId,
                }),
                eventName: event.eventName,
              },
            });
            break;
          case 'runtime.agent.turn.reasoning_delta':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) {
              break;
            }
            if (event.detail.text) {
              yield {
                type: 'reasoning-delta',
                textDelta: event.detail.text,
              };
            }
            break;
          case 'runtime.agent.turn.text_delta':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) {
              break;
            }
            provisionalText += event.detail.text;
            if (event.detail.text) {
              if (!firstDeltaObserved) {
                firstDeltaObserved = true;
                if (startedAt > 0) {
                  input.logTiming?.({
                    stage: 'started_to_first_delta',
                    startedAt,
                    details: contextDetails({
                      request: input.request,
                      requestId: input.requestId,
                      requestMessageId: input.requestMessageId,
                      runtimeTurnId: input.runtimeTurnRef.turnId,
                      runtimeStreamId: input.runtimeTurnRef.streamId,
                      route: input.route,
                      modelId: input.modelId,
                      connectorId: input.connectorId,
                    }),
                  });
                }
              }
              yield {
                type: 'text-delta',
                textDelta: event.detail.text,
              };
            }
            break;
          case 'runtime.agent.turn.structured':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) {
              break;
            }
            structuredEnvelope = parseRuntimeAgentStructuredMessageActionEnvelope(event.detail.payload);
            yield* maybeYieldCommittedMessage(trace);
            break;
          case 'runtime.agent.turn.message_committed':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) {
              break;
            }
            committedMessage = {
              messageId: event.detail.messageId,
              text: event.detail.text,
              runtimeTurnId: event.turnId,
              runtimeStreamId: event.streamId,
            };
            messageCommittedAt = input.nowMs();
            input.logEvent?.({
              level: 'info',
              area: 'agent-chat-runtime',
              message: 'action:runtime-agent-turn:message-committed',
              details: {
                ...contextDetails({
                  request: input.request,
                  requestId: input.requestId,
                  requestMessageId: input.requestMessageId,
                  runtimeTurnId: event.turnId,
                  runtimeStreamId: event.streamId,
                  route: input.route,
                  modelId: input.modelId,
                  connectorId: input.connectorId,
                }),
                messageId: event.detail.messageId,
                textLength: event.detail.text.length,
              },
            });
            yield* maybeYieldCommittedMessage(trace);
            break;
          case 'runtime.agent.turn.completed':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) {
              break;
            }
            terminalProjected = true;
            input.logEvent?.({
              level: 'info',
              area: 'agent-chat-runtime',
              message: 'action:runtime-agent-turn:completed',
              details: {
                ...contextDetails({
                  request: input.request,
                  requestId: input.requestId,
                  requestMessageId: input.requestMessageId,
                  runtimeTurnId: event.turnId,
                  runtimeStreamId: event.streamId,
                  route: input.route,
                  modelId: input.modelId,
                  connectorId: input.connectorId,
                }),
                terminalReason: normalizeText(event.detail.terminalReason) || null,
              },
            });
            input.logTiming?.({
              stage: 'completed_to_ui_done',
              startedAt: input.nowMs(),
              details: contextDetails({
                request: input.request,
                requestId: input.requestId,
                requestMessageId: input.requestMessageId,
                runtimeTurnId: event.turnId,
                runtimeStreamId: event.streamId,
                route: input.route,
                modelId: input.modelId,
                connectorId: input.connectorId,
              }),
            });
            if (!messageSealedEmitted || !committedMessage) {
              yield {
                type: 'turn-failed',
                error: {
                  code: 'RUNTIME_AGENT_TURNS_INVALID',
                  message: 'runtime.agent.turn.completed arrived without committed structured message',
                },
                outputText: committedMessage?.text || provisionalText || undefined,
                diagnostics: diagnostics({ missingStructuredProjection: true }, trace),
              };
              return;
            }
            yield {
              type: 'turn-completed',
              outputText: committedMessage.text || provisionalText,
              finishReason: normalizeText(event.detail.terminalReason) || undefined,
              trace,
              diagnostics: diagnostics(undefined, trace),
            };
            return;
          case 'runtime.agent.turn.failed':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) {
              break;
            }
            terminalProjected = true;
            input.logEvent?.({
              level: 'warn',
              area: 'agent-chat-runtime',
              message: 'action:runtime-agent-turn:failed',
              details: {
                ...contextDetails({
                  request: input.request,
                  requestId: input.requestId,
                  requestMessageId: input.requestMessageId,
                  runtimeTurnId: event.turnId,
                  runtimeStreamId: event.streamId,
                  route: input.route,
                  modelId: input.modelId,
                  connectorId: input.connectorId,
                }),
                reasonCode: normalizeText(event.detail.reasonCode) || null,
                failureMessage: normalizeText(event.detail.message) || null,
              },
            });
            yield {
              type: 'turn-failed',
              error: {
                code: normalizeText(event.detail.reasonCode) || 'RUNTIME_AGENT_TURN_FAILED',
                message: normalizeText(event.detail.message) || 'runtime.agent turn failed',
              },
              outputText: committedMessage?.text || provisionalText || undefined,
              trace,
              diagnostics: diagnostics(undefined, trace),
            };
            return;
          case 'runtime.agent.turn.interrupted':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) {
              break;
            }
            terminalProjected = true;
            yield {
              type: 'turn-canceled',
              scope: 'turn',
              outputText: committedMessage?.text || provisionalText || undefined,
              trace,
              diagnostics: diagnostics({
                reason: normalizeText(event.detail.reason) || 'interrupt_requested',
              }, trace),
            };
            return;
          default:
            break;
        }
      }
    } finally {
      snapshotRecoveryController.abort();
      input.cleanupSubscription();
    }
    throw new Error('runtime.agent turn stream ended without a terminal event');
  })();
}
