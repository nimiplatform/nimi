import { desktopBridge, type DesktopAccountSessionEvent, type DesktopAccountSessionStatus } from '../../bridge';
import { getOfflineCoordinator } from '../offline/coordinator';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import type { DesktopRendererLifecyclePort } from '../../renderer/lifecycle-port.js';
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

export function applyRuntimeAccountStatusProjection(
  status: DesktopAccountSessionStatus | DesktopAccountSessionEvent,
  lifecycle: Pick<
    DesktopRendererLifecyclePort,
    'applyRuntimeAccountProjection' | 'auth' | 'cancelAndClearQueries'
  >,
): void {
  const current = lifecycle.auth();
  lifecycle.applyRuntimeAccountProjection(
    projectRuntimeAccountAuthState(status, current.user),
  );

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
  const runGeneration = ++generation;
  void resyncAndSubscribe(runGeneration, lifecycle);
}

export function stopAuthStateWatcher(): void {
  watcherRunning = false;
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
): Promise<void> {
  unsubscribe?.();
  unsubscribe = null;
  try {
    const status = await desktopBridge.getRuntimeAccountSessionStatus();
    if (runGeneration !== generation) return;
    getOfflineCoordinator().markRuntimeReachability('reachable');
    applyRuntimeAccountStatusProjection(status, lifecycle);
    await openSubscription(runGeneration, status.sequence, lifecycle);
    if (runGeneration === generation && unsubscribe) {
      retryAttempt = 0;
    }
  } catch (error) {
    if (runGeneration !== generation) return;
    applyRuntimeAccountUnavailableProjection(lifecycle);
    getOfflineCoordinator().markRuntimeReachability('unreachable');
    logRendererEvent({
      level: 'warn',
      area: 'auth-state-watcher',
      message: 'phase:runtime-account-status:unavailable',
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    scheduleRetry(runGeneration, lifecycle);
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
    applyRuntimeAccountUnavailableProjection(lifecycle);
    scheduleRetry(runGeneration, lifecycle);
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
      applyRuntimeAccountStatusProjection(event, lifecycle);
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
): void {
  const current = lifecycle.auth();
  lifecycle.applyRuntimeAccountProjection({
    status: 'unavailable',
    sequence: current.sequence,
    reasonCode: current.reasonCode,
    accountReasonCode: current.accountReasonCode,
    user: null,
  });
  void lifecycle.cancelAndClearQueries();
  getOfflineCoordinator().markRealmRestReachability('unknown');
}

function scheduleRetry(
  runGeneration: number,
  lifecycle: DesktopRendererLifecyclePort,
): void {
  if (retryTimer || runGeneration !== generation) return;
  const delayMs = Math.min(1_000 * (2 ** retryAttempt), 30_000);
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void resyncAndSubscribe(runGeneration, lifecycle);
  }, delayMs);
}
