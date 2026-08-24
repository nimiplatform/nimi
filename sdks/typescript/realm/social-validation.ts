import { createNimiError, type JsonObject } from '../types';

export function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

export function toNullableString(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized || null;
}

export function toRecord(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

export function socialError(input: {
  readonly reasonCode: string;
  readonly message: string;
  readonly actionHint: string;
  readonly details?: JsonObject;
}): Error {
  return createNimiError({
    message: input.message,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: 'realm',
    details: input.details,
  });
}

export function requireText(value: unknown, input: {
  readonly reasonCode: string;
  readonly message: string;
  readonly actionHint: string;
}): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw socialError(input);
  }
  return normalized;
}
