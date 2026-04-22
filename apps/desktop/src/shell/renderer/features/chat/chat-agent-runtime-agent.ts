import { getPlatformClient } from '@nimiplatform/sdk';
import type {
  ConversationRuntimeTrace,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import type { JsonObject } from '@renderer/bridge/runtime-bridge/shared';
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
} from './chat-thinking';

type PendingCommittedMessage = {
  messageId: string;
  text: string;
  runtimeTurnId: string;
  runtimeStreamId: string;
};

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
  const modality = normalizeText(record.modality) as AgentResolvedModalityAction['modality'];
  const promptText = normalizeText(promptPayloadRecord.prompt_text);
  const delayMs = Number(promptPayloadRecord.delay_ms);
  return {
    actionId: normalizeText(record.action_id) || `runtime-agent-action-${index}`,
    actionIndex: Number.isFinite(Number(record.action_index)) ? Number(record.action_index) : index,
    actionCount: Number.isFinite(Number(record.action_count)) ? Number(record.action_count) : actionCount,
    modality,
    operation: normalizeText(record.operation),
    promptPayload: modality === 'follow-up-turn'
      ? {
        kind: 'follow-up-turn',
        promptText,
        delayMs: Number.isFinite(delayMs) ? delayMs : 0,
      }
      : modality === 'image'
        ? {
          kind: 'image-prompt',
          promptText,
        }
        : modality === 'voice'
          ? {
            kind: 'voice-prompt',
            promptText,
          }
          : {
            kind: 'video-prompt',
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
  const route = normalizeText(routeInput.connectorId) ? 'cloud' : 'local';
  const modelId = normalizeText(routeInput.localProviderModel);
  const connectorId = normalizeText(routeInput.connectorId) || undefined;
  const subscribed = await runtime.agent.turns.subscribe({
    agentId: request.agentId,
    conversationAnchorId: request.conversationAnchorId,
  });

  let requestSubmitted = false;
  let interruptRequested = false;
  let currentRuntimeTurnId = '';
  let currentRuntimeStreamId = '';

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

  await runtime.agent.turns.request({
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
  });
  requestSubmitted = true;

  return {
    stream: (async function* stream(): AsyncIterable<AgentLocalChatTurnStreamPart> {
      let structuredEnvelope: AgentResolvedMessageActionEnvelope | null = null;
      let provisionalText = '';
      let committedMessage: PendingCommittedMessage | null = null;
      let messageSealedEmitted = false;

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
        for await (const event of subscribed) {
          if ('turnId' in event && typeof event.turnId === 'string' && normalizeText(event.turnId)) {
            if (!currentRuntimeTurnId) {
              currentRuntimeTurnId = event.turnId;
            } else if (currentRuntimeTurnId !== event.turnId) {
              continue;
            }
          }
          if ('streamId' in event && typeof event.streamId === 'string' && normalizeText(event.streamId)) {
            if (!currentRuntimeStreamId) {
              currentRuntimeStreamId = event.streamId;
            }
          }
          const trace = resolveRuntimeTrace();
          switch (event.eventName) {
            case 'runtime.agent.turn.accepted':
            case 'runtime.agent.turn.started':
            case 'runtime.agent.turn.post_turn':
            case 'runtime.agent.turn.interrupt_ack':
              break;
            case 'runtime.agent.turn.reasoning_delta':
              if (event.detail.text) {
                yield {
                  type: 'reasoning-delta',
                  textDelta: event.detail.text,
                };
              }
              break;
            case 'runtime.agent.turn.text_delta':
              provisionalText += event.detail.text;
              if (event.detail.text) {
                yield {
                  type: 'text-delta',
                  textDelta: event.detail.text,
                };
              }
              break;
            case 'runtime.agent.turn.structured':
              structuredEnvelope = toResolvedEnvelope(event.detail.payload);
              yield* maybeYieldCommittedMessage(trace);
              break;
            case 'runtime.agent.turn.message_committed':
              committedMessage = {
                messageId: event.detail.messageId,
                text: event.detail.text,
                runtimeTurnId: event.turnId,
                runtimeStreamId: event.streamId,
              };
              yield* maybeYieldCommittedMessage(trace);
              break;
            case 'runtime.agent.turn.completed':
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
      }
      throw new Error('runtime.agent turn stream ended without a terminal event');
    })(),
  };
}
