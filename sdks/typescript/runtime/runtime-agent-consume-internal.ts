import { createNimiError, type JsonObject } from '../types';
import { normalizeNimiRuntimeAgentText } from './runtime-agent-values';

export function runtimeAgentError(message: string, reasonCode: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode,
    actionHint,
    source: 'sdk',
  });
}

export function normalizeText(value: unknown): string {
  return normalizeNimiRuntimeAgentText(value);
}

export function requireText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    runtimeAgentError(
      `Runtime Agent consume requires ${field}`,
      'SDK_RUNTIME_AGENT_INPUT_INVALID',
      'provide_runtime_agent_consume_input',
    );
  }
  return normalized;
}

export function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function optionalString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return undefined;
}

export function asRecord(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}
