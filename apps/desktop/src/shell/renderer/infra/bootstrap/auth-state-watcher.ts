import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { AppStoreState } from '@renderer/app-shell/providers/app-store';
import {
  runLocalAgentProvisionCourierPass,
  runLocalAgentTerminationCourierPass,
  startLocalAgentProvisionCourier,
  startLocalAgentTerminationCourier,
  stopLocalAgentCouriers,
} from '@renderer/infra/local-agent-courier';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';

type AuthSnapshot = { status: string };

function selectAuth(state: AppStoreState): AuthSnapshot {
  return { status: state.auth.status };
}

function authEqual(a: AuthSnapshot, b: AuthSnapshot): boolean {
  return a.status === b.status;
}

let unsubscribe: (() => void) | null = null;

export function startAuthStateWatcher() {
  if (unsubscribe) {
    return;
  }

  let prevAuth = selectAuth(useAppStore.getState());

  unsubscribe = useAppStore.subscribe((state: AppStoreState) => {
    const auth = selectAuth(state);
    if (authEqual(auth, prevAuth)) {
      return;
    }
    const prev = prevAuth;
    prevAuth = auth;

    if (auth.status === 'authenticated') {
      logRendererEvent({
        level: 'info',
        area: 'auth-state-watcher',
        message: 'phase:auth-projection-observed',
        details: {
          hasUser: Boolean(state.auth.user),
        },
      });
      // R-SOC-008 desktop reconciliation courier: on every authenticated
      // transition (startup / post-login / re-login) run one stateless courier
      // pass and register the ~60s tick. The startup pass is what converges a
      // device that was offline when the source admission was removed — the intent
      // has stayed OPEN server-side and the loopback runtime is reachable
      // exactly when this device is online.
      startLocalAgentTerminationCourier();
      void runLocalAgentTerminationCourierPass().catch(() => {
        // Transport/offline failures are expected and telemetered by the
        // courier; the intent stays OPEN for the periodic tick.
      });
      // R-SOC-009 desktop reconciliation courier (creation side): on every
      // authenticated transition run one stateless provision courier pass and
      // register the ~60s tick. The startup pass converges a device that was
      // offline when the source admission was created — the provision intent has
      // stayed OPEN server-side and the loopback runtime is reachable exactly
      // when this device is online.
      startLocalAgentProvisionCourier();
      void runLocalAgentProvisionCourierPass().catch(() => {
        // Transport/offline failures are expected and telemetered by the
        // courier; the intent stays OPEN for the periodic tick.
      });
    } else if (auth.status === 'anonymous' && prev.status !== 'anonymous') {
      stopLocalAgentCouriers();
      logRendererEvent({
        level: 'info',
        area: 'auth-state-watcher',
        message: 'phase:auth-cleared:local-agent-couriers-stopped',
      });
    }
  });

  logRendererEvent({
    level: 'info',
    area: 'auth-state-watcher',
    message: 'phase:auth-state-watcher:started',
  });
}

export function stopAuthStateWatcher() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}
