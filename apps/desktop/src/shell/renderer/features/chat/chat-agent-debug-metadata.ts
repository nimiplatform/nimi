import type { JsonObject } from '@renderer/bridge/runtime-bridge/shared';
import type {
  AgentModelOutputDiagnostics,
} from './chat-agent-behavior-resolver';
import type { AgentResolvedStatusCue } from './chat-agent-behavior';

export type AgentTextTurnDebugMetadata = {
  debugType: 'agent-text-turn';
  prompt: string;
  systemPrompt: string | null;
  rawModelOutput: string | null;
  normalizedModelOutput: string | null;
  statusCue: AgentResolvedStatusCue | null;
  followUpInstruction: string | null;
  followUpTurn: boolean;
  chainId: string | null;
  followUpDepth: number | null;
  maxFollowUpTurns: number | null;
  followUpCanceledByUser: boolean;
  followUpSourceActionId: string | null;
  followUpDelayMs: number | null;
  runtimeAgentTurns?: {
    transport: 'runtime.agent.turns';
    conversationAnchorId: string | null;
    runtimeTurnId: string | null;
    runtimeStreamId: string | null;
    route: string | null;
    modelId: string | null;
    connectorId: string | null;
    traceId: string | null;
    modelResolved: string | null;
    routeDecision: string | null;
  } | null;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeNullableText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseStatusCue(value: unknown): AgentResolvedStatusCue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const sourceMessageId = normalizeNullableText(record.sourceMessageId);
  if (!sourceMessageId) {
    return null;
  }
  const mood = normalizeNullableText(record.mood);
  const label = normalizeNullableText(record.label);
  const actionCue = normalizeNullableText(record.actionCue);
  const intensity = Number.isFinite(Number(record.intensity))
    ? Number(record.intensity)
    : null;
  return {
    sourceMessageId,
    ...(mood ? { mood: mood as AgentResolvedStatusCue['mood'] } : {}),
    ...(label ? { label } : {}),
    ...(intensity != null ? { intensity } : {}),
    ...(actionCue ? { actionCue } : {}),
  };
}

function parseRuntimeAgentTurns(value: unknown): AgentTextTurnDebugMetadata['runtimeAgentTurns'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (normalizeNullableText(record.transport) !== 'runtime.agent.turns') {
    return null;
  }
  return {
    transport: 'runtime.agent.turns',
    conversationAnchorId: normalizeNullableText(record.conversationAnchorId),
    runtimeTurnId: normalizeNullableText(record.runtimeTurnId),
    runtimeStreamId: normalizeNullableText(record.runtimeStreamId),
    route: normalizeNullableText(record.route),
    modelId: normalizeNullableText(record.modelId),
    connectorId: normalizeNullableText(record.connectorId),
    traceId: normalizeNullableText(record.traceId),
    modelResolved: normalizeNullableText(record.modelResolved),
    routeDecision: normalizeNullableText(record.routeDecision),
  };
}

export function buildAgentTextTurnDebugMetadata(
  diagnostics: AgentModelOutputDiagnostics | null | undefined,
  options?: {
    statusCue?: AgentResolvedStatusCue | null;
    followUpTurn?: boolean;
    followUpInstruction?: string | null;
    chainId?: string | null;
    followUpDepth?: number | null;
    maxFollowUpTurns?: number | null;
    followUpCanceledByUser?: boolean;
    followUpSourceActionId?: string | null;
    followUpDelayMs?: number | null;
  },
): JsonObject | null {
  const prompt = normalizeText(diagnostics?.requestPrompt);
  if (!prompt) {
    return null;
  }
  return {
    debugType: 'agent-text-turn',
    prompt,
    systemPrompt: normalizeNullableText(diagnostics?.requestSystemPrompt),
    rawModelOutput: normalizeNullableText(diagnostics?.rawModelOutputText),
    normalizedModelOutput: normalizeNullableText(diagnostics?.normalizedModelOutputText),
    statusCue: options?.statusCue || null,
    followUpInstruction: normalizeNullableText(options?.followUpInstruction),
    followUpTurn: options?.followUpTurn === true,
    chainId: normalizeNullableText(options?.chainId ?? diagnostics?.chainId),
    followUpDepth: Number.isFinite(Number(options?.followUpDepth ?? diagnostics?.followUpDepth))
      ? Number(options?.followUpDepth ?? diagnostics?.followUpDepth)
      : null,
    maxFollowUpTurns: Number.isFinite(Number(options?.maxFollowUpTurns ?? diagnostics?.maxFollowUpTurns))
      ? Number(options?.maxFollowUpTurns ?? diagnostics?.maxFollowUpTurns)
      : null,
    followUpCanceledByUser: options?.followUpCanceledByUser === true || diagnostics?.followUpCanceledByUser === true,
    followUpSourceActionId: normalizeNullableText(options?.followUpSourceActionId),
    followUpDelayMs: Number.isFinite(Number(options?.followUpDelayMs))
      ? Number(options?.followUpDelayMs)
      : null,
    runtimeAgentTurns: null,
  } satisfies AgentTextTurnDebugMetadata;
}

export function parseAgentTextTurnDebugMetadata(value: unknown): AgentTextTurnDebugMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.debugType !== 'agent-text-turn') {
    return null;
  }
  const prompt = normalizeText(record.prompt);
  if (!prompt) {
    return null;
  }
  return {
    debugType: 'agent-text-turn',
    prompt,
    systemPrompt: normalizeNullableText(record.systemPrompt),
    rawModelOutput: normalizeNullableText(record.rawModelOutput),
    normalizedModelOutput: normalizeNullableText(record.normalizedModelOutput),
    statusCue: parseStatusCue(record.statusCue),
    followUpInstruction: normalizeNullableText(record.followUpInstruction),
    followUpTurn: record.followUpTurn === true,
    chainId: normalizeNullableText(record.chainId),
    followUpDepth: Number.isFinite(Number(record.followUpDepth))
      ? Number(record.followUpDepth)
      : null,
    maxFollowUpTurns: Number.isFinite(Number(record.maxFollowUpTurns))
      ? Number(record.maxFollowUpTurns)
      : null,
    followUpCanceledByUser: record.followUpCanceledByUser === true,
    followUpSourceActionId: normalizeNullableText(record.followUpSourceActionId),
    followUpDelayMs: Number.isFinite(Number(record.followUpDelayMs))
      ? Number(record.followUpDelayMs)
      : null,
    runtimeAgentTurns: parseRuntimeAgentTurns(record.runtimeAgentTurns),
  };
}
