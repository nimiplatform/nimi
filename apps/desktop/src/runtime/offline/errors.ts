import {
  isRealmOfflineReasonCode,
  isRuntimeOfflineReasonCode,
  type NimiError,
  type NimiErrorSource,
} from '@nimiplatform/sdk/types';
import { asRecord } from '@runtime/net/json';

function randomTraceId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `offline:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = String(error.message || '').trim();
    return message || fallback;
  }
  const message = String(error || '').trim();
  return message || fallback;
}

export function isNimiErrorLike(error: unknown): error is NimiError {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const record = asRecord(error);
  return typeof record.reasonCode === 'string' && typeof record.actionHint === 'string';
}

export function isRealmOfflineError(error: unknown): boolean {
  if (isNimiErrorLike(error)) {
    return isRealmOfflineReasonCode(error.reasonCode);
  }
  const message = getErrorMessage(error, '');
  return /REALM_UNAVAILABLE|network|fetch failed|failed to fetch|load failed|timeout/i.test(message);
}

export function isRuntimeOfflineError(error: unknown): boolean {
  if (isNimiErrorLike(error)) {
    return Boolean(error.retryable) || isRuntimeOfflineReasonCode(error.reasonCode);
  }
  const message = getErrorMessage(error, '');
  return /RUNTIME_UNAVAILABLE|runtime unavailable|daemon unavailable|bridge unavailable/i.test(message);
}

export function createOfflineError(input: {
  source: NimiErrorSource;
  reasonCode: string;
  message: string;
  actionHint: string;
  retryable?: boolean;
}): NimiError {
  const error = new Error(input.message) as NimiError;
  error.code = input.reasonCode;
  error.reasonCode = input.reasonCode;
  error.actionHint = input.actionHint;
  error.traceId = randomTraceId();
  error.retryable = input.retryable !== false;
  error.source = input.source;
  error.details = {};
  return error;
}
