import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { AppStoreState } from '@renderer/app-shell/providers/app-store';
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
    } else if (auth.status === 'anonymous' && prev.status !== 'anonymous') {
      logRendererEvent({
        level: 'info',
        area: 'auth-state-watcher',
        message: 'phase:auth-cleared',
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
