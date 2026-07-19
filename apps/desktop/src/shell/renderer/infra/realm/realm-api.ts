import type { Realm } from '@nimiplatform/sdk/realm';
import {
  extractNimiErrorFields,
  isRealmOfflineErrorLike as isRealmOfflineError,
  isRuntimeOfflineErrorLike as isRuntimeOfflineError,
  normalizeApiError,
  ReasonCode,
  tryParseJsonLike,
} from '@nimiplatform/sdk/types';
import { emitRuntimeLog } from '@nimiplatform/kit/telemetry';
import { getOfflineCoordinator } from '@renderer/infra/offline/coordinator';
import { getDesktopRealm } from '@renderer/infra/sdk/desktop-nimi-client-session';
import { resolveRealmDataErrorLogLevel } from './realm-api-log-level';

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
    const result = await task(getDesktopRealm());
    getOfflineCoordinator().markRealmRestReachability('reachable');
    return tryParseJsonLike(result);
  } catch (error) {
    const normalized = normalizeApiError(error, fallbackMessage);
    if (isRealmOfflineError(normalized)) {
      getOfflineCoordinator().markRealmRestReachability('unreachable');
    }
    throw normalized;
  }
}

export function emitRealmDataError(
  action: string,
  error: unknown,
  details: Record<string, unknown> = {},
): void {
  const errorFields = extractNimiErrorFields(error);
  const realmOffline = errorFields.reasonCode === ReasonCode.REALM_UNAVAILABLE || isRealmOfflineError(error);
  const runtimeOffline = errorFields.reasonCode === ReasonCode.RUNTIME_UNAVAILABLE || isRuntimeOfflineError(error);
  if (realmOffline) {
    getOfflineCoordinator().markRealmRestReachability('unreachable');
  }
  emitRuntimeLog({
    level: resolveRealmDataErrorLogLevel({
      action,
      reasonCode: errorFields.reasonCode,
      realmOffline,
      runtimeOffline,
    }),
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
