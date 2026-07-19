import type {
  DesktopAccountSessionEvent,
  DesktopAccountSessionState,
  DesktopAccountSessionStatus,
} from '@renderer/bridge';
import type { RuntimeAccountAuthProjection } from '@renderer/app-shell/providers/store-types';

export type RuntimeAccountStreamCursor = {
  readonly sequence: bigint;
  readonly snapshotObserved: boolean;
};

export type RuntimeAccountStreamAdvance =
  | { readonly kind: 'apply'; readonly cursor: RuntimeAccountStreamCursor }
  | { readonly kind: 'resync'; readonly reason: string };

export function createRuntimeAccountStreamCursor(afterSequence: string): RuntimeAccountStreamCursor {
  return { sequence: BigInt(afterSequence), snapshotObserved: false };
}

export function advanceRuntimeAccountStreamCursor(
  cursor: RuntimeAccountStreamCursor,
  event: DesktopAccountSessionEvent,
): RuntimeAccountStreamAdvance {
  const sequence = BigInt(event.sequence);
  if (event.replayTruncated) {
    return { kind: 'resync', reason: 'replay-truncated' };
  }
  if (event.deliveryKind === 'replay') {
    if (cursor.snapshotObserved || sequence !== cursor.sequence + 1n) {
      return { kind: 'resync', reason: 'invalid-replay-order' };
    }
    return { kind: 'apply', cursor: { sequence, snapshotObserved: false } };
  }
  if (event.deliveryKind === 'snapshot') {
    if (cursor.snapshotObserved || sequence !== cursor.sequence) {
      return { kind: 'resync', reason: 'invalid-snapshot-order' };
    }
    return { kind: 'apply', cursor: { sequence, snapshotObserved: true } };
  }
  if (!cursor.snapshotObserved || sequence !== cursor.sequence + 1n) {
    return { kind: 'resync', reason: 'live-sequence-gap' };
  }
  return { kind: 'apply', cursor: { sequence, snapshotObserved: true } };
}

export function projectRuntimeAccountAuthState(
  status: DesktopAccountSessionStatus | DesktopAccountSessionEvent,
  currentUser: Record<string, unknown> | null,
): RuntimeAccountAuthProjection {
  const projection = status.accountProjection;
  const projectedUser = projection?.accountId
    ? {
        id: projection.accountId,
        displayName: projection.displayName,
        realmEnvironmentId: projection.realmEnvironmentId,
      }
    : null;
  const retainUser = status.state === 'refresh-pending'
    || status.state === 'switching'
    || status.state === 'logging-out';
  return {
    status: status.state,
    sequence: status.sequence,
    reasonCode: status.reasonCode,
    accountReasonCode: status.accountReasonCode,
    user: status.state === 'authenticated'
      ? projectedUser
      : retainUser
        ? projectedUser ?? currentUser
        : null,
  };
}

export function runtimeAccountConnectivityDisposition(
  state: DesktopAccountSessionState,
  previousState?: DesktopAccountSessionState | 'bootstrapping',
): 'reachable' | 'unknown' | 'unchanged' {
  if (state === 'authenticated'
    && (previousState === 'refresh-pending' || previousState === 'login-pending')) {
    return 'reachable';
  }
  if (state === 'anonymous'
    || state === 'expired'
    || state === 'reauth-required'
    || state === 'unavailable') {
    return 'unknown';
  }
  return 'unchanged';
}

export function runtimeAccountClearsAccountMemory(state: DesktopAccountSessionState): boolean {
  return state === 'anonymous'
    || state === 'expired'
    || state === 'reauth-required'
    || state === 'switching'
    || state === 'logging-out'
    || state === 'unavailable';
}
