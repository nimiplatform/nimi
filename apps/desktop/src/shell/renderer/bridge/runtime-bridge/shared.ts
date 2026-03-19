import type { RuntimeLogMessage } from '@runtime/telemetry/logger';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = unknown;
export type JsonObject = Record<string, unknown>;
export type JsonArray = JsonValue[];

export type RendererLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type RendererLogMessage = RuntimeLogMessage;

export type RendererLogPayload = {
  level: RendererLogLevel;
  area: string;
  message: RendererLogMessage;
  traceId?: string;
  flowId?: string;
  source?: string;
  costMs?: number;
  details?: JsonObject;
};

export type RuntimeBridgeStructuredError = {
  code?: string;
  reasonCode?: string;
  actionHint?: string;
  traceId?: string;
  retryable?: boolean;
  message?: string;
  details?: JsonObject;
};

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function assertRecord(value: unknown, errorMessage: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(errorMessage);
  }
  return value as JsonObject;
}

export function parseOptionalJsonObject(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

export function parseRequiredString(
  value: unknown,
  fieldName: string,
  errorPrefix: string,
): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${errorPrefix}: ${fieldName} is required`);
  }
  return normalized;
}

export function parseOptionalString(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

export function parseOptionalNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}
