import { asRecord } from '../internal/utils.js';
import type { JsonObject } from '../internal/utils.js';

export { asRecord };

/**
 * Parse JSON without pretending to validate shape.
 * Use safeParseObject/safeParseArray for runtime-checked collection variants,
 * or pass a validator when a typed result is required.
 */
export function safeParseJson(text: string, fallback: unknown): unknown;
export function safeParseJson<T>(text: string, fallback: T, validate: (value: unknown) => value is T): T;
export function safeParseJson<T>(
  text: string,
  fallback: T,
  validate?: (value: unknown) => value is T,
): T | unknown {
  try {
    const parsed = JSON.parse(String(text || '')) as unknown;
    if (!validate) {
      return parsed;
    }
    return validate(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function safeParseObject(text: string): JsonObject {
  const parsed = safeParseJson(String(text || '{}'), {});
  return asRecord(parsed);
}

export function safeParseArray(text: string): unknown[] {
  const parsed = safeParseJson(String(text || '[]'), []);
  return Array.isArray(parsed) ? parsed : [];
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

export function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp01(value: unknown, fallback = 0.5): number {
  const numeric = toFiniteNumber(value, fallback);
  return Math.max(0, Math.min(1, numeric));
}
