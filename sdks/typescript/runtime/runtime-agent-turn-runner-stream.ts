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
import {
  TERMINAL_GRACE_MAX_EVENTS,
  TERMINAL_GRACE_WAIT_MS,
  buildRunnerDiagnostics,
  createNimiRuntimeAgentEventQueue,
  delay,
  detailText,
  nimiRuntimeAgentContextDetails,
  sortedRuntimeTerminalGraceEvents,
} from './runtime-agent-turn-runner-stream-support';
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
} from './runtime-agent-turn-runner-types';

export {
  buildNimiRuntimeAgentSubscribeRequest,
  createNimiRuntimeAgentEventQueue,
  defaultNimiRuntimeAgentNowMs,
  nimiRuntimeAgentContextDetails,
  nimiRuntimeAgentLocalIdentityFromRequest,
} from './runtime-agent-turn-runner-stream-support';

export type NimiRuntimeAgentTurnStreamInput = {
  readonly acceptedRequestIds: Set<string>;
  readonly cleanupSubscription: () => void;
  readonly eventQueue: ReturnType<typeof createNimiRuntimeAgentEventQueue>;
  readonly logEvent?: (event: NimiRuntimeAgentTurnRunnerLogEvent) => void;
  readonly logTiming?: NimiRuntimeAgentTurnRunnerOptions['logTiming'];
  readonly nowMs: () => number;
  readonly querySnapshot: () => Promise<{
    readonly activeTurn?: NimiRuntimeAgentSessionTurnSnapshot;
    readonly lastTurn?: NimiRuntimeAgentSessionTurnSnapshot;
  }>;
  readonly request: NimiRuntimeAgentTurnRequest;
  readonly requestId: string;
  readonly requestMessageId: string;
  readonly resolveTrace?: () => NimiRuntimeAgentTurnRunnerTrace | undefined;
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
      runtimeSourceRef: recoveryIdentity.runtimeSourceRef,
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

    const eventMatchesCurrentTurn = (event: NimiRuntimeAgentConsumeEvent): boolean =>
      currentTurnAccepted && event.turnId === input.runtimeTurnRef.turnId;
    const projectionMatchesCurrentTurn = (event: NimiRuntimeAgentConsumeEvent): boolean =>
      isNimiRuntimeAgentProjectionEvent(event)
        && matchesNimiRuntimeAgentProjectionScope({
          event,
          conversationAnchorId: input.request.conversationAnchorId,
          currentTurnAccepted,
          currentRuntimeTurnId: input.runtimeTurnRef.turnId,
        });
    const admitProvisionalTextDelta = (text: string): boolean => {
      if (!text) return false;
      if (!messageSealedEmitted) {
        provisionalText += text;
        return true;
      }
      const nextProvisionalText = provisionalText + text;
      const committedText = committedMessage?.text || '';
      if (!committedText || !committedText.startsWith(nextProvisionalText)) {
        throw new Error('runtime.agent emitted divergent text_delta after message_committed');
      }
      provisionalText = nextProvisionalText;
      return false;
    };
    const shouldDrainBeforeTerminal = (event: NimiRuntimeAgentConsumeEvent): boolean => {
      if (
        event.eventName === 'runtime.agent.turn.completed'
        || event.eventName === 'runtime.agent.turn.failed'
        || event.eventName === 'runtime.agent.turn.interrupted'
      ) {
        return false;
      }
      if (event.eventName.startsWith('runtime.agent.turn.')) {
        return eventMatchesCurrentTurn(event);
      }
      return projectionMatchesCurrentTurn(event);
    };
    const drainTerminalGraceEvents = async (): Promise<NimiRuntimeAgentConsumeEvent[]> => {
      const drained: NimiRuntimeAgentConsumeEvent[] = [];
      while (drained.length < TERMINAL_GRACE_MAX_EVENTS) {
        const nextGrace = await input.eventQueue.next(TERMINAL_GRACE_WAIT_MS);
        if (nextGrace.type === 'timeout' || nextGrace.type === 'done') break;
        if (nextGrace.type === 'error') {
          input.logEvent?.({
            level: 'warn',
            area: 'agent-chat-runtime',
            message: 'action:runtime-agent-turn:terminal-grace-error',
            details: {
              ...nimiRuntimeAgentContextDetails({
                request: input.request,
                requestId: input.requestId,
                requestMessageId: input.requestMessageId,
                runtimeTurnId: input.runtimeTurnRef.turnId,
                runtimeStreamId: input.runtimeTurnRef.streamId,
              }),
              error: String(nextGrace.error instanceof Error ? nextGrace.error.message : nextGrace.error),
            },
          });
          break;
        }
        if (shouldDrainBeforeTerminal(nextGrace.event)) {
          drained.push(nextGrace.event);
        }
      }
      return sortedRuntimeTerminalGraceEvents(drained);
    };
    const yieldPreTerminalEvent = function* (
      event: NimiRuntimeAgentConsumeEvent,
      trace?: NimiRuntimeAgentTurnRunnerTrace,
    ): Generator<NimiRuntimeAgentTurnRunnerPart> {
      switch (event.eventName) {
        case 'runtime.agent.turn.started':
        case 'runtime.agent.turn.post_turn':
        case 'runtime.agent.turn.interrupt_ack':
          if (!eventMatchesCurrentTurn(event)) break;
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
        case 'runtime.agent.conversation.voice_timing_ready':
        case 'runtime.agent.conversation.voice_artifact_available':
        case 'runtime.agent.conversation.voice_timing_terminal':
          if (projectionMatchesCurrentTurn(event)) {
            runtimeProjectionEvents.push(summarizeNimiRuntimeAgentProjectionEvent(event));
          }
          break;
        case 'runtime.agent.turn.reasoning_delta': {
          if (!eventMatchesCurrentTurn(event)) break;
          const text = detailText(event, 'text');
          if (text) yield { type: 'reasoning-delta', textDelta: text };
          break;
        }
        case 'runtime.agent.turn.text_delta': {
          if (!eventMatchesCurrentTurn(event)) break;
          const text = detailText(event, 'text');
          if (admitProvisionalTextDelta(text)) {
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
                  }),
                });
              }
            }
            yield { type: 'text-delta', textDelta: text };
          }
          break;
        }
        case 'runtime.agent.turn.structured':
          if (!eventMatchesCurrentTurn(event)) break;
          structuredEnvelope = parseNimiRuntimeAgentStructuredMessageActionEnvelope(event.detail.payload);
          yield* maybeYieldCommittedMessage(trace);
          break;
        case 'runtime.agent.turn.message_committed': {
          if (!eventMatchesCurrentTurn(event)) break;
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
        case 'runtime.agent.turn.action_planned':
          if (!eventMatchesCurrentTurn(event)) break;
          yield {
            type: 'beat-planned',
            turnId: event.turnId || '',
            beatId: detailText(event, 'actionId'),
            projectionMessageId: detailText(event, 'projectionMessageId') || undefined,
          };
          break;
        case 'runtime.agent.turn.action_started':
          if (!eventMatchesCurrentTurn(event)) break;
          yield {
            type: 'beat-delivery-started',
            turnId: event.turnId || '',
            beatId: detailText(event, 'actionId'),
            projectionMessageId: detailText(event, 'projectionMessageId') || undefined,
          };
          break;
        case 'runtime.agent.turn.artifact_ready':
          if (!eventMatchesCurrentTurn(event)) break;
          yield {
            type: 'artifact-ready',
            turnId: event.turnId || '',
            beatId: detailText(event, 'actionId'),
            artifactId: detailText(event, 'artifactId'),
            mimeType: detailText(event, 'mimeType'),
            projectionMessageId: detailText(event, 'projectionMessageId') || undefined,
          };
          break;
        case 'runtime.agent.turn.action_completed':
          if (!eventMatchesCurrentTurn(event)) break;
          yield {
            type: 'beat-delivered',
            turnId: event.turnId || '',
            beatId: detailText(event, 'actionId'),
            projectionMessageId: detailText(event, 'projectionMessageId') || undefined,
            artifactId: detailText(event, 'artifactId') || undefined,
            mimeType: detailText(event, 'mimeType') || undefined,
          };
          break;
        case 'runtime.agent.turn.action_failed':
          if (!eventMatchesCurrentTurn(event)) break;
          yield {
            type: 'beat-delivery-failed',
            turnId: event.turnId || '',
            beatId: detailText(event, 'actionId'),
            operation: detailText(event, 'operation'),
            modality: detailText(event, 'modality'),
            reasonCode: detailText(event, 'reasonCode'),
            reason: detailText(event, 'reason'),
            message: detailText(event, 'message'),
            projectionMessageId: detailText(event, 'projectionMessageId') || undefined,
          };
          break;
        default:
          break;
      }
    };

    try {
      while (true) {
        const nextResult = await input.eventQueue.next();
        if (nextResult.type === 'done') {
          input.logEvent?.({
            level: 'info',
            area: 'agent-chat-runtime',
            message: 'action:runtime-agent-turn:subscription-done',
            details: nimiRuntimeAgentContextDetails({
              request: input.request,
              requestId: input.requestId,
              requestMessageId: input.requestMessageId,
              runtimeTurnId: input.runtimeTurnRef.turnId,
              runtimeStreamId: input.runtimeTurnRef.streamId,
            }),
          });
          const recovered = await recoverTerminalSnapshot('subscription_done');
          if (recovered !== 'none') continue;
          await Promise.resolve();
          const retryRecovered = await recoverTerminalSnapshot('subscription_done_retry');
          if (retryRecovered !== 'none') continue;
          break;
        }
        if (nextResult.type === 'timeout') {
          continue;
        }
        if (nextResult.type === 'error') {
          input.logEvent?.({
            level: 'warn',
            area: 'agent-chat-runtime',
            message: 'action:runtime-agent-turn:subscription-error',
            details: {
              ...nimiRuntimeAgentContextDetails({
                request: input.request,
                requestId: input.requestId,
                requestMessageId: input.requestMessageId,
                runtimeTurnId: input.runtimeTurnRef.turnId,
                runtimeStreamId: input.runtimeTurnRef.streamId,
              }),
              error: String(nextResult.error instanceof Error ? nextResult.error.message : nextResult.error),
            },
          });
          const recovered = await recoverTerminalSnapshot('subscription_error');
          if (recovered !== 'none') continue;
          throw nextResult.error;
        }
        const event = nextResult.event;
        recordTurnTimeline(event);
        const trace = input.resolveTrace?.();
        if (event.eventName.startsWith('runtime.agent.turn.')) {
          input.logEvent?.({
            level: 'info',
            area: 'agent-chat-runtime',
            message: 'action:runtime-agent-turn:subscription-event',
            details: {
              ...nimiRuntimeAgentContextDetails({
                request: input.request,
                requestId: input.requestId,
                requestMessageId: input.requestMessageId,
                runtimeTurnId: input.runtimeTurnRef.turnId,
                runtimeStreamId: input.runtimeTurnRef.streamId,
              }),
              eventName: event.eventName,
              eventTurnId: event.turnId || null,
              eventStreamId: event.streamId || null,
              currentTurnAccepted,
            },
          });
        }
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
          case 'runtime.agent.conversation.voice_timing_ready':
          case 'runtime.agent.conversation.voice_artifact_available':
          case 'runtime.agent.conversation.voice_timing_terminal':
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
            if (admitProvisionalTextDelta(text)) {
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
          case 'runtime.agent.turn.action_planned':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) break;
            yield {
              type: 'beat-planned',
              turnId: event.turnId || '',
              beatId: detailText(event, 'actionId'),
              projectionMessageId: detailText(event, 'projectionMessageId') || undefined,
            };
            break;
          case 'runtime.agent.turn.action_started':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) break;
            yield {
              type: 'beat-delivery-started',
              turnId: event.turnId || '',
              beatId: detailText(event, 'actionId'),
              projectionMessageId: detailText(event, 'projectionMessageId') || undefined,
            };
            break;
          case 'runtime.agent.turn.artifact_ready':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) break;
            yield {
              type: 'artifact-ready',
              turnId: event.turnId || '',
              beatId: detailText(event, 'actionId'),
              artifactId: detailText(event, 'artifactId'),
              mimeType: detailText(event, 'mimeType'),
              projectionMessageId: detailText(event, 'projectionMessageId') || undefined,
            };
            break;
          case 'runtime.agent.turn.action_completed':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) break;
            yield {
              type: 'beat-delivered',
              turnId: event.turnId || '',
              beatId: detailText(event, 'actionId'),
              projectionMessageId: detailText(event, 'projectionMessageId') || undefined,
              artifactId: detailText(event, 'artifactId') || undefined,
              mimeType: detailText(event, 'mimeType') || undefined,
            };
            break;
          case 'runtime.agent.turn.action_failed':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) break;
            yield {
              type: 'beat-delivery-failed',
              turnId: event.turnId || '',
              beatId: detailText(event, 'actionId'),
              operation: detailText(event, 'operation'),
              modality: detailText(event, 'modality'),
              reasonCode: detailText(event, 'reasonCode'),
              reason: detailText(event, 'reason'),
              message: detailText(event, 'message'),
              projectionMessageId: detailText(event, 'projectionMessageId') || undefined,
            };
            break;
          case 'runtime.agent.turn.completed':
            if (!currentTurnAccepted || event.turnId !== input.runtimeTurnRef.turnId) break;
            for (const graceEvent of await drainTerminalGraceEvents()) {
              recordTurnTimeline(graceEvent);
              yield* yieldPreTerminalEvent(graceEvent, input.resolveTrace?.());
            }
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
