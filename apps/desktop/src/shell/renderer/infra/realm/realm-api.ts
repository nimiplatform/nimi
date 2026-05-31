import { getPlatformClient } from '@nimiplatform/sdk';
import type { Realm } from '@nimiplatform/sdk/realm';
import { ReasonCode, tryParseJsonLike } from '@nimiplatform/sdk/types';
import { extractRuntimeErrorFields } from '@runtime/telemetry/error-fields';
import { emitRuntimeLog } from '@runtime/telemetry/logger';
import {
  getOfflineCoordinator,
  isRealmOfflineError,
} from '@renderer/infra/offline';
import { normalizeApiError } from '@runtime/net/error-normalize';

export type RealmApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;
export type RealmDataErrorEmitter = (
  action: string,
  error: unknown,
  details?: Record<string, unknown>,
) => void;

export async function callRealmApi<T>(
  task: (realm: Realm) => Promise<T>,
  fallbackMessage?: string,
): Promise<T> {
  try {
    const result = await task(getPlatformClient().realm);
    getOfflineCoordinator().markRealmRestReachable(true);
    return tryParseJsonLike(result);
  } catch (error) {
    const normalized = normalizeApiError(error, fallbackMessage);
    if (isRealmOfflineError(normalized)) {
      getOfflineCoordinator().markRealmRestReachable(false);
    }
    throw normalized;
  }
}

export function emitRealmDataError(
  action: string,
  error: unknown,
  details: Record<string, unknown> = {},
): void {
  const errorFields = extractRuntimeErrorFields(error);
  if (errorFields.reasonCode === ReasonCode.REALM_UNAVAILABLE || isRealmOfflineError(error)) {
    getOfflineCoordinator().markRealmRestReachable(false);
  }
  emitRuntimeLog({
    level: 'error',
    area: 'realm-data',
    message: `action:${action}:failed`,
    traceId: errorFields.traceId,
    details: {
      ...details,
      reasonCode: errorFields.reasonCode,
      actionHint: errorFields.actionHint,
      retryable: errorFields.retryable,
      traceId: errorFields.traceId,
      error: errorFields.message || (error instanceof Error ? error.message : String(error || '')),
    },
  });
}
