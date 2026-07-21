import type {
  ConversationRuntimeTrace,
} from '@nimiplatform/kit/features/chat/headless';
import {
  cloneNimiRuntimeAgentResolvedMessageActionEnvelopeWithCommittedMessage,
  parseNimiRuntimeAgentStructuredMessageActionEnvelope,
  type NimiRuntimeAgentResolvedMessageActionEnvelope,
  type NimiRuntimeAgentTimelineSummary,
} from '@nimiplatform/sdk/runtime';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import type { JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';

export type PendingCommittedMessage = {
  messageId: string;
  text: string;
  runtimeTurnId: string;
  runtimeStreamId: string;
};

export function safeLogRuntimeAgentEvent(input: Parameters<typeof logRendererEvent>[0]): void {
  logRendererEvent(input);
}

export function safeLogRuntimeAgentTiming(input: {
  stage: string;
  startedAt: number;
  details?: JsonObject;
  now?: () => number;
}): void {
  safeLogRuntimeAgentEvent({
    level: 'info',
    area: 'agent-chat-runtime-latency',
    message: `phase:${input.stage}`,
    costMs: Math.max(0, Math.round((input.now?.() ?? input.startedAt) - input.startedAt)),
    details: {
      stage: input.stage,
      ...(input.details || {}),
    },
  });
}

export function toResolvedEnvelope(value: unknown): NimiRuntimeAgentResolvedMessageActionEnvelope {
  return parseNimiRuntimeAgentStructuredMessageActionEnvelope(value);
}

export function cloneEnvelopeWithCommittedMessage(input: {
  envelope: NimiRuntimeAgentResolvedMessageActionEnvelope;
  messageId: string;
  text: string;
}): NimiRuntimeAgentResolvedMessageActionEnvelope {
  return cloneNimiRuntimeAgentResolvedMessageActionEnvelopeWithCommittedMessage(input);
}

export function toDebugMetadata(input: {
  prompt: string;
  systemPrompt: string | null;
  conversationAnchorId: string;
  runtimeTurnId: string;
  runtimeStreamId: string;
  trace?: ConversationRuntimeTrace;
  envelope: NimiRuntimeAgentResolvedMessageActionEnvelope;
  latestTimeline?: NimiRuntimeAgentTimelineSummary | null;
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
      traceId: input.trace?.traceId || null,
      presentationTimeline: input.latestTimeline || null,
    },
  } satisfies JsonObject;
}

export function buildRuntimeAgentDiagnostics(input: {
  conversationAnchorId: string;
  runtimeTurnId: string;
  runtimeStreamId: string;
  trace?: ConversationRuntimeTrace;
  extra?: JsonObject;
}): JsonObject {
  return {
    transport: 'runtime.agent.turns',
    conversationAnchorId: input.conversationAnchorId,
    runtimeTurnId: input.runtimeTurnId,
    runtimeStreamId: input.runtimeStreamId,
    traceId: input.trace?.traceId || null,
    ...(input.extra || {}),
  } as JsonObject;
}

export function resolveRuntimeTrace(): ConversationRuntimeTrace | undefined {
  return undefined;
}
