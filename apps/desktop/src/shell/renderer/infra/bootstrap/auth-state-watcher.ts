import { desktopBridge, type DesktopAccountSessionEvent, type DesktopAccountSessionStatus } from '../../bridge';
import { getOfflineCoordinator } from '../offline/coordinator';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import type { DesktopRendererLifecyclePort } from '../../renderer/lifecycle-port.js';
import { getDesktopFormalAppClient } from '../sdk/desktop-nimi-client-session.js';
import { recoverRuntimeAppSession } from './runtime-app-session-recovery.js';
import {
  advanceRuntimeAccountStreamCursor,
  createRuntimeAccountStreamCursor,
  projectRuntimeAccountAuthState,
  runtimeAccountClearsAccountMemory,
  runtimeAccountConnectivityDisposition,
} from './runtime-account-state-machine';

let unsubscribe: (() => void) | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
let retryAttempt = 0;
let watcherRunning = false;
let activeLifecycle: DesktopRendererLifecyclePort | null = null;
let appSessionRecoveryRevision = 0;
type AccountRecoveryIdentity = { accountId: string; realmEnvironmentId: string; authorizationRevision: string };
// Suppresses only duplicate Account-driven recovery after an observed success.
// This is not App/PPS readiness; independent owner failures keep their gates.
// @nimi-authority: rule.nimi.runtime.protected-session.r031
let recoveredAccount: AccountRecoveryIdentity | null = null;

function recoveryIdentity(auth: ReturnType<DesktopRendererLifecyclePort['auth']>): AccountRecoveryIdentity | null {
  const accountId = auth.user?.id;
  const realmEnvironmentId = auth.user?.realmEnvironmentId;
  if (typeof accountId !== 'string' || !accountId || typeof realmEnvironmentId !== 'string' || !realmEnvironmentId
    || !auth.authorizationRevision) return null;
  return { accountId, realmEnvironmentId, authorizationRevision: auth.authorizationRevision };
}

function sameRecoveryIdentity(left: AccountRecoveryIdentity | null, right: AccountRecoveryIdentity | null): boolean {
  return !!left && !!right && left.accountId === right.accountId && left.realmEnvironmentId === right.realmEnvironmentId
    && left.authorizationRevision === right.authorizationRevision;
}

function logRecoveryDecision(
  previous: ReturnType<DesktopRendererLifecyclePort['auth']>,
  current: ReturnType<DesktopRendererLifecyclePort['auth']>,
  recoveryCause: string,
): void {
  logRendererEvent({ level: 'info', area: 'auth-state-watcher', message: 'phase:account-recovery:decision', details: {
    atUnixMs: Date.now(), fromState: previous.status, toState: current.status,
    samePrincipal: !!previous.user?.id && !!previous.user.realmEnvironmentId
      && previous.user.id === current.user?.id && previous.user.realmEnvironmentId === current.user?.realmEnvironmentId,
    revisionChanged: previous.authorizationRevision !== current.authorizationRevision,
    recoveryCause,
  } });
}

export function applyRuntimeAccountStatusProjection(
  status: DesktopAccountSessionStatus | DesktopAccountSessionEvent,
  lifecycle: Pick<
    DesktopRendererLifecyclePort,
    'applyRuntimeAccountProjection' | 'auth' | 'cancelAndClearQueries' | 'setStatusBanner' | 'translate'
  >,
): void {
  const current = lifecycle.auth();
  if (status.state !== current.status
    || status.accountProjection?.accountId !== current.user?.id
    || status.accountProjection?.realmEnvironmentId !== current.user?.realmEnvironmentId
    || status.authorizationRevision !== current.authorizationRevision) {
    appSessionRecoveryRevision += 1;
  }
  lifecycle.applyRuntimeAccountProjection(
    projectRuntimeAccountAuthState(status, current.user),
  );
  if ((status.state !== 'authenticated' && status.state !== 'refresh-pending')
    || !sameRecoveryIdentity(recoveredAccount, recoveryIdentity(lifecycle.auth()))) recoveredAccount = null;

  if (status.auditDiagnostic) lifecycle.setStatusBanner({ kind: 'warning', message: lifecycle.translate('Feedback.auditResultUnrecorded') });

  const coordinator = getOfflineCoordinator();
  const connectivity = runtimeAccountConnectivityDisposition(status.state, current.status);
  if (connectivity !== 'unchanged') {
    coordinator.markRealmRestReachability(connectivity);
  }

  if (runtimeAccountClearsAccountMemory(status.state)) {
    void lifecycle.cancelAndClearQueries();
  }
}

export function startAuthStateWatcher(lifecycle: DesktopRendererLifecyclePort): void {
  if (watcherRunning) return;
  watcherRunning = true;
  recoveredAccount = null;
  activeLifecycle = lifecycle;
  const runGeneration = ++generation;
  void resyncAndSubscribe(runGeneration, lifecycle, 'startup');
}

/**
 * Asks Runtime for the account now instead of waiting for the next automatic
 * attempt. Any attempt already in flight is superseded, so only one stream is
 * ever subscribed.
 */
export function retryRuntimeAccountConnectionNow(): void {
  if (!watcherRunning || !activeLifecycle) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const runGeneration = ++generation;
  recoveredAccount = null;
  void resyncAndSubscribe(runGeneration, activeLifecycle, 'explicit-retry');
}

export function stopAuthStateWatcher(): void {
  watcherRunning = false;
  activeLifecycle = null;
  recoveredAccount = null;
  generation += 1;
  unsubscribe?.();
  unsubscribe = null;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  retryAttempt = 0;
}

async function resyncAndSubscribe(
  runGeneration: number,
  lifecycle: DesktopRendererLifecyclePort,
  recoveryCause: string,
): Promise<void> {
  unsubscribe?.();
  unsubscribe = null;
  try {
    const status = await desktopBridge.getRuntimeAccountSessionStatus();
    if (runGeneration !== generation) return;
    getOfflineCoordinator().markRuntimeReachability('reachable');
    const previous = lifecycle.auth();
    applyRuntimeAccountStatusProjection(status, lifecycle);
    logRecoveryDecision(previous, lifecycle.auth(), recoveryCause);
    restoreAppSession(runGeneration, lifecycle);
    await openSubscription(runGeneration, status.sequence, lifecycle);
    if (runGeneration === generation && unsubscribe) {
      retryAttempt = 0;
    }
  } catch (error) {
    if (runGeneration !== generation) return;
    applyRuntimeAccountUnavailableProjection(lifecycle, error instanceof Error ? error.message : String(error));
    getOfflineCoordinator().markRuntimeReachability('unreachable');
    logRendererEvent({
      level: 'warn',
      area: 'auth-state-watcher',
      message: 'phase:runtime-account-status:unavailable',
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    scheduleRetry(runGeneration, lifecycle, 'status-retry');
  }
}

async function openSubscription(
  runGeneration: number,
  afterSequence: string,
  lifecycle: DesktopRendererLifecyclePort,
): Promise<void> {
  let cursor = createRuntimeAccountStreamCursor(afterSequence);
  let resyncRequested = false;
  const requestResync = (reason: string) => {
    if (resyncRequested || runGeneration !== generation) return;
    resyncRequested = true;
    logRendererEvent({
      level: 'warn',
      area: 'auth-state-watcher',
      message: 'phase:runtime-account-stream:resync-required',
      details: { reason, afterSequence: cursor.sequence.toString() },
    });
    unsubscribe?.();
    unsubscribe = null;
    // A missing or malformed stream segment means the renderer can no longer
    // prove which account owns cached product data. Hide the last projection
    // and clear account-scoped queries before asking Runtime for fresh truth.
    applyRuntimeAccountUnavailableProjection(lifecycle, `account stream ${reason}`);
    scheduleRetry(runGeneration, lifecycle, 'stream-resync');
  };

  const nextUnsubscribe = await desktopBridge.subscribeRuntimeAccountSessionEvents(afterSequence, {
    onEvent: (event) => {
      if (runGeneration !== generation || resyncRequested) return;
      const advance = advanceRuntimeAccountStreamCursor(cursor, event);
      if (advance.kind === 'resync') {
        requestResync(advance.reason);
        return;
      }
      cursor = advance.cursor;
      const previousRevision = appSessionRecoveryRevision;
      const previous = lifecycle.auth();
      applyRuntimeAccountStatusProjection(event, lifecycle);
      if (previousRevision !== appSessionRecoveryRevision) {
        const current = lifecycle.auth();
        // @nimi-authority: rule.nimi.runtime.protected-session.r031
        const continuousRefresh = previous.status === 'refresh-pending' && current.status === 'authenticated'
          && sameRecoveryIdentity(recoveryIdentity(previous), recoveryIdentity(current))
          && sameRecoveryIdentity(recoveredAccount, recoveryIdentity(current));
        const cause = continuousRefresh ? 'same-authorization-refresh'
          : current.status !== 'authenticated' ? 'not-authenticated'
          : previous.user?.id !== current.user?.id || previous.user?.realmEnvironmentId !== current.user?.realmEnvironmentId
            ? 'principal-changed'
            : previous.authorizationRevision !== current.authorizationRevision ? 'authorization-changed' : 'account-restored';
        logRecoveryDecision(previous, current, cause);
        if (!continuousRefresh && current.status === 'authenticated') restoreAppSession(runGeneration, lifecycle);
      }
    },
    onError: (error) => {
      logRendererEvent({
        level: 'warn',
        area: 'auth-state-watcher',
        message: 'phase:runtime-account-stream:error',
        details: { error: error instanceof Error ? error.message : String(error) },
      });
      requestResync('stream-error');
    },
    onCompleted: () => requestResync('stream-completed'),
  });
  if (runGeneration !== generation || resyncRequested) {
    nextUnsubscribe();
    return;
  }
  unsubscribe = nextUnsubscribe;
  logRendererEvent({
    level: 'info',
    area: 'auth-state-watcher',
    message: 'phase:runtime-account-stream:subscribed',
    details: { afterSequence },
  });
}

export function applyRuntimeAccountUnavailableProjection(
  lifecycle: DesktopRendererLifecyclePort,
  failureDetail?: string,
): void {
  appSessionRecoveryRevision += 1;
  recoveredAccount = null;
  const current = lifecycle.auth();
  lifecycle.applyRuntimeAccountProjection({
    status: 'unavailable',
    sequence: current.sequence,
    reasonCode: current.reasonCode,
    accountReasonCode: current.accountReasonCode,
    authorizationRevision: '',
    user: null,
    ...(failureDetail ? { failureDetail: failureDetail.slice(0, 400) } : {}),
  });
  lifecycle.clearAgentConversationAnchorBindings();
  void lifecycle.cancelAndClearQueries();
  getOfflineCoordinator().markRealmRestReachability('unknown');
}

function restoreAppSession(runGeneration: number, lifecycle: DesktopRendererLifecyclePort): void {
  // A failed forced retry must not leave an earlier successful baseline usable.
  recoveredAccount = null;
  const revision = appSessionRecoveryRevision;
  const isCurrent = () => runGeneration === generation && revision === appSessionRecoveryRevision;
  void recoverRuntimeAppSession({
    lifecycle,
    readStatus: () => getDesktopFormalAppClient().auth.status(),
    isCurrent,
  }).then((recovered) => {
    if (recovered && isCurrent()) recoveredAccount = recoveryIdentity(lifecycle.auth());
  }).catch((error: unknown) => {
    if (!isCurrent()) return;
    // App-session failure does not change the Runtime account projection.
    logRendererEvent({
      level: 'warn',
      area: 'auth-state-watcher',
      message: 'phase:runtime-app-session:unavailable',
      details: { error: error instanceof Error ? error.message : String(error) },
    });
  });
}

function scheduleRetry(
  runGeneration: number,
  lifecycle: DesktopRendererLifecyclePort,
  recoveryCause: string,
): void {
  if (retryTimer || runGeneration !== generation) return;
  const delayMs = Math.min(1_000 * (2 ** retryAttempt), 30_000);
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void resyncAndSubscribe(runGeneration, lifecycle, recoveryCause);
  }, delayMs);
}
