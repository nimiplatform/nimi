import {
  projectRuntimeLocalAgentIdentity,
} from './agent-local-identity';
import type { JsonObject } from '../types';
import {
  isNimiRuntimeAgentProjectionEvent,
  matchesNimiRuntimeAgentProjectionScope,
  recoverNimiRuntimeAgentTerminalSnapshot,
  summarizeNimiRuntimeAgentProjectionEvent,
  summarizeNimiRuntimeAgentTimeline,
} from './runtime-agent-consumer-helpers';
import type {
  NimiRuntimeAgentConsumeEvent,
  NimiRuntimeAgentSessionTurnSnapshot,
} from './runtime-agent-consume-types';
import {
  cloneNimiRuntimeAgentResolvedMessageActionEnvelopeWithCommittedMessage,
  parseNimiRuntimeAgentStructuredMessageActionEnvelope,
  type NimiRuntimeAgentResolvedMessageActionEnvelope,
} from './runtime-agent-message-action';
import type {
  NimiRuntimeAgentProjectionSummary,
  NimiRuntimeAgentTimelineSummary,
  NimiRuntimeAgentTurnRunnerCommittedMessage,
  NimiRuntimeAgentTurnRunnerDiagnosticsInput,
  NimiRuntimeAgentTurnRunnerLogEvent,
  NimiRuntimeAgentTurnRunnerMetadataInput,
  NimiRuntimeAgentTurnRunnerOptions,
  NimiRuntimeAgentTurnRunnerPart,
  NimiRuntimeAgentTurnRunnerTrace,
  NimiRuntimeAgentTurnRequest,
  NimiRuntimeAgentConsumeRequest,
} from './runtime-agent-turn-runner-types';

type NimiRuntimeAgentQueuedEvent =
  | { readonly type: 'event'; readonly event: NimiRuntimeAgentConsumeEvent }
  | { readonly type: 'done' }
  | { readonly type: 'error'; readonly error: unknown };

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function detailText(event: NimiRuntimeAgentConsumeEvent, field: string): string {
  return normalizeText(event.detail[field]);
}

export function createNimiRuntimeAgentEventQueue(
  source: AsyncIterable<NimiRuntimeAgentConsumeEvent>,
): {
  readonly next: () => Promise<NimiRuntimeAgentQueuedEvent>;
  readonly enqueue: (event: NimiRuntimeAgentConsumeEvent) => void;
  readonly stop: () => void;
} {
  const iterator = source[Symbol.asyncIterator]();
  const queue: NimiRuntimeAgentQueuedEvent[] = [];
  const waiters: Array<() => void> = [];
  let stopped = false;

  const notify = () => {
    const pending = waiters.splice(0);
    for (const wake of pending) wake();
  };
  const push = (item: NimiRuntimeAgentQueuedEvent) => {
    if (stopped) return;
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
        if (stopped) return { type: 'done' };
        await waitForEvent();
      }
      return queue.shift() || { type: 'done' };
    },
    enqueue: (event) => {
      push({ type: 'event', event });
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      notify();
      void iterator.return?.();
    },
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timeout = globalThis.setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export function defaultNimiRuntimeAgentNowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function buildRunnerDiagnostics(input: NimiRuntimeAgentTurnRunnerDiagnosticsInput): JsonObject {
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

export function nimiRuntimeAgentLocalIdentityFromRequest(request: NimiRuntimeAgentTurnRequest) {
  return {
    ownerUserId: request.ownerUserId,
    realmAgentId: request.realmAgentId,
    localAgentRef: request.localAgentRef,
  };
}

export function buildNimiRuntimeAgentSubscribeRequest(
  request: NimiRuntimeAgentTurnRequest,
  subscribe?: NimiRuntimeAgentConsumeRequest,
): NimiRuntimeAgentConsumeRequest {
  return subscribe || {
    ...nimiRuntimeAgentLocalIdentityFromRequest(request),
    conversationAnchorId: request.conversationAnchorId,
    includeAgentEvents: false,
  };
}

export function nimiRuntimeAgentContextDetails(input: {
  readonly request: NimiRuntimeAgentTurnRequest;
  readonly requestId: string;
  readonly requestMessageId?: string;
  readonly runtimeTurnId?: string;
  readonly runtimeStreamId?: string;
  readonly route: string;
  readonly modelId: string;
  readonly connectorId?: string;
}): JsonObject {
  return {
    localAgentRef: normalizeText(input.request.localAgentRef),
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

export type NimiRuntimeAgentTurnStreamInput = {
  readonly acceptedRequestIds: Set<string>;
  readonly cleanupSubscription: () => void;
  readonly connectorId: string | undefined;
  readonly eventQueue: ReturnType<typeof createNimiRuntimeAgentEventQueue>;
  readonly logEvent?: (event: NimiRuntimeAgentTurnRunnerLogEvent) => void;
  readonly logTiming?: NimiRuntimeAgentTurnRunnerOptions['logTiming'];
  readonly modelId: string;
  readonly nowMs: () => number;
  readonly querySnapshot: () => Promise<{
    readonly activeTurn?: NimiRuntimeAgentSessionTurnSnapshot;
    readonly lastTurn?: NimiRuntimeAgentSessionTurnSnapshot;
  }>;
  readonly request: NimiRuntimeAgentTurnRequest;
  readonly requestId: string;
  readonly requestMessageId: string;
  readonly resolveTrace?: () => NimiRuntimeAgentTurnRunnerTrace | undefined;
  readonly route: string;
  readonly runtimeTurnRef: { turnId: string; streamId: string };
  readonly stallRecoveryIntervalMs?: number;
  readonly buildMetadata?: NimiRuntimeAgentTurnRunnerOptions['buildMetadata'];
  readonly buildDiagnostics?: NimiRuntimeAgentTurnRunnerOptions['buildDiagnostics'];
};

export function createNimiRuntimeAgentTurnStream(
  input: NimiRuntimeAgentTurnStreamInput,
): AsyncIterable<NimiRuntimeAgentTurnRunnerPart> {
  return (async function* stream(): AsyncIterable<NimiRuntimeAgentTurnRunnerPart> {
    let structuredEnvelope: NimiRuntimeAgentResolvedMessageActionEnvelope | null = null;
    let provisionalText = '';
    let committedMessage: NimiRuntimeAgentTurnRunnerCommittedMessage | null = null;
    let messageSealedEmitted = false;
    let currentTurnAccepted = false;
    let acceptedAt = 0;
    let startedAt = 0;
    let firstDeltaObserved = false;
    let messageCommittedAt = 0;
    let terminalProjected = false;
    let snapshotRecoveryProjected = false;
    const requestStartedAtMs = input.nowMs();
    const recoveryIdentity = projectRuntimeLocalAgentIdentity(input.request);
    const recoveryRequest = {
      ownerUserId: recoveryIdentity.ownerUserId,
      realmAgentId: recoveryIdentity.realmAgentId,
      localAgentRef: recoveryIdentity.localAgentRef,
      conversationAnchorId: input.request.conversationAnchorId,
      ...(input.request.threadId ? { threadId: input.request.threadId } : {}),
    };
    const snapshotRecoveryController = new AbortController();
    const runtimeProjectionEvents: NimiRuntimeAgentProjectionSummary[] = [];
    const runtimeTurnTimelines: NimiRuntimeAgentTimelineSummary[] = [];
    const diagnostics = (extra?: JsonObject, trace?: NimiRuntimeAgentTurnRunnerTrace) => {
      const runtimeTurnId = input.runtimeTurnRef.turnId || committedMessage?.runtimeTurnId || '';
      const runtimeStreamId = input.runtimeTurnRef.streamId || committedMessage?.runtimeStreamId || '';
      const diagnosticsInput: NimiRuntimeAgentTurnRunnerDiagnosticsInput = {
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
      return input.buildDiagnostics?.(diagnosticsInput) || buildRunnerDiagnostics(diagnosticsInput);
    };
    const recordTurnTimeline = (event: NimiRuntimeAgentConsumeEvent) => {
      const timeline = summarizeNimiRuntimeAgentTimeline(event);
      if (timeline) runtimeTurnTimelines.push(timeline);
    };
    const recoverTerminalSnapshot = async (reason: string): Promise<'none' | 'bound' | 'terminal'> => {
      if (terminalProjected || snapshotRecoveryProjected) return 'none';
      const recovered = await recoverNimiRuntimeAgentTerminalSnapshot({
        reason,
        request: recoveryRequest,
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
      if (recovered === 'terminal') snapshotRecoveryProjected = true;
      return recovered;
    };
    void (async () => {
      while (!terminalProjected && !snapshotRecoveryController.signal.aborted) {
        await delay(input.stallRecoveryIntervalMs ?? 1000, snapshotRecoveryController.signal);
        if (terminalProjected || snapshotRecoveryController.signal.aborted) return;
        const recovered = await recoverTerminalSnapshot('subscription_terminal_stall');
        if (recovered === 'terminal') return;
      }
    })();

    const maybeYieldCommittedMessage = function* (
      trace?: NimiRuntimeAgentTurnRunnerTrace,
    ): Generator<NimiRuntimeAgentTurnRunnerPart> {
      if (messageSealedEmitted || !structuredEnvelope || !committedMessage) return;
      messageSealedEmitted = true;
      if (messageCommittedAt > 0) {
        input.logTiming?.({
          stage: 'message_committed_to_message_sealed',
          startedAt: messageCommittedAt,
          details: nimiRuntimeAgentContextDetails({
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
      const sealedEnvelope = cloneNimiRuntimeAgentResolvedMessageActionEnvelopeWithCommittedMessage({
        envelope: structuredEnvelope,
        messageId: committedMessage.messageId,
        text: committedMessage.text,
      });
      const metadataInput: NimiRuntimeAgentTurnRunnerMetadataInput = {
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
          if (recovered !== 'none') continue;
          await Promise.resolve();
          const retryRecovered = await recoverTerminalSnapshot('subscription_done_retry');
          if (retryRecovered !== 'none') continue;
          break;
        }
        if (nextResult.type === 'error') {
          const recovered = await recoverTerminalSnapshot('subscription_error');
          if (recovered !== 'none') continue;
          throw nextResult.error;
        }
        const event = nextResult.event;
        recordTurnTimeline(event);
        const trace = input.resolveTrace?.();
        switch (event.eventName) {
          case 'runtime.agent.turn.accepted':
            if (!input.acceptedRequestIds.has(detailText(event, 'requestId'))) break;
            currentTurnAccepted = true;
            acceptedAt = input.nowMs();
            input.runtimeTurnRef.turnId = event.turnId || '';
            input.runtimeTurnRef.streamId = event.streamId || '';
            input.logEvent?.({
              level: 'info',
              area: 'agent-chat-runtime',
              message: 'action:runtime-agent-turn:accepted',
              details: {
                ...nimiRuntimeAgentContextDetails({
                  request: input.request,
                  requestId: input.requestId,
                  requestMessageId: input.requestMessageId,
                  runtimeTurnId: input.runtimeTurnRef.turnId,
                  runtimeStreamId: input.runtimeTurnRef.streamId,
                  route: input.route,
                  modelId: input.modelId,
                  connectorId: input.connectorId,
                }),
                acceptedRequestId: detailText(event, 'requestId'),
              },
            });
            break;
          case 'runtime.agent.turn.started':
          case 'runtime.agent.turn.post_turn':
          case 'runtime.agent.turn.interrupt_ack':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) break;
            if (event.eventName === 'runtime.agent.turn.started') {
              startedAt = input.nowMs();
              if (acceptedAt > 0) {
                input.logTiming?.({
                  stage: 'accepted_to_started',
                  startedAt: acceptedAt,
                  details: nimiRuntimeAgentContextDetails({
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
            if (!isNimiRuntimeAgentProjectionEvent(event)
              || !matchesNimiRuntimeAgentProjectionScope({
                event,
                conversationAnchorId: input.request.conversationAnchorId,
                currentTurnAccepted,
                currentRuntimeTurnId: input.runtimeTurnRef.turnId,
              })) {
              break;
            }
            runtimeProjectionEvents.push(summarizeNimiRuntimeAgentProjectionEvent(event));
            break;
          case 'runtime.agent.turn.reasoning_delta': {
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) break;
            const text = detailText(event, 'text');
            if (text) yield { type: 'reasoning-delta', textDelta: text };
            break;
          }
          case 'runtime.agent.turn.text_delta': {
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) break;
            const text = detailText(event, 'text');
            provisionalText += text;
            if (text) {
              if (!firstDeltaObserved) {
                firstDeltaObserved = true;
                if (startedAt > 0) {
                  input.logTiming?.({
                    stage: 'started_to_first_delta',
                    startedAt,
                    details: nimiRuntimeAgentContextDetails({
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
              yield { type: 'text-delta', textDelta: text };
            }
            break;
          }
          case 'runtime.agent.turn.structured':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) break;
            structuredEnvelope = parseNimiRuntimeAgentStructuredMessageActionEnvelope(event.detail.payload);
            yield* maybeYieldCommittedMessage(trace);
            break;
          case 'runtime.agent.turn.message_committed': {
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) break;
            const messageId = detailText(event, 'messageId');
            const text = detailText(event, 'text');
            committedMessage = {
              messageId,
              text,
              runtimeTurnId: event.turnId || '',
              runtimeStreamId: event.streamId || '',
            };
            messageCommittedAt = input.nowMs();
            yield* maybeYieldCommittedMessage(trace);
            break;
          }
          case 'runtime.agent.turn.completed':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) break;
            terminalProjected = true;
            input.logTiming?.({
              stage: 'completed_to_ui_done',
              startedAt: input.nowMs(),
              details: nimiRuntimeAgentContextDetails({
                request: input.request,
                requestId: input.requestId,
                requestMessageId: input.requestMessageId,
                runtimeTurnId: event.turnId || '',
                runtimeStreamId: event.streamId || '',
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
              finishReason: detailText(event, 'terminalReason') || undefined,
              trace,
              diagnostics: diagnostics(undefined, trace),
            };
            return;
          case 'runtime.agent.turn.failed':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) break;
            terminalProjected = true;
            yield {
              type: 'turn-failed',
              error: {
                code: detailText(event, 'reasonCode') || 'RUNTIME_AGENT_TURN_FAILED',
                message: detailText(event, 'message') || 'runtime.agent turn failed',
              },
              outputText: committedMessage?.text || provisionalText || undefined,
              trace,
              diagnostics: diagnostics(undefined, trace),
            };
            return;
          case 'runtime.agent.turn.interrupted':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) break;
            terminalProjected = true;
            yield {
              type: 'turn-canceled',
              scope: 'turn',
              outputText: committedMessage?.text || provisionalText || undefined,
              trace,
              diagnostics: diagnostics({ reason: detailText(event, 'reason') || 'interrupt_requested' }, trace),
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
