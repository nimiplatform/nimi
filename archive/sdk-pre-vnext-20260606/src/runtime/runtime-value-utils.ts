
import { ReasonCode } from '../types/index.js';
import { createNimiError } from '../core/errors.js';
import { asRecord, normalizeText, nowIso } from '../internal/utils.js';

export { asRecord, normalizeText, nowIso };

export function ensureText(value: unknown, fieldName: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: `${fieldName} is required`,
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: `set_${fieldName}`,
      source: 'sdk',
    });
  }
  return normalized;
}

export function parseCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return undefined;
}

export function toLabels(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalizedKey = normalizeText(key);
    const normalizedValue = normalizeText(value);
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    labels[normalizedKey] = normalizedValue;
  }
  return labels;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function toIsoFromTimestamp(value: unknown): string | undefined {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }

  const secondsRaw = record.seconds;
  const nanosRaw = record.nanos;
  const seconds = Number(secondsRaw);
  const nanos = Number(nanosRaw);
  if (!Number.isFinite(seconds)) {
    return undefined;
  }

  const millis = (seconds * 1000) + (Number.isFinite(nanos) ? Math.floor(nanos / 1_000_000) : 0);
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
