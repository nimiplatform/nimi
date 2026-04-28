import type {
  ConversationRuntimeTrace,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import type { JsonObject } from '@renderer/bridge/runtime-bridge/shared';
import {
  AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
  type AgentResolvedMessageActionEnvelope,
  type AgentResolvedModalityAction,
  type AgentResolvedStatusCue,
} from './chat-agent-behavior';
import { normalizeText } from './chat-agent-orchestration-shared';
import type {
  RuntimeAgentTimelineSummary,
} from './chat-agent-runtime-agent-timeline';

export type PendingCommittedMessage = {
  messageId: string;
  text: string;
  runtimeTurnId: string;
  runtimeStreamId: string;
};

export function safeLogRuntimeAgentEvent(input: Parameters<typeof logRendererEvent>[0]): void {
  if (typeof window === 'undefined') {
    return;
  }
  logRendererEvent(input);
}

export function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(nowMs() - startedAt));
}

export function safeLogRuntimeAgentTiming(input: {
  stage: string;
  startedAt: number;
  details?: Record<string, unknown>;
}): void {
  safeLogRuntimeAgentEvent({
    level: 'info',
    area: 'agent-chat-runtime-latency',
    message: `phase:${input.stage}`,
    costMs: elapsedMs(input.startedAt),
    details: {
      stage: input.stage,
      ...(input.details || {}),
    },
  });
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

export function toResolvedEnvelope(value: unknown): AgentResolvedMessageActionEnvelope {
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

export function cloneEnvelopeWithCommittedMessage(input: {
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

export function toDebugMetadata(input: {
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
  latestTimeline?: RuntimeAgentTimelineSummary | null;
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
      presentationTimeline: input.latestTimeline || null,
    },
  } satisfies JsonObject;
}

export function buildRuntimeAgentDiagnostics(input: {
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

export function resolveRuntimeTrace(): ConversationRuntimeTrace | undefined {
  return undefined;
}
