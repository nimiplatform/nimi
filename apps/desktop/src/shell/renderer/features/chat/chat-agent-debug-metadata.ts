import type { JsonObject } from '@renderer/bridge/runtime-bridge/shared';
import type { AgentModelOutputDiagnostics } from './chat-agent-behavior-resolver';

export type AgentTextTurnDebugMetadata = {
  debugType: 'agent-text-turn';
  prompt: string;
  systemPrompt: string | null;
  rawModelOutput: string | null;
  normalizedModelOutput: string | null;
  followUpInstruction: string | null;
  followUpTurn: boolean;
  chainId: string | null;
  followUpDepth: number | null;
  maxFollowUpTurns: number | null;
  followUpCanceledByUser: boolean;
  followUpSourceActionId: string | null;
  followUpDelayMs: number | null;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeNullableText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function buildAgentTextTurnDebugMetadata(
  diagnostics: AgentModelOutputDiagnostics | null | undefined,
  options?: {
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
  };
}
