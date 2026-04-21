import { getPlatformClient } from '@nimiplatform/sdk';
import type {
  ConversationTurnHistoryMessage,
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

type RuntimeAgentSessionHint = {
  sessionId: string;
  route: string;
  modelId: string;
  connectorId: string | null;
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

function toDebugMetadata(input: {
  prompt: string;
  systemPrompt: string | null;
  sessionId: string;
  runtimeTurnId: string;
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
    runtimeAgentChat: {
      transport: 'runtime.agent',
      sessionId: input.sessionId,
      runtimeTurnId: input.runtimeTurnId,
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
  sessionId: string;
  runtimeTurnId: string;
  route: string;
  modelId: string;
  connectorId?: string;
  trace?: ConversationRuntimeTrace;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    transport: 'runtime.agent',
    sessionId: input.sessionId,
    runtimeTurnId: input.runtimeTurnId,
    route: input.route,
    modelId: input.modelId,
    connectorId: input.connectorId || null,
    traceId: input.trace?.traceId || null,
    modelResolved: input.trace?.modelResolved || null,
    routeDecision: input.trace?.routeDecision || null,
    ...(input.extra || {}),
  };
}

function parseRuntimeAgentSessionHint(value: unknown): RuntimeAgentSessionHint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (normalizeText(record.transport) !== 'runtime.agent') {
    return null;
  }
  const sessionId = normalizeText(record.sessionId);
  const route = normalizeText(record.route);
  const modelId = normalizeText(record.modelId);
  if (!sessionId || !route || !modelId) {
    return null;
  }
  return {
    sessionId,
    route,
    modelId,
    connectorId: normalizeText(record.connectorId) || null,
  };
}

function resolveKnownRuntimeAgentSessionId(input: {
  history?: readonly ConversationTurnHistoryMessage[];
  route: string;
  modelId: string;
  connectorId?: string;
}): string | null {
  const history = Array.isArray(input.history) ? input.history : [];
  const connectorId = normalizeText(input.connectorId) || null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const hint = parseRuntimeAgentSessionHint(
      (history[index]?.metadata as Record<string, unknown> | undefined)?.runtimeAgentChat,
    );
    if (!hint) {
      continue;
    }
    if (hint.route !== input.route || hint.modelId !== input.modelId) {
      continue;
    }
    if ((hint.connectorId || null) !== connectorId) {
      continue;
    }
    return hint.sessionId;
  }
  return null;
}

function buildSessionId(input: {
  agentId: string;
  threadId: string;
  route: string;
  modelId: string;
  connectorId?: string;
}): string {
  const parts = [
    'desktop-agent-chat',
    input.agentId,
    input.threadId,
    input.route,
    input.connectorId || 'local',
    input.modelId,
  ].map((part) => normalizeText(part).replace(/[^a-zA-Z0-9._-]+/g, '_')).filter(Boolean);
  return parts.join('__').slice(0, 240);
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
  const sessionId = resolveKnownRuntimeAgentSessionId({
    history: request.history,
    route,
    modelId,
    connectorId,
  }) || buildSessionId({
    agentId: request.agentId,
    threadId: request.threadId,
    route,
    modelId,
    connectorId,
  });
  const streamHandle = await runtime.agent.chat.streamTurn({
    agentId: request.agentId,
    sessionId,
    threadId: request.threadId,
    systemPrompt: normalizeText(request.systemPrompt) || undefined,
    maxOutputTokens: Number.isFinite(Number(request.maxOutputTokensRequested))
      && Number(request.maxOutputTokensRequested) > 0
      ? Math.floor(Number(request.maxOutputTokensRequested))
      : undefined,
    messages: Array.isArray(request.messages)
      ? request.messages.map((message) => ({
        role: message.role,
        content: normalizeText(message.content ?? message.text),
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
  }, {
    signal: request.signal,
  });

  return {
    stream: (async function* stream(): AsyncIterable<AgentLocalChatTurnStreamPart> {
      let messageSealedEmitted = false;
      for await (const event of streamHandle) {
        switch (event.type) {
          case 'accepted':
          case 'started':
          case 'text_delta':
          case 'post_turn':
          case 'interrupt_ack':
            break;
          case 'reasoning_delta':
            if (normalizeText(event.textDelta)) {
              yield {
                type: 'reasoning-delta',
                textDelta: normalizeText(event.textDelta),
              };
            }
            break;
          case 'structured': {
            const trace = event.trace
              ? {
                ...(event.trace.traceId ? { traceId: event.trace.traceId, promptTraceId: event.trace.traceId } : {}),
                ...(event.trace.modelResolved ? { modelResolved: event.trace.modelResolved } : {}),
                ...(event.trace.routeDecision ? { routeDecision: event.trace.routeDecision } : {}),
              } satisfies ConversationRuntimeTrace
              : undefined;
            const envelope = toResolvedEnvelope(event.structured);
            messageSealedEmitted = true;
            yield {
              type: 'message-sealed',
              envelope,
              trace,
              metadataJson: toDebugMetadata({
                prompt: normalizeText(request.prompt),
                systemPrompt: normalizeText(request.systemPrompt) || null,
                sessionId: event.sessionId || sessionId,
                runtimeTurnId: event.turnId,
                route,
                modelId,
                connectorId,
                trace,
                envelope,
              }),
              diagnostics: {
                transport: 'runtime.agent',
                sessionId: event.sessionId || sessionId,
                runtimeTurnId: event.turnId,
              },
            };
            break;
          }
          case 'completed': {
            const trace = event.trace
              ? {
                ...(event.trace.traceId ? { traceId: event.trace.traceId, promptTraceId: event.trace.traceId } : {}),
                ...(event.trace.modelResolved ? { modelResolved: event.trace.modelResolved } : {}),
                ...(event.trace.routeDecision ? { routeDecision: event.trace.routeDecision } : {}),
              } satisfies ConversationRuntimeTrace
              : undefined;
            const outputText = normalizeText(event.text);
            if (!messageSealedEmitted) {
              yield {
                type: 'turn-failed',
                error: {
                  code: 'RUNTIME_AGENT_CHAT_INVALID',
                  message: 'runtime.agent completed without structured projection',
                },
                outputText: outputText || undefined,
                finishReason: normalizeText(event.finishReason) || undefined,
                usage: event.usage,
                trace,
                diagnostics: buildRuntimeAgentDiagnostics({
                  sessionId: event.sessionId || sessionId,
                  runtimeTurnId: event.turnId,
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
              outputText,
              finishReason: normalizeText(event.finishReason) || undefined,
              usage: event.usage,
              trace,
              diagnostics: buildRuntimeAgentDiagnostics({
                sessionId: event.sessionId || sessionId,
                runtimeTurnId: event.turnId,
                route,
                modelId,
                connectorId,
                trace,
              }),
            };
            return;
          }
          case 'failed': {
            const trace = event.trace
              ? {
                ...(event.trace.traceId ? { traceId: event.trace.traceId, promptTraceId: event.trace.traceId } : {}),
                ...(event.trace.modelResolved ? { modelResolved: event.trace.modelResolved } : {}),
                ...(event.trace.routeDecision ? { routeDecision: event.trace.routeDecision } : {}),
              } satisfies ConversationRuntimeTrace
              : undefined;
            yield {
              type: 'turn-failed',
              error: {
                code: normalizeText(event.reasonCode) || 'RUNTIME_AGENT_CHAT_FAILED',
                message: normalizeText(event.message) || 'runtime.agent turn failed',
              },
              outputText: normalizeText(event.text) || undefined,
              finishReason: normalizeText(event.finishReason) || undefined,
              usage: event.usage,
              trace,
              diagnostics: buildRuntimeAgentDiagnostics({
                sessionId: event.sessionId || sessionId,
                runtimeTurnId: event.turnId,
                route,
                modelId,
                connectorId,
                trace,
                extra: {
                  actionHint: normalizeText(event.actionHint) || undefined,
                },
              }),
            };
            return;
          }
          case 'interrupted': {
            const trace = event.trace
              ? {
                ...(event.trace.traceId ? { traceId: event.trace.traceId, promptTraceId: event.trace.traceId } : {}),
                ...(event.trace.modelResolved ? { modelResolved: event.trace.modelResolved } : {}),
                ...(event.trace.routeDecision ? { routeDecision: event.trace.routeDecision } : {}),
              } satisfies ConversationRuntimeTrace
              : undefined;
            yield {
              type: 'turn-canceled',
              scope: 'turn',
              outputText: normalizeText(event.text) || undefined,
              trace,
              diagnostics: buildRuntimeAgentDiagnostics({
                sessionId: event.sessionId || sessionId,
                runtimeTurnId: event.turnId,
                route,
                modelId,
                connectorId,
                trace,
                extra: {
                  reason: 'interrupt_requested',
                },
              }),
            };
            return;
          }
          default:
            break;
        }
      }
      throw new Error('runtime.agent turn stream ended without a terminal event');
    })(),
  };
}
