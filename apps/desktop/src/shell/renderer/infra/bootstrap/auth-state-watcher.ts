import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { AppStoreState } from '@renderer/app-shell/providers/app-store';
import { dataSync } from '@runtime/data-sync';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { persistSharedDesktopSession } from '@renderer/features/auth/shared-auth-session';

type AuthSnapshot = { status: string; token: string; refreshToken: string };

function selectAuth(state: AppStoreState): AuthSnapshot {
  return { status: state.auth.status, token: state.auth.token, refreshToken: state.auth.refreshToken };
}

function authEqual(a: AuthSnapshot, b: AuthSnapshot): boolean {
  return a.status === b.status && a.token === b.token && a.refreshToken === b.refreshToken;
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

    if (auth.status === 'authenticated' && auth.token) {
      dataSync.setToken(auth.token);
      if (auth.refreshToken) {
        dataSync.setRefreshToken(auth.refreshToken);
      }
      if (auth.token !== prev.token) {
        dataSync.scheduleProactiveRefresh(auth.token);
      }
      const realmBaseUrl = String(state.runtimeDefaults?.realm?.realmBaseUrl || '').trim();
      if (!realmBaseUrl) {
        logRendererEvent({
          level: 'warn',
          area: 'auth-state-watcher',
          message: 'phase:auth-persist:skipped',
          details: {
            reason: 'missing-realm-base-url',
          },
        });
        return;
      }
      void persistSharedDesktopSession({
        realmBaseUrl,
        accessToken: auth.token,
        refreshToken: auth.refreshToken,
        user: state.auth.user,
      }).then(() => {
        logRendererEvent({
          level: 'info',
          area: 'auth-state-watcher',
          message: 'phase:auth-persist:done',
          details: {
            hasRefreshToken: Boolean(auth.refreshToken),
            hasUser: Boolean(state.auth.user),
          },
        });
      }).catch((error) => {
        logRendererEvent({
          level: 'warn',
          area: 'auth-state-watcher',
          message: 'phase:auth-persist:failed',
          details: {
            error: error instanceof Error ? error.message : String(error || ''),
            hasRefreshToken: Boolean(auth.refreshToken),
          },
        });
      });
      // Contacts prewarm is handled by runtime-bootstrap-auth + React Query.
      // Duplicate prewarm call removed to avoid startup request storm.
    } else if (auth.status === 'anonymous' && prev.status !== 'anonymous') {
      dataSync.setToken('');
      dataSync.setRefreshToken('');
      dataSync.stopAllPolling();
      dataSync.clearProactiveRefreshTimer();
      logRendererEvent({
        level: 'info',
        area: 'auth-state-watcher',
        message: 'phase:auth-cleared:datasync-reset',
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
