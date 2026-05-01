import type { RuntimeAgentConsumeEvent, RuntimeAgentSessionTurnSnapshot } from '@nimiplatform/sdk/runtime';
import type { ConversationRuntimeTrace } from '@nimiplatform/nimi-kit/features/chat/headless';

import { type AgentResolvedMessageActionEnvelope } from './chat-agent-behavior';
import type {
  AgentLocalChatRuntimeRequest,
  AgentLocalChatTurnStreamPart,
} from './chat-agent-orchestration-types';
import { normalizeText } from './chat-agent-orchestration-shared';
import {
  isRuntimeAgentProjectionEvent,
  matchesRuntimeAgentProjectionScope,
  summarizeRuntimeAgentProjectionEvent,
  type RuntimeAgentProjectionSummary,
} from './chat-agent-runtime-agent-projection';
import {
  summarizeRuntimeAgentTimeline,
  type RuntimeAgentTimelineSummary,
} from './chat-agent-runtime-agent-timeline';
import {
  createRuntimeAgentEventQueue,
  delay,
  recoverRuntimeAgentTerminalSnapshot,
} from './chat-agent-runtime-agent-stream';
import {
  buildRuntimeAgentDiagnostics,
  cloneEnvelopeWithCommittedMessage,
  nowMs,
  resolveRuntimeTrace,
  safeLogRuntimeAgentEvent,
  safeLogRuntimeAgentTiming,
  toDebugMetadata,
  toResolvedEnvelope,
  type PendingCommittedMessage,
} from './chat-agent-runtime-agent-utils';

export type RuntimeAgentTurnRef = {
  turnId: string;
  streamId: string;
};

type RuntimeAgentTurnStreamInput = {
  acceptedRequestIds: Set<string>;
  cleanupSubscription: () => void;
  connectorId: string | undefined;
  eventQueue: ReturnType<typeof createRuntimeAgentEventQueue>;
  modelId: string;
  querySnapshot: () => Promise<{
    activeTurn?: RuntimeAgentSessionTurnSnapshot;
    lastTurn?: RuntimeAgentSessionTurnSnapshot;
  }>;
  request: AgentLocalChatRuntimeRequest;
  requestId: string;
  requestMessageId: string;
  route: string;
  runtimeTurnRef: RuntimeAgentTurnRef;
};

export function createRuntimeAgentTurnStream(input: RuntimeAgentTurnStreamInput): { stream: AsyncIterable<AgentLocalChatTurnStreamPart> } {
  const {
    acceptedRequestIds,
    cleanupSubscription,
    connectorId,
    eventQueue,
    modelId,
    querySnapshot,
    request,
    requestId,
    requestMessageId,
    route,
    runtimeTurnRef,
  } = input;

  return {
    stream: (async function* stream(): AsyncIterable<AgentLocalChatTurnStreamPart> {
      let structuredEnvelope: AgentResolvedMessageActionEnvelope | null = null;
      let provisionalText = '';
      let committedMessage: PendingCommittedMessage | null = null;
      let messageSealedEmitted = false;
      let currentTurnAccepted = false;
      let acceptedAt = 0;
      let startedAt = 0;
      let firstDeltaObserved = false;
      let messageCommittedAt = 0;
      let terminalProjected = false;
      let snapshotRecoveryProjected = false;
      const snapshotRecoveryController = new AbortController();
      const runtimeProjectionEvents: RuntimeAgentProjectionSummary[] = [];
      const runtimeTurnTimelines: RuntimeAgentTimelineSummary[] = [];

      const timelineDiagnostics = () => runtimeTurnTimelines.length > 0
        ? { runtimeTurnTimelines: [...runtimeTurnTimelines] }
        : {};
      const projectionDiagnostics = () => runtimeProjectionEvents.length > 0
        ? { runtimeProjectionEvents: [...runtimeProjectionEvents] }
        : {};
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
          request,
          requestId,
          requestMessageId,
          currentTurnAccepted,
          currentRuntimeTurnId: runtimeTurnRef.turnId,
          currentRuntimeStreamId: runtimeTurnRef.streamId,
          hasStructuredEnvelope: Boolean(structuredEnvelope),
          hasCommittedMessage: Boolean(committedMessage),
          querySnapshot,
          enqueue: eventQueue.enqueue,
          logEvent: safeLogRuntimeAgentEvent,
        });
        if (recovered === 'terminal') {
          snapshotRecoveryProjected = true;
        }
        return recovered;
      };
      void (async () => {
        while (!terminalProjected && !snapshotRecoveryController.signal.aborted) {
          await delay(1000, snapshotRecoveryController.signal);
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
        trace?: ConversationRuntimeTrace,
      ): Generator<AgentLocalChatTurnStreamPart> {
        if (messageSealedEmitted || !structuredEnvelope || !committedMessage) {
          return;
        }
        messageSealedEmitted = true;
        if (messageCommittedAt > 0) {
          safeLogRuntimeAgentTiming({
            stage: 'desktop.runtime_agent.message_committed_to_message_sealed_ms',
            startedAt: messageCommittedAt,
            details: {
              agentId: request.agentId,
              conversationAnchorId: request.conversationAnchorId,
              threadId: request.threadId,
              requestId,
              runtimeTurnId: committedMessage.runtimeTurnId,
              runtimeStreamId: committedMessage.runtimeStreamId,
              route,
              modelId,
              connectorId: connectorId || null,
            },
          });
        }
        const sealedEnvelope = cloneEnvelopeWithCommittedMessage({
          envelope: structuredEnvelope,
          messageId: committedMessage.messageId,
          text: committedMessage.text,
        });
        yield {
          type: 'message-sealed',
          envelope: sealedEnvelope,
          trace,
          metadataJson: toDebugMetadata({
            prompt: typeof request.prompt === 'string' ? request.prompt : '',
            systemPrompt: normalizeText(request.systemPrompt) || null,
            conversationAnchorId: request.conversationAnchorId,
            runtimeTurnId: committedMessage.runtimeTurnId,
            runtimeStreamId: committedMessage.runtimeStreamId,
            route,
            modelId,
            connectorId,
            trace,
            envelope: sealedEnvelope,
            latestTimeline: runtimeTurnTimelines[runtimeTurnTimelines.length - 1] || null,
          }),
          diagnostics: buildRuntimeAgentDiagnostics({
            conversationAnchorId: request.conversationAnchorId,
            runtimeTurnId: committedMessage.runtimeTurnId,
            runtimeStreamId: committedMessage.runtimeStreamId,
            route,
            modelId,
            connectorId,
            trace,
            extra: {
              ...timelineDiagnostics(),
              ...projectionDiagnostics(),
            },
          }),
        };
      };

      try {
        while (true) {
          const nextResult = await eventQueue.next();
          if (nextResult.type === 'done') {
            const recovered = await recoverTerminalSnapshot('subscription_done');
            if (recovered !== 'none') {
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
          const trace = resolveRuntimeTrace();
          switch (event.eventName) {
            case 'runtime.agent.turn.accepted':
              if (!acceptedRequestIds.has(event.detail.requestId)) {
                break;
              }
              currentTurnAccepted = true;
              acceptedAt = nowMs();
              runtimeTurnRef.turnId = event.turnId;
              runtimeTurnRef.streamId = event.streamId;
              safeLogRuntimeAgentEvent({
                level: 'info',
                area: 'agent-chat-runtime',
                message: 'action:runtime-agent-turn:accepted',
                details: {
                  agentId: request.agentId,
                  conversationAnchorId: request.conversationAnchorId,
                  threadId: request.threadId,
                  requestId,
                  requestMessageId,
                  acceptedRequestId: event.detail.requestId,
                  runtimeTurnId: runtimeTurnRef.turnId,
                  runtimeStreamId: runtimeTurnRef.streamId,
                  route,
                  modelId,
                  connectorId: connectorId || null,
                },
              });
              break;
            case 'runtime.agent.turn.started':
            case 'runtime.agent.turn.post_turn':
            case 'runtime.agent.turn.interrupt_ack':
              if (!currentTurnAccepted || event.turnId !== runtimeTurnRef.turnId) {
                break;
              }
              if (event.eventName === 'runtime.agent.turn.started') {
                startedAt = nowMs();
                if (acceptedAt > 0) {
                  safeLogRuntimeAgentTiming({
                    stage: 'desktop.runtime_agent.accepted_to_started_ms',
                    startedAt: acceptedAt,
                    details: {
                      agentId: request.agentId,
                      conversationAnchorId: request.conversationAnchorId,
                      threadId: request.threadId,
                      requestId,
                      runtimeTurnId: runtimeTurnRef.turnId,
                      runtimeStreamId: runtimeTurnRef.streamId,
                      route,
                      modelId,
                      connectorId: connectorId || null,
                    },
                  });
                }
                safeLogRuntimeAgentEvent({
                  level: 'info',
                  area: 'agent-chat-runtime',
                  message: 'action:runtime-agent-turn:started',
                  details: {
                    agentId: request.agentId,
                    conversationAnchorId: request.conversationAnchorId,
                    threadId: request.threadId,
                    requestId,
                    runtimeTurnId: runtimeTurnRef.turnId,
                    runtimeStreamId: runtimeTurnRef.streamId,
                    route,
                    modelId,
                    connectorId: connectorId || null,
                  },
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
                  conversationAnchorId: request.conversationAnchorId,
                  currentTurnAccepted,
                  currentRuntimeTurnId: runtimeTurnRef.turnId,
                })) {
                break;
              }
              runtimeProjectionEvents.push(summarizeRuntimeAgentProjectionEvent(event));
              safeLogRuntimeAgentEvent({
                level: 'info',
                area: 'agent-chat-runtime',
                message: 'action:runtime-agent-turn:projection-event',
                details: {
                  agentId: request.agentId,
                  conversationAnchorId: request.conversationAnchorId,
                  threadId: request.threadId,
                  requestId,
                  eventName: event.eventName,
                  runtimeTurnId: runtimeTurnRef.turnId || null,
                  runtimeStreamId: runtimeTurnRef.streamId || null,
                  route,
                  modelId,
                  connectorId: connectorId || null,
                },
              });
              break;
            case 'runtime.agent.turn.reasoning_delta':
              if (!currentTurnAccepted || event.turnId !== runtimeTurnRef.turnId) {
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
              if (!currentTurnAccepted || event.turnId !== runtimeTurnRef.turnId) {
                break;
              }
              provisionalText += event.detail.text;
              if (event.detail.text) {
                if (!firstDeltaObserved) {
                  firstDeltaObserved = true;
                  if (startedAt > 0) {
                    safeLogRuntimeAgentTiming({
                      stage: 'desktop.runtime_agent.started_to_first_delta_ms',
                      startedAt,
                      details: {
                        agentId: request.agentId,
                        conversationAnchorId: request.conversationAnchorId,
                        threadId: request.threadId,
                        requestId,
                        runtimeTurnId: runtimeTurnRef.turnId,
                        runtimeStreamId: runtimeTurnRef.streamId,
                        route,
                        modelId,
                        connectorId: connectorId || null,
                      },
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
              if (!currentTurnAccepted || event.turnId !== runtimeTurnRef.turnId) {
                break;
              }
              structuredEnvelope = toResolvedEnvelope(event.detail.payload);
              yield* maybeYieldCommittedMessage(trace);
              break;
            case 'runtime.agent.turn.message_committed':
              if (!currentTurnAccepted || event.turnId !== runtimeTurnRef.turnId) {
                break;
              }
              committedMessage = {
                messageId: event.detail.messageId,
                text: event.detail.text,
                runtimeTurnId: event.turnId,
                runtimeStreamId: event.streamId,
              };
              messageCommittedAt = nowMs();
              safeLogRuntimeAgentEvent({
                level: 'info',
                area: 'agent-chat-runtime',
                message: 'action:runtime-agent-turn:message-committed',
                details: {
                  agentId: request.agentId,
                  conversationAnchorId: request.conversationAnchorId,
                  threadId: request.threadId,
                  requestId,
                  runtimeTurnId: event.turnId,
                  runtimeStreamId: event.streamId,
                  messageId: event.detail.messageId,
                  textLength: event.detail.text.length,
                  route,
                  modelId,
                  connectorId: connectorId || null,
                },
              });
              yield* maybeYieldCommittedMessage(trace);
              break;
            case 'runtime.agent.turn.completed':
              if (!currentTurnAccepted || event.turnId !== runtimeTurnRef.turnId) {
                break;
              }
              terminalProjected = true;
              safeLogRuntimeAgentEvent({
                level: 'info',
                area: 'agent-chat-runtime',
                message: 'action:runtime-agent-turn:completed',
                details: {
                  agentId: request.agentId,
                  conversationAnchorId: request.conversationAnchorId,
                  threadId: request.threadId,
                  requestId,
                  runtimeTurnId: event.turnId,
                  runtimeStreamId: event.streamId,
                  terminalReason: normalizeText(event.detail.terminalReason) || null,
                  route,
                  modelId,
                  connectorId: connectorId || null,
                },
              });
              safeLogRuntimeAgentTiming({
                stage: 'desktop.runtime_agent.completed_to_ui_done_ms',
                startedAt: nowMs(),
                details: {
                  agentId: request.agentId,
                  conversationAnchorId: request.conversationAnchorId,
                  threadId: request.threadId,
                  requestId,
                  runtimeTurnId: event.turnId,
                  runtimeStreamId: event.streamId,
                  route,
                  modelId,
                  connectorId: connectorId || null,
                },
              });
              if (!messageSealedEmitted || !committedMessage) {
                yield {
                  type: 'turn-failed',
                  error: {
                    code: 'RUNTIME_AGENT_TURNS_INVALID',
                    message: 'runtime.agent.turn.completed arrived without committed structured message',
                  },
                  outputText: committedMessage?.text || provisionalText || undefined,
                  diagnostics: buildRuntimeAgentDiagnostics({
                    conversationAnchorId: request.conversationAnchorId,
                  runtimeTurnId: runtimeTurnRef.turnId || committedMessage?.runtimeTurnId || '',
                  runtimeStreamId: runtimeTurnRef.streamId || committedMessage?.runtimeStreamId || '',
                  route,
                  modelId,
                  connectorId,
                  trace,
                  extra: {
                    missingStructuredProjection: true,
                    ...timelineDiagnostics(),
                    ...projectionDiagnostics(),
                  },
                }),
              };
                return;
              }
              yield {
                type: 'turn-completed',
                outputText: committedMessage.text || provisionalText,
                finishReason: normalizeText(event.detail.terminalReason) || undefined,
                trace,
                diagnostics: buildRuntimeAgentDiagnostics({
                  conversationAnchorId: request.conversationAnchorId,
                  runtimeTurnId: committedMessage.runtimeTurnId,
                  runtimeStreamId: committedMessage.runtimeStreamId,
                  route,
                  modelId,
                  connectorId,
                  trace,
                  extra: {
                    ...timelineDiagnostics(),
                    ...projectionDiagnostics(),
                  },
                }),
              };
              return;
            case 'runtime.agent.turn.failed':
              if (!currentTurnAccepted || event.turnId !== runtimeTurnRef.turnId) {
                break;
              }
              terminalProjected = true;
              safeLogRuntimeAgentEvent({
                level: 'warn',
                area: 'agent-chat-runtime',
                message: 'action:runtime-agent-turn:failed',
                details: {
                  agentId: request.agentId,
                  conversationAnchorId: request.conversationAnchorId,
                  threadId: request.threadId,
                  requestId,
                  runtimeTurnId: event.turnId,
                  runtimeStreamId: event.streamId,
                  reasonCode: normalizeText(event.detail.reasonCode) || null,
                  failureMessage: normalizeText(event.detail.message) || null,
                  route,
                  modelId,
                  connectorId: connectorId || null,
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
                diagnostics: buildRuntimeAgentDiagnostics({
                  conversationAnchorId: request.conversationAnchorId,
                  runtimeTurnId: runtimeTurnRef.turnId || committedMessage?.runtimeTurnId || '',
                  runtimeStreamId: runtimeTurnRef.streamId || committedMessage?.runtimeStreamId || '',
                  route,
                  modelId,
                  connectorId,
                  trace,
                  extra: {
                    ...timelineDiagnostics(),
                    ...projectionDiagnostics(),
                  },
                }),
              };
              return;
            case 'runtime.agent.turn.interrupted':
              if (!currentTurnAccepted || event.turnId !== runtimeTurnRef.turnId) {
                break;
              }
              terminalProjected = true;
              yield {
                type: 'turn-canceled',
                scope: 'turn',
                outputText: committedMessage?.text || provisionalText || undefined,
                trace,
                diagnostics: buildRuntimeAgentDiagnostics({
                  conversationAnchorId: request.conversationAnchorId,
                  runtimeTurnId: runtimeTurnRef.turnId || committedMessage?.runtimeTurnId || '',
                  runtimeStreamId: runtimeTurnRef.streamId || committedMessage?.runtimeStreamId || '',
                  route,
                  modelId,
                  connectorId,
                  trace,
                  extra: {
                    reason: normalizeText(event.detail.reason) || 'interrupt_requested',
                    ...timelineDiagnostics(),
                    ...projectionDiagnostics(),
                  },
                }),
              };
              return;
            default:
              break;
          }
        }
      } finally {
        snapshotRecoveryController.abort();
        cleanupSubscription();
      }
      throw new Error('runtime.agent turn stream ended without a terminal event');
    })(),
  };
}
