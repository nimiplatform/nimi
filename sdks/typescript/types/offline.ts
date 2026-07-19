import { classifyOfflineReasonCode, type OfflineReasonCodeOwner } from './reason-code.js';

export type OfflineErrorClassificationOptions = {
  transportOwner?: OfflineReasonCodeOwner;
};

function readErrorString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized) {
        return normalized;
      }
    }
  }
  return '';
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === 'object' && !Array.isArray(error)
    ? error as Record<string, unknown>
    : {};
}

function offlineErrorReasonCode(error: unknown): string {
  const record = errorRecord(error);
  return readErrorString(record, ['reasonCode', 'reason_code', 'reason', 'code']);
}

function offlineErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return String(error.message || '').trim();
  }
  const record = errorRecord(error);
  const message = readErrorString(record, ['message', 'detail', 'reasonDetail']);
  if (message) {
    return message;
  }
  return String(error || '').trim();
}

export function getNimiErrorMessage(error: unknown, fallback: string): string {
  const message = offlineErrorMessage(error);
  return message || fallback;
}

export function classifyOfflineError(
  error: unknown,
  options: OfflineErrorClassificationOptions = {},
): OfflineReasonCodeOwner | null {
  const reasonCode = offlineErrorReasonCode(error);
  const reasonOwner = classifyOfflineReasonCode(reasonCode);
  if (reasonOwner) {
    return reasonOwner;
  }
  const message = offlineErrorMessage(error);
  if (!message) {
    return null;
  }
  if (/network|fetch failed|failed to fetch|load failed|timeout/i.test(message)) {
    return options.transportOwner ?? null;
  }
  return null;
}

export function isRealmOfflineErrorLike(
  error: unknown,
  options: OfflineErrorClassificationOptions = {},
): boolean {
  return classifyOfflineError(error, options) === 'realm';
}

export function isRuntimeOfflineErrorLike(
  error: unknown,
  options: OfflineErrorClassificationOptions = {},
): boolean {
  return classifyOfflineError(error, options) === 'runtime';
}
