import { getPlatformClient } from '@nimiplatform/sdk';
import { asNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type {
  ConversationRuntimeTrace,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import type { JsonObject } from '@renderer/bridge/runtime-bridge/shared';
import { randomIdV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import {
  ensureRuntimeLocalModelWarm,
  resolveSourceAndModel,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge';
import {
  AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
  type AgentResolvedMessageActionEnvelope,
  type AgentResolvedModalityAction,
  type AgentResolvedStatusCue,
} from './chat-agent-behavior';
import type {
  AgentLocalChatRuntimeRequest,
  AgentLocalChatTurnStreamPart,
} from './chat-agent-orchestration-types';
import { normalizeText } from './chat-agent-orchestration-shared';
import { resolveRouteInput } from './chat-agent-runtime-text';
import {
  resolveChatThinkingConfig,
  resolveTextExecutionSnapshotThinkingSupport,
} from './chat-shared-thinking';

type PendingCommittedMessage = {
  messageId: string;
  text: string;
  runtimeTurnId: string;
  runtimeStreamId: string;
};

function safeLogRuntimeAgentEvent(input: Parameters<typeof logRendererEvent>[0]): void {
  if (typeof window === 'undefined') {
    return;
  }
  logRendererEvent(input);
}

function toResolvedStatusCue(value: unknown): AgentResolvedStatusCue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const sourceMessageId = normalizeText(record.source_message_id);
  if (!sourceMessageId) {
    return null;
  }
  const mood = normalizeText(record.mood) as AgentResolvedStatusCue['mood'] | '';
  const label = normalizeText(record.label);
  const actionCue = normalizeText(record.action_cue);
  const intensity = Number(record.intensity);
  return {
    sourceMessageId,
    ...(mood ? { mood } : {}),
    ...(label ? { label } : {}),
    ...(Number.isFinite(intensity) ? { intensity } : {}),
    ...(actionCue ? { actionCue } : {}),
  };
}

function toResolvedAction(value: unknown, index: number, actionCount: number): AgentResolvedModalityAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`runtime.agent structured action[${index}] is invalid`);
  }
  const record = value as Record<string, unknown>;
  const promptPayloadRecord = value && typeof record.prompt_payload === 'object' && !Array.isArray(record.prompt_payload)
    ? record.prompt_payload as Record<string, unknown>
    : {};
  const modality = normalizeText(record.modality);
  if (modality !== 'image' && modality !== 'voice') {
    throw new Error(`runtime.agent structured action[${index}].modality is invalid`);
  }
  const promptText = normalizeText(promptPayloadRecord.prompt_text);
  return {
    actionId: normalizeText(record.action_id) || `runtime-agent-action-${index}`,
    actionIndex: Number.isFinite(Number(record.action_index)) ? Number(record.action_index) : index,
    actionCount: Number.isFinite(Number(record.action_count)) ? Number(record.action_count) : actionCount,
    modality,
    operation: normalizeText(record.operation),
    promptPayload: modality === 'image'
        ? {
          kind: 'image-prompt',
          promptText,
        }
        : {
          kind: 'voice-prompt',
          promptText,
        },
    sourceMessageId: normalizeText(record.source_message_id),
    deliveryCoupling: normalizeText(record.delivery_coupling) === 'with-message'
      ? 'with-message'
      : 'after-message',
  };
}

function toResolvedEnvelope(value: unknown): AgentResolvedMessageActionEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('runtime.agent structured payload is invalid');
  }
  const record = value as Record<string, unknown>;
  const message = value && typeof record.message === 'object' && !Array.isArray(record.message)
    ? record.message as Record<string, unknown>
    : {};
  const actions = Array.isArray(record.actions) ? record.actions : [];
  return {
    schemaId: AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
    message: {
      messageId: normalizeText(message.message_id),
      text: normalizeText(message.text),
    },
    statusCue: toResolvedStatusCue(record.status_cue),
    actions: actions.map((action, index) => toResolvedAction(action, index, actions.length)),
  };
}

function cloneEnvelopeWithCommittedMessage(input: {
  envelope: AgentResolvedMessageActionEnvelope;
  messageId: string;
  text: string;
}): AgentResolvedMessageActionEnvelope {
  return {
    ...input.envelope,
    message: {
      messageId: input.messageId,
      text: input.text,
    },
  };
}

function toDebugMetadata(input: {
  prompt: string;
  systemPrompt: string | null;
  conversationAnchorId: string;
  runtimeTurnId: string;
  runtimeStreamId: string;
  route: string;
  modelId: string;
  connectorId?: string;
  trace?: ConversationRuntimeTrace;
  envelope: AgentResolvedMessageActionEnvelope;
}): JsonObject {
  return {
    debugType: 'agent-text-turn',
    prompt: input.prompt,
    systemPrompt: input.systemPrompt,
    rawModelOutput: null,
    normalizedModelOutput: null,
    statusCue: input.envelope.statusCue || null,
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
      conversationAnchorId: input.conversationAnchorId,
      runtimeTurnId: input.runtimeTurnId,
      runtimeStreamId: input.runtimeStreamId,
      route: input.route,
      modelId: input.modelId,
      connectorId: input.connectorId || null,
      traceId: input.trace?.traceId || null,
      modelResolved: input.trace?.modelResolved || null,
      routeDecision: input.trace?.routeDecision || null,
    },
  } satisfies JsonObject;
}

function buildRuntimeAgentDiagnostics(input: {
  conversationAnchorId: string;
  runtimeTurnId: string;
  runtimeStreamId: string;
  route: string;
  modelId: string;
  connectorId?: string;
  trace?: ConversationRuntimeTrace;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
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
    ...(input.extra || {}),
  };
}

function resolveRuntimeTrace(): ConversationRuntimeTrace | undefined {
  return undefined;
}

export async function streamChatAgentRuntimeAgentTurn(
  request: AgentLocalChatRuntimeRequest,
): Promise<{ stream: AsyncIterable<AgentLocalChatTurnStreamPart> }> {
  const runtime = getPlatformClient().runtime;
  const requestId = randomIdV11('runtime-agent-turn-request');
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
  await ensureRuntimeLocalModelWarm({
    modId: routeInput.modId,
    source: resolved.source,
    modelId: resolved.modelId,
    engine: resolved.provider,
    endpoint: resolved.endpoint,
    timeoutMs: 120_000,
  });
  safeLogRuntimeAgentEvent({
    level: 'info',
    area: 'agent-chat-runtime',
    message: 'action:runtime-agent-turn:local-warm-complete',
    details: {
      agentId: request.agentId,
      conversationAnchorId: request.conversationAnchorId,
      threadId: request.threadId,
      requestId,
      route: resolved.source,
      modelId: resolved.modelId,
    },
  });
  const route = resolved.source;
  const modelId = normalizeText(resolved.modelId);
  const connectorId = normalizeText(routeInput.connectorId) || undefined;
  const subscribed = await runtime.agent.turns.subscribe({
    agentId: request.agentId,
    conversationAnchorId: request.conversationAnchorId,
    includeAgentEvents: false,
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
      const iterator = subscribed[Symbol.asyncIterator]();

      const maybeYieldCommittedMessage = function* (
        trace?: ConversationRuntimeTrace,
      ): Generator<AgentLocalChatTurnStreamPart> {
        if (messageSealedEmitted || !structuredEnvelope || !committedMessage) {
          return;
        }
        messageSealedEmitted = true;
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
          }),
          diagnostics: buildRuntimeAgentDiagnostics({
            conversationAnchorId: request.conversationAnchorId,
            runtimeTurnId: committedMessage.runtimeTurnId,
            runtimeStreamId: committedMessage.runtimeStreamId,
            route,
            modelId,
            connectorId,
            trace,
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
          const trace = resolveRuntimeTrace();
          switch (event.eventName) {
            case 'runtime.agent.turn.accepted':
              if (!acceptedRequestIds.has(event.detail.requestId)) {
                break;
              }
              currentTurnAccepted = true;
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
