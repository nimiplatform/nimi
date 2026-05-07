import type {
  ConversationRuntimeTrace,
} from '@nimiplatform/nimi-kit/features/chat/headless';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import type { JsonObject } from '@renderer/bridge/runtime-bridge/shared';
import {
  AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
  type AgentResolvedMessageActionEnvelope,
} from './chat-agent-behavior';
import { parseAgentResolvedMessageActionEnvelopeFromPayload } from './chat-agent-behavior-resolver-envelope';
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

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireTextField(record: Record<string, unknown>, field: string, label: string): string {
  const value = normalizeText(record[field]);
  if (!value) {
    throw new Error(`${label}.${field} is required`);
  }
  return value;
}

function canonicalizeStatusCue(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  const record = requireRecord(value, 'runtime.agent structured status_cue');
  const statusCue: Record<string, unknown> = {
    sourceMessageId: requireTextField(record, 'source_message_id', 'runtime.agent structured status_cue'),
  };
  if (Object.prototype.hasOwnProperty.call(record, 'mood')) {
    statusCue.mood = record.mood;
  }
  if (Object.prototype.hasOwnProperty.call(record, 'label')) {
    statusCue.label = record.label;
  }
  if (Object.prototype.hasOwnProperty.call(record, 'intensity')) {
    statusCue.intensity = record.intensity;
  }
  if (Object.prototype.hasOwnProperty.call(record, 'action_cue')) {
    statusCue.actionCue = record.action_cue;
  }
  return statusCue;
}

function canonicalizeAction(value: unknown, index: number): Record<string, unknown> {
  const record = requireRecord(value, `runtime.agent structured actions[${index}]`);
  const modality = requireTextField(record, 'modality', `runtime.agent structured actions[${index}]`);
  const promptPayload = requireRecord(record.prompt_payload, `runtime.agent structured actions[${index}].prompt_payload`);
  return {
    actionId: requireTextField(record, 'action_id', `runtime.agent structured actions[${index}]`),
    actionIndex: record.action_index,
    actionCount: record.action_count,
    modality,
    operation: requireTextField(record, 'operation', `runtime.agent structured actions[${index}]`),
    promptPayload: {
      kind: modality === 'image' ? 'image-prompt' : modality === 'voice' ? 'voice-prompt' : '',
      promptText: requireTextField(promptPayload, 'prompt_text', `runtime.agent structured actions[${index}].prompt_payload`),
    },
    sourceMessageId: requireTextField(record, 'source_message_id', `runtime.agent structured actions[${index}]`),
    deliveryCoupling: requireTextField(record, 'delivery_coupling', `runtime.agent structured actions[${index}]`),
  };
}

function toCanonicalResolvedPayload(value: unknown): Record<string, unknown> {
  const record = requireRecord(value, 'runtime.agent structured payload');
  const message = requireRecord(record.message, 'runtime.agent structured message');
  const actions = Array.isArray(record.actions) ? record.actions : null;
  if (!actions) {
    throw new Error('runtime.agent structured actions must be an array');
  }
  const schemaId = normalizeText(record.schemaId) || normalizeText(record.schema_id) || AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID;
  if (schemaId !== AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID) {
    throw new Error(`runtime.agent structured schemaId must equal ${AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID}`);
  }
  return {
    schemaId,
    message: {
      messageId: requireTextField(message, 'message_id', 'runtime.agent structured message'),
      text: requireTextField(message, 'text', 'runtime.agent structured message'),
    },
    ...(record.status_cue == null ? {} : { statusCue: canonicalizeStatusCue(record.status_cue) }),
    actions: actions.map((action, index) => canonicalizeAction(action, index)),
  };
}

export function toResolvedEnvelope(value: unknown): AgentResolvedMessageActionEnvelope {
  return parseAgentResolvedMessageActionEnvelopeFromPayload(toCanonicalResolvedPayload(value));
}

export function cloneEnvelopeWithCommittedMessage(input: {
  envelope: AgentResolvedMessageActionEnvelope;
  messageId: string;
  text: string;
}): AgentResolvedMessageActionEnvelope {
  const next = {
    ...input.envelope,
    message: {
      messageId: input.messageId,
      text: input.text,
    },
    ...(input.envelope.statusCue
      ? { statusCue: { ...input.envelope.statusCue, sourceMessageId: input.messageId } }
      : {}),
    actions: input.envelope.actions.map((action) => ({
      ...action,
      sourceMessageId: input.messageId,
    })),
  };
  return parseAgentResolvedMessageActionEnvelopeFromPayload(next);
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
