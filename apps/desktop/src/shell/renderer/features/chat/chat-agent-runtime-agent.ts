import { getPlatformClient } from '@nimiplatform/sdk';
import { asNimiError } from '@nimiplatform/sdk/runtime';
import type { RuntimeAgentConsumeEvent } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type {
  ConversationRuntimeTrace,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import { randomIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import {
  resolveSourceAndModel,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import {
  type AgentResolvedMessageActionEnvelope,
} from './chat-agent-behavior';
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
import { resolveRouteInput } from './chat-agent-runtime-text';
import {
  resolveChatThinkingConfig,
  resolveTextExecutionSnapshotThinkingSupport,
} from './chat-shared-thinking';
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

export async function streamChatAgentRuntimeAgentTurn(
  request: AgentLocalChatRuntimeRequest,
): Promise<{ stream: AsyncIterable<AgentLocalChatTurnStreamPart> }> {
  const runtime = getPlatformClient().runtime;
  const requestId = randomIdV11('runtime-agent-turn-request');
  const routeResolveStartedAt = nowMs();
  safeLogRuntimeAgentEvent({
    level: 'info',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:start',
    details: {
      agentId: request.agentId,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
    },
  });
  const routeInput = await resolveRouteInput({
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
  const resolved = resolveSourceAndModel(routeInput);
  safeLogRuntimeAgentTiming({
    stage: 'desktop.runtime_agent.route_resolve_ms',
    startedAt: routeResolveStartedAt,
    details: {
      agentId: request.agentId,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
      route: resolved.source,
      modelId: resolved.modelId,
      provider: resolved.provider,
      connectorId: normalizeText(routeInput.connectorId) || null,
    },
  });
  safeLogRuntimeAgentEvent({
    level: 'info',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:route-resolved',
    details: {
      agentId: request.agentId,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
      route: resolved.source,
      modelId: resolved.modelId,
      provider: resolved.provider,
      connectorId: normalizeText(routeInput.connectorId) || null,
    },
  });
  safeLogRuntimeAgentEvent({
    level: 'info',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:local-warm-skipped',
    details: {
      agentId: request.agentId,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
      route: resolved.source,
      modelId: resolved.modelId,
      reason: 'runtime_local_model_lease_authoritative',
    },
  });
  const route = resolved.source;
  const modelId = normalizeText(resolved.modelId);
  const connectorId = normalizeText(routeInput.connectorId) || undefined;
  const subscribeStartedAt = nowMs();
  const subscribed = await runtime.agent.turns.subscribe({
    agentId: request.agentId,
    conversationAnchorId: request.conversationAnchorId,
    includeAgentEvents: false,
  });
  safeLogRuntimeAgentTiming({
    stage: 'desktop.runtime_agent.subscribe_ms',
    startedAt: subscribeStartedAt,
    details: {
      agentId: request.agentId,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
    },
  });
  safeLogRuntimeAgentEvent({
    level: 'info',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:subscribed',
    details: {
      agentId: request.agentId,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
    },
  });

  let requestSubmitted = false;
  let interruptRequested = false;
  let currentRuntimeTurnId = '';
  let currentRuntimeStreamId = '';
  const acceptedRequestIds = new Set<string>([requestId]);

  const requestInterrupt = () => {
    if (interruptRequested || !requestSubmitted) {
      return;
    }
    interruptRequested = true;
    void runtime.agent.turns.interrupt({
      agentId: request.agentId,
      conversationAnchorId: request.conversationAnchorId,
      ...(normalizeText(currentRuntimeTurnId) ? { turnId: currentRuntimeTurnId } : {}),
      reason: 'desktop_agent_chat_abort',
    }).catch(() => undefined);
  };

  request.signal?.addEventListener('abort', requestInterrupt, { once: true });

  const requestPayloadBase = {
    agentId: request.agentId,
    conversationAnchorId: request.conversationAnchorId,
    threadId: request.threadId,
    systemPrompt: normalizeText(request.systemPrompt) || undefined,
    maxOutputTokens: Number.isFinite(Number(request.maxOutputTokensRequested))
      && Number(request.maxOutputTokensRequested) > 0
      ? Math.floor(Number(request.maxOutputTokensRequested))
      : undefined,
    messages: Array.isArray(request.messages)
      ? request.messages.map((message) => ({
        role: message.role,
        content: typeof message.content === 'string'
          ? message.content
          : typeof message.text === 'string'
            ? message.text
            : '',
        ...(normalizeText(message.name) ? { name: normalizeText(message.name) } : {}),
      }))
      : [],
    executionBinding: {
      route,
      modelId,
      ...(connectorId ? { connectorId } : {}),
    },
    reasoning: (() => {
      const resolved = resolveChatThinkingConfig(
        request.reasoningPreference,
        resolveTextExecutionSnapshotThinkingSupport(
          request.textExecutionSnapshot?.conversationCapabilitySlice as Parameters<typeof resolveTextExecutionSnapshotThinkingSupport>[0],
        ),
      );
      if (!resolved) {
        return undefined;
      }
      return {
        ...(normalizeText(resolved.mode) ? { mode: normalizeText(resolved.mode) as typeof resolved.mode } : {}),
        ...(normalizeText(resolved.traceMode) ? { traceMode: normalizeText(resolved.traceMode) as typeof resolved.traceMode } : {}),
        ...(Number.isFinite(Number(resolved.budgetTokens))
          ? { budgetTokens: Math.floor(Number(resolved.budgetTokens)) }
          : {}),
      };
    })(),
  };

  let requestResponse: { messageId?: string } | void;
  const requestStartedAt = nowMs();
  try {
    requestResponse = await runtime.agent.turns.request({
      ...requestPayloadBase,
      requestId,
    });
  } catch (error) {
    const normalized = asNimiError(error, { source: 'runtime' });
    if (normalized.reasonCode !== ReasonCode.PROTOCOL_ENVELOPE_INVALID) {
      throw error;
    }
    requestResponse = await runtime.agent.turns.request(requestPayloadBase);
  }
  const requestMessageId = normalizeText(requestResponse && typeof requestResponse === 'object' ? requestResponse.messageId : '');
  if (requestMessageId) {
    acceptedRequestIds.add(requestMessageId);
  }
  requestSubmitted = true;
  safeLogRuntimeAgentTiming({
    stage: 'desktop.runtime_agent.request_ack_ms',
    startedAt: requestStartedAt,
    details: {
      agentId: request.agentId,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
      requestMessageId,
      route,
      modelId,
      connectorId: connectorId || null,
    },
  });
  safeLogRuntimeAgentEvent({
    level: 'info',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:request-acked',
    details: {
      agentId: request.agentId,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
      requestMessageId,
      route,
      modelId,
      connectorId: connectorId || null,
    },
  });

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
      const runtimeProjectionEvents: RuntimeAgentProjectionSummary[] = [];
      const runtimeTurnTimelines: RuntimeAgentTimelineSummary[] = [];
      const iterator = subscribed[Symbol.asyncIterator]();

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
          const nextResult = await iterator.next();
          if (nextResult.done) {
            break;
          }
          const event = nextResult.value;
          recordTurnTimeline(event);
          const trace = resolveRuntimeTrace();
          switch (event.eventName) {
            case 'runtime.agent.turn.accepted':
              if (!acceptedRequestIds.has(event.detail.requestId)) {
                break;
              }
              currentTurnAccepted = true;
              acceptedAt = nowMs();
              currentRuntimeTurnId = event.turnId;
              currentRuntimeStreamId = event.streamId;
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
                  runtimeTurnId: currentRuntimeTurnId,
                  runtimeStreamId: currentRuntimeStreamId,
                  route,
                  modelId,
                  connectorId: connectorId || null,
                },
              });
              break;
            case 'runtime.agent.turn.started':
            case 'runtime.agent.turn.post_turn':
            case 'runtime.agent.turn.interrupt_ack':
              if (!currentTurnAccepted || event.turnId !== currentRuntimeTurnId) {
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
                      runtimeTurnId: currentRuntimeTurnId,
                      runtimeStreamId: currentRuntimeStreamId,
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
                    runtimeTurnId: currentRuntimeTurnId,
                    runtimeStreamId: currentRuntimeStreamId,
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
                  currentRuntimeTurnId,
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
                  runtimeTurnId: currentRuntimeTurnId || null,
                  runtimeStreamId: currentRuntimeStreamId || null,
                  route,
                  modelId,
                  connectorId: connectorId || null,
                },
              });
              break;
            case 'runtime.agent.turn.reasoning_delta':
              if (!currentTurnAccepted || event.turnId !== currentRuntimeTurnId) {
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
              if (!currentTurnAccepted || event.turnId !== currentRuntimeTurnId) {
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
                        runtimeTurnId: currentRuntimeTurnId,
                        runtimeStreamId: currentRuntimeStreamId,
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
              if (!currentTurnAccepted || event.turnId !== currentRuntimeTurnId) {
                break;
              }
              structuredEnvelope = toResolvedEnvelope(event.detail.payload);
              yield* maybeYieldCommittedMessage(trace);
              break;
            case 'runtime.agent.turn.message_committed':
              if (!currentTurnAccepted || event.turnId !== currentRuntimeTurnId) {
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
              if (!currentTurnAccepted || event.turnId !== currentRuntimeTurnId) {
                break;
              }
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
                  runtimeTurnId: currentRuntimeTurnId || committedMessage?.runtimeTurnId || '',
                  runtimeStreamId: currentRuntimeStreamId || committedMessage?.runtimeStreamId || '',
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
              if (!currentTurnAccepted || event.turnId !== currentRuntimeTurnId) {
                break;
              }
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
                  runtimeTurnId: currentRuntimeTurnId || committedMessage?.runtimeTurnId || '',
                  runtimeStreamId: currentRuntimeStreamId || committedMessage?.runtimeStreamId || '',
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
              if (!currentTurnAccepted || event.turnId !== currentRuntimeTurnId) {
                break;
              }
              yield {
                type: 'turn-canceled',
                scope: 'turn',
                outputText: committedMessage?.text || provisionalText || undefined,
                trace,
                diagnostics: buildRuntimeAgentDiagnostics({
                  conversationAnchorId: request.conversationAnchorId,
                  runtimeTurnId: currentRuntimeTurnId || committedMessage?.runtimeTurnId || '',
                  runtimeStreamId: currentRuntimeStreamId || committedMessage?.runtimeStreamId || '',
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
        request.signal?.removeEventListener('abort', requestInterrupt);
        await iterator.return?.();
      }
      throw new Error('runtime.agent turn stream ended without a terminal event');
    })(),
  };
}
