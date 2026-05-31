import type {
  ConversationRuntimeTrace,
} from '@nimiplatform/kit/features/chat/headless';
import {
  cloneAgentResolvedMessageActionEnvelopeWithCommittedMessage,
  parseRuntimeAgentStructuredMessageActionEnvelope,
  type AgentResolvedMessageActionEnvelope,
  type RuntimeAgentTimelineSummary,
} from '@nimiplatform/sdk/runtime';
import { logRendererEvent } from '@renderer/bridge/runtime-bridge/logging';
import type { JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';

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

export function toResolvedEnvelope(value: unknown): AgentResolvedMessageActionEnvelope {
  return parseRuntimeAgentStructuredMessageActionEnvelope(value);
}

export function cloneEnvelopeWithCommittedMessage(input: {
  envelope: AgentResolvedMessageActionEnvelope;
  messageId: string;
  text: string;
}): AgentResolvedMessageActionEnvelope {
  return cloneAgentResolvedMessageActionEnvelopeWithCommittedMessage(input);
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
