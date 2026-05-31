import { createNimiClientId, createNimiError } from '@nimiplatform/sdk/runtime';
import {
  classifyOfflineError,
  type NimiError,
  type NimiErrorSource,
} from '@nimiplatform/sdk/types';

export { isNimiErrorLike } from '@nimiplatform/sdk/types';

function randomTraceId(): string {
  return createNimiClientId('offline');
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = String(error.message || '').trim();
    return message || fallback;
  }
  const message = String(error || '').trim();
  return message || fallback;
}

export function isRealmOfflineError(error: unknown): boolean {
  return classifyOfflineError(error, { transportOwner: 'realm' }) === 'realm';
}

export function isRuntimeOfflineError(error: unknown): boolean {
  return classifyOfflineError(error, { transportOwner: 'runtime' }) === 'runtime';
}

export function createOfflineError(input: {
  source: NimiErrorSource;
  reasonCode: string;
  message: string;
  actionHint: string;
  retryable?: boolean;
}): NimiError {
  return createNimiError({
    message: input.message,
    code: input.reasonCode,
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    traceId: randomTraceId(),
    retryable: input.retryable !== false,
    source: input.source,
    details: {},
  });
}
