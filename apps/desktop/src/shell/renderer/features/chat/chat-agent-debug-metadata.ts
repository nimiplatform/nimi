import type { JsonObject } from '@renderer/bridge/runtime-bridge/shared';
import type { AgentModelOutputDiagnostics } from './chat-agent-behavior-resolver';

export type AgentTextTurnDebugMetadata = {
  debugType: 'agent-text-turn';
  prompt: string;
  systemPrompt: string | null;
  rawModelOutput: string | null;
  normalizedModelOutput: string | null;
  followUpTurn: boolean;
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
    followUpTurn: options?.followUpTurn === true,
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
    followUpTurn: record.followUpTurn === true,
    followUpSourceActionId: normalizeNullableText(record.followUpSourceActionId),
    followUpDelayMs: Number.isFinite(Number(record.followUpDelayMs))
      ? Number(record.followUpDelayMs)
      : null,
  };
}
